import assert from 'node:assert/strict';
import test from 'node:test';

import { ArchiveClearOption, ArchiveItems } from '../src/utils/archiveItems.ts';

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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;

// An archive with pages around the 7-day cutoff, a user subfolder, a nested archive and a page without a date
const agedArchive = {
  id: 'archive',
  title: 'asd_Archive',
  children: [
    page('fresh', 'Fresh', 'https://fresh.test/', NOW - HOUR),
    page('just-newer', 'Just newer', 'https://newer.test/', NOW - 7 * DAY + 1),
    page('at-cutoff', 'At cutoff', 'https://cutoff.test/', NOW - 7 * DAY),
    { id: 'saved', title: 'Saved', children: [page('old-in-sub', 'Old in sub', 'https://sub.test/', NOW - 40 * DAY)] },
    {
      id: 'nested-archive',
      title: 'asd_Archive',
      children: [page('nested-old', 'Nested old', 'https://nested.test/', NOW - 40 * DAY)],
    },
    page('undated', 'Undated', 'https://undated.test/', undefined),
  ],
};

test('an age option clears pages at or before the cutoff, subfolders included, nested archives and undated pages excluded', () =>
{
  const items = ArchiveItems.fromFolder(agedArchive);

  assert.deepEqual(ids(items.clearable(ArchiveClearOption.OLDER_THAN_7_DAYS, NOW)), ['at-cutoff', 'old-in-sub']);
  assert.deepEqual(ids(items.clearable(ArchiveClearOption.OLDER_THAN_30_DAYS, NOW)), ['old-in-sub']);
  assert.deepEqual(
    ids(items.clearable(ArchiveClearOption.OLDER_THAN_24_HOURS, NOW)),
    ['just-newer', 'at-cutoff', 'old-in-sub']);
});

test('Clear All clears every page of the archive, undated ones too, but not a nested archive', () =>
{
  const items = ArchiveItems.fromFolder(agedArchive);

  assert.deepEqual(
    ids(items.clearable(ArchiveClearOption.ALL, NOW)),
    ['fresh', 'just-newer', 'at-cutoff', 'old-in-sub', 'undated']);
  assert.deepEqual(ArchiveItems.fromFolder(undefined).clearable(ArchiveClearOption.ALL, NOW), []);
});
