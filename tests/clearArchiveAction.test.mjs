import assert from 'node:assert/strict';
import test from 'node:test';

import { ClearArchiveAction } from '../src/actions/clearArchiveAction.ts';
import { ArchiveClearOption } from '../src/utils/archiveItems.ts';

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

/**
 * In-memory chrome.bookmarks tree: getSubTree, remove and create, with a node's
 * index being its position among its parent's children. New bookmarks get the
 * fake clock's time as dateAdded, as Chrome stamps the current time.
 */
class FakeBookmarkTree
{
  #nodes = new Map();
  #nextId = 1;
  /** Removing one of these ids throws. */
  failRemoveIds = new Set();

  constructor()
  {
    this.#nodes.set('root', { id: 'root', title: '', children: [] });
  }

  /** Add a folder or (with `url`) a bookmark at the end of `parentId`; returns its id. */
  add(parentId, { id, title, url, dateAdded })
  {
    const nodeId = id ?? `n${this.#nextId++}`;
    const node = { id: nodeId, parentId, title, url, dateAdded, children: url ? undefined : [] };
    this.#nodes.set(nodeId, node);
    this.#nodes.get(parentId).children.push(nodeId);
    return nodeId;
  }

  move(id, newParentId)
  {
    const node = this.#nodes.get(id);
    this.#detach(node);
    node.parentId = newParentId;
    this.#nodes.get(newParentId).children.unshift(id);
  }

  rename(id, title)
  {
    this.#nodes.get(id).title = title;
  }

  /** Titles of a folder's direct children, top first. */
  titles(folderId)
  {
    return this.#nodes.get(folderId).children.map(id => this.#nodes.get(id).title);
  }

