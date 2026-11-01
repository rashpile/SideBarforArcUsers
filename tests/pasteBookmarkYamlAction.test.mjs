import assert from 'node:assert/strict';
import test from 'node:test';

import { PasteBookmarkYamlAction } from '../src/actions/pasteBookmarkYamlAction.ts';
import { parseBookmarkYaml } from '../src/utils/bookmarkYaml.ts';

/** In-memory chrome.bookmarks: create (appends when no index), remove, removeTree, move. */
class FakeBookmarks
{
  #nodes = new Map();
  #nextId = 1;
  /** Creating an item with one of these titles throws. */
  failTitles = new Set();

  constructor()
  {
    this.#nodes.set('root', { id: 'root', title: '', children: [] });
  }

  addFolder(parentId, title)
  {
    return this.#insert(parentId, { title, children: [] });
  }

  addBookmark(parentId, title, url)
  {
    return this.#insert(parentId, { title, url });
  }

  #insert(parentId, fields)
  {
    const parent = this.#nodes.get(parentId);
    if (!parent || !parent.children) throw new Error(`Can't find parent bookmark ${parentId}`);
    const node = { id: `n${this.#nextId++}`, parentId, ...fields };
    this.#nodes.set(node.id, node);
    parent.children.push(node);
    return node.id;
  }

  create = async ({ parentId, title, url, index }) =>
  {
    assert.equal(index, undefined, 'paste must append, not insert at an index');
    if (this.failTitles.has(title)) throw new Error(`create failed: ${title}`);
    const id = url === undefined
      ? this.addFolder(parentId, title)
      : this.addBookmark(parentId, title, url);
    return { id };
  };

  remove = async (id) =>
  {
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id ${id}`);
    if (node.children && node.children.length > 0) throw new Error("Can't remove non-empty folder");
    this.#detach(node);
  };

  removeTree = async (id) =>
  {
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id ${id}`);
    this.#detach(node);
  };

  /** Moves a node to the end of another folder, as the Move to... dialog or drag-and-drop would. */
  move(id, parentId)
  {
    const node = this.#nodes.get(id);
    const oldParent = this.#nodes.get(node.parentId);
    oldParent.children = oldParent.children.filter(child => child !== node);
    node.parentId = parentId;
    this.#nodes.get(parentId).children.push(node);
  }

  #detach(node)
  {
    const parent = this.#nodes.get(node.parentId);
    parent.children = parent.children.filter(child => child !== node);
    const drop = (n) =>
    {
      this.#nodes.delete(n.id);
      for (const child of n.children ?? []) drop(child);
    };
    drop(node);
  }

  /** The subtree below `id` as plain `{ title, url? , items? }` values, ids dropped. */
  shape(id)
  {
    const toShape = (node) => node.children
      ? { folder: node.title, items: node.children.map(toShape) }
      : { title: node.title, url: node.url };
    return this.#nodes.get(id).children.map(toShape);
  }

  childId(parentId, title)
  {
    return this.#nodes.get(parentId).children.find(child => child.title === title).id;
  }

  get size()
  {
    return this.#nodes.size;
  }
}

function parse(text)
{
  const result = parseBookmarkYaml(text);
  assert.ok(result.ok, JSON.stringify(result.errors));
  return result.list;
}

const PASTE = `
- folder: "Tools"
  items:
    - title: "GitHub"
      url: "https://github.com/"
    - folder: "Docs"
      items:
        - title: "MDN"
          url: "https://developer.mozilla.org/"
    - folder: "Empty"
      items: []
- title: "Inbox"
  url: "https://mail.google.com/"
`;

const PASTED_SHAPE = [
  {
    folder: 'Tools',
    items: [
      { title: 'GitHub', url: 'https://github.com/' },
      { folder: 'Docs', items: [{ title: 'MDN', url: 'https://developer.mozilla.org/' }] },
      { folder: 'Empty', items: [] },
    ],
  },
  { title: 'Inbox', url: 'https://mail.google.com/' },
];

function setup()
{
  const bookmarks = new FakeBookmarks();
  const target = bookmarks.addFolder('root', 'Target');
  bookmarks.addBookmark(target, 'Existing', 'https://example.com/');
  const other = bookmarks.addFolder('root', 'Other');
  bookmarks.addBookmark(other, 'Keep', 'https://keep.example/');
  return { bookmarks, target, other };
}

