import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAVORITES_MIGRATION_STORAGE_KEY,
  FavoritesMigration,
  FavoritesMigrationState,
} from '../src/services/favoritesMigration.ts';
import { FAVORITES_FOLDER_TITLE } from '../src/utils/favoritesFolder.ts';

// In-memory chrome.bookmarks: one "Bookmarks Bar" root holding the given Space folders.
// Children are kept per parent; a node's index is its position.
class FakeBookmarkTree
{
  #nodes = new Map();
  #children = new Map();
  #nextId = 1;
  /** Creating a bookmark under one of these parent folder ids throws. */
  failParents = new Set();
  /** Creating a bookmark of one of these URLs throws, wherever it goes. */
  failUrls = new Set();

  constructor(spaceFolderTitles)
  {
    this.#add({ id: 'bar', title: 'Bookmarks Bar' }, null);
    for (const title of spaceFolderTitles)
    {
      this.#add({ id: `space-${title}`, title }, 'bar');
    }
  }

  #add(node, parentId)
  {
    this.#nodes.set(node.id, { ...node, parentId });
    if (!node.url) this.#children.set(node.id, []);
    if (parentId) this.#children.get(parentId).push(node.id);
  }

  #build(id)
  {
    const node = this.#nodes.get(id);
    const parentChildren = node.parentId ? this.#children.get(node.parentId) : [id];
    const built = { ...node, index: parentChildren.indexOf(id) };
    if (!node.url) built.children = this.#children.get(id).map(childId => this.#build(childId));
    return built;
  }

  getTree = async () => [{ id: '0', title: '', children: [this.#build('bar')] }];

  getChildren = async (id) => (this.#children.get(id) ?? []).map(childId => this.#build(childId));

  create = async ({ parentId, title, url }) =>
  {
    const ownerTitle = this.#nodes.get(this.#nodes.get(parentId).parentId)?.title;
    if (url && (this.failParents.has(ownerTitle) || this.failUrls.has(url))) throw new Error('create failed');

    const node = { id: `n${this.#nextId++}`, title, url };
    this.#add(node, parentId);
    return this.#build(node.id);
  };

  addFavoritesFolder(spaceTitle)
  {
    return this.create({ parentId: `space-${spaceTitle}`, title: FAVORITES_FOLDER_TITLE });
  }

  /** An asd_Favorites with these [title, url] pages, as bookmark sync brings it from another device. */
  async addSyncedFavorites(spaceTitle, pages)
  {
    const folder = await this.addFavoritesFolder(spaceTitle);
    for (const [title, url] of pages)
    {
      await this.create({ parentId: folder.id, title, url });
    }
  }

  favoritesFolders(spaceTitle)
  {
    return this.#children.get(`space-${spaceTitle}`)
      .map(id => this.#build(id))
      .filter(node => !node.url && node.title === FAVORITES_FOLDER_TITLE);
  }

  /** The Space's Favorites as [title, url] pairs, in order. */
  favorites(spaceTitle)
  {
    const [folder] = this.favoritesFolders(spaceTitle);
    return folder ? folder.children.map(node => [node.title, node.url]) : [];
  }

  /** The bookmark ids of the Space's Favorites, in order. */
  favoriteIds(spaceTitle)
  {
    const [folder] = this.favoritesFolders(spaceTitle);
    return folder ? folder.children.map(node => node.id) : [];
  }
}

class FakeStorage
{
  values = {};

  get = async (key) => (key in this.values ? { [key]: structuredClone(this.values[key]) } : {});

  set = async (values) =>
  {
    Object.assign(this.values, structuredClone(values));
  };

  migrationState()
  {
    return FavoritesMigrationState.fromStored(this.values[FAVORITES_MIGRATION_STORAGE_KEY]);
  }
}

const space = (id, folderTitle) => ({ id, bookmarkFolderSegments: ['Bookmarks Bar', folderTitle] });

const LEGACY_PINS = [
  { id: 'p1', url: 'https://mail.example/', title: 'Mail', emoji: '📮' },
  { id: 'p2', url: 'https://docs.example/', title: 'Docs', customIconName: 'FileText', iconColor: '#ef4444', favicon: 'data:icon' },
];

function setup({ folders, spaces, pins = LEGACY_PINS })
{
  const bookmarks = new FakeBookmarkTree(folders);
  const storage = new FakeStorage();
  if (pins) storage.values.pinnedSites = pins;
  const restored = new Map();
  const migration = new FavoritesMigration({
    bookmarks,
    storage,
    restoreIcons: (id, entry) => restored.set(id, entry),
    getSpaces: () => spaces,
  });
  return { bookmarks, storage, restored, migration };
}

test('copies the old Favorites into every Space with a folder, in order, with icons under the new ids', async () =>
{
  const { bookmarks, storage, restored, migration } = setup({
    folders: ['Work', 'Home'],
    spaces: [space('work', 'Work'), space('home', 'Home'), space('nofolder', 'Missing')],
  });

  await migration.run();

  for (const title of ['Work', 'Home'])
  {
    assert.deepEqual(bookmarks.favorites(title), [['Mail', 'https://mail.example/'], ['Docs', 'https://docs.example/']]);
  }

  const [workMail, workDocs] = bookmarks.favoriteIds('Work');
  const [homeMail] = bookmarks.favoriteIds('Home');
  assert.deepEqual(restored.get(workMail), { favicon: undefined, customIconName: undefined, iconColor: undefined, emoji: '📮' });
  assert.deepEqual(restored.get(workDocs), { favicon: 'data:icon', customIconName: 'FileText', iconColor: '#ef4444', emoji: undefined });
  assert.equal(restored.get(homeMail).emoji, '📮');

  const state = storage.migrationState();
  assert.equal(state.done, true);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'work'), workMail);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'home'), homeMail);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'nofolder'), undefined);
});

