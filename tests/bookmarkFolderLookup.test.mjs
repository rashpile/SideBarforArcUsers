import assert from 'node:assert/strict';
import test from 'node:test';

import { findFolderBySegments, findRootFolder } from '../src/utils/bookmarkFolderLookup.ts';
import { findSpaceForFolderSegments } from '../src/utils/spaceFolderMatch.ts';

const folder = (id, title, syncing, children = []) => ({ id, title, syncing, children });

// Chrome with account bookmarks enabled: device-only roots first, then account roots
const roots = [
  folder('1', 'Bookmarks Bar', false),
  folder('2', 'Other Bookmarks', false),
  folder('a1', 'Bookmarks Bar', true, [folder('a10', 'Photo', true)]),
  folder('a2', 'Other Bookmarks', true, [folder('a20', 'Board 1', true)]),
];

test('without storage info the first same-titled root wins (legacy behavior)', () =>
{
  assert.equal(findFolderBySegments(roots, ['Bookmarks Bar'])?.id, '1');
});

test('storage flag picks the account root over the same-titled device root', () =>
{
  assert.equal(findFolderBySegments(roots, ['Bookmarks Bar'], true)?.id, 'a1');
  assert.equal(findFolderBySegments(roots, ['Bookmarks Bar'], false)?.id, '1');
});

test('a nested path is found under the second same-titled root', () =>
{
  assert.equal(findFolderBySegments(roots, ['Other Bookmarks', 'Board 1'])?.id, 'a20');
});

test('falls back to the other storage when the preferred one has no match', () =>
{
  assert.equal(findFolderBySegments(roots, ['Bookmarks Bar', 'Photo'], false)?.id, 'a10');
});

test('folder in account storage belongs to the Space saved for account storage', () =>
{
  const spaces = [
    { id: 'device', bookmarkFolderSegments: ['Bookmarks Bar'], bookmarkFolderInAccount: false },
    { id: 'account', bookmarkFolderSegments: ['Bookmarks Bar'], bookmarkFolderInAccount: true },
  ];
  assert.equal(findSpaceForFolderSegments(['Bookmarks Bar', 'Photo'], spaces, true)?.id, 'account');
  assert.equal(findSpaceForFolderSegments(['Bookmarks Bar'], spaces, false)?.id, 'device');
  assert.equal(findSpaceForFolderSegments(['Bookmarks Bar'], spaces)?.id, 'device');
});

const root = (id, title, folderType, syncing) => ({ id, title, folderType, syncing, parentId: '0', children: [] });

test('root folder is found by type when only account roots exist (no legacy ids)', () =>
{
  const accountOnly = [
    root('a1', 'Bookmarks Bar', 'bookmarks-bar', true),
    root('a2', 'Other Bookmarks', 'other', true),
    root('a3', 'Mobile Bookmarks', 'mobile', true),
  ];
  assert.equal(findRootFolder(accountOnly, 'other')?.id, 'a2');
  assert.equal(findRootFolder(accountOnly, 'bookmarks-bar')?.id, 'a1');
});

test('account root wins over the device root of the same type', () =>
{
  const both = [
    root('1', 'Bookmarks Bar', 'bookmarks-bar', false),
    root('2', 'Other Bookmarks', 'other', false),
    root('a2', 'Other Bookmarks', 'other', true),
  ];
  assert.equal(findRootFolder(both, 'other')?.id, 'a2');
  assert.equal(findRootFolder(both, 'bookmarks-bar')?.id, '1');
});

test('older Chrome without folderType falls back to legacy ids', () =>
{
  const legacy = [
    { id: '1', title: 'Bookmarks Bar', children: [] },
    { id: '2', title: 'Other Bookmarks', children: [] },
  ];
  assert.equal(findRootFolder(legacy, 'other')?.id, '2');
  assert.equal(findRootFolder(legacy, 'mobile'), undefined);
});
