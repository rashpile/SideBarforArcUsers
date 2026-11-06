// What picking a search popup result does (see services/searchPopup.ts). Each kind of result ends
// the way a click on the same item in the sidebar does: an open tab is focused, a bookmark opens
// per the "Bookmark open mode" setting, an archive item opens and leaves the archive, and a
// recently closed tab is reopened in its Space. Activating the tab switches the window to its Space.

import type {
  ArchiveSearchItem,
  BookmarkSearchItem,
  ClosedSearchItem,
  SearchItem,
  TabSearchItem,
} from './searchResults.ts';
import type { BookmarkOpenMode } from '../utils/bookmarkOpenMode.ts';
import { BOOKMARK_ITEM_KEY_PREFIX } from '../utils/tabAssociations.ts';

export interface CreatedTab
{
  id?: number;
  index: number;
  url?: string;
}

export interface SearchPickerDeps
{
  /** Activates the tab and switches its window to the tab's Space; rejects when that fails. */
  activateTab(tabId: number): Promise<void>;
  /** Activates the tab without a Space switch. */
  activateTabOnly(tabId: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
  /** Creates an active tab in the window. */
  createTab(windowId: number, url: string): Promise<CreatedTab>;
  updateTabUrl(tabId: number, url: string): Promise<void>;
  activeTabId(windowId: number): Promise<number | undefined>;
  tabExists(tabId: number): Promise<boolean>;
  /** Tabs of the window whose association is itemKey. */
  associatedTabIds(windowId: number, itemKey: string): Promise<number[]>;
  /** Writes the association and its backup. */
  storeAssociation(windowId: number, tabId: number, itemKey: string, url: string, index: number): Promise<void>;
  registerTab(windowId: number, tabId: number, spaceId: string): Promise<void>;
  bookmarkSpaceId(bookmarkId: string): Promise<string | undefined>;
  removeBookmark(bookmarkId: string): Promise<void>;
  /** The reopened tab's id; undefined when the record is gone. */
  reopenClosed(windowId: number, spaceId: string, recordId: string): Promise<number | undefined>;
  bookmarkOpenMode(): Promise<BookmarkOpenMode>;
}

export class SearchPicker
{
  readonly #deps: SearchPickerDeps;

  constructor(deps: SearchPickerDeps)
  {
    this.#deps = deps;
  }

  /**
   * Opens the picked item from the origin window. `restored` is what stateReady resolved to:
   * false means the startup restore failed, so the associations and the Space registry can't be
   * trusted to point at the right tab or Space.
   */
  async pick(item: SearchItem, originWindowId: number, restored: boolean): Promise<void>
  {
    switch (item.kind)
    {
      case 'tab':
        return this.#pickTab(item, originWindowId, restored);
      case 'bookmark':
        return this.#pickBookmark(item, originWindowId, restored);
      case 'archive':
        return this.#pickArchive(item, originWindowId);
      case 'closed':
        return this.#pickClosed(item, originWindowId);
    }
  }

  async #pickTab(item: TabSearchItem, originWindowId: number, restored: boolean): Promise<void>
  {
    // The Space switch reads the tab's Space from the registry, which a failed restore left
    // unreliable; openSpace skips the switch for the same reason
    if (restored)
    {
      await this.#deps.activateTab(item.tabId);
    }
    else
    {
      await this.#deps.activateTabOnly(item.tabId);
    }

    if (item.windowId !== originWindowId)
    {
      await this.#deps.focusWindow(item.windowId);
    }
  }

  async #pickBookmark(item: BookmarkSearchItem, originWindowId: number, restored: boolean): Promise<void>
  {
    const mode = await this.#deps.bookmarkOpenMode();
    if (mode === 'arc')
    {
      await this.#openArcBookmark(item, originWindowId, restored);
    }
    else if (mode === 'newTab')
    {
      const tabId = await this.#createTab(originWindowId, item.url);
      if (tabId === undefined) return;
      await this.#deps.registerTab(originWindowId, tabId, await this.#bookmarkSpaceId(item));
      await this.#deps.activateTab(tabId);
    }
    else
    {
      const tabId = await this.#deps.activeTabId(originWindowId);
      if (tabId === undefined) return;
      await this.#deps.updateTabUrl(tabId, item.url);
    }
  }

  // As the sidebar's openItemTab: the bookmark's own tab in this window when it still exists,
  // otherwise a new tab that becomes it
  async #openArcBookmark(item: BookmarkSearchItem, originWindowId: number, restored: boolean): Promise<void>
  {
    const itemKey = `${BOOKMARK_ITEM_KEY_PREFIX}${item.bookmarkId}`;

    // After a failed restore an association may point at a reused tab id of another page
    if (restored)
    {
      for (const tabId of await this.#deps.associatedTabIds(originWindowId, itemKey))
      {
        if (await this.#deps.tabExists(tabId))
        {
          await this.#deps.activateTab(tabId);
          return;
        }
      }
    }

    const tab = await this.#deps.createTab(originWindowId, item.url);
    if (tab.id === undefined) return;
    // A just-created tab may report no URL yet; the backup needs the page it will load
    await this.#deps.storeAssociation(originWindowId, tab.id, itemKey, tab.url || item.url, tab.index);
    await this.#deps.registerTab(originWindowId, tab.id, await this.#bookmarkSpaceId(item));
    await this.#deps.activateTab(tab.id);
  }

  // As the Archive section's restore. The item leaves the archive only once its tab is open,
  // so a failed open loses nothing
  async #pickArchive(item: ArchiveSearchItem, originWindowId: number): Promise<void>
  {
    const tabId = await this.#createTab(originWindowId, item.url);
    if (tabId === undefined) return;
    await this.#deps.registerTab(originWindowId, tabId, item.spaceId);
    await this.#deps.activateTab(tabId);
    await this.#deps.removeBookmark(item.bookmarkId);
  }

  async #pickClosed(item: ClosedSearchItem, originWindowId: number): Promise<void>
  {
    const tabId = await this.#deps.reopenClosed(originWindowId, item.spaceId, item.recordId);
    if (tabId === undefined) return;
    await this.#deps.activateTab(tabId);
  }

  async #createTab(windowId: number, url: string): Promise<number | undefined>
  {
    const tab = await this.#deps.createTab(windowId, url);
    return tab.id;
  }

  // The Space the bookmark's folder belongs to now; the snapshot's Space if it can't be resolved
  async #bookmarkSpaceId(item: BookmarkSearchItem): Promise<string>
  {
    return (await this.#deps.bookmarkSpaceId(item.bookmarkId)) ?? item.spaceId;
  }
}
