import assert from 'node:assert/strict';
import test from 'node:test';

import { isOpenedUnvisited, RecentWindows } from '../src/utils/unvisitedTabMarker.ts';

const NOW = 1_800_000_000_000;
const PARK_URL = 'chrome-extension://abcdefghijklmnop/park.html?tabId=12&url=https%3A%2F%2Fexample.com%2F';

function newTab(overrides = {})
{
  return { active: false, incognito: false, windowId: 1, url: '', pendingUrl: 'https://example.com/', ...overrides };
}

test('a window counts as just created for 2 s, then no longer', () =>
{
  const windows = new RecentWindows();
  windows.markCreated(1, NOW);

  assert.equal(windows.isJustCreated(1, NOW + 2000), true);
  assert.equal(windows.isJustCreated(1, NOW + 2001), false);
});

test('an unknown window is not just created', () =>
{
  const windows = new RecentWindows();
  windows.markCreated(1, NOW);

  assert.equal(windows.isJustCreated(2, NOW), false);
});

test('a tab opened in the background is unvisited', () =>
{
  assert.equal(isOpenedUnvisited(newTab(), new RecentWindows(), NOW), true);
});

test('a tab opened active is not unvisited', () =>
{
  assert.equal(isOpenedUnvisited(newTab({ active: true }), new RecentWindows(), NOW), false);
});

test('an inactive tab of a window created moments ago is restored, not unvisited', () =>
{
  const windows = new RecentWindows();
  windows.markCreated(1, NOW - 5);

  assert.equal(isOpenedUnvisited(newTab(), windows, NOW), false);
});

test('an inactive tab of a window created earlier is unvisited', () =>
{
  const windows = new RecentWindows();
  windows.markCreated(1, NOW - 60_000);

  assert.equal(isOpenedUnvisited(newTab(), windows, NOW), true);
});

test('a tab suspender park page is not unvisited', () =>
{
  assert.equal(isOpenedUnvisited(newTab({ pendingUrl: PARK_URL }), new RecentWindows(), NOW), false);
  assert.equal(isOpenedUnvisited(newTab({ url: PARK_URL, pendingUrl: undefined }), new RecentWindows(), NOW), false);
});

test('an incognito tab is not unvisited', () =>
{
  assert.equal(isOpenedUnvisited(newTab({ incognito: true }), new RecentWindows(), NOW), false);
});
