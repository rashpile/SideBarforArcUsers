// A Space's Favorites as read from the bookmark tree: the URL bookmarks directly
// inside the `asd_Favorites` folder of the Space's bookmark folder, merged with
// their icon side-store entries. Pure: callers pass the tree and the icon store.

import type { PinnedSite } from '../managers/shared/pinnedSitesApi.ts';
import type { FavoriteIcons } from '../managers/shared/favoriteIconsApi.ts';
import { ALL_SPACE, type Space } from './spaceMessages.ts';
import { findFolderBySegments } from './bookmarkFolderLookup.ts';
import { findFavoritesFolder } from './favoritesFolder.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

/** The parts of a Space that locate its bookmark folder. */
export type FavoritesSpace = Pick<Space, 'id' | 'bookmarkFolderSegments' | 'bookmarkFolderInAccount'>;

/** One Favorite bookmark and the Space whose `asd_Favorites` holds it. */
export interface SpaceFavoriteBookmark
{
  spaceId: string;
  bookmark: BookmarkNode;
}

function findSpaceFolder(roots: BookmarkNode[], space: FavoritesSpace): BookmarkNode | null
{
  return findFolderBySegments(roots, space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount);
}

// Subfolders inside asd_Favorites are not Favorites; the grid shows only direct pages
function favoriteBookmarksIn(spaceFolder: BookmarkNode | null): BookmarkNode[]
{
  const favoritesFolder = spaceFolder ? findFavoritesFolder(spaceFolder.children ?? []) : undefined;
  return (favoritesFolder?.children ?? [])
    .filter(child => !!child.url)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

export class SpaceFavorites
{
  readonly spaceId: string;
  /** The Space's bookmark folder, or null when the Space has none or it can't be found. */
  readonly spaceFolder: BookmarkNode | null;
  readonly sites: readonly PinnedSite[];
  // Chrome's tree always has roots; none means the sidebar hasn't read it yet
  readonly #treeRead: boolean;

  private constructor(spaceId: string, spaceFolder: BookmarkNode | null, sites: PinnedSite[], treeRead: boolean)
  {
    this.spaceId = spaceId;
    this.spaceFolder = spaceFolder;
    this.sites = sites;
    this.#treeRead = treeRead;
  }

  static resolve(roots: BookmarkNode[], space: FavoritesSpace, icons: FavoriteIcons): SpaceFavorites
  {
    const spaceFolder = findSpaceFolder(roots, space);
    const sites = favoriteBookmarksIn(spaceFolder).map(bookmark => ({
      ...icons.entryFor(bookmark.id),
      id: bookmark.id,
      url: bookmark.url!,
      title: bookmark.title,
    }));
    return new SpaceFavorites(space.id, spaceFolder, sites, roots.length > 0);
  }

  /** False when the Space has no bookmark folder: it can't hold Favorites. True with no Favorites yet too. */
  get hasFolder(): boolean
  {
    return this.spaceFolder !== null;
  }

  /**
   * The grid tells the user why a Space can't hold Favorites. Not for the internal
   * "no Space yet" state, which isn't a Space the user picked, nor before the tree is read.
   */
  get needsFolderHint(): boolean
  {
    return this.#treeRead && !this.hasFolder && this.spaceId !== ALL_SPACE.id;
  }

  /**
   * Same Space, same Space folder and the same Favorites with the same icons. Lets the
   * sidebar keep its list when an unrelated bookmark or icon changes.
   */
  sameAs(other: SpaceFavorites): boolean
  {
    return this.spaceId === other.spaceId
      && this.spaceFolder?.id === other.spaceFolder?.id
      && this.#treeRead === other.#treeRead
      && JSON.stringify(this.sites) === JSON.stringify(other.sites);
  }
}

/**
 * The Favorites of every Space. A folder shared by several Spaces is listed once,
 * under the first of them (see "One folder, one Space" in CLAUDE.md).
 */
export function allFavoriteBookmarks(roots: BookmarkNode[], spaces: readonly FavoritesSpace[]): SpaceFavoriteBookmark[]
{
  const seen = new Set<string>();
  const result: SpaceFavoriteBookmark[] = [];

  for (const space of spaces)
  {
    for (const bookmark of favoriteBookmarksIn(findSpaceFolder(roots, space)))
    {
      if (seen.has(bookmark.id)) continue;
      seen.add(bookmark.id);
      result.push({ spaceId: space.id, bookmark });
    }
  }
  return result;
}

/** The page URLs of every Space's Favorites. */
export function allFavoriteUrls(roots: BookmarkNode[], spaces: readonly FavoritesSpace[]): string[]
{
  return allFavoriteBookmarks(roots, spaces).map(({ bookmark }) => bookmark.url!);
}

/**
 * The Spaces a Favorite of `from` can move to: those with a bookmark folder of their
 * own. A Space that shares the source's folder is left out, since moving there
 * changes nothing (see "One folder, one Space" in CLAUDE.md).
 */
export function favoritesMoveTargets<S extends FavoritesSpace>(
  roots: BookmarkNode[],
  spaces: readonly S[],
  from: FavoritesSpace
): S[]
{
  const sourceFolderId = findSpaceFolder(roots, from)?.id;
  return spaces.filter(space =>
  {
    if (space.id === from.id) return false;
    const folder = findSpaceFolder(roots, space);
    return folder !== null && folder.id !== sourceFolderId;
  });
}

/** The bookmark folder of a Space, or null when it has none or it can't be found. */
export function favoritesSpaceFolder(roots: BookmarkNode[], space: FavoritesSpace): BookmarkNode | null
{
  return findSpaceFolder(roots, space);
}
