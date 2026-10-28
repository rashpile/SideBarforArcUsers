// Shared by the archive tests (not a test file itself: `make test` runs only *.test.mjs)

import { ARCHIVE_FOLDER_TITLE } from '../src/utils/archiveFolder.ts';

/**
 * In-memory stand-in for chrome.bookmarks with one Space folder, id 'space'.
 * Children are kept per parent; a node's index is its position.
 */
export class FakeArchiveBookmarks
{
  #children = new Map([['space', []]]);
  #nextId = 1;
  /** Creating a bookmark on one of these URLs throws. */
  failUrls = new Set();

  getChildren = async (id) =>
    (this.#children.get(id) ?? []).map((node, index) => ({ ...node, index }));

  create = async ({ parentId, title, url, index }) =>
  {
    if (url && this.failUrls.has(url)) throw new Error('create failed');

    const node = { id: `n${this.#nextId++}`, parentId, title, url };
    if (!url) this.#children.set(node.id, []);
    const siblings = this.#children.get(parentId);
    siblings.splice(index ?? siblings.length, 0, node);
    return { ...node, index: siblings.indexOf(node) };
  };

  remove = async (id) =>
  {
    // Drop the node from whichever parent holds it
    for (const siblings of this.#children.values())
    {
      const position = siblings.findIndex(node => node.id === id);
      if (position >= 0) siblings.splice(position, 1);
    }
  };

  /** Archive folders directly inside the Space folder. */
  archiveFolders()
  {
    return this.#children.get('space').filter(node => !node.url && node.title === ARCHIVE_FOLDER_TITLE);
  }

  /** URLs in the Space's archive, top first (none without an archive folder). */
  archivedUrls()
  {
    const [folder] = this.archiveFolders();
    return folder ? this.#children.get(folder.id).map(node => node.url) : [];
  }
}
