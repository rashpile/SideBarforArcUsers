import assert from 'node:assert/strict';
import test from 'node:test';

import { createTaskSpaceFolder } from '../src/utils/taskSpaceFolder.ts';

const DAY = new Date(2026, 10, 15, 12, 0);

const root = (id, title, folderType, syncing) => ({ id, title, folderType, syncing, parentId: '0', children: [] });

// Device-only profile from older Chrome: legacy ids, no folderType
const LEGACY_ROOTS = [
  { id: '1', title: 'Bookmarks Bar', parentId: '0', children: [] },
  { id: '2', title: 'Other Bookmarks', parentId: '0', children: [] },
];

/** In-memory chrome.bookmarks: children kept per parent id, every root starts empty. */
class FakeBookmarks
{
  #children = new Map();
  #nextId = 1;

  constructor(roots)
  {
    for (const node of roots) this.#children.set(node.id, []);
  }

  getChildren = async (id) => (this.#children.get(id) ?? []).map(node => ({ ...node }));

  create = async ({ parentId, title, url }) =>
  {
    const node = { id: `n${this.#nextId++}`, parentId, title, url };
    if (!url) this.#children.set(node.id, []);
    this.#children.get(parentId).push(node);
    return { ...node };
  };

  /** Titles of the children of `parentId`, in order. */
  titles(parentId)
  {
    return (this.#children.get(parentId) ?? []).map(node => node.title);
  }

  childFolder(parentId, title)
  {
    return (this.#children.get(parentId) ?? []).find(node => !node.url && node.title === title);
  }
}

test('creates Tasks Spaces under the Other root when it is missing', async () =>
{
  const bookmarks = new FakeBookmarks(LEGACY_ROOTS);

  const created = await createTaskSpaceFolder(bookmarks, LEGACY_ROOTS, DAY, []);

  assert.equal(created.name, '20261115-01');
  assert.deepEqual(bookmarks.titles('2'), ['Tasks Spaces']);
  const tasksFolder = bookmarks.childFolder('2', 'Tasks Spaces');
  assert.deepEqual(bookmarks.titles(tasksFolder.id), ['20261115-01']);
  assert.equal(created.folderId, bookmarks.childFolder(tasksFolder.id, '20261115-01').id);
  assert.deepEqual(bookmarks.titles('1'), [], 'the Bookmarks Bar is not touched');
});

test('reuses an existing Tasks Spaces folder', async () =>
{
  const bookmarks = new FakeBookmarks(LEGACY_ROOTS);
  await bookmarks.create({ parentId: '2', title: 'Tasks Spaces', url: 'https://example.com/' });
  const existing = await bookmarks.create({ parentId: '2', title: 'Tasks Spaces' });

  const created = await createTaskSpaceFolder(bookmarks, LEGACY_ROOTS, DAY, []);

  assert.deepEqual(bookmarks.titles('2'), ['Tasks Spaces', 'Tasks Spaces'], 'no third Tasks Spaces item');
  assert.equal(created.folderId, bookmarks.childFolder(existing.id, '20261115-01').id);
});

test('skips a number whose folder exists without a Space (archived or deleted Task Space)', async () =>
{
  const bookmarks = new FakeBookmarks(LEGACY_ROOTS);
  const tasksFolder = await bookmarks.create({ parentId: '2', title: 'Tasks Spaces' });
  await bookmarks.create({ parentId: tasksFolder.id, title: '20261115-02' });
  // A bookmark with a matching title is not a Task Space folder
  await bookmarks.create({ parentId: tasksFolder.id, title: '20261115-07', url: 'https://example.com/' });

  const created = await createTaskSpaceFolder(bookmarks, LEGACY_ROOTS, DAY, ['20261115-01']);

  assert.equal(created.name, '20261115-03');
  assert.equal(created.folderId, bookmarks.childFolder(tasksFolder.id, '20261115-03').id);
});

test('prefers the account Other root when both device and account roots exist', async () =>
{
  const roots = [
    root('1', 'Bookmarks Bar', 'bookmarks-bar', false),
    root('2', 'Other Bookmarks', 'other', false),
    root('a1', 'Bookmarks Bar', 'bookmarks-bar', true),
    root('a2', 'Other Bookmarks', 'other', true),
  ];
  const bookmarks = new FakeBookmarks(roots);

  await createTaskSpaceFolder(bookmarks, roots, DAY, []);

  assert.deepEqual(bookmarks.titles('a2'), ['Tasks Spaces']);
  assert.deepEqual(bookmarks.titles('2'), []);
});

test('finds the Other root by folderType in a profile without ids 1 and 2', async () =>
{
  const roots = [
    root('a1', 'Bookmarks Bar', 'bookmarks-bar', true),
    root('a3', 'Mobile Bookmarks', 'mobile', true),
    root('a2', 'Andere Lesezeichen', 'other', true),
  ];
  const bookmarks = new FakeBookmarks(roots);

  const created = await createTaskSpaceFolder(bookmarks, roots, DAY, []);

  const tasksFolder = bookmarks.childFolder('a2', 'Tasks Spaces');
  assert.ok(tasksFolder);
  assert.equal(created.folderId, bookmarks.childFolder(tasksFolder.id, '20261115-01').id);
});

test('throws and creates nothing when there is no Other root', async () =>
{
  const roots = [root('a1', 'Bookmarks Bar', 'bookmarks-bar', true)];
  const bookmarks = new FakeBookmarks(roots);

  await assert.rejects(createTaskSpaceFolder(bookmarks, roots, DAY, []));
  assert.deepEqual(bookmarks.titles('a1'), []);
});
