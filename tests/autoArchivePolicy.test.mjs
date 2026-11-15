import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SavedPages,
  TabAssociationsByWindow,
  closingTabAction,
  selectTabsToClose,
  tabChangedDuringRun,
} from '../src/utils/autoArchivePolicy.ts';
import { allFavoriteUrls } from '../src/utils/spaceFavorites.ts';

const HOUR = 60 * 60 * 1000;
const PERIOD = 12 * HOUR;
const NOW = 1000 * HOUR;
const LONG_AGO = NOW - 3 * PERIOD;

// An inactive, unpinned tab of window 1 on its own page
const tab = (id, fields = {}) => ({
  id,
  windowId: 1,
  active: false,
  audible: false,
  pinned: false,
  incognito: false,
  url: `https://site${id}.test/`,
  ...fields,
});

// Run the policy over window 1; every tab was last used LONG_AGO unless lastUsedAt says otherwise.
// bookmarks: { [id]: url } in one folder; favorites: URLs of pinned sites
function select({ tabs, associations = {}, bookmarks = {}, favorites = [], lastUsedAt = {}, marked = [], enabledAt = 0, now = NOW })
{
  const associationsByWindow = new TabAssociationsByWindow();
  associationsByWindow.setWindow(1, associations);
  const tree = [{ id: 'folder', children: Object.entries(bookmarks).map(([id, url]) => ({ id, url })) }];

  const { archive, closeOnly } = selectTabsToClose({
    tabs,
    associationsByWindow,
    savedPages: SavedPages.fromTree(tree, favorites.map(url => ({ url }))),
    activity: { lastUsedAt: (id) => id in lastUsedAt ? lastUsedAt[id] : LONG_AGO },
    isMarked: (id) => marked.includes(id),
    enabledAt,
    now,
    periodMs: PERIOD,
  });
  return { archive: archive.map(({ id }) => id), closeOnly: closeOnly.map(({ id }) => id) };
}

test('active, audible, Chrome-pinned and incognito tabs and tabs with an unknown last use stay open', () =>
{
  const result = select({
    tabs: [
      tab(1),
      tab(2, { active: true }),
      tab(3, { audible: true }),
      tab(4, { pinned: true }),
      tab(5, { incognito: true }),
      tab(6),
    ],
    lastUsedAt: { 6: undefined },
  });

  assert.deepEqual(result, { archive: [1], closeOnly: [] });
});

test('an overdue marked tab stays open, an overdue unmarked one is still closed', () =>
{
  const result = select({
    tabs: [tab(1), tab(2), tab(3), tab(4)],
    associations: { 3: 'bookmark-b3', 4: 'bookmark-b4' },
    bookmarks: { b3: 'https://site3.test/', b4: 'https://site4.test/' },
    marked: [1, 3],
  });

  assert.deepEqual(result, { archive: [2], closeOnly: [4] });
});

test('bookmark tabs close without archiving, regular tabs are archived, Favorites and unknown kinds stay open', () =>
{
  const result = select({
    tabs: [tab(1), tab(2), tab(3), tab(4)],
    associations: { 2: 'bookmark-b2', 3: 'pinned-p3', 4: 'space-x' },
    bookmarks: { b2: 'https://site2.test/' },
  });

  assert.deepEqual(result, { archive: [1], closeOnly: [2] });
});

test('a bookmark tab stays open until it is overdue', () =>
{
  const result = select({
    tabs: [tab(1), tab(2)],
    associations: { 1: 'bookmark-b1', 2: 'bookmark-b2' },
    bookmarks: { b1: 'https://site1.test/', b2: 'https://site2.test/' },
    lastUsedAt: { 1: NOW - PERIOD + 1 },
  });

  assert.deepEqual(result, { archive: [], closeOnly: [2] });
});

