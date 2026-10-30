// The pages of a Space's archive folder as the Archive section lists them.
// An item's archive time is the moment its bookmark was created
// (`dateAdded`): auto-archive creates a new bookmark for every archived tab.

import { collectFolderBookmarks } from './folderRecentItems.ts';
import { matchesFilter } from './searchParser.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A choice in the Archive's Clear menu: every page, or the pages older than an age. */
export class ArchiveClearOption
{
  static readonly ALL = new ArchiveClearOption('Clear All', null);
  static readonly OLDER_THAN_24_HOURS = new ArchiveClearOption('Older than 24 Hours', 24 * HOUR_MS);
  static readonly OLDER_THAN_7_DAYS = new ArchiveClearOption('Older than 7 Days', 7 * DAY_MS);
  static readonly OLDER_THAN_30_DAYS = new ArchiveClearOption('Older than 30 Days', 30 * DAY_MS);

  /** The options in menu order. */
  static readonly MENU_ORDER: readonly ArchiveClearOption[] = [
    ArchiveClearOption.ALL,
    ArchiveClearOption.OLDER_THAN_24_HOURS,
    ArchiveClearOption.OLDER_THAN_7_DAYS,
    ArchiveClearOption.OLDER_THAN_30_DAYS,
  ];

  readonly label: string;
  /** `null` clears every page regardless of age. */
  readonly maxAgeMs: number | null;

  private constructor(label: string, maxAgeMs: number | null)
  {
    this.label = label;
    this.maxAgeMs = maxAgeMs;
  }

  /** Whether this option clears `page` at time `now`. */
  includes(page: BookmarkNode, now: number): boolean
  {
    if (this.maxAgeMs === null) return true;
    // A page without `dateAdded` has an unknown age: only Clear All removes it
    if (page.dateAdded === undefined) return false;
    return page.dateAdded <= now - this.maxAgeMs;
  }
}

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

  /** The pages `option` removes at time `now`, newest first; ignores any filter or search. */
  clearable(option: ArchiveClearOption, now: number): BookmarkNode[]
  {
    return this.#newestFirst.filter(page => option.includes(page, now));
  }
}
