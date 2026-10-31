import assert from 'node:assert/strict';
import test from 'node:test';

import { CreateBookmarkFolderAction } from '../src/actions/createBookmarkFolderAction.ts';

/** In-memory chrome.bookmarks: get, create, move, remove (rejects for a non-empty folder). */
class FakeBookmarks
{
  #nodes = new Map();
  #nextId = 1;

  constructor()
  {
    this.#nodes.set('root', { id: 'root', title: '', children: [] });
  }

  addFolder(parentId, title)
  {
    return this.#insert(parentId, { title, children: [] });
  }

  addBookmark(parentId, title)
  {
    return this.#insert(parentId, { title, url: `https://${title}.example/` });
  }

  #insert(parentId, fields, index)
  {
    const parent = this.#nodes.get(parentId);
    const node = { id: `n${this.#nextId++}`, parentId, ...fields };
    this.#nodes.set(node.id, node);
    parent.children.splice(index ?? parent.children.length, 0, node);
    return node.id;
  }

  get = async (id) =>
  {
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id ${id}`);
    const parent = this.#nodes.get(node.parentId);
    return [{ id, parentId: node.parentId, index: parent.children.indexOf(node), title: node.title }];
  };

  create = async ({ parentId, title }) => ({ id: this.addFolder(parentId, title) });

  move = async (id, { parentId, index }) =>
  {
    const node = this.#nodes.get(id);
    const oldParent = this.#nodes.get(node.parentId);
    oldParent.children = oldParent.children.filter(child => child !== node);
    node.parentId = parentId;
    const parent = this.#nodes.get(parentId);
    parent.children.splice(index ?? parent.children.length, 0, node);
  };

  remove = async (id) =>
  {
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id ${id}`);
    if (node.children && node.children.length > 0) throw new Error("Can't remove non-empty folder");
    const parent = this.#nodes.get(node.parentId);
    parent.children = parent.children.filter(child => child !== node);
    this.#nodes.delete(id);
  };

  /** Titles below `id`, folders as `{ title: [children] }`. */
  shape(id)
  {
    const toShape = node => node.children ? { [node.title]: node.children.map(toShape) } : node.title;
    return this.#nodes.get(id).children.map(toShape);
  }

  childId(parentId, title)
  {
    return this.#nodes.get(parentId).children.find(child => child.title === title).id;
  }
}

function setup()
{
  const bookmarks = new FakeBookmarks();
  const work = bookmarks.addFolder('root', 'Work');
  const a = bookmarks.addBookmark(work, 'a');
  bookmarks.addBookmark(work, 'b');
  const c = bookmarks.addBookmark(work, 'c');
  const other = bookmarks.addFolder('root', 'Other');
  const d = bookmarks.addBookmark(other, 'd');
  const outsider = bookmarks.addBookmark(other, 'outsider');
  const action = new CreateBookmarkFolderAction(work, 'New', [c, a, d], bookmarks, fn => fn());
  return { bookmarks, work, other, outsider, action };
}

const ORIGINAL = [{ Work: ['a', 'b', 'c'] }, { Other: ['d', 'outsider'] }];

test('do moves the selection into the new folder in selection order', async () =>
{
  const { bookmarks, action } = setup();
  await action.do();
  assert.deepEqual(bookmarks.shape('root'), [{ Work: ['b', { New: ['c', 'a', 'd'] }] }, { Other: ['outsider'] }]);
});

test('undo puts the selection back where it was and removes the folder', async () =>
{
  const { bookmarks, action } = setup();
  await action.do();
  await action.undo();
  assert.deepEqual(bookmarks.shape('root'), ORIGINAL);
});

test('undo keeps the folder and a bookmark the user moved into it', async () =>
{
  const { bookmarks, work, outsider, action } = setup();
  await action.do();
  await bookmarks.move(outsider, { parentId: bookmarks.childId(work, 'New') });
  await action.undo();
  assert.deepEqual(bookmarks.shape('root'), [{ Work: ['a', 'b', 'c', { New: ['outsider'] }] }, { Other: ['d'] }]);
});