test('a bookmark tab on another page than its bookmark, or of a deleted bookmark, is archived', () =>
{
  const result = select({
    tabs: [tab(1), tab(2, { url: 'https://docs.test/other' }), tab(3, { url: 'https://docs.test/start' })],
    associations: { 1: 'bookmark-gone', 2: 'bookmark-b2', 3: 'bookmark-b3' },
    bookmarks: { b2: 'https://docs.test/start', b3: 'https://docs.test/start/' },
  });

  // Tab 3 shows its bookmark's page; a trailing slash doesn't count
  assert.deepEqual(result, { archive: [1, 2], closeOnly: [3] });
});

test('a bookmark tab on another hash route of its bookmark\'s URL is archived; on the bookmark\'s own route it only closes', () =>
{
  const result = select({
    tabs: [
      tab(1, { url: 'https://mail.test/mail/u/0/#inbox/abc' }),
      tab(2, { url: 'https://mail.test/mail/u/0#inbox' }),
      tab(3, { url: 'https://docs.test/guide#setup' }),
      tab(4, { url: 'https://chat.test/#room/7' }),
    ],
    associations: { 1: 'bookmark-b1', 2: 'bookmark-b2', 3: 'bookmark-b3' },
    bookmarks: { b1: 'https://mail.test/mail/u/0/#inbox', b2: 'https://mail.test/mail/u/0/#inbox', b3: 'https://docs.test/guide' },
    // Unassociated tab 4 is on a Favorite's page: Favorite pages still match whatever the hash
    favorites: ['https://chat.test/'],
  });

  assert.deepEqual(result, { archive: [1, 3], closeOnly: [2] });
});

test('a tab closing with its Space is saved unless it is on a Favorite\'s or its bookmark\'s exact page, hash included, or empty', () =>
{
  const savedPages = SavedPages.fromTree(
    [{ id: 'folder', children: [{ id: 'b1', url: 'https://docs.test/guide#setup' }] }],
    [{ url: 'https://mail.test/mail/u/0/#inbox' }, { url: 'https://fav.test/' }]
  );
  const cases = [
    // A Favorite's own route, associated or not; a trailing slash doesn't count
    [undefined, 'https://mail.test/mail/u/0/#inbox', 'close-only'],
    ['pinned-f1', 'https://mail.test/mail/u/0#inbox', 'close-only'],
    ['pinned-f2', 'https://fav.test', 'close-only'],
    // Another hash route of a Favorite's URL, or none, is another page
    ['pinned-f1', 'https://mail.test/mail/u/0/#drafts/123', 'save'],
    [undefined, 'https://mail.test/mail/u/0/', 'save'],
    ['pinned-f2', 'https://fav.test/#section', 'save'],
    // A bookmark tab on its bookmark's route, on another route, of a deleted bookmark, on a Favorite's page
    ['bookmark-b1', 'https://docs.test/guide#setup', 'close-only'],
    ['bookmark-b1', 'https://docs.test/guide', 'save'],
    ['bookmark-gone', 'https://docs.test/guide#setup', 'save'],
    ['bookmark-b1', 'https://mail.test/mail/u/0/#inbox', 'close-only'],
    // An unassociated tab on a bookmarked page, an empty page, any other page
    [undefined, 'https://docs.test/guide#setup', 'save'],
    [undefined, 'chrome://newtab/', 'close-only'],
    [undefined, 'https://other.test/', 'save'],
  ];

  for (const [itemKey, pageUrl, expected] of cases)
  {
    assert.equal(closingTabAction(itemKey, pageUrl, savedPages), expected, `${itemKey} on ${pageUrl}`);
  }
});

test('a tab on a Favorite\'s page stays open, associated or not; an unassociated tab on a bookmarked page is archived', () =>
{
  const result = select({
    tabs: [
      tab(1, { url: 'https://mail.test/inbox' }),
      tab(2, { url: 'https://mail.test/inbox/' }),
      tab(3, { url: 'https://docs.test/' }),
    ],
    associations: { 2: 'bookmark-b9' },
    bookmarks: { b9: 'https://elsewhere.test/', b3: 'https://docs.test/' },
    favorites: ['https://mail.test/inbox'],
  });

  assert.deepEqual(result, { archive: [3], closeOnly: [] });
});

