// Favorites folder of a Space: a bookmark folder titled `asd_Favorites`, a direct
// child of the Space's bookmark folder, next to `asd_Archive`. Its direct URL
// children are the Space's Favorites, in bookmark order. The Bookmarks section
// hides the folder; only the Favorites grid shows it.

export const FAVORITES_FOLDER_TITLE = 'asd_Favorites';

/** The fields of a bookmark node the favorites helpers read. */
export interface FavoritesNodeLike
{
  title?: string;
  url?: string;
  index?: number;
}

/** A bookmark node as returned by the injected bookmarks API. */
export interface FavoritesBookmarkNode extends FavoritesNodeLike
{
  id: string;
}

/** The chrome.bookmarks calls ensureFavoritesFolder needs (injected for tests). */
export interface FavoritesBookmarksApi
{
  getChildren: (id: string) => Promise<FavoritesBookmarkNode[]>;
  create: (bookmark: { parentId: string; title: string; url?: string; index?: number }) => Promise<FavoritesBookmarkNode>;
}

/** True for a folder (no URL) titled `asd_Favorites`. */
export function isFavoritesFolder(node: FavoritesNodeLike): boolean
{
  return !node.url && node.title === FAVORITES_FOLDER_TITLE;
}

/**
 * The favorites folder among a Space folder's children. Several can exist (e.g.
 * after a bookmark sync); the one with the lowest index is used.
 */
export function findFavoritesFolder<T extends FavoritesNodeLike>(children: readonly T[]): T | undefined
{
  let first: T | undefined;

  // Keep the favorites folder with the lowest index; without indices the first in order wins
  for (const child of children)
  {
    if (!isFavoritesFolder(child)) continue;
    if (!first || (child.index ?? Infinity) < (first.index ?? Infinity))
    {
      first = child;
    }
  }
  return first;
}

/**
 * The Space's favorites folder, created at the end of the Space folder when it has
 * none. Nothing is cached: a folder the user deleted or renamed is created anew.
 */
export async function ensureFavoritesFolder(
  bookmarks: FavoritesBookmarksApi,
  spaceFolderId: string,
): Promise<FavoritesBookmarkNode>
{
  const children = await bookmarks.getChildren(spaceFolderId);
  return findFavoritesFolder(children)
    ?? await bookmarks.create({ parentId: spaceFolderId, title: FAVORITES_FOLDER_TITLE });
}

// The old Edit dialog saved URLs as typed, so backups and old pins can hold one
// that doesn't parse; bookmarks.create rejects it, and would on every retry
export function isBookmarkableUrl(url: string): boolean
{
  try
  {
    new URL(url);
    return true;
  }
  catch
  {
    return false;
  }
}

/** A Favorite bookmark to create in a favorites folder. */
export interface FavoriteBookmarkEntry
{
  url: string;
  title: string;
}

/** What a run of creates made, in order, and what Chrome rejected. */
export interface FavoriteBookmarksCreated<E extends FavoriteBookmarkEntry>
{
  created: Array<{ entry: E; node: FavoritesBookmarkNode }>;
  rejected: Array<{ entry: E; error: unknown }>;
}

/**
 * Creates the entries one after another, from bookmark index `startIndex` on or
 * at the end, so they keep their order. An entry Chrome rejects is skipped and
 * the rest are still created: in an import, the current Favorites may already
 * be gone.
 */
export async function createFavoriteBookmarks<E extends FavoriteBookmarkEntry>(
  bookmarks: FavoritesBookmarksApi,
  folderId: string,
  entries: readonly E[],
  startIndex: number | undefined,
  onCreated: (node: FavoritesBookmarkNode, entry: E) => Promise<void>
): Promise<FavoriteBookmarksCreated<E>>
{
  const result: FavoriteBookmarksCreated<E> = { created: [], rejected: [] };
  let index = startIndex;

  for (const entry of entries)
  {
    let node: FavoritesBookmarkNode;
    try
    {
      node = await bookmarks.create({
        parentId: folderId,
        title: entry.title,
        url: entry.url,
        ...(index !== undefined && { index }),
      });
    }
    catch (error)
    {
      result.rejected.push({ entry, error });
      continue;
    }
    if (index !== undefined) index++;

    await onCreated(node, entry);
    result.created.push({ entry, node });
  }
  return result;
}
