import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHIVE_FOLDER_TITLE, SpaceArchive, findArchiveFolder } from '../src/utils/archiveFolder.ts';

// In-memory stand-in for chrome.bookmarks: children kept per parent, index = position
class FakeBookmarks
{
  #children = new Map();
  #nextId = 1;
  failBookmarkCreate = false;
  failRemove = false;

  constructor(spaceFolderId, spaceChildren = [])
  {
    this.#children.set(spaceFolderId, []);
    // Seed the Space folder with existing nodes
    for (const child of spaceChildren)
    {
      this.#insert(spaceFolderId, child);
    }
  }

  getChildren = async (id) =>
    (this.#children.get(id) ?? []).map((node, index) => ({ ...node, index }));

  create = async ({ parentId, title, url, index }) =>
  {
    if (url && this.failBookmarkCreate) throw new Error('create failed');
    return this.#insert(parentId, { title, url }, index);
  };

  remove = async (id) =>
  {
    if (this.failRemove) throw new Error('remove failed');

    // Drop the node from whichever parent holds it
    for (const siblings of this.#children.values())
    {
      const position = siblings.findIndex(node => node.id === id);
      if (position >= 0) siblings.splice(position, 1);
    }
  };

  /** Archive folders directly inside the Space folder. */
  archiveFolders(spaceFolderId)
  {
    return this.#children.get(spaceFolderId).filter(node => !node.url && node.title === ARCHIVE_FOLDER_TITLE);
  }

  /** Items of a folder as [title, url] pairs, top first. */
  items(folderId)
  {
    return this.#children.get(folderId).map(node => [node.title, node.url]);
  }

  #insert(parentId, { id, title, url }, index)
  {
    const node = { id: id ?? `n${this.#nextId++}`, parentId, title, url };
    if (!url) this.#children.set(node.id, []);
    const siblings = this.#children.get(parentId);
    siblings.splice(index ?? siblings.length, 0, node);
    return { ...node, index: siblings.indexOf(node) };
  }
}

test('two archives in one Space share one archive folder, newest on top', async () =>
{
  const bookmarks = new FakeBookmarks('space', [{ title: 'Docs', url: 'https://docs.test/' }]);
  const archive = new SpaceArchive(bookmarks);

  await archive.archive('space', { title: 'A', url: 'https://a.test/' });
  await archive.archive('space', { title: 'B', url: 'https://b.test/' });

  const folders = bookmarks.archiveFolders('space');
  assert.equal(folders.length, 1);
  assert.deepEqual(bookmarks.items(folders[0].id), [['B', 'https://b.test/'], ['A', 'https://a.test/']]);
  // The new folder goes after the Space's own items
  assert.deepEqual(bookmarks.items('space').map(([title]) => title), ['Docs', ARCHIVE_FOLDER_TITLE]);
});

test('archiving the same URL again leaves one item, moved to the top', async () =>
{
  const bookmarks = new FakeBookmarks('space');
  const archive = new SpaceArchive(bookmarks);

  const first = await archive.archive('space', { title: 'Old title', url: 'https://a.test/' });
  await archive.archive('space', { title: 'B', url: 'https://b.test/' });
  const second = await archive.archive('space', { title: 'New title', url: 'https://a.test/' });

  const [folder] = bookmarks.archiveFolders('space');
  assert.deepEqual(bookmarks.items(folder.id), [['New title', 'https://a.test/'], ['B', 'https://b.test/']]);
  assert.notEqual(second.id, first.id);
});

test('an empty title falls back to the URL', async () =>
{
  const bookmarks = new FakeBookmarks('space');
  const archive = new SpaceArchive(bookmarks);

  await archive.archive('space', { title: '', url: 'https://a.test/' });
  await archive.archive('space', { url: 'https://b.test/' });

  const [folder] = bookmarks.archiveFolders('space');
  assert.deepEqual(bookmarks.items(folder.id), [['https://b.test/', 'https://b.test/'], ['https://a.test/', 'https://a.test/']]);
});

test('a failed create throws and keeps the older item', async () =>
{
  const bookmarks = new FakeBookmarks('space');
  const archive = new SpaceArchive(bookmarks);
  await archive.archive('space', { title: 'A', url: 'https://a.test/' });

  bookmarks.failBookmarkCreate = true;
  await assert.rejects(archive.archive('space', { title: 'A again', url: 'https://a.test/' }), /create failed/);

  const [folder] = bookmarks.archiveFolders('space');
  assert.deepEqual(bookmarks.items(folder.id), [['A', 'https://a.test/']]);
});

test('with several archive folders the first by index is used', async () =>
{
  const bookmarks = new FakeBookmarks('space', [
    { id: 'look-alike', title: ARCHIVE_FOLDER_TITLE, url: 'https://not-a-folder.test/' },
    { id: 'first', title: ARCHIVE_FOLDER_TITLE },
    { id: 'second', title: ARCHIVE_FOLDER_TITLE },
  ]);
  const archive = new SpaceArchive(bookmarks);

  await archive.archive('space', { title: 'A', url: 'https://a.test/' });

  assert.deepEqual(bookmarks.items('first'), [['A', 'https://a.test/']]);
  assert.deepEqual(bookmarks.items('second'), []);
  // Lowest index wins even when the children come unsorted
  const unsorted = [
    { id: 'second', title: ARCHIVE_FOLDER_TITLE, index: 4 },
    { id: 'first', title: ARCHIVE_FOLDER_TITLE, index: 1 },
  ];
  assert.equal(findArchiveFolder(unsorted)?.id, 'first');
});

test('a failed removal of the older copy still counts as archived; the new item is on top', async (t) =>
{
  const errors = t.mock.method(console, 'error', () => {});
  const bookmarks = new FakeBookmarks('space');
  const archive = new SpaceArchive(bookmarks);
  await archive.archive('space', { title: 'Old', url: 'https://a.test/' });

  bookmarks.failRemove = true;
  const created = await archive.archive('space', { title: 'New', url: 'https://a.test/' });

  const [folder] = bookmarks.archiveFolders('space');
  assert.equal(created.title, 'New');
  assert.deepEqual(bookmarks.items(folder.id), [['New', 'https://a.test/'], ['Old', 'https://a.test/']]);
  assert.equal(errors.mock.callCount(), 1);
});

test('an archive folder deleted between two archives is created again', async () =>
{
  const bookmarks = new FakeBookmarks('space');
  const archive = new SpaceArchive(bookmarks);
  await archive.archive('space', { title: 'A', url: 'https://a.test/' });

  const [deleted] = bookmarks.archiveFolders('space');
  await bookmarks.remove(deleted.id);
  await archive.archive('space', { title: 'B', url: 'https://b.test/' });

  const folders = bookmarks.archiveFolders('space');
  assert.equal(folders.length, 1);
  assert.notEqual(folders[0].id, deleted.id);
  assert.deepEqual(bookmarks.items(folders[0].id), [['B', 'https://b.test/']]);
});
