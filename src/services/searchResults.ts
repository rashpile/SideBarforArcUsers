// What the search popup can find (see services/searchPopup.ts): the open tabs, the Space folders'
// bookmarks, the Spaces' archives and their recently closed tabs. Background collects them once
// when the popup opens; every query filters that snapshot, shows results of the same page once
// and returns at most 20 items, newest last access first.

import type { Space } from '../utils/spaceMessages.ts';
import type { SearchItemKind, SearchQuery, SearchRow, SearchScope } from '../utils/searchPopupMessages.ts';
import type { BookmarkRecency } from '../stores/bookmarkRecencyStore.ts';
import type { ClosedTabRecord } from '../stores/recentlyClosedTabs.ts';
import type { TabWithLastAccess } from './switcherLists.ts';
import { findFolderBySegments } from '../utils/bookmarkFolderLookup.ts';
import { collectFolderBookmarks } from '../utils/folderRecentItems.ts';
import { findArchiveFolder } from '../utils/archiveFolder.ts';
import { ArchiveItems } from '../utils/archiveItems.ts';
import { matchesSearch, parseSearchQuery, type ASTNode } from '../utils/searchParser.ts';
import { BOOKMARK_ITEM_KEY_PREFIX } from '../utils/tabAssociations.ts';
import { getEffectiveTabUrl } from '../utils/parkedTabAssociation.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export const SEARCH_RESULT_LIMIT = 20;

export interface SearchCandidatesInput
{
  originWindowId: number;
  originActiveTabId: number | undefined;
  originIncognito: boolean;
  activeSpaceId: string | undefined;          // undefined: no Spaces set up
  spaces: readonly Space[];                   // sidebar order
  tabs: readonly TabWithLastAccess[];         // tabs of normal windows
  spaceOf(windowId: number, tabId: number): string | undefined;
  associations: ReadonlyMap<number, Record<number, string>>;  // windowId -> tabId -> itemKey
  bookmarkRoots: BookmarkNode[];              // getTree()[0].children
  recency: BookmarkRecency;
  closedRecords(spaceId: string): readonly ClosedTabRecord[];
  collapseSamePage: boolean;                  // the Settings option: results of one page show once
}

interface SearchItemBase
{
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly spaceId: string | undefined;
  readonly lastAccess: number | undefined;   // epoch millis; undefined sorts last
  readonly inThisSpace: boolean;             // listed in This Space mode
}

export interface TabSearchItem extends SearchItemBase
{
  readonly kind: 'tab';
  readonly windowId: number;
  readonly tabId: number;
  readonly bookmarkId: string | undefined;   // set when the tab is a bookmark's Arc tab
}

export interface BookmarkSearchItem extends SearchItemBase
{
  readonly kind: 'bookmark';
  readonly spaceId: string;
  readonly bookmarkId: string;
}

export interface ArchiveSearchItem extends SearchItemBase
{
  readonly kind: 'archive';
  readonly spaceId: string;
  readonly bookmarkId: string;
}

export interface ClosedSearchItem extends SearchItemBase
{
  readonly kind: 'closed';
  readonly spaceId: string;
  readonly recordId: string;
}

export type SearchItem = TabSearchItem | BookmarkSearchItem | ArchiveSearchItem | ClosedSearchItem;

const SCOPE_KIND: Record<Exclude<SearchScope, 'all'>, SearchItemKind> = {
  tabs: 'tab',
  bookmarks: 'bookmark',
  archive: 'archive',
  closed: 'closed',
};

function inScope(scope: SearchScope, kind: SearchItemKind): boolean
{
  return scope === 'all' || SCOPE_KIND[scope] === kind;
}

// The bookmark whose Arc tab this is, from the window's tab associations
function arcBookmarkId(input: SearchCandidatesInput, windowId: number, tabId: number | undefined): string | undefined
{
  if (tabId === undefined) return undefined;
  const itemKey = input.associations.get(windowId)?.[tabId];
  return itemKey?.startsWith(BOOKMARK_ITEM_KEY_PREFIX)
    ? itemKey.slice(BOOKMARK_ITEM_KEY_PREFIX.length)
    : undefined;
}

// Chrome 114+ reports when a bookmark was last opened; @types/chrome doesn't declare it
function dateLastUsed(node: BookmarkNode): number | undefined
{
  return (node as BookmarkNode & { dateLastUsed?: number }).dateLastUsed;
}

function hostOf(url: string): string
{
  try { return new URL(url).host || url; }
  catch { return url; }
}

