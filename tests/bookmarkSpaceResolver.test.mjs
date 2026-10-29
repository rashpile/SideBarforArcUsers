import assert from 'node:assert/strict';
import test from 'node:test';

import { BookmarkSpaceResolver } from '../src/utils/bookmarkSpaceResolver.ts';

// chrome.bookmarks.get for a fixed tree: a node by ID, undefined once it is gone
function nodeLookup(nodes)
{
  const byId = new Map(nodes.map(node => [node.id, node]));
  return async (id) => byId.get(id);
}

const space = (id, segments, inAccount) => ({
  id,
  name: id,
  icon: 'circle',
  color: 'grey',
  bookmarkFolderPath: segments.join('/'),
  bookmarkFolderSegments: segments,
  bookmarkFolderInAccount: inAccount,
});

// Root "0" has no title; its permanent folders don't use the IDs "1"/"2" on
// every profile, so none of the lookups may depend on them
const tree = [
  { id: '0', title: '' },
  { id: 'bar', parentId: '0', title: 'Bookmarks Bar' },
  { id: 'home', parentId: 'bar', title: 'Home' },
  { id: 'personal', parentId: 'home', title: 'Personal' },
  { id: 'finance', parentId: 'personal', title: 'Finance', url: 'https://sheets.example' },
  { id: 'dev', parentId: 'bar', title: 'Dev' },
  { id: 'gitea', parentId: 'dev', title: 'Gitea', url: 'https://gitea.example' },
  { id: 'loose', parentId: 'bar', title: 'Loose', url: 'https://loose.example' },
];
const spaces = [space('home-space', ['Bookmarks Bar', 'Home']), space('dev-space', ['Bookmarks Bar', 'Dev'])];

test("a bookmark's tab belongs to the Space whose folder holds the bookmark", async () =>
{
  const resolver = new BookmarkSpaceResolver(nodeLookup(tree), () => spaces);

  assert.equal(await resolver.findSpaceId('gitea'), 'dev-space');
});

test('a bookmark in a subfolder belongs to the Space of the folder above it', async () =>
{
  const resolver = new BookmarkSpaceResolver(nodeLookup(tree), () => spaces);

  assert.equal(await resolver.findSpaceId('finance'), 'home-space');
});

test('a bookmark outside every Space folder, or one that is gone, has no Space', async () =>
{
  const resolver = new BookmarkSpaceResolver(nodeLookup(tree), () => spaces);

  assert.equal(await resolver.findSpaceId('loose'), undefined);
  assert.equal(await resolver.findSpaceId('deleted'), undefined);
});

test('same-titled folders on the device and in the Google account resolve to their own Spaces', async () =>
{
  const accountTree = [
    { id: '0', title: '' },
    { id: 'device-bar', parentId: '0', title: 'Bookmarks Bar', syncing: false },
    { id: 'device-dev', parentId: 'device-bar', title: 'Dev', syncing: false },
    { id: 'device-link', parentId: 'device-dev', title: 'A', url: 'https://a.example', syncing: false },
    { id: 'account-bar', parentId: '0', title: 'Bookmarks Bar', syncing: true },
    { id: 'account-dev', parentId: 'account-bar', title: 'Dev', syncing: true },
    { id: 'account-link', parentId: 'account-dev', title: 'B', url: 'https://b.example', syncing: true },
  ];
  const twinSpaces = [
    space('device-space', ['Bookmarks Bar', 'Dev'], false),
    space('account-space', ['Bookmarks Bar', 'Dev'], true),
  ];
  const resolver = new BookmarkSpaceResolver(nodeLookup(accountTree), () => twinSpaces);

  assert.equal(await resolver.findSpaceId('account-link'), 'account-space');
  assert.equal(await resolver.findSpaceId('device-link'), 'device-space');
});
