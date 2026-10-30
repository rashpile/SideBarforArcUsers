import assert from 'node:assert/strict';
import test from 'node:test';

import { isSystemFolder } from '../src/utils/archiveFolder.ts';
import {
  FAVORITES_FOLDER_TITLE,
  ensureFavoritesFolder,
  findFavoritesFolder,
} from '../src/utils/favoritesFolder.ts';

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

  create = async ({ parentId, title, url, index }) =>
  {
    const node = { id: `n${this.#nextId++}`, parentId, title, url };
    if (!url) this.#children.set(node.id, []);
    const siblings = this.#children.get(parentId);
    siblings.splice(index ?? siblings.length, 0, node);
    return { ...node, index: siblings.indexOf(node) };
  };

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