test('an existing empty asd_Favorites gets the old Favorites, and no second folder', async () =>
{
  const { bookmarks, storage, migration } = setup({
    folders: ['Work', 'Home'],
    spaces: [space('work', 'Work'), space('home', 'Home')],
  });
  await bookmarks.addFavoritesFolder('Home');

  await migration.run();

  assert.equal(bookmarks.favoritesFolders('Home').length, 1);
  assert.deepEqual(bookmarks.favorites('Home'), [['Mail', 'https://mail.example/'], ['Docs', 'https://docs.example/']]);
  assert.equal(bookmarks.favorites('Work').length, 2);
  assert.equal(storage.migrationState().done, true);
  assert.equal(storage.migrationState().rekey.bookmarkIdFor('p1', 'home'), bookmarks.favoriteIds('Home')[0]);
});

test('a synced asd_Favorites gets this device\'s icons by URL, no duplicates, and its own unmatched pins appended', async () =>
{
  const { bookmarks, storage, restored, migration } = setup({
    folders: ['Work'],
    spaces: [space('work', 'Work')],
    pins: [...LEGACY_PINS, { id: 'p3', url: 'https://only-here.example/', title: 'Local' }],
  });
  await bookmarks.addSyncedFavorites('Work', [['Docs', 'https://docs.example/'], ['Mail', 'https://mail.example/']]);
  const [syncedDocs, syncedMail] = bookmarks.favoriteIds('Work');

  await migration.run();

  assert.equal(bookmarks.favoritesFolders('Work').length, 1);
  assert.deepEqual(bookmarks.favorites('Work'),
    [['Docs', 'https://docs.example/'], ['Mail', 'https://mail.example/'], ['Local', 'https://only-here.example/']]);
  const [docsId, mailId, localId] = bookmarks.favoriteIds('Work');
  assert.deepEqual([docsId, mailId], [syncedDocs, syncedMail]);
  assert.equal(restored.get(syncedMail).emoji, '📮');
  assert.equal(restored.get(syncedDocs).customIconName, 'FileText');
  assert.ok(restored.has(localId));

  const state = storage.migrationState();
  assert.equal(state.done, true);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'work'), syncedMail);
  assert.equal(state.rekey.bookmarkIdFor('p2', 'work'), syncedDocs);
  assert.equal(state.rekey.bookmarkIdFor('p3', 'work'), localId);
});

test('a synced bookmark claimed by one pin is not matched again by a second pin of the same URL', async () =>
{
  const { bookmarks, storage, migration } = setup({
    folders: ['Work'],
    spaces: [space('work', 'Work')],
    pins: [{ id: 'a', url: 'https://mail.example/', title: 'Mail' }, { id: 'b', url: 'https://mail.example/', title: 'Mail 2' }],
  });
  await bookmarks.addSyncedFavorites('Work', [['Mail', 'https://mail.example/']]);

  await migration.run();

  const ids = bookmarks.favoriteIds('Work');
  assert.equal(ids.length, 2);
  const state = storage.migrationState();
  assert.notEqual(state.rekey.bookmarkIdFor('a', 'work'), state.rekey.bookmarkIdFor('b', 'work'));
  assert.deepEqual(new Set([state.rekey.bookmarkIdFor('a', 'work'), state.rekey.bookmarkIdFor('b', 'work')]), new Set(ids));
});

test('an old pin whose URL does not parse is left behind and the rest are copied', async () =>
{
  const { bookmarks, storage, migration } = setup({
    folders: ['Work'],
    spaces: [space('work', 'Work')],
    pins: [{ id: 'bad', url: 'mail example', title: 'Typed' }, ...LEGACY_PINS],
  });

  await migration.run();

  assert.deepEqual(bookmarks.favorites('Work'), [['Mail', 'https://mail.example/'], ['Docs', 'https://docs.example/']]);
  const state = storage.migrationState();
  assert.equal(state.done, true);
  // Listed with no copy, so its open tab becomes a regular tab instead of keeping a dead key
  assert.equal(state.rekey.hasPin('bad'), true);
  assert.equal(state.rekey.bookmarkIdFor('bad', 'work'), undefined);
});

