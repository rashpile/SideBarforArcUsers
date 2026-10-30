import assert from 'node:assert/strict';
import test from 'node:test';

import { favoritesImportAction, iconRestoresByUrl } from '../src/utils/favoritesImport.ts';

const folder = (id, title, children = []) => ({ id, title, children });
const page = (id, title, url) => ({ id, title, url });

const backupFavorites = [
  { id: 'old-1', url: 'https://mail.example/', title: 'Mail', emoji: '📬' },
  { id: 'old-2', url: 'https://docs.example/', title: 'Docs', customIconName: 'file', iconColor: '#ef4444' },
];

// A backup made after per-Space Favorites: the Space folder holds its asd_Favorites
const perSpaceBookmarks = [
  folder('0', '', [
    folder('1', 'Bookmarks Bar', [
      folder('work', 'Work', [
        folder('fav', 'asd_Favorites', [
          page('b1', 'Mail', 'https://mail.example/'),
          page('b2', 'Docs', 'https://docs.example/'),
        ]),
      ]),
    ]),
  ]),
];

// A backup made before: no asd_Favorites anywhere, pinnedSites is the only copy
const legacyBookmarks = [
  folder('0', '', [folder('1', 'Bookmarks Bar', [folder('work', 'Work', [page('p1', 'Page', 'https://page.example/')])])]),
];

const input = (overrides) => ({
  importFavorites: true,
  favoritesMode: 'append',
  backupFavorites,
  bookmarksRestoredInPlace: true,
  backupBookmarks: perSpaceBookmarks,
  ...overrides,
});

test('bookmarks and pinnedSites imported together add no second copy of the Favorites', () =>
{
  assert.equal(favoritesImportAction(input({ favoritesMode: 'append' })), 'restore-icons');
  assert.equal(favoritesImportAction(input({ favoritesMode: 'replace' })), 'restore-icons');
});

test('pinnedSites are written when the bookmarks do not bring the Favorites back', () =>
{
  // Imported into a subfolder: no Space folder comes back in place
  assert.equal(favoritesImportAction(input({ bookmarksRestoredInPlace: false })), 'append');
  // A backup from before per-Space Favorites: dropping pinnedSites would lose them
  assert.equal(favoritesImportAction(input({ backupBookmarks: legacyBookmarks, favoritesMode: 'replace' })), 'replace');
});

test('icons go back by URL onto the restored Favorites only', () =>
{
  const restored = [
    { id: 'n2', url: 'https://docs.example/' },
    { id: 'n1', url: 'https://mail.example/' },
    { id: 'n3', url: 'https://other.example/' },
  ];

  assert.deepEqual(iconRestoresByUrl(backupFavorites, restored), [
    { id: 'n2', icons: { favicon: undefined, customIconName: 'file', iconColor: '#ef4444', emoji: undefined } },
    { id: 'n1', icons: { favicon: undefined, customIconName: undefined, iconColor: undefined, emoji: '📬' } },
  ]);
});

test('two Favorites of one page each take one backup entry, in order', () =>
{
  const sites = [
    { id: 'a', url: 'https://mail.example/', title: 'Work mail', emoji: '💼' },
    { id: 'b', url: 'https://mail.example/', title: 'Home mail', emoji: '🏠' },
  ];
  const restored = [{ id: 'n1', url: 'https://mail.example/' }, { id: 'n2', url: 'https://mail.example/' }];

  assert.deepEqual(iconRestoresByUrl(sites, restored).map(({ id, icons }) => [id, icons.emoji]), [['n1', '💼'], ['n2', '🏠']]);
});
