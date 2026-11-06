import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchCandidates, SEARCH_RESULT_LIMIT } from '../src/services/searchResults.ts';
import { BookmarkRecency } from '../src/stores/bookmarkRecencyStore.ts';

const ORIGIN = 10;
const OTHER_WINDOW = 20;

const tab = (id, windowId, lastAccessed, extra = {}) => ({
  id,
  windowId,
  lastAccessed,
  title: `Tab ${id}`,
  url: `https://tab${id}.test/`,
  active: false,
  incognito: false,
  ...extra,
});
const page = (id, title, url, extra = {}) => ({ id, title, url, ...extra });
const folder = (id, title, children) => ({ id, title, children });
const space = (id, segments) => ({
  id,
  name: id,
  icon: 'Folder',
  color: 'blue',
  bookmarkFolderPath: segments.join('/'),
  bookmarkFolderSegments: segments,
});
const closed = (id, closedAt) => ({ id, url: `https://closed-${id}.test/`, title: `Closed ${id}`, closedAt });

function candidates(overrides = {})
{
  return SearchCandidates.build({
    originWindowId: ORIGIN,
    originActiveTabId: undefined,
    originIncognito: false,
    activeSpaceId: undefined,
    spaces: [],
    tabs: [],
    spaceOf: () => undefined,
    associations: new Map(),
    bookmarkRoots: [],
    recency: BookmarkRecency.EMPTY,
    closedRecords: () => [],
    ...overrides,
  });
}

const ids = (items) => items.map(item => item.id);
const search = (list, query = {}) => ids(list.search({ text: '', scope: 'all', allSpaces: false, ...query }));
const sorted = (values) => [...values].sort();

// Two Spaces with their own folders, archives and closed tabs. Tab 1 is the origin's active tab and the
// Arc tab of the Work bookmark "wcur".
function twoSpaces()
{
  const roots = [
    folder('acct-bar', 'Bookmarks Bar', [
      folder('work', 'Work', [
        page('wb', 'Work wiki', 'https://wiki.work.test/'),
        page('wcur', 'Current page', 'https://tab1.test/'),
        folder('work-archive', 'asd_Archive', [page('wa', 'Old work', 'https://old.work.test/', { dateAdded: 5 })]),
      ]),
      folder('home', 'Home', [
        page('hb', 'Recipes', 'https://recipes.home.test/'),
        folder('home-archive', 'asd_Archive', [page('ha', 'Old home', 'https://old.home.test/', { dateAdded: 6 })]),
      ]),
    ]),
  ];
  const spaceOfTab = { 1: 'work', 2: 'work', 3: 'home', 4: 'work', 5: 'work' };

  return candidates({
    originActiveTabId: 1,
    activeSpaceId: 'work',
    spaces: [space('work', ['Bookmarks Bar', 'Work']), space('home', ['Bookmarks Bar', 'Home'])],
    tabs: [
      tab(1, ORIGIN, 900, { active: true }),
      tab(2, ORIGIN, 800),
      tab(3, ORIGIN, 700),
      tab(4, OTHER_WINDOW, 600, { active: true }),
      tab(5, ORIGIN, 500, { incognito: true }),
    ],
    spaceOf: (_windowId, tabId) => spaceOfTab[tabId],
    associations: new Map([[ORIGIN, { 1: 'bookmark-wcur' }]]),
    bookmarkRoots: roots,
    closedRecords: (spaceId) => ({ work: [closed('r1', 10)], home: [closed('r2', 20)] })[spaceId] ?? [],
  });
}

test('This Space lists the origin window\'s tabs of the active Space and that Space\'s bookmarks, archive and closed tabs', () =>
{
  const list = twoSpaces();

  assert.deepEqual(sorted(search(list)), sorted(['t:10:2', 'b:wb', 'a:wa', 'c:work:r1']));
});

test('All Spaces adds the other Spaces and the tabs of other windows', () =>
{
  const list = twoSpaces();

  assert.deepEqual(sorted(search(list, { allSpaces: true })), sorted([
    't:10:2', 't:10:3', 't:20:4',
    'b:wb', 'b:hb',
    'a:wa', 'a:ha',
    'c:work:r1', 'c:home:r2',
  ]));
});

test('the current tab, its bookmark and tabs of the other incognito mode are never results', () =>
{
  const list = twoSpaces();

  for (const scope of ['all', 'tabs', 'bookmarks'])
  {
    for (const allSpaces of [false, true])
    {
      const found = search(list, { scope, allSpaces });
      assert.ok(!found.includes('t:10:1'), `${scope}/${allSpaces} lists the current tab`);
      assert.ok(!found.includes('b:wcur'), `${scope}/${allSpaces} lists the current tab's bookmark`);
      assert.ok(!found.includes('t:10:5'), `${scope}/${allSpaces} lists an incognito tab`);
    }
  }
  assert.equal(list.item('t:10:1'), undefined);
});

