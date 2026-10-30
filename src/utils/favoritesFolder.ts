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
