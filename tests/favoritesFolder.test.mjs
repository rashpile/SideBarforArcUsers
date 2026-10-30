import assert from 'node:assert/strict';
import test from 'node:test';

import { isSystemFolder } from '../src/utils/archiveFolder.ts';
import {
  FAVORITES_FOLDER_TITLE,
  createFavoriteBookmarks,
  ensureFavoritesFolder,
  findFavoritesFolder,
  isBookmarkableUrl,
} from '../src/utils/favoritesFolder.ts';

function isParsable(url)
{
  try
  {
    new URL(url);
    return true;
  }
  catch
  {
    return false;
  }
}

// In-memory stand-in for chrome.bookmarks: children kept per parent, index = position
class FakeBookmarks
{
  #children = new Map();
  #nextId = 1;

  constructor(spaceFolderId, spaceChildren = [])
  {
    this.#children.set(spaceFolderId, []);
    for (const child of spaceChildren)
    {
      this.create({ parentId: spaceFolderId, ...child });
    }
  }

  getChildren = async (id) =>
    (this.#children.get(id) ?? []).map((node, index) => ({ ...node, index }));

  // Chrome rejects a bookmark whose URL it can't parse
  create = async ({ parentId, title, url, index }) =>
  {
    if (url !== undefined && !isParsable(url)) throw new Error(`Invalid URL: ${url}`);
    const node = { id: `n${this.#nextId++}`, parentId, title, url };
    if (!url) this.#children.set(node.id, []);
    const siblings = this.#children.get(parentId);
    siblings.splice(index ?? siblings.length, 0, node);
    return { ...node, index: siblings.indexOf(node) };
  };

  pages(folderId)
  {
    return this.#children.get(folderId).map(node => node.url);
  }

  favoritesFolders(spaceFolderId)
  {
    return this.#children.get(spaceFolderId).filter(node => !node.url && node.title === FAVORITES_FOLDER_TITLE);
  }
}

test('a URL bookmark titled asd_Favorites is not a system folder', () =>
{
  assert.equal(isSystemFolder({ title: FAVORITES_FOLDER_TITLE, url: 'https://example.com/' }), false);
  assert.equal(isSystemFolder({ title: 'asd_Archive', url: 'https://example.com/' }), false);
  assert.equal(isSystemFolder({ title: FAVORITES_FOLDER_TITLE }), true);
  assert.equal(isSystemFolder({ title: 'asd_Archive' }), true);
  assert.equal(isSystemFolder({ title: 'Work' }), false);
});

test('findFavoritesFolder picks the asd_Favorites with the lowest index', () =>
{
  const children = [
    { id: 'late', title: FAVORITES_FOLDER_TITLE, index: 5 },
    { id: 'link', title: FAVORITES_FOLDER_TITLE, url: 'https://example.com/', index: 0 },
    { id: 'early', title: FAVORITES_FOLDER_TITLE, index: 2 },
  ];

  assert.equal(findFavoritesFolder(children)?.id, 'early');
});

test('ensureFavoritesFolder reuses an existing folder instead of creating a second', async () =>
{
  const bookmarks = new FakeBookmarks('space', [
    { title: 'Work' },
    { title: FAVORITES_FOLDER_TITLE },
  ]);
  const [existing] = bookmarks.favoritesFolders('space');

  const folder = await ensureFavoritesFolder(bookmarks, 'space');

  assert.equal(folder.id, existing.id);
  assert.equal(bookmarks.favoritesFolders('space').length, 1);
});

test('ensureFavoritesFolder creates the folder at the end of the Space folder when missing', async () =>
{
  const bookmarks = new FakeBookmarks('space', [{ title: 'Work' }]);

  const folder = await ensureFavoritesFolder(bookmarks, 'space');

  assert.equal(folder.title, FAVORITES_FOLDER_TITLE);
  assert.equal(folder.index, 1);
  assert.equal(bookmarks.favoritesFolders('space').length, 1);
});

const entry = (url) => ({ url, title: url });

test('createFavoriteBookmarks creates the entries after one Chrome rejects, in order', async () =>
{
  const bookmarks = new FakeBookmarks('fav');
  const stored = [];

  const { created, rejected } = await createFavoriteBookmarks(
    bookmarks,
    'fav',
    [entry('https://a.example/'), entry('not a url'), entry('https://b.example/'), entry('https://c.example/')],
    undefined,
    async (node, e) => { stored.push([node.id, e.url]); }
  );

  assert.deepEqual(bookmarks.pages('fav'), ['https://a.example/', 'https://b.example/', 'https://c.example/']);
  assert.deepEqual(created.map(c => c.entry.url), ['https://a.example/', 'https://b.example/', 'https://c.example/']);
  assert.deepEqual(rejected.map(r => r.entry.url), ['not a url']);
  // Icons go onto the bookmark made for that entry, not a neighbour's
  assert.deepEqual(stored, created.map(c => [c.node.id, c.entry.url]));
});

test('createFavoriteBookmarks keeps grid order at an index when an entry in the middle is rejected', async () =>
{
  const bookmarks = new FakeBookmarks('fav', [{ title: 'X', url: 'https://x.example/' }, { title: 'Y', url: 'https://y.example/' }]);

  await createFavoriteBookmarks(
    bookmarks,
    'fav',
    [entry('https://a.example/'), entry('bad'), entry('https://b.example/')],
    1,
    async () => {}
  );

  assert.deepEqual(bookmarks.pages('fav'), ['https://x.example/', 'https://a.example/', 'https://b.example/', 'https://y.example/']);
});

test('isBookmarkableUrl rejects what bookmarks.create would and accepts non-http schemes', () =>
{
  assert.equal(isBookmarkableUrl('https://example.com/'), true);
  assert.equal(isBookmarkableUrl('chrome://settings'), true);
  assert.equal(isBookmarkableUrl('example.com'), false);
  assert.equal(isBookmarkableUrl(''), false);
});
