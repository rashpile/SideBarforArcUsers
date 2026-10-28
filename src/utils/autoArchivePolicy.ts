// Which tabs auto-archive closes (feature 035). Pure rules, no chrome.* calls:
// the archiver gathers tabs, associations, bookmarks, Favorites and last-use
// times, and this module decides. A tab is closed only when it is overdue and
// none of the exemptions hold; when anything about it is unknown, it stays open.

import { getEffectiveTabUrl, normalizeComparableUrl } from './parkedTabAssociation.ts';
import { BOOKMARK_ITEM_KEY_PREFIX } from './tabAssociations.ts';

// chrome.tabs.SPLIT_VIEW_ID_NONE (Chrome 140+): the tab is not in a split view
const SPLIT_VIEW_ID_NONE = -1;

// Pages with nothing worth keeping: closed without an archive bookmark
const EMPTY_PAGE_URLS: ReadonlySet<string> = new Set(['', 'chrome://newtab/', 'about:blank']);

/** The fields of chrome.tabs.Tab the policy reads. */
export interface AutoArchiveTabLike
{
  id?: number;
  windowId: number;
  active: boolean;
  audible?: boolean;
  pinned: boolean;
  incognito: boolean;
  url?: string;
  pendingUrl?: string;
  /** Chrome 140+: the split view showing the tab; SPLIT_VIEW_ID_NONE (-1) or absent when none. */
  splitViewId?: number;
  /** Chrome 121+: epoch millis the tab last became active. */
  lastAccessed?: number;
}

/** Last-use times by tab ID (from TabActivityTracker.refresh). */
export interface TabLastUseTimes
{
  lastUsedAt: (tabId: number) => number | undefined;
}

/** A bookmark tree node, as chrome.bookmarks.getTree returns it. */
interface SavedNodeLike
{
  id: string;
  url?: string;
  children?: SavedNodeLike[];
}

/**
 * Each window's tab associations (`tabAssociations_{windowId}`: tab ID ->
 * `bookmark-…` / `pinned-…`), as the archiver loaded them.
 */
export class TabAssociationsByWindow
{
  #byWindow = new Map<number, Readonly<Record<number, string>>>();

  /** Record one window's associations (an empty record for a window with none). */
  setWindow(windowId: number, associations: Readonly<Record<number, string>>): void
  {
    this.#byWindow.set(windowId, associations);
  }

  /** The item key the tab is associated with, if any. */
  itemKey(windowId: number, tabId: number): string | undefined
  {
    return this.#byWindow.get(windowId)?.[tabId];
  }
}

// The page in the form Favorite URLs are compared in (the sidebar's comparison:
// hash and trailing slash ignored); a parked tab counts by its original URL
function comparablePageUrl(url: string): string
{
  return normalizeComparableUrl(getEffectiveTabUrl(url));
}

// The page in the form a bookmark tab is compared with its bookmark: as above, but
// the hash is kept. Hash-routed apps (Gmail) show another page under another hash,
// and that page must be archived before the tab closes
function comparablePageUrlWithHash(url: string): string
{
  const effectiveUrl = getEffectiveTabUrl(url);
  try
  {
    return normalizeComparableUrl(effectiveUrl) + new URL(effectiveUrl).hash;
  }
  catch
  {
    return effectiveUrl;
  }
}

/**
 * The bookmarks and Favorites (pinned sites) one run judges tabs against.
 * Favorites are compared the way the sidebar's URL recovery compares them;
 * bookmarks also by hash, so only a tab on its bookmark's exact page closes
 * without an archive bookmark.
 */
export class SavedPages
{
  #bookmarkUrlById = new Map<string, string>();
  #favoriteUrls = new Set<string>();

  static fromTree(roots: readonly SavedNodeLike[], favorites: readonly { url: string }[]): SavedPages
  {
    const saved = new SavedPages();

    // Remember every Favorite's page
    for (const favorite of favorites)
    {
      const url = comparablePageUrl(favorite.url);
      if (url) saved.#favoriteUrls.add(url);
    }
    saved.#addBookmarks(roots);
    return saved;
  }

  /** True when the page is a Favorite's page. */
  isFavoritePage(pageUrl: string): boolean
  {
    return this.#favoriteUrls.has(comparablePageUrl(pageUrl));
  }

  /** True when the bookmark still exists and the page is its URL, hash included. */
  isBookmarkPage(bookmarkId: string, pageUrl: string): boolean
  {
    const bookmarkUrl = this.#bookmarkUrlById.get(bookmarkId);
    return bookmarkUrl !== undefined && bookmarkUrl === comparablePageUrlWithHash(pageUrl);
  }

  #addBookmarks(nodes: readonly SavedNodeLike[]): void
  {
    // Bookmarks count; folders are only walked into
    for (const node of nodes)
    {
      if (node.url) this.#bookmarkUrlById.set(node.id, comparablePageUrlWithHash(node.url));
      if (node.children) this.#addBookmarks(node.children);
    }
  }
}

/** What the policy needs to judge the open tabs. */
export interface TabsToCloseQuery<T extends AutoArchiveTabLike>
{
  tabs: readonly T[];
  associationsByWindow: TabAssociationsByWindow;
  savedPages: SavedPages;
  activity: TabLastUseTimes;
  /** Epoch millis auto-archive was switched on from 'never'. */
  enabledAt: number;
  now: number;
  periodMs: number;
}