test('each scope keeps only its kind of item', () =>
{
  const list = twoSpaces();

  assert.deepEqual(search(list, { scope: 'tabs', allSpaces: true }), ['t:10:2', 't:10:3', 't:20:4']);
  assert.deepEqual(sorted(search(list, { scope: 'bookmarks', allSpaces: true })), ['b:hb', 'b:wb']);
  assert.deepEqual(search(list, { scope: 'archive', allSpaces: true }), ['a:ha', 'a:wa']);
  assert.deepEqual(search(list, { scope: 'closed', allSpaces: true }), ['c:home:r2', 'c:work:r1']);
});

// Dev's folder holds Sub, another Space's folder; Shared is the folder of two Spaces. Root ids are not
// Chrome's legacy '1'/'2'/'3', as with account bookmarks.
const nestedTree = [
  folder('acct-bar', 'Bookmarks Bar', [
    folder('dev', 'Dev', [
      page('d1', 'Dev docs', 'https://docs.dev.test/'),
      folder('deep', 'Deep', [
        folder('deep-archive', 'asd_Archive', [page('deep-archived', 'Deep archived', 'https://deep.test/')]),
      ]),
      folder('dev-favorites', 'asd_Favorites', [page('fav1', 'Favorite', 'https://fav.test/')]),
      folder('sub', 'Sub', [
        page('s1', 'Sub page', 'https://sub.test/'),
        folder('sub-archive', 'asd_Archive', [page('sa1', 'Sub archived', 'https://sub-archived.test/')]),
      ]),
      folder('dev-archive', 'asd_Archive', [
        page('da1', 'Dev archived', 'https://dev-archived.test/'),
        folder('saved', 'Saved', [page('da2', 'Saved archived', 'https://saved-archived.test/')]),
      ]),
    ]),
    folder('shared', 'Shared', [
      page('sh1', 'Shared page', 'https://shared.test/'),
      folder('shared-archive', 'asd_Archive', [page('sha1', 'Shared archived', 'https://shared-archived.test/')]),
    ]),
  ]),
  folder('acct-other', 'Other Bookmarks', []),
];

const DEV = space('dev', ['Bookmarks Bar', 'Dev']);
const SUB = space('sub', ['Bookmarks Bar', 'Dev', 'Sub']);
const SHARED_A = space('shared-a', ['Bookmarks Bar', 'Shared']);
const SHARED_B = space('shared-b', ['Bookmarks Bar', 'Shared']);

const spaceOfEach = (list, rowIds) => Object.fromEntries(rowIds.map(id => [id, list.item(id)?.spaceId]));

test('system folders at any depth hold no bookmark results, and archive items come only from a Space\'s own asd_Archive', () =>
{
  const list = candidates({ activeSpaceId: 'dev', spaces: [DEV, SUB, SHARED_A, SHARED_B], bookmarkRoots: nestedTree });

  const found = search(list, { allSpaces: true });
  assert.deepEqual(sorted(found), sorted(['b:d1', 'b:s1', 'a:da1', 'a:da2', 'a:sa1', 'b:sh1', 'a:sha1']));
  for (const hidden of ['b:fav1', 'b:deep-archived', 'a:deep-archived', 'b:da1', 'b:sa1', 'b:sha1'])
  {
    assert.ok(!found.includes(hidden), `${hidden} is listed`);
  }
});

test('a bookmark in a folder nested under two Spaces\' folders belongs to the first Space in the list', () =>
{
  const devFirst = candidates({ activeSpaceId: 'dev', spaces: [DEV, SUB], bookmarkRoots: nestedTree });
  assert.deepEqual(spaceOfEach(devFirst, ['b:d1', 'b:s1', 'a:da1', 'a:sa1']), {
    'b:d1': 'dev', 'b:s1': 'dev', 'a:da1': 'dev', 'a:sa1': 'sub',
  });

  const subFirst = candidates({ activeSpaceId: 'dev', spaces: [SUB, DEV], bookmarkRoots: nestedTree });
  assert.deepEqual(spaceOfEach(subFirst, ['b:d1', 'b:s1', 'a:da1', 'a:sa1']), {
    'b:d1': 'dev', 'b:s1': 'sub', 'a:da1': 'dev', 'a:sa1': 'sub',
  });
  // This Space follows the owner: Dev no longer lists Sub's page
  assert.deepEqual(sorted(search(subFirst, { scope: 'bookmarks' })), ['b:d1']);
});

test('a folder and asd_Archive two Spaces share belong to the first Space only', () =>
{
  const list = candidates({ activeSpaceId: 'shared-b', spaces: [SHARED_A, SHARED_B], bookmarkRoots: nestedTree });

  const all = search(list, { allSpaces: true });
  assert.deepEqual(sorted(all), ['a:sha1', 'b:sh1']);
  assert.deepEqual(spaceOfEach(list, all), { 'a:sha1': 'shared-a', 'b:sh1': 'shared-a' });
  assert.deepEqual(search(list), []);
});

