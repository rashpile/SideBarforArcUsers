import assert from 'node:assert/strict';
import test from 'node:test';

import { BookmarkMarks, TabMarks } from '../src/stores/attentionMarks.ts';

const tab = (id, windowId, url, index, extra = {}) => ({ id, windowId, url, index, ...extra });
const record = (tabId, windowId, url, index) => ({ tabId, windowId, url, index });

// Stored IDs that may come from an earlier browser session, and IDs of the running one
const AFTER_RESTART = 'sameWindowAndSite';
const SAME_SESSION = 'sameWindow';

test('after a browser restart a mark re-attaches by URL and position, not to an unrelated tab reusing the old ID', () =>
{
  const marks = TabMarks.fromStored([record(5, 1, 'https://a.test/doc', 2)]);
  const liveTabs = [
    tab(5, 1, 'https://b.test/', 0),
    tab(12, 1, 'https://a.test/doc', 2),
  ];

  const rematched = marks.rematched(liveTabs, AFTER_RESTART);

  assert.equal(rematched.isMarked(5), false);
  assert.equal(rematched.isMarked(12), true);
  assert.deepEqual(rematched.toStored(), [record(12, 1, 'https://a.test/doc', 2)]);
});

test('on a worker restart a mark stays with its tab ID even after the tab left the site', () =>
{
  const marks = TabMarks.fromStored([record(7, 1, 'https://mail.test/inbox', 3)]);
  const liveTabs = [
    tab(2, 1, 'https://mail.test/inbox', 3),
    tab(7, 1, 'https://login.test/', 3),
  ];

  const rematched = marks.rematched(liveTabs, SAME_SESSION);

  assert.deepEqual(rematched.markedTabIds(), [7]);
  assert.deepEqual(rematched.toStored(), [record(7, 1, 'https://login.test/', 3)]);
});

test('a followed tab stays matchable after it navigated and moved', () =>
{
  const marks = new TabMarks();
  marks.mark(tab(5, 1, 'https://a.test/', 0));

  assert.equal(marks.follow(tab(5, 2, 'https://b.test/page', 4)), true);
  assert.equal(marks.follow(tab(5, 2, 'https://b.test/page', 4)), false);

  // After a restart the old position and URL would no longer find the tab
  const rematched = TabMarks.fromStored(marks.toStored())
    .rematched([tab(1, 2, 'https://a.test/', 0), tab(3, 2, 'https://b.test/page', 4)], AFTER_RESTART);
  assert.deepEqual(rematched.markedTabIds(), [3]);
});

test('follow leaves unmarked tabs unmarked', () =>
{
  const marks = new TabMarks();

  assert.equal(marks.follow(tab(5, 1, 'https://a.test/', 0)), false);
  assert.equal(marks.isMarked(5), false);
});

test('marks without a live tab are dropped on re-match', () =>
{
  const marks = TabMarks.fromStored([
    record(5, 1, 'https://a.test/', 0),
    record(6, 1, 'https://gone.test/', 1),
  ]);

  const rematched = marks.rematched([tab(5, 1, 'https://a.test/', 0)], SAME_SESSION);

  assert.deepEqual(rematched.markedTabIds(), [5]);
});

test('incognito tabs are refused and never take a mark on re-match', () =>
{
  const marks = new TabMarks();

  assert.equal(marks.mark(tab(5, 1, 'https://a.test/', 0, { incognito: true })), false);
  assert.equal(marks.mark({ windowId: 1, url: 'https://a.test/', index: 0 }), false);
  assert.deepEqual(marks.toStored(), []);

  const stored = TabMarks.fromStored([record(5, 1, 'https://a.test/', 0)]);
  const rematched = stored.rematched([tab(9, 3, 'https://a.test/', 0, { incognito: true })], AFTER_RESTART);
  assert.deepEqual(rematched.markedTabIds(), []);
});

test('a malformed stored tab value throws', () =>
{
  assert.throws(() => TabMarks.fromStored({ 5: record(5, 1, 'https://a.test/', 0) }));
  assert.throws(() => TabMarks.fromStored([record(5, 1, 'https://a.test/', 0), { tabId: 'x', windowId: 1, url: '', index: 0 }]));
  assert.throws(() => TabMarks.fromStored([{ tabId: 5, windowId: 1, index: 0 }]));
  assert.deepEqual(TabMarks.fromStored(undefined).toStored(), []);
});

test('bookmark marks keep only ids still in the tree', () =>
{
  const marks = BookmarkMarks.fromStored(['10', '11', '12']);

  const kept = marks.keptIn(new Set(['1', '10', '12']));

  assert.deepEqual(kept.markedIds().sort(), ['10', '12']);
  assert.throws(() => BookmarkMarks.fromStored(['10', 11]));
});
