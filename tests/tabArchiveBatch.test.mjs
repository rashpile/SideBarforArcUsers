import assert from 'node:assert/strict';
import test from 'node:test';

import { TabArchiveBatch } from '../src/utils/tabArchiveBatch.ts';
import { FakeArchiveBookmarks } from './fakeArchiveBookmarks.mjs';

const tab = (id, url, title = `Tab ${id}`) => ({ id, title, url });

test('a tab whose archive item cannot be created stays open; the others archive', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const bookmarks = new FakeArchiveBookmarks();
  bookmarks.failUrls.add('https://b.test/');

  const result = await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'https://a.test/'),
    tab(2, 'https://b.test/'),
    tab(3, 'https://c.test/'),
  ]);

  assert.deepEqual(result.closableTabIds, [1, 3]);
  assert.equal(result.archivedCount, 2);
  assert.equal(result.keptOpenCount, 1);
  assert.deepEqual(bookmarks.archivedUrls(), ['https://c.test/', 'https://a.test/']);
});

test('empty pages are closable without an archive item', async () =>
{
  const bookmarks = new FakeArchiveBookmarks();

  const result = await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'chrome://newtab/', 'New Tab'),
    tab(2, 'about:blank'),
    { id: 3, title: 'Loading', url: '', pendingUrl: '' },
  ]);

  assert.deepEqual(result.closableTabIds, [1, 2, 3]);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.keptOpenCount, 0);
  assert.deepEqual(bookmarks.archiveFolders(), []);
});

test('a batch into a Space without an archive folder creates exactly one', async () =>
{
  const bookmarks = new FakeArchiveBookmarks();

  await new TabArchiveBatch(bookmarks).archive('space', [
    tab(1, 'https://a.test/'),
    tab(2, 'https://b.test/'),
    tab(3, 'https://c.test/'),
  ]);

  assert.equal(bookmarks.archiveFolders().length, 1);
  assert.deepEqual(bookmarks.archivedUrls(), ['https://c.test/', 'https://b.test/', 'https://a.test/']);
});