  getSubTree = async (id) =>
  {
    if (!this.#nodes.has(id)) throw new Error(`Can't find bookmark for id.`);
    return [this.#snapshot(id)];
  };

  remove = async (id) =>
  {
    if (this.failRemoveIds.has(id)) throw new Error('remove failed');
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id.`);
    if (node.children?.length) throw new Error("Can't remove non-empty folder");
    this.#detach(node);
    this.#nodes.delete(id);
  };

  create = async ({ parentId, title, url, index }) =>
  {
    const nodeId = `n${this.#nextId++}`;
    this.#nodes.set(nodeId, { id: nodeId, parentId, title, url, dateAdded: NOW, children: undefined });
    this.#nodes.get(parentId).children.splice(index, 0, nodeId);
    return this.#snapshot(nodeId);
  };

  #detach(node)
  {
    const siblings = this.#nodes.get(node.parentId).children;
    siblings.splice(siblings.indexOf(node.id), 1);
  }

  #snapshot(id)
  {
    const node = this.#nodes.get(id);
    const parent = this.#nodes.get(node.parentId);
    const result = { id, parentId: node.parentId, title: node.title, index: parent?.children.indexOf(id) };
    if (node.url) return { ...result, url: node.url, dateAdded: node.dateAdded };
    return { ...result, children: node.children.map(childId => this.#snapshot(childId)) };
  }
}

const page = (title, ageDays) => ({ title, url: `https://${title}.test/`, dateAdded: NOW - ageDays * DAY });

// Space A with a regular bookmark and an archive holding a user subfolder; Space B with its own archive
function setUp()
{
  const tree = new FakeBookmarkTree();
  tree.add('root', { id: 'spaceA', title: 'Space A' });
  tree.add('spaceA', { id: 'regular', ...page('regular', 60) });
  tree.add('spaceA', { id: 'archive', title: 'asd_Archive' });
  tree.add('archive', { id: 'fresh', ...page('fresh', 1) });
  tree.add('archive', { id: 'week', ...page('week', 8) });
  tree.add('archive', { id: 'sub', title: 'Kept folder' });
  tree.add('sub', { id: 'subOld', ...page('subOld', 20) });
  tree.add('sub', { id: 'subNew', ...page('subNew', 2) });
  tree.add('archive', { id: 'month', ...page('month', 40) });
  tree.add('root', { id: 'spaceB', title: 'Space B' });
  tree.add('spaceB', { id: 'archiveB', title: 'asd_Archive' });
  tree.add('archiveB', { id: 'otherOld', ...page('otherOld', 90) });

  const build = (option, folderId = 'archive') => new ClearArchiveAction(tree, folderId, option, () => NOW);
  return { tree, build };
}

test('removes only this archive\'s pages older than the cutoff', async () =>
{
  const { tree, build } = setUp();
  const action = build(ArchiveClearOption.OLDER_THAN_7_DAYS);

  await action.do();

  assert.deepEqual(tree.titles('archive'), ['fresh', 'Kept folder']);
  assert.deepEqual(tree.titles('sub'), ['subNew']);
  assert.deepEqual(tree.titles('spaceA'), ['regular', 'asd_Archive']);
  assert.deepEqual(tree.titles('archiveB'), ['otherOld']);
  assert.equal(action.description, 'Cleared 3 archived pages');
});

test('a page moved out of the archive after the menu rendered is not removed', async () =>
{
  const { tree, build } = setUp();
  const action = build(ArchiveClearOption.ALL);
  tree.move('month', 'spaceA');

  await action.do();

  assert.deepEqual(tree.titles('spaceA'), ['month', 'regular', 'asd_Archive']);
  assert.deepEqual(tree.titles('archive'), ['Kept folder']);
});

test('a folder that is no longer an archive folder is left alone', async () =>
{
  const { tree, build } = setUp();
  tree.rename('archive', 'Renamed');
  const action = build(ArchiveClearOption.ALL);

  await action.do();

  assert.deepEqual(tree.titles('archive'), ['fresh', 'week', 'Kept folder', 'month']);
  assert.equal(action.description, 'Cleared 0 archived pages');
});

test('a missing archive folder rejects and removes nothing', async () =>
{
  const { tree, build } = setUp();

  await assert.rejects(build(ArchiveClearOption.ALL, 'gone').do());

  assert.deepEqual(tree.titles('archive'), ['fresh', 'week', 'Kept folder', 'month']);
  assert.deepEqual(tree.titles('spaceA'), ['regular', 'asd_Archive']);
});

test('a failed remove is skipped and not restored by undo', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const { tree, build } = setUp();
  tree.failRemoveIds.add('week');
  const action = build(ArchiveClearOption.OLDER_THAN_7_DAYS);

  await action.do();
  assert.deepEqual(tree.titles('archive'), ['fresh', 'week', 'Kept folder']);
  assert.equal(action.description, 'Cleared 2 archived pages');

  await action.undo();
  assert.deepEqual(tree.titles('archive'), ['month', 'fresh', 'week', 'Kept folder']);
  assert.deepEqual(tree.titles('sub'), ['subOld', 'subNew']);
});

test('undo puts pages back into their parents in their original relative order', async () =>
{
  const tree = new FakeBookmarkTree();
  tree.add('root', { id: 'space', title: 'Space' });
  tree.add('space', { id: 'archive', title: 'asd_Archive' });
  tree.add('archive', { ...page('newest', 1) });
  // Archived in the same millisecond: tree order decides
  tree.add('archive', { ...page('tieTop', 3) });
  tree.add('archive', { ...page('tieBottom', 3) });
  tree.add('archive', { id: 'sub', title: 'Sub' });
  tree.add('sub', { ...page('subA', 2) });
  tree.add('sub', { ...page('subB', 9) });
  tree.add('archive', { title: 'undated', url: 'https://undated.test/' });
  tree.add('archive', { ...page('oldest', 30) });
  const action = new ClearArchiveAction(tree, 'archive', ArchiveClearOption.ALL, () => NOW);

  await action.do();
  assert.deepEqual(tree.titles('archive'), ['Sub']);
  assert.deepEqual(tree.titles('sub'), []);

  await action.undo();
  assert.deepEqual(tree.titles('archive'), ['newest', 'tieTop', 'tieBottom', 'oldest', 'undated', 'Sub']);
  assert.deepEqual(tree.titles('sub'), ['subA', 'subB']);
});
