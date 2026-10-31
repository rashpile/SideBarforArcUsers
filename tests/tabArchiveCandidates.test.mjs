import assert from 'node:assert/strict';
import test from 'node:test';

import { TabArchiveCandidates } from '../src/utils/tabArchiveCandidates.ts';

const tab = (id, url = `https://site${id}.test/`, groupId = -1) => ({ id, url, title: `Tab ${id}`, groupId });
const noneMarked = () => false;
const ids = (tabs) => tabs.map(t => t.id);

test('marked tabs are skipped by pick and refused by canArchiveRow', () =>
{
  const spaceTabs = [tab(1), tab(2), tab(3)];
  const candidates = new TabArchiveCandidates(spaceTabs, id => id === 2);

  assert.deepEqual(ids(candidates.pick([1, 2, 3], [])), [1, 3]);
  assert.equal(candidates.canArchiveRow(spaceTabs[1]), false);
  assert.equal(candidates.canArchiveRow(spaceTabs[0]), true);
});

test('tabs not in the Space list (another Space) are skipped', () =>
{
  const candidates = new TabArchiveCandidates([tab(1), tab(2)], noneMarked);

  assert.deepEqual(ids(candidates.pick([1, 7], [])), [1]);
  assert.equal(candidates.canArchiveRow(tab(7)), false);
});

test('a listed group expands to its Space tabs only', () =>
{
  const spaceTabs = [tab(1, undefined, 5), tab(2), tab(3, undefined, 5)];
  const candidates = new TabArchiveCandidates(spaceTabs, noneMarked);

  // Tab 9 is in the same group but not in the Space list, so it stays open
  assert.deepEqual(ids(candidates.pick([9], [5])), [1, 3]);
});

test('a tab listed and in a listed group is picked once, in Space-list order', () =>
{
  const spaceTabs = [tab(1), tab(2, undefined, 5), tab(3, undefined, 5), tab(4)];
  const candidates = new TabArchiveCandidates(spaceTabs, noneMarked);

  assert.deepEqual(ids(candidates.pick([4, 3, 1], [5])), [1, 2, 3, 4]);
});

test('the "no group" id does not pick every ungrouped tab', () =>
{
  const candidates = new TabArchiveCandidates([tab(1), tab(2)], noneMarked);

  assert.deepEqual(ids(candidates.pick([], [-1])), []);
});

test('empty pages are refused by canArchiveRow but kept in pick', () =>
{
  const spaceTabs = [tab(1, 'chrome://newtab/'), tab(2, 'about:blank'), tab(3, '')];
  const candidates = new TabArchiveCandidates(spaceTabs, noneMarked);

  for (const t of spaceTabs)
  {
    assert.equal(candidates.canArchiveRow(t), false);
  }
  assert.deepEqual(ids(candidates.pick([1, 2, 3], [])), [1, 2, 3]);
});

test('a loading tab counts by its pending URL', () =>
{
  const loading = { id: 1, url: '', pendingUrl: 'https://a.test/' };
  const candidates = new TabArchiveCandidates([loading], noneMarked);

  assert.equal(candidates.canArchiveRow(loading), true);
  assert.deepEqual(candidates.pick([1], []), [{ id: 1, title: undefined, url: '', pendingUrl: 'https://a.test/' }]);
});

test('tabs without id are skipped', () =>
{
  const noId = { url: 'https://a.test/', groupId: 5 };
  const candidates = new TabArchiveCandidates([noId, tab(2, undefined, 5)], noneMarked);

  assert.equal(candidates.canArchiveRow(noId), false);
  assert.deepEqual(ids(candidates.pick([], [5])), [2]);
});

test('empty input gives an empty list', () =>
{
  const candidates = new TabArchiveCandidates([tab(1), tab(2)], noneMarked);

  assert.deepEqual(candidates.pick([], []), []);
  assert.deepEqual(new TabArchiveCandidates([], noneMarked).pick([1], [5]), []);
});