/** Overdue tabs, split by what happens to them. */
export interface TabsToClose<T>
{
  /** Regular tabs: saved to the Space's archive folder, then closed. */
  archive: T[];
  /** Open bookmark pages and empty pages: closed without an archive bookmark. */
  closeOnly: T[];
}

/** The URL a tab shows, or is loading when nothing has committed yet. */
export function tabPageUrl(tab: { url?: string; pendingUrl?: string }): string
{
  return tab.url || tab.pendingUrl || '';
}

/** How the sidebar shows a tab, judged by its association. */
type TabKind = 'regular' | 'bookmark' | 'kept';

function tabKind(itemKey: string | undefined, pageUrl: string, savedPages: SavedPages): TabKind
{
  // A tab on a Favorite's page counts as that Favorite, associated or not: the sidebar claims such tabs by URL
  if (savedPages.isFavoritePage(pageUrl)) return 'kept';
  if (itemKey === undefined) return 'regular';

  // A bookmark tab on its bookmark's page closes without archiving. On any other page, another hash
  // route included (bookmark deleted, tab navigated away, association restored to the wrong tab),
  // it is archived, so the page is not lost
  if (itemKey.startsWith(BOOKMARK_ITEM_KEY_PREFIX))
  {
    return savedPages.isBookmarkPage(itemKey.slice(BOOKMARK_ITEM_KEY_PREFIX.length), pageUrl) ? 'bookmark' : 'regular';
  }

  // Favorites (`pinned-…`) never auto-close, nor does a tab with an association of unknown kind
  return 'kept';
}

/** The fields of a tab that place it in a split view. */
export type SplitViewTabLike = Pick<AutoArchiveTabLike, 'active' | 'splitViewId'>;

// The split view a tab is shown in, if any
function splitViewOf(tab: Pick<AutoArchiveTabLike, 'splitViewId'>): number | undefined
{
  return tab.splitViewId === SPLIT_VIEW_ID_NONE ? undefined : tab.splitViewId;
}

/**
 * The split views that show their window's active tab. Every tab of such a split
 * view is on screen, so it counts as in use like the active tab (the policy keeps
 * it open, the tracker restarts its clock).
 */
export class SplitViewsOnScreen
{
  #splitViewIds = new Set<number>();

  static of(tabs: readonly SplitViewTabLike[]): SplitViewsOnScreen
  {
    const onScreen = new SplitViewsOnScreen();

    // Split views showing their window's active tab
    for (const tab of tabs)
    {
      const splitView = splitViewOf(tab);
      if (tab.active && splitView !== undefined) onScreen.#splitViewIds.add(splitView);
    }
    return onScreen;
  }

  /** True when the tab shares a split view with its window's active tab (or is that tab). */
  shows(tab: SplitViewTabLike): boolean
  {
    const splitView = splitViewOf(tab);
    return splitView !== undefined && this.#splitViewIds.has(splitView);
  }
}

// Tabs the user is on, listening to or pinned in Chrome; incognito tabs are never touched
function isAlwaysKept(tab: AutoArchiveTabLike, splitViewsOnScreen: SplitViewsOnScreen): boolean
{
  return tab.active
    || tab.audible === true
    || tab.pinned
    || tab.incognito
    || splitViewsOnScreen.shows(tab);
}

// Unused for at least one period. The clock starts no earlier than the moment
// auto-archive was switched on; an unknown last use keeps the tab.
function isOverdue(lastUsedAt: number | undefined, enabledAt: number, now: number, periodMs: number): boolean
{
  if (lastUsedAt === undefined) return false;
  return now - Math.max(lastUsedAt, enabledAt) >= periodMs;
}

/** Pick the tabs to close now: regular tabs to archive first, the rest to close only. */
export function selectTabsToClose<T extends AutoArchiveTabLike>(query: TabsToCloseQuery<T>): TabsToClose<T>
{
  const { tabs, associationsByWindow, savedPages, activity, enabledAt, now, periodMs } = query;
  const selection: TabsToClose<T> = { archive: [], closeOnly: [] };
  const splitViewsOnScreen = SplitViewsOnScreen.of(tabs);

  // Sort each overdue, closable tab into archive or close-only; every other tab stays open
  for (const tab of tabs)
  {
    if (tab.id === undefined || isAlwaysKept(tab, splitViewsOnScreen)) continue;

    const pageUrl = tabPageUrl(tab);
    const kind = tabKind(associationsByWindow.itemKey(tab.windowId, tab.id), pageUrl, savedPages);
    if (kind === 'kept' || !isOverdue(activity.lastUsedAt(tab.id), enabledAt, now, periodMs)) continue;

    if (kind === 'bookmark' || EMPTY_PAGE_URLS.has(pageUrl))
    {
      selection.closeOnly.push(tab);
    }
    else
    {
      selection.archive.push(tab);
    }
  }
  return selection;
}

/**
 * True when a tab changed after the run judged its snapshot: the user switched
 * to it, it started audio, was pinned in Chrome, opened another page or joined
 * a split view. Such a tab stays open until the next run.
 */
export function tabChangedDuringRun(snapshot: AutoArchiveTabLike, current: AutoArchiveTabLike, runStartedAt: number): boolean
{
  return current.active
    || current.audible === true
    || current.pinned
    || (current.lastAccessed ?? 0) >= runStartedAt
    || tabPageUrl(current) !== tabPageUrl(snapshot)
    || splitViewOf(current) !== splitViewOf(snapshot);
}
