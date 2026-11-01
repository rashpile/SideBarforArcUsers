// New Folder from a selection. The bookmarks API and the batch runner are injected,
// so Node tests can load this module without chrome.*.

import type { BatchRunner, UndoableAction } from './types.ts';

/** The chrome.bookmarks calls CreateBookmarkFolderAction needs (injected for tests). */
export interface CreateBookmarkFolderApi
{
  get: (id: string) => Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  create: (bookmark: { parentId: string; title: string }) => Promise<{ id: string }>;
  move: (id: string, destination: { parentId: string; index: number }) => Promise<unknown>;
  /** Like chrome.bookmarks.remove: rejects for a folder that still has children. */
  remove: (id: string) => Promise<void>;
}

interface BookmarkLocation
{
  id: string;
  parentId: string;
  index: number;
}

type BookmarkMovedCallback = (bookmarkId: string, targetFolderId: string) => Promise<void>;

/**
 * The original parents and positions are recorded only on the first run; a redo reuses them.
 */
export class CreateBookmarkFolderAction implements UndoableAction
{
  description: string;
  #targetParentId: string;
  #title: string;
  #bookmarkIds: string[];
  #originalLocations: BookmarkLocation[] = [];
  #createdFolderId: string | null = null;
  #api: CreateBookmarkFolderApi;
  #batch: BatchRunner;
  #onBookmarkMoved?: BookmarkMovedCallback;
  #onFolderCreated?: (folderId: string) => void;

  constructor(
    targetParentId: string,
    title: string,
    bookmarkIds: string[],
    api: CreateBookmarkFolderApi,
    batch: BatchRunner,
    onBookmarkMoved?: BookmarkMovedCallback,
    onFolderCreated?: (folderId: string) => void
  )
  {
    this.#targetParentId = targetParentId;
    this.#title = title;
    this.#bookmarkIds = bookmarkIds;
    this.#api = api;
    this.#batch = batch;
    this.#onBookmarkMoved = onBookmarkMoved;
    this.#onFolderCreated = onFolderCreated;
    this.description = `Created "${title}" with ${bookmarkIds.length} items`;
  }

  async do(): Promise<void>
  {
    if (this.#originalLocations.length === 0)
    {
      const nodes = await Promise.all(this.#bookmarkIds.map(async (id) =>
      {
        const [node] = await this.#api.get(id);
        return node;
      }));

      this.#originalLocations = nodes
        .filter((node): node is chrome.bookmarks.BookmarkTreeNode =>
          !!node && !!node.parentId && node.index !== undefined)
        .map(node => ({ id: node.id, parentId: node.parentId!, index: node.index! }));
    }

    await this.#batch(async () =>
    {
      const folder = await this.#api.create({
        parentId: this.#targetParentId,
        title: this.#title,
      });
      this.#createdFolderId = folder.id;

      // Moved in selection order, so the new folder matches the order selected in the sidebar.
      for (let index = 0; index < this.#bookmarkIds.length; index++)
      {
        const bookmarkId = this.#bookmarkIds[index];
        await this.#api.move(bookmarkId, { parentId: folder.id, index });
        await this.#onBookmarkMoved?.(bookmarkId, folder.id);
      }

      this.#onFolderCreated?.(folder.id);
    });
  }

  async undo(): Promise<void>
  {
    if (!this.#createdFolderId) return;

    await this.#batch(async () =>
    {
      // Sorted by original index within each parent, so earlier moves don't shift later positions.
      const locations = [...this.#originalLocations].sort((a, b) =>
      {
        if (a.parentId !== b.parentId) return a.parentId.localeCompare(b.parentId);
        return a.index - b.index;
      });

      for (const location of locations)
      {
        await this.#api.move(location.id, {
          parentId: location.parentId,
          index: location.index,
        });
        await this.#onBookmarkMoved?.(location.id, location.parentId);
      }

      // remove, not removeTree: bookmarks the user added to the folder since must not go with it.
      try
      {
        await this.#api.remove(this.#createdFolderId!);
      }
      catch (error)
      {
        console.warn('[CreateBookmarkFolderAction] Kept the folder, it holds other bookmarks', this.#createdFolderId, error);
      }
      this.#createdFolderId = null;
    });
  }
}
