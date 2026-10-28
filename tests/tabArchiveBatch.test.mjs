import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHIVE_FOLDER_TITLE } from '../src/utils/archiveFolder.ts';
import { TabArchiveBatch } from '../src/utils/tabArchiveBatch.ts';

// In-memory stand-in for chrome.bookmarks: children kept per parent, index = position
class FakeBookmarks
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

const tab = (id, url, title = `Tab ${id}`) => ({ id, title, url });

test('a tab whose archive item cannot be created stays open; the others archive', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const bookmarks = new FakeBookmarks();
  bookmarks.failUrls.add('https://b.test/');

  const result = await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'https://a.test/'),
    tab(2, 'https://b.test/'),
    tab(3, 'https://c.test/'),
  ]);

  assert.deepEqual(result.closableTabIds, [1, 3]);
  assert.equal(result.archivedCount, 2);
  assert.equal(result.keptOpenCount, 1);
  assert.deepEqual(bookmarks.archivedUrls(), ['https://c.test/', 'https://a.test/']);
});

test('empty pages are closable without an archive item', async () =>
{
  const bookmarks = new FakeBookmarks();

  const result = await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'chrome://newtab/', 'New Tab'),
    tab(2, 'about:blank'),
    { id: 3, title: 'Loading', url: '', pendingUrl: '' },
  ]);

  assert.deepEqual(result.closableTabIds, [1, 2, 3]);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.keptOpenCount, 0);
  assert.deepEqual(bookmarks.archiveFolders(), []);
});

test('a batch into a Space without an archive folder creates exactly one', async () =>
{
  const bookmarks = new FakeBookmarks();

  await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'https://a.test/'),
    tab(2, 'https://b.test/'),
    tab(3, 'https://c.test/'),
  ]);

  assert.equal(bookmarks.archiveFolders().length, 1);
  assert.deepEqual(bookmarks.archivedUrls(), ['https://c.test/', 'https://b.test/', 'https://a.test/']);
});