test('a tab in Space B on the page of a Space A Favorite stays open', () =>
{
  // Space A's folder holds the Favorite; Space B's folder has no asd_Favorites
  const roots = [{
    id: 'bar',
    title: 'Bookmarks Bar',
    children: [
      { id: 'a', title: 'A', children: [
        { id: 'a-fav', title: 'asd_Favorites', index: 0, children: [{ id: 'f1', url: 'https://chat.test/', index: 0 }] },
      ] },
      { id: 'b', title: 'B', children: [] },
    ],
  }];
  const spaces = [
    { id: 'space-a', bookmarkFolderSegments: ['Bookmarks Bar', 'A'] },
    { id: 'space-b', bookmarkFolderSegments: ['Bookmarks Bar', 'B'] },
  ];
  const associationsByWindow = new TabAssociationsByWindow();
  associationsByWindow.setWindow(1, {});

  // Tab 1 belongs to Space B (no association: it is an ordinary tab there); tab 2 is on another page
  const { archive, closeOnly } = selectTabsToClose({
    tabs: [tab(1, { url: 'https://chat.test/' }), tab(2)],
    associationsByWindow,
    savedPages: SavedPages.fromTree(roots, allFavoriteUrls(roots, spaces).map(url => ({ url }))),
    activity: { lastUsedAt: () => LONG_AGO },
    isMarked: () => false,
    enabledAt: 0,
    now: NOW,
    periodMs: PERIOD,
  });

  assert.deepEqual({ archive: archive.map(({ id }) => id), closeOnly: closeOnly.map(({ id }) => id) }, { archive: [2], closeOnly: [] });
});

test('a tab in a Chrome tab group is archived', () =>
{
  const result = select({ tabs: [tab(1, { groupId: 7 })] });

  assert.deepEqual(result, { archive: [1], closeOnly: [] });
});

test('tabs in a split view with the active tab stay open; other split views are judged as usual', () =>
{
  const result = select({
    tabs: [
      tab(1, { active: true, splitViewId: 5 }),
      tab(2, { splitViewId: 5 }),
      tab(3, { splitViewId: 6 }),
      tab(4, { splitViewId: 6 }),
      tab(5, { splitViewId: -1 }),
    ],
  });

  assert.deepEqual(result, { archive: [3, 4, 5], closeOnly: [] });
});

test('empty pages close without archiving; a loading tab with a pendingUrl is not empty', () =>
{
  const result = select({
    tabs: [
      tab(1, { url: 'chrome://newtab/' }),
      tab(2, { url: 'about:blank' }),
      tab(3, { url: '' }),
      tab(4, { url: '', pendingUrl: 'https://loading.test/' }),
    ],
  });

  assert.deepEqual(result, { archive: [4], closeOnly: [1, 2, 3] });
});

test('switching on from Never gives every tab one full period', () =>
{
  const tabs = [tab(1), tab(2, { url: 'about:blank' })];
  const enabledAt = NOW - PERIOD / 2;

  assert.deepEqual(select({ tabs, enabledAt }), { archive: [], closeOnly: [] });
  assert.deepEqual(select({ tabs, enabledAt, now: enabledAt + PERIOD }), { archive: [1], closeOnly: [2] });
});

test('a tab closes exactly when one period has passed since its last use', () =>
{
  const result = select({
    tabs: [tab(1), tab(2)],
    lastUsedAt: { 1: NOW - PERIOD, 2: NOW - PERIOD + 1 },
  });

  assert.deepEqual(result, { archive: [1], closeOnly: [] });
});

test('a tab that changed after the run judged it stays open', () =>
{
  const runStartedAt = NOW;
  const snapshot = tab(1, { lastAccessed: LONG_AGO });

  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot }, runStartedAt), false);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, active: true }, runStartedAt), true);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, audible: true }, runStartedAt), true);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, pinned: true }, runStartedAt), true);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, lastAccessed: runStartedAt }, runStartedAt), true);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, url: 'https://other.test/' }, runStartedAt), true);
  assert.equal(tabChangedDuringRun(snapshot, { ...snapshot, splitViewId: 3 }, runStartedAt), true);
});
