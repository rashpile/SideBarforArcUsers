import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchPicker, parseBookmarkOpenMode } from '../src/services/searchPick.ts';

const ORIGIN = 10;
const OTHER_WINDOW = 20;

const tabItem = (tabId, windowId, extra = {}) => ({
  kind: 'tab',
  id: `t:${windowId}:${tabId}`,
  title: `Tab ${tabId}`,
  url: `https://tab${tabId}.test/`,
  spaceId: 'work',
  lastAccess: 1,
  inThisSpace: true,
  windowId,
  tabId,
  bookmarkId: undefined,
  ...extra,
});
const bookmarkItem = (bookmarkId, spaceId = 'work') => ({
  kind: 'bookmark',
  id: `b:${bookmarkId}`,
  title: `Bookmark ${bookmarkId}`,
  url: `https://${bookmarkId}.test/`,
  spaceId,
  lastAccess: 1,
  inThisSpace: true,
  bookmarkId,
});
const archiveItem = (bookmarkId, spaceId = 'work') => ({
  kind: 'archive',
  id: `a:${bookmarkId}`,
  title: `Archived ${bookmarkId}`,
  url: `https://${bookmarkId}.test/`,
  spaceId,
  lastAccess: 1,
  inThisSpace: true,
  bookmarkId,
});
const closedItem = (recordId, spaceId = 'work') => ({
  kind: 'closed',
  id: `c:${spaceId}:${recordId}`,
  title: `Closed ${recordId}`,
  url: `https://${recordId}.test/`,
  spaceId,
  lastAccess: 1,
  inThisSpace: true,
  recordId,
});

// Fake deps that record every call in order. `associations` is windowId -> { tabId: itemKey },
// `openTabs` the tab ids that still exist, `reopened` what reopenClosed resolves to.
function fakeDeps(options = {})
{
  const {
    mode = 'arc',
    associations = {},
    openTabs = [],
    bookmarkSpaces = {},
    activeTabs = {},
    failCreate = false,
  } = options;
  const reopened = 'reopened' in options ? options.reopened : 300;
  const calls = [];
  let nextTabId = 100;
  const deps = {
    activateTab: async (tabId) => { calls.push(['activateTab', tabId]); },
    activateTabOnly: async (tabId) => { calls.push(['activateTabOnly', tabId]); },
    focusWindow: async (windowId) => { calls.push(['focusWindow', windowId]); },
    createTab: async (windowId, url) =>
    {
      calls.push(['createTab', windowId, url]);
      if (failCreate) throw new Error('create failed');
      return { id: nextTabId++, index: 4, url: '' };
    },
    updateTabUrl: async (tabId, url) => { calls.push(['updateTabUrl', tabId, url]); },
    activeTabId: async (windowId) => activeTabs[windowId],
    tabExists: async (tabId) => openTabs.includes(tabId),
    associatedTabIds: async (windowId, itemKey) =>
      Object.entries(associations[windowId] ?? {})
        .filter(([, key]) => key === itemKey)
        .map(([tabId]) => Number(tabId)),
    storeAssociation: async (windowId, tabId, itemKey, url, index) =>
    {
      calls.push(['storeAssociation', windowId, tabId, itemKey, url, index]);
    },
    registerTab: async (windowId, tabId, spaceId) => { calls.push(['registerTab', windowId, tabId, spaceId]); },
    bookmarkSpaceId: async (bookmarkId) => bookmarkSpaces[bookmarkId],
    removeBookmark: async (bookmarkId) => { calls.push(['removeBookmark', bookmarkId]); },
    reopenClosed: async (windowId, spaceId, recordId) =>
    {
      calls.push(['reopenClosed', windowId, spaceId, recordId]);
      return reopened;
    },
    bookmarkOpenMode: async () => mode,
  };
  return { picker: new SearchPicker(deps), calls };
}

test('a tab result activates that tab and focuses its window only when it is another window', async () =>
{
  const same = fakeDeps();
  await same.picker.pick(tabItem(7, ORIGIN), ORIGIN, true);
  assert.deepEqual(same.calls, [['activateTab', 7]]);

  const other = fakeDeps();
  await other.picker.pick(tabItem(8, OTHER_WINDOW), ORIGIN, true);
  assert.deepEqual(other.calls, [['activateTab', 8], ['focusWindow', OTHER_WINDOW]]);
});

test('a closed record reopens with its Space and id in the origin window and activates the new tab', async () =>
{
  const { picker, calls } = fakeDeps({ reopened: 42 });

  await picker.pick(closedItem('rec-1', 'home'), ORIGIN, true);

  assert.deepEqual(calls, [['reopenClosed', ORIGIN, 'home', 'rec-1'], ['activateTab', 42]]);
});

test('a closed record that is already gone activates nothing', async () =>
{
  const { picker, calls } = fakeDeps({ reopened: undefined });

  await picker.pick(closedItem('rec-1'), ORIGIN, true);

  assert.deepEqual(calls, [['reopenClosed', ORIGIN, 'work', 'rec-1']]);
});

