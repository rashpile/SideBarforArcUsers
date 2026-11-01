// Paste from YAML: creates a parsed folder tree at the end of one bookmark folder.
// The bookmarks API and the batch runner are injected, so Node tests can load
// this module without chrome.*.

import type { BatchRunner, UndoableAction } from './types.ts';
import { YamlFolder, type YamlBookmarkList, type YamlItem } from '../utils/bookmarkYaml.ts';

/** The chrome.bookmarks calls PasteBookmarkYamlAction needs (injected for tests). */
export interface PasteBookmarkYamlApi
{
  create: (bookmark: { parentId: string; title: string; url?: string }) => Promise<{ id: string }>;
  /** Like chrome.bookmarks.remove: rejects for a folder that still has children. */
  remove: (id: string) => Promise<void>;
}

/**
 * Every node one paste created, in creation order. Removal goes newest first and never uses
 * removeTree: a pasted folder the user has since filled with other bookmarks fails to remove and
 * stays, so Undo can't take bookmarks the paste didn't create.
 */
class CreatedNodes
{
  #ids: string[] = [];

  add(id: string): void
  {
    this.#ids.push(id);
  }

  /** Removes the recorded nodes and forgets them, so a second call removes nothing. */
  async removeAll(api: PasteBookmarkYamlApi): Promise<void>
  {
    const ids = this.#ids;
    this.#ids = [];

    // Newest first, so each folder's pasted children are gone before the folder itself.
    for (let index = ids.length - 1; index >= 0; index--)
    {
      try
      {
        await api.remove(ids[index]);
      }
      catch (error)
      {
        // Already deleted by the user, or a folder now holding bookmarks the paste didn't create.
        console.warn('[PasteBookmarkYamlAction] Kept or missing pasted item', ids[index], error);
      }
    }
  }
}

export class PasteBookmarkYamlAction implements UndoableAction
{
  description: string;
  #targetFolderId: string;
  #list: YamlBookmarkList;
  #api: PasteBookmarkYamlApi;
  #batch: BatchRunner;
  #created = new CreatedNodes();
  #failure: string | null = null;

  constructor(
    targetFolderId: string,
    list: YamlBookmarkList,
    api: PasteBookmarkYamlApi,
    batch: BatchRunner = fn => fn()
  )
  {
    this.#targetFolderId = targetFolderId;
    this.#list = list;
    this.#api = api;
    this.#batch = batch;
    this.description = `Pasted ${list.summary()}`;
  }

  /**
   * The message of the last do() failure, or null. The caller's performAction
   * swallows errors from do(), so the paste dialog reads this instead.
   */
  get failure(): string | null
  {
    return this.#failure;
  }

  async do(): Promise<void>
  {
    this.#failure = null;
    this.#created = new CreatedNodes();

    try
    {
      await this.#batch(async () =>
      {
        await this.#createItems(this.#targetFolderId, this.#list.items);
      });
    }
    catch (error)
    {
      // A half-made paste can't be undone as one step, so remove what was created.
      await this.#removeCreated();
      this.#failure = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async undo(): Promise<void>
  {
    await this.#removeCreated();
  }

  async #createItems(parentId: string, items: YamlItem[]): Promise<void>
  {
    for (const item of items)
    {
      // Recorded before its children, so a failure inside a folder still removes the folder.
      const created = await this.#createItem(parentId, item);
      this.#created.add(created.id);
      if (item instanceof YamlFolder)
      {
        await this.#createItems(created.id, item.items);
      }
    }
  }

  #createItem(parentId: string, item: YamlItem): Promise<{ id: string }>
  {
    // No index: Chrome appends, so the paste lands after the folder's existing children.
    if (item instanceof YamlFolder)
    {
      return this.#api.create({ parentId, title: item.title });
    }
    return this.#api.create({ parentId, title: item.title, url: item.url });
  }

  async #removeCreated(): Promise<void>
  {
    await this.#batch(() => this.#created.removeAll(this.#api));
  }
}
