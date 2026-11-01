// PageStyleApplier - puts a bookmark's saved page style back on the page whenever a page of the
// saved site loads in the bookmark's (or Favorite's) tab, also after a browser restart, with the
// sidebar closed. Runs in the background; the chrome calls are passed in, so tests run under Node.
//
// Only the tab associated with the bookmark gets the style: a hand-opened tab of the same site
// stays unstyled. The inserted text carries the marker id `saved-<rev>`, so the side panel can
// recognize the sheet as the saved one and remove it by its exact text.

import { bookmarkIdFromItemKey, httpOriginOf } from '../stores/savedPageStyles.ts';
import type { SavedPageStyle, SavedPageStyles } from '../stores/savedPageStyles.ts';
import { PageAgentCssSanitizer } from '../utils/pageAgentCss.ts';

/** The fields of chrome.tabs.Tab the applier decides on. */
export interface PageStyleTab
{
  id?: number;
  windowId: number;
  url?: string;
  incognito: boolean;
}

export interface PageStyleApplierDeps
{
  /** Resolves once the startup association restore ended: true when it succeeded (stateReady). */
  ready: Promise<boolean>;
  /** True on a service-worker restart, false in a new browser session or after an extension reload. */
  sameBrowserSession: Promise<boolean>;
  /** The window's tab associations: item keys by tab id. */
  associationsOf: (windowId: number) => Promise<Record<number, string>>;
  /** The saved styles as they are now. */
  styles: () => SavedPageStyles;
  getTab: (tabId: number) => Promise<PageStyleTab>;
  queryTabs: () => Promise<PageStyleTab[]>;
  insertCss: (tabId: number, text: string) => Promise<void>;
  /** The applied id of the page agent's stylesheet on the page, or '' when the page has none. */
  readMarker: (tabId: number) => Promise<string>;
  debug: boolean;
}

type AssociationsOf = (windowId: number) => Promise<Record<number, string>>;

// A back/forward-cache restore brings back a document that still has its inserted sheets.
const FORWARD_BACK_QUALIFIER = 'forward_back';

export class PageStyleApplier
{
  readonly #deps: PageStyleApplierDeps;
  // The work for one tab runs one at a time, so a load-complete check reads the marker only after
  // the insert of that page's commit has landed, and the two don't both insert.
  readonly #tabWork = new Map<number, Promise<void>>();
  // Tabs whose last top-frame commit put no sheet on the page. Only they get a load-complete
  // check, and only once: Chrome reports 'complete' again for the same document after a late
  // iframe load, and that check would put back a sheet the user removed with Undo.
  readonly #awaitingLoadCheck = new Set<number>();

  constructor(deps: PageStyleApplierDeps)
  {
    this.#deps = deps;
  }

