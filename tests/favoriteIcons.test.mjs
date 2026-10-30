import assert from 'node:assert/strict';
import test from 'node:test';

import { FavoriteIconsManager } from '../src/managers/impl/favoriteIconsManager.ts';
import { FAVORITE_ICONS_STORAGE_KEY } from '../src/managers/shared/favoriteIconsApi.ts';
import { collectBookmarkIds } from '../src/utils/bookmarkFolderLookup.ts';

// A manager over a fake storage area; returns both so tests can read storage back
async function loadedManager(stored = {})
{
  const local = { ...stored };
  const manager = new FavoriteIconsManager({
    storage: {
      get: async (key) => (key in local ? { [key]: local[key] } : {}),
      set: async (values) => { Object.assign(local, values); },
    },
    broadcast: async () => {},
  });
  await manager.load();
  return { manager, local };
}

test('a favicon resolved for a Favorite whose icon changed meanwhile is dropped', async () =>
{
  const { manager } = await loadedManager({
    [FAVORITE_ICONS_STORAGE_KEY]: {
      emojiNow: { emoji: '🚀' },
      otherIconNow: { customIconName: 'Star' },
      stillBare: {},
    },
  });

  manager.setFavicons([
    { id: 'emojiNow', favicon: 'data:site' },
    { id: 'otherIconNow', favicon: 'data:heart', forCustomIconName: 'Heart' },
    { id: 'stillBare', favicon: 'data:site' },
    { id: 'noEntryYet', favicon: 'data:site' },
  ]);

  assert.deepEqual(manager.getIcons(), {
    emojiNow: { emoji: '🚀' },
    otherIconNow: { customIconName: 'Star' },
    stillBare: { favicon: 'data:site' },
    noEntryYet: { favicon: 'data:site' },
  });
});

test('removing a folder drops the icon entries of the bookmarks inside it and keeps the others', async () =>
{
  const { manager, local } = await loadedManager({
    [FAVORITE_ICONS_STORAGE_KEY]: {
      inside: { emoji: '📌' },
      deeper: { customIconName: 'Star', iconColor: '#ef4444' },
      elsewhere: { favicon: 'data:kept' },
    },
  });

  // What chrome.bookmarks.onRemoved reports for a removed asd_Favorites folder
  const removedFolder = {
    id: 'fav-folder',
    title: 'asd_Favorites',
    children: [
      { id: 'inside', url: 'https://a.test/' },
      { id: 'sub', title: 'Sub', children: [{ id: 'deeper', url: 'https://b.test/' }] },
    ],
  };
  manager.removeIcons(collectBookmarkIds(removedFolder));
  await manager.flushWrites();

  assert.deepEqual(manager.getIcons(), { elsewhere: { favicon: 'data:kept' } });
  assert.deepEqual(local[FAVORITE_ICONS_STORAGE_KEY], { elsewhere: { favicon: 'data:kept' } });
});
