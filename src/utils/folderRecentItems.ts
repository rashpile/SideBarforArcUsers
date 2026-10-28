// Row selection for the collapsed-folder recent popover (feature 034).

import { matchesFilter } from './searchParser.ts';
import { isArchiveFolder } from './archiveFolder.ts';
import type { BookmarkRecency } from '../stores/bookmarkRecencyStore.ts';

export const RECENT_ROW_LIMIT = 10;
export const SEARCH_ROW_LIMIT = 50;

export interface FolderRecentItem
{
  bookmark: chrome.bookmarks.BookmarkTreeNode;
  lastActiveAt?: number;
}

/**
 * All bookmark pages (not folders) under a folder, recursively, in tree order.
 * Archive folders below `folder` are skipped; `folder` itself may be an archive
 * folder (the Archive section's popover lists its items).
 */
export function collectFolderBookmarks(
  folder: chrome.bookmarks.BookmarkTreeNode
): chrome.bookmarks.BookmarkTreeNode[]
{
  const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];

  // Depth-first walk keeps the same order the tree shows when expanded
  const walk = (node: chrome.bookmarks.BookmarkTreeNode) =>
  {
    for (const child of node.children ?? [])
    {
      if (child.url) bookmarks.push(child);
      else if (!isArchiveFolder(child)) walk(child);
    }
  };

  walk(folder);
  return bookmarks;
}

/**
 * Rows to show for a folder.
 * - Empty query: only previously active bookmarks, newest first.
 * - Query: every matching bookmark; previously active ones first by recency, the rest in tree order.
 */
export function selectFolderRecentItems(
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  recency: BookmarkRecency,
  query: string
): FolderRecentItem[]
{
  const hasQuery = query.trim() !== '';
  const items: FolderRecentItem[] = [];

  // Keep matching bookmarks; without a query only those with a recorded activation
  for (const bookmark of bookmarks)
  {
    const lastActiveAt = recency.lastActiveAt(bookmark.id);
    if (!hasQuery && lastActiveAt === undefined) continue;
    if (hasQuery && !matchesFilter(bookmark.title, bookmark.url ?? '', query)) continue;
    items.push({ bookmark, lastActiveAt });
  }

  // Array.sort is stable, so never-active bookmarks keep their tree order at the end
  items.sort((a, b) => (b.lastActiveAt ?? -Infinity) - (a.lastActiveAt ?? -Infinity));

  return items.slice(0, hasQuery ? SEARCH_ROW_LIMIT : RECENT_ROW_LIMIT);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;

/** Arc-style relative label: "Just now", "5 min ago", "3 hours ago", "2 months ago". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string
{
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < MONTH) return plural(Math.floor(elapsed / DAY), 'day');
  if (elapsed < YEAR) return plural(Math.floor(elapsed / MONTH), 'month');
  return plural(Math.floor(elapsed / YEAR), 'year');
}