  /**
   * Sweeps the open tabs once the startup restore succeeded, but only in a new browser session:
   * on a worker restart the pages still have their sheets, and a sweep would put the style back on
   * a page where the user just pressed Undo.
   */
  async start(): Promise<void>
  {
    if (!await this.#deps.ready) return;
    if (await this.#deps.sameBrowserSession) return;
    await this.sweep();
  }

  /** webNavigation.onCommitted: a fresh top-frame document has no sheet yet, so no marker check. */
  committed(tabId: number, frameId: number, transitionQualifiers: readonly string[] = []): Promise<void>
  {
    if (frameId !== 0) return Promise.resolve();
    const forwardBack = transitionQualifiers.includes(FORWARD_BACK_QUALIFIER);

    return this.#forTab(tabId, async () =>
    {
      this.#awaitingLoadCheck.add(tabId);
      // Inserting the same text twice leaves a copy Undo can't remove, and inserting over the chat's
      // own sheet orphans it, so a restored document is left to the marker check of loadComplete.
      if (forwardBack) return;

      const tab = await this.#deps.getTab(tabId);
      const style = await this.#styleForTab(tab, this.#deps.associationsOf);
      if (!style) return;
      await this.#insert(tabId, style);
      this.#awaitingLoadCheck.delete(tabId);
    });
  }

  /**
   * tabs.onUpdated with status 'complete': covers back/forward commits and tabs associated after
   * their page committed. Acts once after a commit that put no sheet on the page.
   */
  loadComplete(tabId: number): Promise<void>
  {
    return this.#forTab(tabId, async () =>
    {
      if (!this.#awaitingLoadCheck.has(tabId)) return;
      await this.#insertIfUnstyled(tabId, await this.#deps.getTab(tabId), this.#deps.associationsOf);
      this.#awaitingLoadCheck.delete(tabId);
    });
  }

  /** The marker check of loadComplete for every open tab, whatever its last commit did. */
  async sweep(): Promise<void>
  {
    if (!await this.#deps.ready) return;

    let tabs: PageStyleTab[];
    try
    {
      tabs = await this.#deps.queryTabs();
    }
    catch (error)
    {
      this.#logError('could not list tabs for the startup sweep', error);
      return;
    }

    const associationsOf = memoizedAssociations(this.#deps.associationsOf);
    const checks = tabs
      .filter((tab): tab is PageStyleTab & { id: number } => tab.id !== undefined)
      .map(tab => this.#forTab(tab.id, () => this.#insertIfUnstyled(tab.id, tab, associationsOf)));
    await Promise.all(checks);
  }

  // Inserts only into a page without the agent's sheet: another id means the chat owns the page,
  // the saved id means the style is already there. Callers run it inside the tab's queue.
  async #insertIfUnstyled(tabId: number, tab: PageStyleTab, associationsOf: AssociationsOf): Promise<void>
  {
    const style = await this.#styleForTab(tab, associationsOf);
    if (!style) return;
    const marker = await this.#deps.readMarker(tabId);
    if (marker !== '')
    {
      this.#log(`tab ${tabId} already has the sheet "${marker}"`);
      return;
    }
    await this.#insert(tabId, style);
  }

  // The style to put on the tab's current page, or null when the tab doesn't get one
  async #styleForTab(tab: PageStyleTab, associationsOf: AssociationsOf): Promise<SavedPageStyle | null>
  {
    if (tab.incognito || tab.id === undefined || !tab.url) return null;
    if (httpOriginOf(tab.url) === null) return null;

    const associations = await associationsOf(tab.windowId);
    const bookmarkId = bookmarkIdFromItemKey(associations[tab.id]);
    if (bookmarkId === null) return null;

    const style = this.#deps.styles().styleFor(bookmarkId);
    if (!style || !style.autoApply || !style.appliesTo(tab.url)) return null;
    // The stored value is checked again: whatever is in storage is inserted without a request.
    if (!PageAgentCssSanitizer.check(style.css).ok)
    {
      this.#log(`saved style of bookmark ${bookmarkId} fails the CSS check, not applied`);
      return null;
    }
    return style;
  }

  async #insert(tabId: number, style: SavedPageStyle): Promise<void>
  {
    await this.#deps.insertCss(tabId, style.insertedText);
    this.#log(`applied saved style "${style.appliedId}" to tab ${tabId}`);
  }

  // Waits for readiness inside the tab's queue, so events that arrive before the restore ends keep
  // their order. Never rejects: a page without host permission, an unscriptable page or a closed
  // tab is a normal outcome here.
  #forTab(tabId: number, work: () => Promise<void>): Promise<void>
  {
    const previous = this.#tabWork.get(tabId) ?? Promise.resolve();
    const next = previous.then(async () =>
    {
      if (!await this.#deps.ready) return;
      await work();
    }).catch(error => this.#logError(`tab ${tabId}`, error));

    this.#tabWork.set(tabId, next);
    void next.then(() =>
    {
      if (this.#tabWork.get(tabId) === next) this.#tabWork.delete(tabId);
    });
    return next;
  }

  #log(message: string): void
  {
    if (this.#deps.debug)
    {
      console.log('[PageStyleApplier]', message);
    }
  }

  #logError(context: string, error: unknown): void
  {
    if (this.#deps.debug)
    {
      console.warn('[PageStyleApplier]', context, error);
    }
  }
}

// One association read per window for a sweep over all open tabs
function memoizedAssociations(associationsOf: AssociationsOf): AssociationsOf
{
  const byWindow = new Map<number, Promise<Record<number, string>>>();
  return (windowId) =>
  {
    let associations = byWindow.get(windowId);
    if (!associations)
    {
      associations = associationsOf(windowId);
      byWindow.set(windowId, associations);
    }
    return associations;
  };
}
