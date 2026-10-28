// The pages of a Space's archive folder as the Archive section lists them
// (feature 035). An item's archive time is the moment its bookmark was created
// (`dateAdded`): auto-archive creates a new bookmark for every archived tab.

import { collectFolderBookmarks } from './folderRecentItems.ts';
import { matchesFilter } from './searchParser.ts';
import { BookmarkRecency } from '../stores/bookmarkRecencyStore.ts';
import type { BookmarkRecencyRecord } from '../stores/bookmarkRecencyStore.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

/** The pages in a Space's archive folder, newest archive time (`dateAdded`) first. */
export class ArchiveItems
{
  static readonly EMPTY = new ArchiveItems([]);

  #newestFirst: BookmarkNode[];

  constructor(pages: BookmarkNode[])
  {
    // Array.sort is stable: equal times keep tree order, where index 0 is the newest
    this.#newestFirst = [...pages].sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
  }

  /** The pages of the archive folder, subfolders included; empty without a folder. */
  static fromFolder(folder: BookmarkNode | undefined): ArchiveItems
  {
    return folder ? new ArchiveItems(collectFolderBookmarks(folder)) : ArchiveItems.EMPTY;
  }

  /** Every item, or only those matching the toolbar text filter while it is active. */
  matching(filterText: string): BookmarkNode[]
  {
    if (!filterText.trim()) return this.#newestFirst;
    return this.#newestFirst.filter(page => matchesFilter(page.title, page.url ?? '', filterText));
  }

  /** Archive times in the form the recent popover orders by. */
  toRecency(): BookmarkRecency
  {
    const archivedAt: BookmarkRecencyRecord = {};

    // The archive time of an item is the moment its bookmark was created
    for (const page of this.#newestFirst)
    {
      if (page.dateAdded !== undefined) archivedAt[page.id] = page.dateAdded;
    }
    return new BookmarkRecency(archivedAt);
  }
}
