// What a JSON backup's `pinnedSites` does to the active Space's Favorites. Pure:
// the import code passes the options and the bookmark trees in.

import type { PinnedSite } from '../managers/shared/pinnedSitesApi.ts';
import type { FavoriteIconEntry } from '../managers/shared/favoriteIconsApi.ts';
import { isFavoritesFolder } from './favoritesFolder.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export type FavoritesImportAction = 'skip' | 'restore-icons' | 'replace' | 'append';

export interface FavoritesImportInput
{
  importFavorites: boolean;
  favoritesMode: 'replace' | 'append';
  backupFavorites: readonly PinnedSite[];
  /** The backup's bookmarks replace the current roots, so each Space folder comes back in place. */
  bookmarksRestoredInPlace: boolean;
  backupBookmarks: readonly BookmarkNode[];
}

function holdsFavoritesFolder(nodes: readonly BookmarkNode[]): boolean
{
  return nodes.some(node => isFavoritesFolder(node) || holdsFavoritesFolder(node.children ?? []));
}

/**
 * Restored in place, the backup's bookmarks already bring back every Space's
 * `asd_Favorites`, so `pinnedSites` only puts the icons back: adding them too
 * would show each Favorite twice. A backup from before per-Space Favorites has
 * no such folder, and a backup imported into a subfolder restores no Space
 * folder: then `pinnedSites` is the only copy and is written as before.
 */
export function favoritesImportAction(input: FavoritesImportInput): FavoritesImportAction
{
  if (!input.importFavorites || input.backupFavorites.length === 0) return 'skip';
  if (input.bookmarksRestoredInPlace && holdsFavoritesFolder(input.backupBookmarks)) return 'restore-icons';
  return input.favoritesMode;
}

export interface FavoriteIconRestore
{
  id: string;
  icons: FavoriteIconEntry;
}

function iconsOf(site: PinnedSite): FavoriteIconEntry
{
  return { favicon: site.favicon, customIconName: site.customIconName, iconColor: site.iconColor, emoji: site.emoji };
}

function hasIcons(icons: FavoriteIconEntry): boolean
{
  return !!(icons.favicon || icons.customIconName || icons.iconColor || icons.emoji);
}

/**
 * Pairs each restored Favorite with a backup entry of the same URL, in order, each
 * backup entry used once, so two Favorites of one page keep their own icons.
 * Never yields a Favorite that isn't in `current`.
 */
export function iconRestoresByUrl(
  backupFavorites: readonly PinnedSite[],
  current: readonly Pick<PinnedSite, 'id' | 'url'>[]
): FavoriteIconRestore[]
{
  const unused = [...backupFavorites];
  const restores: FavoriteIconRestore[] = [];

  for (const favorite of current)
  {
    const match = unused.findIndex(site => site.url === favorite.url);
    if (match === -1) continue;

    const [site] = unused.splice(match, 1);
    const icons = iconsOf(site);
    if (hasIcons(icons)) restores.push({ id: favorite.id, icons });
  }
  return restores;
}