test('paste appends after the target folder\'s children, keeping order and nesting', async () =>
{
  const { bookmarks, target, other } = setup();
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);

  await action.do();

  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }, ...PASTED_SHAPE]);
  assert.deepEqual(bookmarks.shape(other), [{ title: 'Keep', url: 'https://keep.example/' }]);
  assert.equal(action.failure, null);
});

test('paste runs its creates inside the injected batch', async () =>
{
  const { bookmarks, target } = setup();
  let batches = 0;
  const batch = async (fn) =>
  {
    batches++;
    return fn();
  };
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks, batch);

  await action.do();

  assert.equal(batches, 1);
});

test('undo removes everything the paste created and nothing else', async () =>
{
  const { bookmarks, target, other } = setup();
  const sizeBefore = bookmarks.size;
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);

  await action.do();
  await action.undo();

  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }]);
  assert.deepEqual(bookmarks.shape(other), [{ title: 'Keep', url: 'https://keep.example/' }]);
  assert.equal(bookmarks.size, sizeBefore);
});

test('undo tolerates pasted items the user already removed', async () =>
{
  const { bookmarks, target } = setup();
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);
  await action.do();

  // The user deletes the pasted "Tools" folder by hand before Undo
  await bookmarks.removeTree(bookmarks.childId(target, 'Tools'));

  await action.undo();

  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }]);
});

test('undo keeps a bookmark the user moved into a pasted folder, and the folders holding it', async () =>
{
  const { bookmarks, target, other } = setup();
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);
  await action.do();

  const tools = bookmarks.childId(target, 'Tools');
  const docs = bookmarks.childId(tools, 'Docs');
  bookmarks.move(bookmarks.childId(other, 'Keep'), docs);

  await action.undo();

  // Only the pasted folders on the path to "Keep" stay; every other pasted item is gone
  assert.deepEqual(bookmarks.shape(target), [
    { title: 'Existing', url: 'https://example.com/' },
    { folder: 'Tools', items: [{ folder: 'Docs', items: [{ title: 'Keep', url: 'https://keep.example/' }] }] },
  ]);
  assert.deepEqual(bookmarks.shape(other), []);
});

test('redo after undo pastes again and a second undo removes it', async () =>
{
  const { bookmarks, target } = setup();
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);

  await action.do();
  await action.undo();
  await action.do();
  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }, ...PASTED_SHAPE]);

  await action.undo();
  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }]);
});

test('a create failure on a nested child of the second root leaves nothing created', async () =>
{
  const { bookmarks, target, other } = setup();
  const sizeBefore = bookmarks.size;
  const list = parse(`
- title: "First"
  url: "https://first.example/"
- folder: "Second"
  items:
    - title: "Fine"
      url: "https://fine.example/"
    - folder: "Inner"
      items:
        - title: "Broken"
          url: "https://broken.example/"
- title: "Never"
  url: "https://never.example/"
`);
  bookmarks.failTitles.add('Broken');
  const action = new PasteBookmarkYamlAction(target, list, bookmarks);

  await assert.rejects(action.do(), /create failed: Broken/);

  assert.equal(action.failure, 'create failed: Broken');
  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }]);
  assert.deepEqual(bookmarks.shape(other), [{ title: 'Keep', url: 'https://keep.example/' }]);
  assert.equal(bookmarks.size, sizeBefore);

  // Nothing is left for Undo to remove, so it must not touch the target folder
  await action.undo();
  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }]);
});

test('a successful retry clears the earlier failure', async () =>
{
  const { bookmarks, target } = setup();
  bookmarks.failTitles.add('MDN');
  const action = new PasteBookmarkYamlAction(target, parse(PASTE), bookmarks);
  await assert.rejects(action.do());
  assert.ok(action.failure);

  bookmarks.failTitles.clear();
  await action.do();

  assert.equal(action.failure, null);
  assert.deepEqual(bookmarks.shape(target), [{ title: 'Existing', url: 'https://example.com/' }, ...PASTED_SHAPE]);
});

test('description names what the paste creates', () =>
{
  const action = new PasteBookmarkYamlAction('root', parse(PASTE), new FakeBookmarks());
  assert.equal(action.description, 'Pasted 3 folders, 3 bookmarks');
});