function collectTabs(input: SearchCandidatesInput): TabSearchItem[]
{
  const items: TabSearchItem[] = [];

  // The current tab is left out: picking it would do nothing
  for (const tab of input.tabs)
  {
    if (tab.id === undefined || tab.id === input.originActiveTabId) continue;
    if (Boolean(tab.incognito) !== input.originIncognito) continue;

    const spaceId = input.spaceOf(tab.windowId, tab.id);
    // As in the Tab Switcher: This Space means the origin window's tabs in its active Space
    const inThisSpace = tab.windowId === input.originWindowId
      && (input.activeSpaceId === undefined || spaceId === input.activeSpaceId);
    items.push({
      kind: 'tab',
      id: `t:${tab.windowId}:${tab.id}`,
      title: tab.title ?? '',
      url: tab.url || tab.pendingUrl || '',
      spaceId,
      lastAccess: tab.lastAccessed,
      inThisSpace,
      windowId: tab.windowId,
      tabId: tab.id,
      bookmarkId: arcBookmarkId(input, tab.windowId, tab.id),
    });
  }
  return items;
}

function collectSpaceItems(input: SearchCandidatesInput): SearchItem[]
{
  const items: SearchItem[] = [];
  // A folder shared by two Spaces, or nested inside another Space's folder, belongs to the first
  // Space in sidebar order (CLAUDE.md "One folder, one Space"), so a bookmark an earlier Space
  // already listed is skipped. Archive items share the check: two Spaces on one folder find the
  // same asd_Archive.
  const claimed = new Set<string>();
  const claim = (node: BookmarkNode) =>
  {
    if (claimed.has(node.id)) return false;
    claimed.add(node.id);
    return true;
  };

  for (const space of input.spaces)
  {
    const inThisSpace = space.id === input.activeSpaceId;
    const folder = findFolderBySegments(
      input.bookmarkRoots, space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount);

    if (folder)
    {
      // collectFolderBookmarks skips asd_Archive and asd_Favorites at any depth
      for (const node of collectFolderBookmarks(folder).filter(claim))
      {
        items.push({
          kind: 'bookmark',
          id: `b:${node.id}`,
          title: node.title,
          url: node.url ?? '',
          spaceId: space.id,
          lastAccess: input.recency.lastActiveAt(node.id) ?? dateLastUsed(node),
          inThisSpace,
          bookmarkId: node.id,
        });
      }

      const archive = ArchiveItems.fromFolder(findArchiveFolder(folder.children ?? []));
      for (const node of archive.matching('').filter(claim))
      {
        items.push({
          kind: 'archive',
          id: `a:${node.id}`,
          title: node.title,
          url: node.url ?? '',
          spaceId: space.id,
          lastAccess: node.dateAdded,
          inThisSpace,
          bookmarkId: node.id,
        });
      }
    }

    for (const record of input.closedRecords(space.id))
    {
      items.push({
        kind: 'closed',
        id: `c:${space.id}:${record.id}`,
        title: record.title,
        url: record.url,
        spaceId: space.id,
        lastAccess: record.closedAt,
        inThisSpace,
        recordId: record.id,
      });
    }
  }
  return items;
}

// The query text as the sidebar's search reads it (matchesFilter), parsed once per query
class TextFilter
{
  #literal: string;
  #ast: ASTNode | null;

  constructor(text: string)
  {
    this.#literal = text.trim().toLowerCase();
    this.#ast = this.#literal ? parseSearchQuery(text) : null;
  }

