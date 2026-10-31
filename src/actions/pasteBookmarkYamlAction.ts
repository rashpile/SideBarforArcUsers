// Paste from YAML: creates a parsed folder tree at the end of one bookmark folder.
// The bookmarks API and the batch runner are injected, so Node tests can load
// this module without chrome.*.

import type { BatchRunner, UndoableAction } from './types.ts';
import { YamlFolder, type YamlBookmarkList, type YamlItem } from '../utils/bookmarkYaml.ts';

/** The chrome.bookmarks calls PasteBookmarkYamlAction needs (injected for tests). */
export interface PasteBookmarkYamlApi
{
  create: (bookmark: { parentId: string; title: string; url?: string }) => Promise<{ id: string }>;
  remove: (id: string) => Promise<void>;
  removeTree: (id: string) => Promise<void>;
}

/** A top-level item the paste created; removing it removes everything below it. */
class CreatedRoot
{
  id: string;
  isFolder: boolean;

  constructor(id: string, isFolder: boolean)
  {
    this.id = id;
    this.isFolder = isFolder;
  }

  async remove(api: PasteBookmarkYamlApi): Promise<void>
  {
    if (this.isFolder)
    {
      await api.removeTree(this.id);
    }
    else
    {
      await api.remove(this.id);
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
  #createdRoots: CreatedRoot[] = [];
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
    this.#createdRoots = [];

    try
    {
      await this.#batch(async () =>
      {
        for (const item of this.#list.items)
        {
          // Recorded before its children, so a failure inside a folder still removes the folder.
          const created = await this.#createItem(this.#targetFolderId, item);
          const root = new CreatedRoot(created.id, item instanceof YamlFolder);
          this.#createdRoots.push(root);
          if (item instanceof YamlFolder)
          {
            await this.#createChildren(created.id, item.items);
          }
        }
      });
    }
    catch (error)
    {
      // A half-made paste can't be undone as one step, so remove what was created.
      await this.#removeCreatedRoots();
      this.#failure = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async undo(): Promise<void>
  {
    await this.#removeCreatedRoots();
  }

  async #createChildren(parentId: string, items: YamlItem[]): Promise<void>
  {
    for (const item of items)
    {
      const created = await this.#createItem(parentId, item);
      if (item instanceof YamlFolder)
      {
        await this.#createChildren(created.id, item.items);
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

  async #removeCreatedRoots(): Promise<void>
  {
    const roots = this.#createdRoots;
    this.#createdRoots = [];

    await this.#batch(async () =>
    {
      for (const root of roots)
      {
        try
        {
          await root.remove(this.#api);
        }
        catch (error)
        {
          // Usually the user already deleted it; the rest must still go.
          console.error('[PasteBookmarkYamlAction] Failed to remove pasted item', root.id, error);
        }
      }
    });
  }
}
