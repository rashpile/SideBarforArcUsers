import assert from 'node:assert/strict';
import test from 'node:test';

import { FavoriteIcons } from '../src/managers/shared/favoriteIconsApi.ts';
import { ALL_SPACE } from '../src/utils/spaceMessages.ts';
import { SpaceFavorites, allFavoriteBookmarks, allFavoriteUrls } from '../src/utils/spaceFavorites.ts';

const folder = (id, title, children = [], extra = {}) => ({ id, title, children, ...extra });
const page = (id, title, url, index) => ({ id, title, url, index });

// Device and account storage both have a "Bookmarks Bar" holding a "Work" folder,
// each with its own asd_Favorites
function twoStorageRoots()
{
  return [
    folder('1', 'Bookmarks Bar', [
      folder('d-work', 'Work', [
        folder('d-fav', 'asd_Favorites', [page('d1', 'Device mail', 'https://mail.example/', 0)], { index: 0 }),
      ]),
    ], { syncing: false }),
    folder('acc-bar', 'Bookmarks Bar', [
      folder('a-work', 'Work', [
        folder('a-fav', 'asd_Favorites', [page('a1', 'Account docs', 'https://docs.example/', 0)], { index: 0 }),
      ]),
    ], { syncing: true }),
  ];
}

const space = (id, segments, inAccount) => ({ id, bookmarkFolderSegments: segments, bookmarkFolderInAccount: inAccount });

test('a Space resolves the asd_Favorites of its own storage when titles repeat across roots', () =>
{
  const roots = twoStorageRoots();

  const account = SpaceFavorites.resolve(roots, space('acc', ['Bookmarks Bar', 'Work'], true), FavoriteIcons.EMPTY);
  const device = SpaceFavorites.resolve(roots, space('dev', ['Bookmarks Bar', 'Work'], false), FavoriteIcons.EMPTY);

  assert.deepEqual(account.sites.map(site => site.id), ['a1']);
  assert.deepEqual(device.sites.map(site => site.id), ['d1']);
});

test('Favorites are the direct pages in index order, merged with their icons; subfolders are ignored', () =>
{
  const roots = [folder('1', 'Bookmarks Bar', [
    folder('work', 'Work', [
      folder('fav', 'asd_Favorites', [
        page('b', 'Second', 'https://b.example/', 1),
        folder('sub', 'Nested', [page('n', 'Nested page', 'https://n.example/', 0)], { index: 2 }),
        page('a', 'First', 'https://a.example/', 0),
      ]),
    ]),
  ])];
  const icons = FavoriteIcons.fromStored({ a: { emoji: '🚀' } });

  const favorites = SpaceFavorites.resolve(roots, space('s', ['Bookmarks Bar', 'Work']), icons);

  assert.deepEqual(favorites.sites, [
    { id: 'a', url: 'https://a.example/', title: 'First', emoji: '🚀' },
    { id: 'b', url: 'https://b.example/', title: 'Second' },
  ]);
});

test('a Space without a bookmark folder has no folder; one with a folder but no Favorites has one', () =>
{
  const roots = [folder('1', 'Bookmarks Bar', [folder('work', 'Work')])];

  const missing = SpaceFavorites.resolve(roots, space('gone', ['Bookmarks Bar', 'Deleted']), FavoriteIcons.EMPTY);
  const empty = SpaceFavorites.resolve(roots, space('work', ['Bookmarks Bar', 'Work']), FavoriteIcons.EMPTY);
  const all = SpaceFavorites.resolve(roots, ALL_SPACE, FavoriteIcons.EMPTY);

  assert.equal(missing.hasFolder, false);
  assert.equal(missing.needsFolderHint, true);
  assert.equal(empty.hasFolder, true);
  assert.deepEqual(empty.sites, []);
  assert.equal(all.hasFolder, false);
  assert.deepEqual(all.sites, []);
  assert.equal(all.needsFolderHint, false);
});

test('every Space\'s Favorites are listed with their Space, a shared folder only once', () =>
{
  const roots = twoStorageRoots();
  const spaces = [
    space('acc', ['Bookmarks Bar', 'Work'], true),
    space('dev', ['Bookmarks Bar', 'Work'], false),
    space('acc-again', ['Bookmarks Bar', 'Work'], true),
  ];

  const all = allFavoriteBookmarks(roots, spaces);

  assert.deepEqual(all.map(({ spaceId, bookmark }) => [spaceId, bookmark.id]), [['acc', 'a1'], ['dev', 'd1']]);
  assert.deepEqual(allFavoriteUrls(roots, spaces), ['https://docs.example/', 'https://mail.example/']);
});