test('only unparsable old pins: done, with their tabs released, and no folder created', async () =>
{
  const { bookmarks, storage, migration } = setup({
    folders: ['Work'],
    spaces: [space('work', 'Work')],
    pins: [{ id: 'bad', url: 'mail example', title: 'Typed' }, { id: 7, url: 'https://x.example/' }],
  });

  await migration.run();

  const state = storage.migrationState();
  assert.equal(state.done, true);
  assert.equal(state.rekey.hasPin('bad'), true);
  assert.equal(bookmarks.favoritesFolders('Work').length, 0);
});

test('a pin that fails to copy does not stop the next ones, and a rerun copies only it', async () =>
{
  const { bookmarks, storage, migration } = setup({ folders: ['Work'], spaces: [space('work', 'Work')] });
  bookmarks.failUrls.add('https://mail.example/');

  await migration.run();

  assert.deepEqual(bookmarks.favorites('Work'), [['Docs', 'https://docs.example/']]);
  assert.equal(storage.migrationState().done, false);

  bookmarks.failUrls.clear();
  await migration.run();

  assert.equal(bookmarks.favoritesFolders('Work').length, 1);
  assert.deepEqual(bookmarks.favorites('Work'), [['Docs', 'https://docs.example/'], ['Mail', 'https://mail.example/']]);
  const state = storage.migrationState();
  assert.equal(state.done, true);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'work'), bookmarks.favoriteIds('Work')[1]);
});

test('a rerun after done does nothing, even for a Space added later', async () =>
{
  const { bookmarks, storage, migration } = setup({ folders: ['Work', 'Home'], spaces: [space('work', 'Work')] });
  await migration.run();

  // A fresh worker reads `done` from storage; a Space added later gets no copy
  const second = new FavoritesMigration({
    bookmarks,
    storage,
    restoreIcons: () => assert.fail('no icons on a rerun'),
    getSpaces: () => [space('work', 'Work'), space('home', 'Home')],
  });
  await second.run();

  assert.equal(bookmarks.favoritesFolders('Work').length, 1);
  assert.equal(bookmarks.favoritesFolders('Home').length, 0);
});

test('with no Space that has a folder nothing is written and done stays unset', async () =>
{
  const { bookmarks, storage, migration } = setup({ folders: ['Work'], spaces: [space('s', 'Missing')] });

  await migration.run();

  assert.equal(storage.values[FAVORITES_MIGRATION_STORAGE_KEY], undefined);
  assert.equal(bookmarks.favoritesFolders('Work').length, 0);
  assert.deepEqual(storage.values.pinnedSites, LEGACY_PINS);
});

test('no old Favorites: done without creating any folder', async () =>
{
  const { bookmarks, storage, migration } = setup({ folders: ['Work'], spaces: [space('work', 'Work')], pins: null });

  await migration.run();

  assert.equal(storage.migrationState().done, true);
  assert.equal(bookmarks.favoritesFolders('Work').length, 0);
});

test('one Space failing leaves done unset; a rerun does not duplicate the others and keeps their rekey entries', async () =>
{
  const { bookmarks, storage, migration } = setup({
    folders: ['Work', 'Home'],
    spaces: [space('work', 'Work'), space('home', 'Home')],
  });
  bookmarks.failParents.add('Home');

  await migration.run();

  const workIds = bookmarks.favoriteIds('Work');
  assert.equal(workIds.length, 2);
  assert.equal(storage.migrationState().done, false);
  assert.equal(storage.migrationState().rekey.bookmarkIdFor('p2', 'work'), workIds[1]);

  bookmarks.failParents.clear();
  await migration.run();

  assert.equal(bookmarks.favoritesFolders('Work').length, 1);
  assert.deepEqual(bookmarks.favoriteIds('Work'), workIds);
  assert.equal(bookmarks.favoritesFolders('Home').length, 1);
  assert.deepEqual(bookmarks.favorites('Home'), [['Mail', 'https://mail.example/'], ['Docs', 'https://docs.example/']]);
  const state = storage.migrationState();
  assert.equal(state.done, true);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'work'), workIds[0]);
  assert.equal(state.rekey.bookmarkIdFor('p2', 'work'), workIds[1]);
  assert.equal(state.rekey.bookmarkIdFor('p1', 'home'), bookmarks.favoriteIds('Home')[0]);
});

test('triggers that arrive during a run share one rerun and never copy twice', async () =>
{
  const { bookmarks, migration } = setup({ folders: ['Work'], spaces: [space('work', 'Work')] });

  await Promise.all([migration.run(), migration.run(), migration.run()]);

  assert.equal(bookmarks.favoritesFolders('Work').length, 1);
  assert.equal(bookmarks.favorites('Work').length, 2);
});
