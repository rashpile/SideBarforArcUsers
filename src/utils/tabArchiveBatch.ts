// Saves a set of tabs into one Space's archive for manual archiving
// (the "+ New Tab" row's Archive, tab rows, drops on the Archive section). Pure logic over an injected bookmarks API: it decides which
// tabs may close and remembers the archive items it created, so Undo can remove
// them again. Closing the tabs is the caller's job.

import { SpaceArchive } from './archiveFolder.ts';
import type { ArchiveBookmarksApi } from './archiveFolder.ts';
import { isEmptyPage, tabPageUrl } from './autoArchivePolicy.ts';
import { getEffectiveTabUrl } from './parkedTabAssociation.ts';

/** The fields of chrome.tabs.Tab the batch reads. */
export interface ArchivableTab
{
  id: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
}

/** What archiving a set of tabs came to. */
export class TabArchiveResult
{
  /** Tabs that may close: the archived ones and empty pages. */
  readonly closableTabIds: readonly number[];
  /** Tabs saved as archive items. */
  readonly archivedTabIds: readonly number[];
  /** Tabs whose archive item could not be created: they stay open. */
  readonly keptOpenCount: number;

  constructor(closableTabIds: readonly number[], archivedTabIds: readonly number[], keptOpenCount: number)
  {
    this.closableTabIds = closableTabIds;
    this.archivedTabIds = archivedTabIds;
    this.keptOpenCount = keptOpenCount;
  }

  get archivedCount(): number
  {
    return this.archivedTabIds.length;
  }
}

export class TabArchiveBatch
{
  #bookmarks: ArchiveBookmarksApi;
  #spaceArchive: SpaceArchive;
  #createdBookmarkIds: string[] = [];

  constructor(bookmarks: ArchiveBookmarksApi)
  {
    this.#bookmarks = bookmarks;
    this.#spaceArchive = new SpaceArchive(bookmarks);
  }

  /**
   * Save the tabs into the Space's archive. Empty pages get no archive item but
   * may close; a tab whose item could not be created stays open.
   */
  async archive(spaceFolderId: string, tabs: readonly ArchivableTab[]): Promise<TabArchiveResult>
  {
    const closableTabIds: number[] = [];
    const archivedTabIds: number[] = [];
    let keptOpenCount = 0;

    // One tab at a time: archives into a Space without an archive folder must not each create one
    for (const tab of tabs)
    {
      const pageUrl = tabPageUrl(tab);
      if (isEmptyPage(pageUrl))
      {
        closableTabIds.push(tab.id);
        continue;
      }

      try
      {
        const bookmark = await this.#spaceArchive.archive(spaceFolderId, { title: tab.title, url: getEffectiveTabUrl(pageUrl) });
        this.#createdBookmarkIds.push(bookmark.id);
        closableTabIds.push(tab.id);
        archivedTabIds.push(tab.id);
      }
      catch (error)
      {
        console.error(`[TabArchiveBatch] Failed to archive tab ${tab.id}:`, error);
        keptOpenCount++;
      }
    }
    return new TabArchiveResult(closableTabIds, archivedTabIds, keptOpenCount);
  }

  /**
   * Remove the archive items this batch created. An item that is already gone
   * (replaced by a later tab on the same URL, or deleted by the user) is logged
   * and skipped; the rest are still removed.
   */
  async discard(): Promise<void>
  {
    const bookmarkIds = this.#createdBookmarkIds;
    this.#createdBookmarkIds = [];

    // Remove each created item on its own, so one failure does not keep the others
    for (const bookmarkId of bookmarkIds)
    {
      try
      {
        await this.#bookmarks.remove(bookmarkId);
      }
      catch (error)
      {
        console.error(`[TabArchiveBatch] Failed to remove archive item ${bookmarkId}:`, error);
      }
    }
  }
}
