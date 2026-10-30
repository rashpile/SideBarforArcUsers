import assert from 'node:assert/strict';
import test from 'node:test';

import { ArchiveItems } from '../src/utils/archiveItems.ts';

const page = (id, title, url, dateAdded) => ({ id, title, url, dateAdded });

// An archive folder: newest item first in the tree, a subfolder the user made, two items with the same time
const archiveFolder = {
  id: 'archive',
  title: 'asd_Archive',
  children: [
    page('a', 'Alpha docs', 'https://alpha.test/', 2000),
    { id: 'saved', title: 'Saved', children: [page('b', 'Beta', 'https://beta.test/', 3000)] },
    page('c', 'Gamma', 'https://gamma.test/', 2000),
    page('d', 'Delta', 'https://delta.test/', undefined),
  ],
};

const ids = (pages) => pages.map(item => item.id);

test('archive items are listed newest first, equal times keep tree order, and the text filter narrows them', () =>
{
  const items = ArchiveItems.fromFolder(archiveFolder);

  assert.deepEqual(ids(items.matching('')), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids(items.matching('   ')), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids(items.matching('gamma')), ['c']);
  assert.deepEqual(ids(items.matching('alpha || beta')), ['b', 'a']);
  assert.deepEqual(ArchiveItems.fromFolder(undefined).matching(''), []);
});

test('the Archive search narrows the items together with the toolbar filter', () =>
{
  const items = ArchiveItems.fromFolder(archiveFolder);

  // Toolbar filter only
  assert.deepEqual(ids(items.matching('test', '')), ['b', 'a', 'c', 'd']);
  // Archive search only
  assert.deepEqual(ids(items.matching('', 'beta')), ['b']);
  // Both apply: an item must match the filter AND the search
  assert.deepEqual(ids(items.matching('alpha || gamma', 'gamma')), ['c']);
  assert.deepEqual(ids(items.matching('alpha', 'beta')), []);
  // A blank search keeps whatever the filter matches
  assert.deepEqual(ids(items.matching('delta', '   ')), ['d']);
  // A search that matches nothing leaves no items
  assert.deepEqual(ids(items.matching('', 'nothing-like-this')), []);
});
