// The pages of a Space's archive folder as the Archive section lists them.
// An item's archive time is the moment its bookmark was created
// (`dateAdded`): auto-archive creates a new bookmark for every archived tab.

import { collectFolderBookmarks } from './folderRecentItems.ts';
import { matchesFilter } from './searchParser.ts';

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

  /**
   * The items matching both the toolbar text filter and the Archive search;
   * a blank query matches every item.
   */
  matching(filterText: string, searchText = ''): BookmarkNode[]
  {
    if (!filterText.trim() && !searchText.trim()) return this.#newestFirst;
    return this.#newestFirst.filter(page =>
      matchesFilter(page.title, page.url ?? '', filterText) &&
      matchesFilter(page.title, page.url ?? '', searchText));
  }
}
