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

test('the archive time of each item feeds the recent popover; an item without one gets none', () =>
{
  const recency = ArchiveItems.fromFolder(archiveFolder).toRecency();

  assert.equal(recency.lastActiveAt('b'), 3000);
  assert.equal(recency.lastActiveAt('a'), 2000);
  assert.equal(recency.wasEverActive('d'), false);
});
