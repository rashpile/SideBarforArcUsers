// The Archive menu's Clear options: removes the pages of one Space's archive
// folder that an ArchiveClearOption selects. The bookmarks API is injected, so
// Node tests can load this module without chrome.*.

import type { UndoableAction } from './types.ts';
import { isArchiveFolder } from '../utils/archiveFolder.ts';
import { ArchiveItems, type ArchiveClearOption } from '../utils/archiveItems.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

/** The chrome.bookmarks calls ClearArchiveAction needs (injected for tests). */
export interface ClearArchiveBookmarksApi
{
  getSubTree: (id: string) => Promise<BookmarkNode[]>;
  remove: (id: string) => Promise<void>;
  create: (bookmark: { parentId: string; title: string; url: string; index: number }) => Promise<unknown>;
}

export type BatchRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/** What Undo needs to recreate a removed page. */
interface RemovedPage
{
  parentId: string;
  title: string;
  url: string;
  dateAdded?: number;
}

export class ClearArchiveAction implements UndoableAction
{
  description = '';
  #api: ClearArchiveBookmarksApi;
  #archiveFolderId: string;
  #option: ArchiveClearOption;
  #now: () => number;
  #batch: BatchRunner;
  #removed: RemovedPage[] = [];

  constructor(
    api: ClearArchiveBookmarksApi,
    archiveFolderId: string,
    option: ArchiveClearOption,
    now: () => number,
    batch: BatchRunner = fn => fn()
  )
  {
    this.#api = api;
    this.#archiveFolderId = archiveFolderId;
    this.#option = option;
    this.#now = now;
    this.#batch = batch;
  }

  async do(): Promise<void>
  {
    this.#removed = [];

    // Select from the folder as it is now, not as the menu last rendered it: a page
    // moved out of the archive since then must not be removed. A deleted folder
    // makes getSubTree reject, and the error reaches the caller's error toast.
    const [folder] = await this.#api.getSubTree(this.#archiveFolderId);
    const pages = folder && isArchiveFolder(folder)
      ? ArchiveItems.fromFolder(folder).clearable(this.#option, this.#now())
      : [];

    await this.#batch(async () =>
    {
      for (const page of pages)
      {
        try
        {
          await this.#api.remove(page.id);
        }
        catch (error)
        {
          console.error('[ClearArchiveAction] Failed to remove archived page', page.id, error);
          continue;
        }
        this.#removed.push({
          parentId: page.parentId ?? this.#archiveFolderId,
          title: page.title,
          url: page.url ?? '',
          dateAdded: page.dateAdded,
        });
      }
    });

    const count = this.#removed.length;
    this.description = count === 1 ? 'Cleared 1 archived page' : `Cleared ${count} archived pages`;
  }

  async undo(): Promise<void>
  {
    // Chrome can't restore dateAdded; recreating oldest first at index 0 at least
    // brings the pages back in their original relative order (newest on top).
    // Removal went top first; reversing it first keeps pages with equal times in order.
    const oldestFirst = [...this.#removed].reverse().sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0));

    await this.#batch(async () =>
    {
      for (const page of oldestFirst)
      {
        try
        {
          await this.#api.create({ parentId: page.parentId, title: page.title, url: page.url, index: 0 });
        }
        catch (error)
        {
          console.error('[ClearArchiveAction] Failed to restore archived page', page.url, error);
        }
      }
    });
  }
}
