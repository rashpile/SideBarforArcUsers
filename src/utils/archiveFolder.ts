// Archive folder of a Space: a bookmark folder titled `asd_Archive`,
// a direct child of the Space's bookmark folder. Auto-archive saves closed tabs
// there as bookmarks, newest at index 0. The Bookmarks section hides the folder;
// only the Archive section shows it.

import { isFavoritesFolder } from './favoritesFolder.ts';

export const ARCHIVE_FOLDER_TITLE = 'asd_Archive';

/** The fields of a bookmark node the archive helpers read. */
export interface ArchiveNodeLike
{
  title?: string;
  url?: string;
  index?: number;
}

/** A bookmark node as returned by the injected bookmarks API. */
export interface ArchiveBookmarkNode extends ArchiveNodeLike
{
  id: string;
}

/** The chrome.bookmarks calls SpaceArchive needs (injected for tests). */
export interface ArchiveBookmarksApi
{
  getChildren: (id: string) => Promise<ArchiveBookmarkNode[]>;
  create: (bookmark: { parentId: string; title: string; url?: string; index?: number }) => Promise<ArchiveBookmarkNode>;
  remove: (id: string) => Promise<void>;
}

/** A page to save in the archive. */
export interface ArchivedPage
{
  title?: string;
  url: string;
}

/** True for a folder (no URL) titled `asd_Archive`. */
export function isArchiveFolder(node: ArchiveNodeLike): boolean
{
  return !node.url && node.title === ARCHIVE_FOLDER_TITLE;
}

/**
 * True for a folder the sidebar manages itself (`asd_Archive` or `asd_Favorites`).
 * Walks of a Space folder's descendants skip these at any depth.
 */
export function isSystemFolder(node: ArchiveNodeLike): boolean
{
  return isArchiveFolder(node) || isFavoritesFolder(node);
}

/**
 * The archive folder among a Space folder's children. Several can exist (e.g.
 * after a bookmark sync); the one with the lowest index is used.
 */
export function findArchiveFolder<T extends ArchiveNodeLike>(children: readonly T[]): T | undefined
{
  let first: T | undefined;

  // Keep the archive folder with the lowest index; without indices the first in order wins
  for (const child of children)
  {
    if (!isArchiveFolder(child)) continue;
    if (!first || (child.index ?? Infinity) < (first.index ?? Infinity))
    {
      first = child;
    }
  }
  return first;
}

/**
 * Saves pages into a Space's archive folder. Nothing is cached: every call looks
 * the folder and its items up again, so a folder the user deleted or renamed is
 * simply created anew.
 */
export class SpaceArchive
{
  #bookmarks: ArchiveBookmarksApi;

  constructor(bookmarks: ArchiveBookmarksApi)
  {
    this.#bookmarks = bookmarks;
  }

  /**
   * Save a page at the top of the Space's archive and return the new bookmark.
   * An older item with the same URL is removed only after the new one exists,
   * so a failed create (which throws) loses nothing.
   */
  async archive(spaceFolderId: string, page: ArchivedPage): Promise<ArchiveBookmarkNode>
  {
    // Without a URL chrome.bookmarks.create would make a folder instead of a bookmark
    if (!page.url)
    {
      throw new Error('cannot archive a page without a URL');
    }

    const folder = await this.#findOrCreateFolder(spaceFolderId);
    const created = await this.#bookmarks.create({
      parentId: folder.id,
      index: 0,
      title: page.title?.trim() ? page.title : page.url,
      url: page.url,
    });
    await this.#removeOlderCopies(folder.id, created);
    return created;
  }

  async #findOrCreateFolder(spaceFolderId: string): Promise<ArchiveBookmarkNode>
  {
    const children = await this.#bookmarks.getChildren(spaceFolderId);
    // Appended at the end of the Space folder, after the items the sidebar shows
    return findArchiveFolder(children)
      ?? await this.#bookmarks.create({ parentId: spaceFolderId, title: ARCHIVE_FOLDER_TITLE });
  }

  // The new item already exists, so a failed removal only leaves a duplicate behind:
  // it is logged and the archive still counts as saved.
  async #removeOlderCopies(folderId: string, created: ArchiveBookmarkNode): Promise<void>
  {
    const items = await this.#bookmarks.getChildren(folderId);

    // Remove every other item on the same URL
    for (const item of items)
    {
      if (item.id === created.id || item.url !== created.url) continue;
      try
      {
        await this.#bookmarks.remove(item.id);
      }
      catch (error)
      {
        console.error('[SpaceArchive] Failed to remove older archive item', item.id, error);
      }
    }
  }
}