test('an arc bookmark with its tab open in the origin window activates that tab and creates nothing', async () =>
{
  const { picker, calls } = fakeDeps({
    associations: {
      [ORIGIN]: { 5: 'bookmark-other', 6: 'bookmark-b1' },
      [OTHER_WINDOW]: { 9: 'bookmark-b1' },
    },
    openTabs: [5, 6, 9],
  });

  await picker.pick(bookmarkItem('b1'), ORIGIN, true);

  assert.deepEqual(calls, [['activateTab', 6]]);
});

test('an arc bookmark whose associated tab is gone gets a new tab, associated and registered in its Space', async () =>
{
  const { picker, calls } = fakeDeps({
    associations: { [ORIGIN]: { 6: 'bookmark-b1' } },
    openTabs: [],
    bookmarkSpaces: { b1: 'home' },
  });

  await picker.pick(bookmarkItem('b1', 'work'), ORIGIN, true);

  assert.deepEqual(calls, [
    ['createTab', ORIGIN, 'https://b1.test/'],
    ['storeAssociation', ORIGIN, 100, 'bookmark-b1', 'https://b1.test/', 4],
    ['registerTab', ORIGIN, 100, 'home'],
    ['activateTab', 100],
  ]);
});

test('an arc bookmark without a tab falls back to the item\'s Space when its folder has none now', async () =>
{
  const { picker, calls } = fakeDeps();

  await picker.pick(bookmarkItem('b1', 'work'), ORIGIN, true);

  assert.deepEqual(calls, [
    ['createTab', ORIGIN, 'https://b1.test/'],
    ['storeAssociation', ORIGIN, 100, 'bookmark-b1', 'https://b1.test/', 4],
    ['registerTab', ORIGIN, 100, 'work'],
    ['activateTab', 100],
  ]);
});

test('newTab mode opens a new tab in the bookmark\'s Space without an association', async () =>
{
  const { picker, calls } = fakeDeps({
    mode: 'newTab',
    associations: { [ORIGIN]: { 6: 'bookmark-b1' } },
    openTabs: [6],
    bookmarkSpaces: { b1: 'home' },
  });

  await picker.pick(bookmarkItem('b1'), ORIGIN, true);

  assert.deepEqual(calls, [
    ['createTab', ORIGIN, 'https://b1.test/'],
    ['registerTab', ORIGIN, 100, 'home'],
    ['activateTab', 100],
  ]);
});

test('activeTab mode loads the bookmark into the origin window\'s active tab', async () =>
{
  const { picker, calls } = fakeDeps({ mode: 'activeTab', activeTabs: { [ORIGIN]: 3, [OTHER_WINDOW]: 9 } });

  await picker.pick(bookmarkItem('b1'), ORIGIN, true);

  assert.deepEqual(calls, [['updateTabUrl', 3, 'https://b1.test/']]);
});

test('parseBookmarkOpenMode migrates the old boolean and defaults to arc', () =>
{
  assert.equal(parseBookmarkOpenMode('true'), 'arc');
  assert.equal(parseBookmarkOpenMode('false'), 'newTab');
  assert.equal(parseBookmarkOpenMode('arc'), 'arc');
  assert.equal(parseBookmarkOpenMode('newTab'), 'newTab');
  assert.equal(parseBookmarkOpenMode('activeTab'), 'activeTab');
  assert.equal(parseBookmarkOpenMode('"arc"'), 'arc');
  assert.equal(parseBookmarkOpenMode(undefined), 'arc');
  assert.equal(parseBookmarkOpenMode(true), 'arc');
});

test('an archive item opens in its Space and leaves the archive only after the tab is open', async () =>
{
  const { picker, calls } = fakeDeps();

  await picker.pick(archiveItem('old1', 'home'), ORIGIN, true);

  assert.deepEqual(calls, [
    ['createTab', ORIGIN, 'https://old1.test/'],
    ['registerTab', ORIGIN, 100, 'home'],
    ['activateTab', 100],
    ['removeBookmark', 'old1'],
  ]);
});

test('a failed tab create keeps the archive item', async () =>
{
  const { picker, calls } = fakeDeps({ failCreate: true });

  await assert.rejects(picker.pick(archiveItem('old1'), ORIGIN, true));

  assert.deepEqual(calls, [['createTab', ORIGIN, 'https://old1.test/']]);
});

test('after a failed restore a tab result is activated without a Space switch', async () =>
{
  const { picker, calls } = fakeDeps();

  await picker.pick(tabItem(8, OTHER_WINDOW), ORIGIN, false);

  assert.deepEqual(calls, [['activateTabOnly', 8], ['focusWindow', OTHER_WINDOW]]);
});

test('after a failed restore an arc bookmark gets a new tab instead of its associated one', async () =>
{
  const { picker, calls } = fakeDeps({
    associations: { [ORIGIN]: { 6: 'bookmark-b1' } },
    openTabs: [6],
  });

  await picker.pick(bookmarkItem('b1'), ORIGIN, false);

  assert.deepEqual(calls, [
    ['createTab', ORIGIN, 'https://b1.test/'],
    ['storeAssociation', ORIGIN, 100, 'bookmark-b1', 'https://b1.test/', 4],
    ['registerTab', ORIGIN, 100, 'work'],
    ['activateTab', 100],
  ]);
});