  matches(title: string, url: string): boolean
  {
    if (!this.#literal) return true;
    if (this.#ast) return matchesSearch(title, url, this.#ast);
    // A query that doesn't parse (an unclosed quote or bracket) is matched literally, as matchesFilter does
    return title.toLowerCase().includes(this.#literal) || url.toLowerCase().includes(this.#literal);
  }
}

function newestFirst(a: SearchItem, b: SearchItem): number
{
  if (a.lastAccess === undefined) return b.lastAccess === undefined ? 0 : 1;
  if (b.lastAccess === undefined) return -1;
  return b.lastAccess - a.lastAccess;
}

// A bookmark and its open Arc tab lead to the same tab, so the tab row is enough
function withoutBookmarksOfListedTabs(items: SearchItem[]): SearchItem[]
{
  const tabBookmarkIds = new Set<string>();
  for (const item of items)
  {
    if (item.kind === 'tab' && item.bookmarkId !== undefined) tabBookmarkIds.add(item.bookmarkId);
  }
  return items.filter(item => !(item.kind === 'bookmark' && tabBookmarkIds.has(item.bookmarkId)));
}

// Lower wins: switching to the open tab opens no second tab, and opening the bookmark leaves the
// Archive and Recently Closed as they are
const KIND_RANK: Record<SearchItemKind, number> = {
  tab: 0,
  bookmark: 1,
  archive: 2,
  closed: 3,
};

// Scheme, host and path. Not URL.origin: it is "null" for chrome:// and chrome-extension:// pages,
// which would merge pages of different extensions.
function pageAddress(url: string): string
{
  // A parked tab is keyed on the page it stands for, as the archive and Recently Closed store it
  const effectiveUrl = getEffectiveTabUrl(url);
  try
  {
    const parsed = new URL(effectiveUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  }
  catch
  {
    return effectiveUrl;
  }
}

function isBetterRow(candidate: SearchItem, current: SearchItem): boolean
{
  const rankDifference = KIND_RANK[candidate.kind] - KIND_RANK[current.kind];
  if (rankDifference !== 0) return rankDifference < 0;
  // A tie keeps the row collected first
  if (candidate.lastAccess === undefined) return false;
  return current.lastAccess === undefined || candidate.lastAccess > current.lastAccess;
}

// Results that open the same page: same title, same scheme, host and path (query and hash ignored).
// A Google Sheets tab and its archived copies differ only in the sheet's gid, and picking a copy would
// open a second tab of the sheet.
class SamePageGroups
{
  readonly #best = new Map<string, SearchItem>();

  private constructor(items: readonly SearchItem[])
  {
    for (const item of items)
    {
      const key = JSON.stringify([item.title, pageAddress(item.url)]);
      const current = this.#best.get(key);
      if (!current || isBetterRow(item, current)) this.#best.set(key, item);
    }
  }

  /** The best row of each page, in collection order so the stable sort still breaks ties by it. */
  static collapse(items: readonly SearchItem[]): SearchItem[]
  {
    const kept = new Set(new SamePageGroups(items).#best.values());
    return items.filter(item => kept.has(item));
  }
}

/** The search popup's snapshot of candidates, taken when it opens. */
export class SearchCandidates
{
  readonly #items: readonly SearchItem[];
  readonly #byId: ReadonlyMap<string, SearchItem>;
  readonly #spaces: readonly Space[];
  // Picking the current tab's own bookmark would do nothing, like picking the current tab
  readonly #currentTabBookmarkId: string | undefined;
  readonly #collapseSamePage: boolean;

  private constructor(
    items: SearchItem[],
    spaces: readonly Space[],
    currentTabBookmarkId: string | undefined,
    collapseSamePage: boolean)
  {
    this.#items = items;
    this.#byId = new Map(items.map(item => [item.id, item]));
    this.#spaces = spaces;
    this.#currentTabBookmarkId = currentTabBookmarkId;
    this.#collapseSamePage = collapseSamePage;
  }

  /** Collects the items in order: tabs, then per Space its bookmarks, archive and closed tabs. */
  static build(input: SearchCandidatesInput): SearchCandidates
  {
    return new SearchCandidates(
      [...collectTabs(input), ...collectSpaceItems(input)],
      input.spaces,
      arcBookmarkId(input, input.originWindowId, input.originActiveTabId),
      input.collapseSamePage);
  }

  /**
   * At most SEARCH_RESULT_LIMIT items, newest last access first; a blank text matches everything.
   * With collapseSamePage results of the same page show once, before the limit, so copies of one page
   * don't take the slots of other pages.
   */
  search(query: SearchQuery): SearchItem[]
  {
    const text = new TextFilter(query.text);
    const kept = this.#items.filter(item =>
      inScope(query.scope, item.kind)
      && (query.allSpaces || item.inThisSpace)
      && !this.#isCurrentTabBookmark(item)
      && text.matches(item.title, item.url));

    // Runs first and with the setting off too: an Arc tab that navigated away from its bookmark's URL
    // has another page address, which the same-page grouping would miss
    const listed = query.scope === 'all' ? withoutBookmarksOfListedTabs(kept) : kept;
    const results = this.#collapseSamePage ? SamePageGroups.collapse(listed) : listed;
    // Array.sort is stable: items with equal or no time keep collection order
    return results.sort(newestFirst).slice(0, SEARCH_RESULT_LIMIT);
  }

  /** False when no Spaces are set up: the page then hides the This Space / All Spaces toggle. */
  get hasSpaces(): boolean
  {
    return this.#spaces.length > 0;
  }

  /** The item a row id from the page stands for; undefined for an id this snapshot never gave out. */
  item(rowId: string): SearchItem | undefined
  {
    return this.#byId.get(rowId);
  }

  toRow(item: SearchItem, allSpaces: boolean): SearchRow
  {
    const host = hostOf(item.url);
    const spaceName = allSpaces ? this.#spaceName(item.spaceId) : undefined;
    return {
      id: item.id,
      kind: item.kind,
      title: item.title || item.url,
      subtitle: spaceName ? `${spaceName} · ${host}` : host,
      faviconPageUrl: item.url,
    };
  }

  #isCurrentTabBookmark(item: SearchItem): boolean
  {
    return item.kind === 'bookmark'
      && this.#currentTabBookmarkId !== undefined
      && item.bookmarkId === this.#currentTabBookmarkId;
  }

  #spaceName(spaceId: string | undefined): string | undefined
  {
    if (spaceId === undefined) return undefined;
    return this.#spaces.find(space => space.id === spaceId)?.name;
  }
}