function timedSpace(overrides = {})
{
  const roots = [
    folder('acct-bar', 'Bookmarks Bar', [
      folder('work', 'Work', [
        page('b1', 'Alpha wiki', 'https://alpha.test/'),
        page('b2', 'Beta board', 'https://beta.test/', { dateLastUsed: 300 }),
        page('b3', 'Gamma notes (draft)', 'https://gamma.test/'),
        page('b4', 'Delta', 'https://example.org/delta'),
        folder('work-archive', 'asd_Archive', [page('a1', 'Archived alpha', 'https://archived.test/', { dateAdded: 600 })]),
      ]),
    ]),
  ];
  return candidates({
    activeSpaceId: 'work',
    spaces: [space('work', ['Bookmarks Bar', 'Work'])],
    tabs: [tab(2, ORIGIN, 500), tab(3, ORIGIN, undefined)],
    spaceOf: () => 'work',
    bookmarkRoots: roots,
    recency: new BookmarkRecency({ b1: 700, b2: 100 }),
    closedRecords: () => [closed('r1', 400)],
    ...overrides,
  });
}

test('results are newest last access first across kinds, and items without a time go last in collection order', () =>
{
  // b1 by its Arc tab's recency, b2 by recency over Chrome's dateLastUsed, a1 by dateAdded, r1 by closedAt;
  // tab 3, b3 and b4 have no time
  assert.deepEqual(search(timedSpace()),
    ['b:b1', 'a:a1', 't:10:2', 'c:work:r1', 'b:b2', 't:10:3', 'b:b3', 'b:b4']);

  // Without recency Chrome's dateLastUsed is the bookmark's time
  const chromeTimes = timedSpace({ recency: BookmarkRecency.EMPTY });
  assert.deepEqual(search(chromeTimes, { scope: 'bookmarks' }), ['b:b2', 'b:b1', 'b:b3', 'b:b4']);
});

test('at most 20 results, the newest ones', () =>
{
  const pages = Array.from({ length: 25 }, (_, i) => page(`p${i}`, `Page ${i}`, `https://p${i}.test/`));
  const recency = new BookmarkRecency(Object.fromEntries(pages.map((p, i) => [p.id, 1000 + i])));
  const list = candidates({
    activeSpaceId: 'work',
    spaces: [space('work', ['Bookmarks Bar', 'Work'])],
    bookmarkRoots: [folder('acct-bar', 'Bookmarks Bar', [folder('work', 'Work', pages)])],
    recency,
  });

  const found = search(list);
  assert.equal(SEARCH_RESULT_LIMIT, 20);
  assert.equal(found.length, 20);
  assert.equal(found[0], 'b:p24');
  assert.equal(found[19], 'b:p5');
});

test('the text matches title and URL, with the sidebar\'s search syntax and its literal fallback', () =>
{
  const list = timedSpace();

  assert.deepEqual(search(list, { text: 'WIKI' }), ['b:b1']);
  assert.deepEqual(search(list, { text: 'example.org' }), ['b:b4']);
  assert.deepEqual(search(list, { text: 'beta || gamma' }), ['b:b2', 'b:b3']);
  assert.deepEqual(search(list, { text: 'alpha !archived' }), ['b:b1']);
  // "(draft" doesn't parse, so it is matched as written
  assert.deepEqual(search(list, { text: '(draft' }), ['b:b3']);
  assert.deepEqual(search(list, { text: '   ' }).length, 8);
});

test('a bookmark whose Arc tab is a listed tab row is dropped only in the All scope', () =>
{
  const list = timedSpace({
    tabs: [tab(2, ORIGIN, 500), tab(7, OTHER_WINDOW, 450)],
    associations: new Map([[ORIGIN, { 2: 'bookmark-b1' }], [OTHER_WINDOW, { 7: 'bookmark-b2' }]]),
  });

  const thisSpace = search(list);
  assert.ok(thisSpace.includes('t:10:2') && !thisSpace.includes('b:b1'));
  // b2's Arc tab is in another window, which This Space doesn't list
  assert.ok(thisSpace.includes('b:b2'));

  const allSpaces = search(list, { allSpaces: true });
  assert.ok(allSpaces.includes('t:20:7') && !allSpaces.includes('b:b2'));

  assert.ok(search(list, { scope: 'bookmarks' }).includes('b:b1'));
  assert.ok(search(list, { scope: 'bookmarks', allSpaces: true }).includes('b:b2'));
  // A tab the text filters out doesn't hide its bookmark
  assert.deepEqual(search(list, { text: 'alpha.test' }), ['b:b1']);
});

test('without Spaces This Space is every tab of the origin window, and there are no bookmarks', () =>
{
  const list = candidates({
    originActiveTabId: 1,
    tabs: [tab(1, ORIGIN, 900, { active: true }), tab(2, ORIGIN, 800), tab(3, ORIGIN, 700), tab(4, OTHER_WINDOW, 600)],
    bookmarkRoots: nestedTree,
  });

  assert.deepEqual(search(list), ['t:10:2', 't:10:3']);
  assert.deepEqual(search(list, { allSpaces: true }), ['t:10:2', 't:10:3', 't:20:4']);
});
