// PageStyleManager - owns the page styles saved to bookmarks and Favorites.
//
// Background-side implementation of shared/pageStyleApi.ts. The sidebar
// reaches it through proxies/pageStyleProxy.ts. Single writer of the
// bookmarkPageStyles key: the sidebar saves, toggles, removes and (on Undo of a
// delete) restores styles, and background drops the styles of deleted bookmarks.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import { BOOKMARK_PAGE_STYLES_KEY, PAGE_STYLES_CHANGED } from '../shared/pageStyleApi.ts';
import type { PageStyleApi, PageStylesState } from '../shared/pageStyleApi.ts';
import { SavedPageStyle, SavedPageStyles, httpOriginOf } from '../../stores/savedPageStyles.ts';
import type { StoredPageStyle } from '../../stores/savedPageStyles.ts';
import { PageAgentCssSanitizer } from '../../utils/pageAgentCss.ts';

/** The chrome APIs and the rev source the manager uses, injected so tests run under Node. */
export interface PageStyleManagerDeps
{
  storage: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
  };
  broadcast: (message: Record<string, unknown>) => Promise<unknown>;
  /** A new random id for every save. */
  newRev: () => string;
}

export class PageStyleManager implements RoutedManager, PageStyleApi
{
  readonly managerId = ManagerId.PAGE_STYLES;

  readonly #deps: PageStyleManagerDeps;
  #styles = new SavedPageStyles();

  // A stored value that couldn't be read starts empty and is not written by background events,
  // so the unread value isn't overwritten with nothing. The user's next save, or an Undo of a
  // delete that brings a style back, writes it and lifts this. Toggle and remove can't: with
  // nothing loaded there is no style for them to change.
  #loaded = false;

  #writeTail: Promise<void> = Promise.resolve();

  constructor(deps: PageStyleManagerDeps)
  {
    this.#deps = deps;
  }

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    // The calling context's CONTEXT_ID, echoed on the broadcast so it can skip its own echo
    const originId = message.senderId as string | undefined;

    switch (method)
    {
      case 'getState':
        return this.getState();

      case 'save':
        return this.save(message.bookmarkId as string, message.css as string, message.pageUrl as string, originId);

      case 'setAutoApply':
        return this.setAutoApply(message.bookmarkId as string, message.on as boolean, originId);

      case 'remove':
        return this.remove(message.bookmarkId as string, originId);

      case 'restore':
        return this.restore(message.bookmarkId as string, message.style as StoredPageStyle, originId);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  /**
   * Never rejects: a broken key must not turn stateReady false, which would pause auto-archive
   * and the association restore. On a failure the manager starts empty and stays unloaded.
   */
  async load(): Promise<void>
  {
    try
    {
      const result = await this.#deps.storage.get(BOOKMARK_PAGE_STYLES_KEY);
      this.#styles = SavedPageStyles.fromStored(result[BOOKMARK_PAGE_STYLES_KEY]);
      this.#loaded = true;
    }
    catch (error)
    {
      console.error('[PageStyleManager] saved page styles not loaded, kept unwritten until the user changes one:', error);
    }
  }

  /** The current styles, for background callers that need the class rather than the wire state. */
  get styles(): SavedPageStyles
  {
    return this.#styles;
  }

  getState(): PageStylesState
  {
    return { styles: this.#styles.toStored() };
  }

  async save(bookmarkId: string, css: string, pageUrl: string, originId?: string): Promise<PageStylesState>
  {
    requireBookmarkId(bookmarkId);
    if (typeof css !== 'string' || css.trim() === '')
    {
      throw new Error('Can\'t save this style: there is no CSS to save');
    }
    // The background inserts the saved CSS without a request, so it gets the same check as CSS
    // the agent applies: whatever reaches storage is put on pages later.
    const check = PageAgentCssSanitizer.check(css);
    if (!check.ok)
    {
      throw new Error(`Can't save this style: ${check.reason}`);
    }
    const origin = typeof pageUrl === 'string' ? httpOriginOf(pageUrl) : null;
    if (origin === null)
    {
      throw new Error('Can\'t save this style: only http and https pages can have a saved style');
    }

    await this.#commitUserChange(this.#styles.withSaved(bookmarkId, css, origin, this.#deps.newRev()), originId);
    return this.getState();
  }

  async setAutoApply(bookmarkId: string, on: boolean, originId?: string): Promise<PageStylesState>
  {
    requireBookmarkId(bookmarkId);
    await this.#commitUserChange(this.#styles.withAutoApply(bookmarkId, on === true), originId);
    return this.getState();
  }

  async remove(bookmarkId: string, originId?: string): Promise<PageStylesState>
  {
    requireBookmarkId(bookmarkId);
    await this.#commitUserChange(this.#styles.without([bookmarkId]), originId);
    return this.getState();
  }

  async restore(bookmarkId: string, stored: StoredPageStyle, originId?: string): Promise<PageStylesState>
  {
    requireBookmarkId(bookmarkId);
    const style = SavedPageStyle.fromStoredEntry(stored);
    if (!style)
    {
      throw new Error('Can\'t restore this style: the record is incomplete');
    }
    // The same gate as save: the sidebar sends the record back, and the background inserts it later
    const check = PageAgentCssSanitizer.check(style.css);
    if (!check.ok)
    {
      throw new Error(`Can't restore this style: ${check.reason}`);
    }

    await this.#commitUserChange(this.#styles.withRestored(bookmarkId, style), originId);
    return this.getState();
  }

  /** `ids` are a removed bookmark's id and, for a folder, all its descendants'. */
  async handleBookmarksRemoved(ids: string[]): Promise<void>
  {
    const next = this.#styles.without(ids);
    if (next === this.#styles) return;
    this.#styles = next;
    this.#broadcast();
    if (this.#loaded) await this.#write();
  }

  // An unchanged collection (same instance) is neither written nor broadcast
  async #commitUserChange(next: SavedPageStyles, originId?: string): Promise<void>
  {
    if (next === this.#styles) return;
    this.#styles = next;
    this.#loaded = true;
    this.#broadcast(originId);
    await this.#write();
  }

  // Writes run one at a time and each takes the styles from memory when it runs, so an older
  // write can't land after a newer one
  #write(): Promise<void>
  {
    const result = this.#writeTail.then(() => this.#deps.storage.set({ [BOOKMARK_PAGE_STYLES_KEY]: this.#styles.toStored() }));
    this.#writeTail = result.catch(() => {});
    return result;
  }

  // senderId lets the context that asked for the change skip its own echo (CONTEXT_ID in messageRouting.ts)
  #broadcast(originId?: string): void
  {
    this.#deps.broadcast({
      action: PAGE_STYLES_CHANGED,
      state: this.getState(),
      senderId: originId,
    }).catch(() =>
    {
      // No sidebar open
    });
  }
}

function requireBookmarkId(bookmarkId: unknown): void
{
  if (typeof bookmarkId !== 'string' || bookmarkId === '')
  {
    throw new Error('PageStyleManager: a bookmark id is required');
  }
}
