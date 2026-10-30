import { isSystemFolder } from './archiveFolder.ts';

interface TabLike
{
  id?: number;
  url?: string;
  active?: boolean;
}

interface BookmarkNodeLike
{
  id: string;
  title?: string;
  url?: string;
  children?: BookmarkNodeLike[];
}

/** A Favorite bookmark and the Space whose `asd_Favorites` holds it (see allFavoriteBookmarks). */
interface SpaceFavoriteLike
{
  spaceId: string;
  bookmark: { id: string; url?: string };
}

/**
 * Finds a tab's Favorite by URL within the tab's own Space. After the migration every
 * Space holds the same Favorite URLs, so only the tab's Space can tell which copy it is;
 * a tab with no Space, or whose Space has no Favorite on that URL, gets no Favorite.
 */
export class FavoriteUrlMatcher
{
  static readonly NONE = new FavoriteUrlMatcher([], () => undefined);

  readonly #itemKeyBySpaceAndUrl = new Map<string, Map<string, string>>();
  readonly #spaceOfTab: (tabId: number) => string | undefined;

  constructor(favorites: readonly SpaceFavoriteLike[], spaceOfTab: (tabId: number) => string | undefined)
  {
    this.#spaceOfTab = spaceOfTab;
    for (const { spaceId, bookmark } of favorites)
    {
      const comparableUrl = bookmark.url ? normalizeComparableUrl(bookmark.url) : '';
      if (!comparableUrl) continue;

      let byUrl = this.#itemKeyBySpaceAndUrl.get(spaceId);
      if (!byUrl)
      {
        byUrl = new Map();
        this.#itemKeyBySpaceAndUrl.set(spaceId, byUrl);
      }
      // Keep the first in grid order, as the bookmark walk keeps the first bookmark
      if (!byUrl.has(comparableUrl)) byUrl.set(comparableUrl, `pinned-${bookmark.id}`);
    }
  }

  itemKeyFor(tabId: number, comparableUrl: string): string | undefined
  {
    const spaceId = this.#spaceOfTab(tabId);
    if (spaceId === undefined) return undefined;
    return this.#itemKeyBySpaceAndUrl.get(spaceId)?.get(comparableUrl);
  }
}

export interface ParkedTabUrl
{
  sourceTabId: number;
  originalUrl: string;
}

/**
 * A tab suspender replaces a tab with its park page, which carries the original tab ID and URL.
 * Only a chrome-extension park.html counts, so the same parameters on a regular web page aren't
 * taken for a tab identity.
 */
export function parseParkedTabUrl(url?: string): ParkedTabUrl | null
{
  if (!url) return null;

  try
  {
    const parsed = new URL(url);
    if (parsed.protocol !== 'chrome-extension:' || !parsed.pathname.endsWith('/park.html')) return null;

    const sourceTabId = Number(parsed.searchParams.get('tabId'));
    const originalUrl = parsed.searchParams.get('url');
    if (!Number.isSafeInteger(sourceTabId) || sourceTabId < 0 || !originalUrl) return null;

    return { sourceTabId, originalUrl };
  }
  catch
  {
    return null;
  }
}

export function getEffectiveTabUrl(url?: string): string
{
  return parseParkedTabUrl(url)?.originalUrl ?? url ?? '';
}

export function findParkedReplacementTab<TTab extends TabLike>(
  tabs: readonly TTab[],
  sourceTabId: number
): TTab | undefined
{
  return tabs.find(tab => parseParkedTabUrl(tab.url)?.sourceTabId === sourceTabId);
}

/**
 * The exact association of the old tab ID comes first; only when it is lost is the original URL
 * matched against Favorites and bookmarks.
 */
export function recoverParkedTabAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[] = [],
  favorites: FavoriteUrlMatcher = FavoriteUrlMatcher.NONE
): Record<number, string>
{
  return recoverAssociations(tabs, associations, bookmarkRoots, favorites, true);
}

/**
 * The active tab goes first, so the sidebar shows the right active state as soon as it opens.
 */
export function recoverFixedTabAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[] = [],
  favorites: FavoriteUrlMatcher = FavoriteUrlMatcher.NONE
): Record<number, string>
{
  return recoverAssociations(tabs, associations, bookmarkRoots, favorites, false);
}

function recoverAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[],
  favorites: FavoriteUrlMatcher,
  parkedOnly: boolean
): Record<number, string>
{
  const recovered: Record<number, string> = {};
  const liveTabIds = new Set(
    tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id])
  );
  const claimedItemKeys = new Set(
    Object.entries(associations)
      .filter(([tabId]) => liveTabIds.has(Number(tabId)))
      .map(([, itemKey]) => itemKey)
  );
  const itemKeyByUrl = buildBookmarkUrlIndex(bookmarkRoots);

  const orderedTabs = [...tabs].sort((left, right) => Number(right.active) - Number(left.active));

  for (const tab of orderedTabs)
  {
    if (tab.id === undefined || associations[tab.id]) continue;

    const parked = parseParkedTabUrl(tab.url);
    if (parkedOnly && !parked) continue;

    // Favorites take priority in Arc, so a Favorite wins over a bookmark with the same URL
    const comparableUrl = normalizeComparableUrl(getEffectiveTabUrl(tab.url));
    const itemKey = (parked ? associations[parked.sourceTabId] : undefined)
      ?? favorites.itemKeyFor(tab.id, comparableUrl)
      ?? itemKeyByUrl.get(comparableUrl);
    if (!itemKey || claimedItemKeys.has(itemKey)) continue;

    recovered[tab.id] = itemKey;
    claimedItemKeys.add(itemKey);
  }

  return recovered;
}

/**
 * System folders are left out: a tab on an archived URL stays a regular tab, and a Favorite
 * never becomes a `bookmark-<id>` tab (Favorites match through FavoriteUrlMatcher).
 */
function buildBookmarkUrlIndex(bookmarkRoots: readonly BookmarkNodeLike[]): Map<string, string>
{
  const itemKeyByUrl = new Map<string, string>();

  const visitBookmarks = (nodes: readonly BookmarkNodeLike[]): void =>
  {
    // Depth-first, keeping the first bookmark found, as the Space resolution already assumes.
    for (const node of nodes)
    {
      if (isSystemFolder(node)) continue;

      if (node.url)
      {
        const comparableUrl = normalizeComparableUrl(node.url);
        if (comparableUrl && !itemKeyByUrl.has(comparableUrl))
        {
          itemKeyByUrl.set(comparableUrl, `bookmark-${node.id}`);
        }
      }
      if (node.children) visitBookmarks(node.children);
    }
  };

  visitBookmarks(bookmarkRoots);
  return itemKeyByUrl;
}

/** Ignores hash and trailing slash, where Chrome and saved bookmark URLs can differ slightly. */
export function normalizeComparableUrl(url: string): string
{
  try
  {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1)
    {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.href;
  }
  catch
  {
    return url;
  }
}
