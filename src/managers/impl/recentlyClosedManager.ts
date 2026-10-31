// RecentlyClosedManager - owns the per-Space Recently Closed lists.
//
// Background-side implementation of shared/recentlyClosedApi.ts. Single writer
// of `recentlyClosedTabs` in chrome.storage.local: background records closes,
// the sidebar reopens and clears through proxies/recentlyClosedProxy.ts and
// reads the key read-only.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import { RECENTLY_CLOSED_TABS_KEY } from '../shared/recentlyClosedApi.ts';
import type { RecentlyClosedApi } from '../shared/recentlyClosedApi.ts';
import { RecentlyClosedTabs } from '../../stores/recentlyClosedTabs.ts';
import type { ClosedTabRecord } from '../../stores/recentlyClosedTabs.ts';
import { getEffectiveTabUrl } from '../../utils/parkedTabAssociation.ts';

export interface RecentlyClosedManagerDeps
{
  /** Ids of the Spaces that exist now. */
  getSpaceIds(): Iterable<string>;
  /** Puts a tab in a Space (background passes TabSpaceRegistry.register). */
  registerTab(windowId: number, tabId: number, spaceId: string): Promise<void>;
}

export class RecentlyClosedManager implements RoutedManager, RecentlyClosedApi
{
  readonly managerId = ManagerId.RECENTLY_CLOSED;

  readonly #deps: RecentlyClosedManagerDeps;
  #tabs = RecentlyClosedTabs.empty();

  // A list that couldn't be read is never written: a write would replace the stored
  // records with only the ones recorded since
  #loaded = false;

  // Every change runs here after the load, so a close that wakes the worker isn't
  // applied to the empty list before the stored one is read
  #writeTail: Promise<void> = Promise.resolve();

  #archiveCloses = new Set<number>();

  constructor(deps: RecentlyClosedManagerDeps)
  {
    this.#deps = deps;
  }

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    switch (method)
    {
      case 'reopen':
        return this.reopen(message.windowId as number, message.spaceId as string, message.recordId as string);

      case 'clear':
        return this.clear(message.spaceId as string);

      case 'spaceRecords':
        return this.spaceRecords(message.spaceId as string);

      case 'restoreSpace':
        return this.restoreSpace(message.spaceId as string, message.records as ClosedTabRecord[]);

      case 'forgetReopened':
        return this.forgetReopened(message.spaceId as string, message.url as string);

      case 'expectArchiveClose':
        return this.expectArchiveClose(message.tabIds as number[]);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  /** Reads the stored list. Never rejects: a failed read is logged and leaves the manager not loaded. */
  load(): Promise<void>
  {
    const result = this.#writeTail.then(() => this.#load())
      .catch(error => console.error('[RecentlyClosedManager] load failed:', error));
    this.#writeTail = result;
    return result;
  }

  get loaded(): boolean
  {
    return this.#loaded;
  }

  forSpace(spaceId: string): readonly ClosedTabRecord[]
  {
    return this.#tabs.forSpace(spaceId);
  }

  recordClose(spaceId: string, record: ClosedTabRecord): Promise<void>
  {
    // Checked when the change runs: deleting a Space closes its tabs first and then
    // deletes it, so a close handled late must not bring the Space's list back
    return this.#change(tabs =>
    {
      if (!new Set(this.#deps.getSpaceIds()).has(spaceId)) return tabs;
      return tabs.add(spaceId, record);
    });
  }

  retainSpaces(spaceIds: Iterable<string>): Promise<void>
  {
    const ids = [...spaceIds];
    return this.#change(tabs => tabs.retainSpaces(ids));
  }

  /** The Space's records once pending changes are applied. */
  async spaceRecords(spaceId: string): Promise<ClosedTabRecord[]>
  {
    await this.#writeTail;
    return [...this.#tabs.forSpace(spaceId)];
  }

  restoreSpace(spaceId: string, records: ClosedTabRecord[]): Promise<void>
  {
    // Run after the Space is back: records of a Space that doesn't exist would be
    // dropped by the next retainSpaces anyway
    return this.#change(tabs =>
    {
      if (!new Set(this.#deps.getSpaceIds()).has(spaceId)) return tabs;
      return tabs.restoreSpace(spaceId, records);
    });
  }

  forgetReopened(spaceId: string, url: string): Promise<void>
  {
    // A parked tab was recorded by the page it stands for
    const recordedUrl = getEffectiveTabUrl(url);
    return this.#change(tabs => tabs.removeUrl(spaceId, recordedUrl));
  }

  clear(spaceId: string): Promise<void>
  {
    return this.#change(tabs => tabs.clearSpace(spaceId));
  }

  /** Called right before an Archive action closes the tabs: they are in the Archive already. */
  expectArchiveClose(tabIds: number[]): void
  {
    for (const tabId of tabIds)
    {
      this.#archiveCloses.add(tabId);
    }
  }

  /** True once for a tab announced by expectArchiveClose. */
  consumeArchiveClose(tabId: number): boolean
  {
    return this.#archiveCloses.delete(tabId);
  }

  async reopen(windowId: number, spaceId: string, recordId: string): Promise<void>
  {
    await this.#writeTail;
    const record = this.#tabs.find(spaceId, recordId);
    if (!record) return;

    // A failed create rejects here and keeps the record, so the user can try again
    const tab = await chrome.tabs.create({ windowId, url: record.url, active: true });
    if (tab.id !== undefined)
    {
      try
      {
        await this.#deps.registerTab(windowId, tab.id, spaceId);
      }
      catch (error)
      {
        console.error('[RecentlyClosedManager] reopened tab not registered in its Space:', error);
      }
    }

    await this.#change(tabs => tabs.remove(spaceId, recordId));
  }

  async #load(): Promise<void>
  {
    try
    {
      const result = await chrome.storage.local.get(RECENTLY_CLOSED_TABS_KEY);
      this.#tabs = RecentlyClosedTabs.fromStored(result[RECENTLY_CLOSED_TABS_KEY]);
      this.#loaded = true;
    }
    catch (error)
    {
      console.error('[RecentlyClosedManager] list not loaded, closes are not stored until the worker restarts:', error);
      return;
    }

    // An empty Space list means the Spaces aren't loaded yet rather than that every
    // Space is gone; retaining against it would wipe every record
    const spaceIds = [...this.#deps.getSpaceIds()];
    if (spaceIds.length === 0) return;
    const kept = this.#tabs.retainSpaces(spaceIds);
    if (kept === this.#tabs) return;
    this.#tabs = kept;
    await this.#save()
      .catch(error => console.error('[RecentlyClosedManager] failed to drop deleted Spaces\' records:', error));
  }

  // Changes run one at a time on the current list, and each writes the list it produced,
  // so an older write can't land after a newer one
  #change(apply: (tabs: RecentlyClosedTabs) => RecentlyClosedTabs): Promise<void>
  {
    const result = this.#writeTail.then(async () =>
    {
      const next = apply(this.#tabs);
      if (next === this.#tabs) return;
      this.#tabs = next;
      if (this.#loaded) await this.#save();
    });
    this.#writeTail = result.catch(() => {});
    return result;
  }

  // A JSON string: the sidebar's useChromeLocalStorage parses the stored value with JSON.parse
  #save(): Promise<void>
  {
    return chrome.storage.local.set({ [RECENTLY_CLOSED_TABS_KEY]: JSON.stringify(this.#tabs.toStored()) });
  }
}
