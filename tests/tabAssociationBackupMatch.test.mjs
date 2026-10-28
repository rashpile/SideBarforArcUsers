import assert from 'node:assert/strict';
import test from 'node:test';

import { matchBackupWindows } from '../src/utils/tabAssociations.ts';
import { mergeRestoredTabAssociations } from '../src/utils/restoreTabAssociations.ts';

// A current window; each tab is [id, url] and gets its position as index
const liveWindow = (id, tabs) => ({ id, tabs: tabs.map(([tabId, url], index) => ({ id: tabId, url, index })) });

// A backup entry: the tab ID, URL and index the association was saved with
const entry = (tabId, url, tabIndex) => ({ tabId, url, tabIndex });

// Run the matcher over backups given as { [windowId]: { [itemKey]: entry } }. By default the
// stored IDs may come from an earlier browser session (browser restart, extension reload/update).
function match(backups, windows, { sameBrowserSession = false } = {})
{
  const backupMap = new Map(Object.entries(backups).map(([id, backup]) => [Number(id), backup]));
  return matchBackupWindows([...backupMap.keys()], backupMap, windows, { sameBrowserSession });
}

// A worker restart within the browser session that wrote the backup: IDs are exact
const SAME_SESSION = { sameBrowserSession: true };

test('extension reload: every entry keeps its tab by ID, also after navigating within its site', () =>
{
  const result = match(
    {
      1: {
        'pinned-mail': entry(10, 'https://mail.test/inbox', 0),
        'bookmark-docs': entry(11, 'https://docs.test/start', 1),
      },
    },
    [liveWindow(1, [[10, 'https://mail.test/inbox'], [11, 'https://docs.test/other']])]
  );

  assert.deepEqual(result.get(1), {
    currentId: 1,
    matchType: 'direct',
    tabMatches: { 'pinned-mail': 10, 'bookmark-docs': 11 },
  });
});

test('browser restart: a reused window ID with new tab IDs at the same indices is restored by index and domain', () =>
{
  // Tab 40 is gone and tab ID 2 now belongs to a page of another site
  const result = match(
    {
      1: {
        'pinned-mail': entry(40, 'https://mail.test/mail/u/0/', 0),
        'bookmark-docs': entry(2, 'https://docs.test/start', 1),
      },
    },
    [liveWindow(1, [[1, 'https://mail.test/mail/u/0/#inbox'], [3, 'https://docs.test/start'], [2, 'https://news.test/']])]
  );

  assert.deepEqual(result.get(1), {
    currentId: 1,
    matchType: 'index+domain',
    tabMatches: { 'pinned-mail': 1, 'bookmark-docs': 3 },
  });
});

test('browser restart: a backup whose old window ID now belongs to another window goes to the window with its tabs', () =>
{
  const result = match(
    {
      1: {
        'pinned-mail': entry(7, 'https://mail.test/', 0),
        'bookmark-docs': entry(8, 'https://docs.test/', 1),
      },
      5: {
        'bookmark-news': entry(9, 'https://news.test/', 0),
      },
    },
    [
      liveWindow(1, [[1, 'https://news.test/']]),
      liveWindow(2, [[2, 'https://mail.test/'], [3, 'https://docs.test/']]),
    ]
  );

  assert.deepEqual(result.get(1), {
    currentId: 2,
    matchType: 'index+domain',
    tabMatches: { 'pinned-mail': 2, 'bookmark-docs': 3 },
  });
  assert.deepEqual(result.get(5), {
    currentId: 1,
    matchType: 'index+domain',
    tabMatches: { 'bookmark-news': 1 },
  });
});

test('browser restart: entries rejected for another site are restored by domain when the tabs moved', () =>
{
  // Tab ID 1 is on its entry's site by chance; tab ID 2 is on another site, and the indices shifted
  const result = match(
    {
      1: {
        'pinned-mail': entry(1, 'https://mail.test/mail/u/0/', 1),
        'bookmark-docs': entry(2, 'https://docs.test/start', 0),
      },
    },
    [liveWindow(1, [[1, 'https://mail.test/mail/u/0/#inbox'], [2, 'https://news.test/'], [3, 'https://docs.test/start']])]
  );

  assert.deepEqual(result.get(1), {
    currentId: 1,
    matchType: 'domain',
    tabMatches: { 'pinned-mail': 1, 'bookmark-docs': 3 },
  });
});

test('extension reload with a stale entry: the other entries keep their tabs by ID, not the first tab of their domain', () =>
{
  // Tab 12 was closed or dragged to another window while the extension was not running
  const result = match(
    {
      1: {
        'pinned-mail': entry(10, 'https://mail.test/', 0),
        'bookmark-docs': entry(11, 'https://docs.test/b', 2),
        'bookmark-news': entry(12, 'https://news.test/', 3),
      },
    },
    [liveWindow(1, [[10, 'https://mail.test/'], [13, 'https://docs.test/a'], [11, 'https://docs.test/b']])]
  );

  assert.deepEqual(result.get(1), {
    currentId: 1,
    matchType: 'direct',
    tabMatches: { 'pinned-mail': 10, 'bookmark-docs': 11 },
  });
});

test('same browser session: closing the only bookmark tab while the worker slept hands its key to no other tab', () =>
{
  // Tab 12 (bookmark-42) was closed; tab 13 on the same domain shifted into its index
  const windows = [liveWindow(5, [[11, 'https://news.test/'], [13, 'https://github.com/other/thing']])];
  const result = match(
    { 5: { 'bookmark-42': entry(12, 'https://github.com/me/repo', 1) } },
    windows,
    SAME_SESSION
  );

  assert.deepEqual(result.get(5), { currentId: 5, matchType: 'direct', tabMatches: {} });

  // The session still lists the closed tab (onRemoved has not run yet); it is dropped, nothing replaces it
  const merged = mergeRestoredTabAssociations({ 12: 'bookmark-42' }, {}, new Set([11, 13]));
  assert.deepEqual(merged, {});
});

test('same browser session: a same-domain tab shifted into a closed tab\'s index does not take its key', () =>
{
  const result = match(
    {
      5: {
        'pinned-mail': entry(11, 'https://mail.test/', 0),
        'bookmark-42': entry(12, 'https://github.com/me/repo', 1),
      },
    },
    [liveWindow(5, [[11, 'https://mail.test/'], [13, 'https://github.com/other/thing']])],
    SAME_SESSION
  );

  assert.deepEqual(result.get(5), { currentId: 5, matchType: 'direct', tabMatches: { 'pinned-mail': 11 } });
});

test('same browser session: an entry keeps its tab by ID when its stored URL lags a move to another site', () =>
{
  // Tab 10 hit a sign-in redirect while the worker slept; tab 11 was stored before its page loaded
  const result = match(
    {
      1: {
        'pinned-mail': entry(10, 'https://outlook.test/mail/', 0),
        'bookmark-docs': entry(11, '', 1),
      },
    },
    [liveWindow(1, [[10, 'https://login.test/sso'], [11, 'https://docs.test/start'], [12, 'https://outlook.test/mail/']])],
    SAME_SESSION
  );

  assert.deepEqual(result.get(1), {
    currentId: 1,
    matchType: 'direct',
    tabMatches: { 'pinned-mail': 10, 'bookmark-docs': 11 },
  });
});

test('browser restart: a Favorite whose index is stale goes to the tab on its exact page, not the first tab of its domain', () =>
{
  // A link opened left of the Favorite moved it from index 2 to 3; tab 2 is a regular tab on the same site
  const result = match(
    { 1: { 'pinned-gh': entry(57, 'https://github.com/org/repo', 2) } },
    [liveWindow(1, [
      [1, 'https://news.test/'],
      [2, 'https://github.com/org/repo/pull/7'],
      [3, 'https://mail.test/'],
      [4, 'https://github.com/org/repo'],
    ])]
  );

  assert.deepEqual(result.get(1), { currentId: 1, matchType: 'domain', tabMatches: { 'pinned-gh': 4 } });
});

test('browser restart: an entry placed by index or reused ID prefers the free tab on its exact page', () =>
{
  // Window 1: index 1 shows another page of the Favorite's site. Window 2: tab ID 2 was reused on that site.
  const result = match(
    {
      1: { 'pinned-gh': entry(57, 'https://github.com/org/repo', 1) },
      2: { 'pinned-docs': entry(2, 'https://docs.test/guide', 0) },
    },
    [
      liveWindow(1, [[1, 'https://news.test/'], [3, 'https://github.com/org/repo/pull/7'], [4, 'https://github.com/org/repo']]),
      liveWindow(2, [[2, 'https://docs.test/other'], [5, 'https://docs.test/guide']]),
    ]
  );

  assert.deepEqual(result.get(1), { currentId: 1, matchType: 'index+domain', tabMatches: { 'pinned-gh': 4 } });
  assert.deepEqual(result.get(2), { currentId: 2, matchType: 'direct', tabMatches: { 'pinned-docs': 5 } });
});

test('browser restart: without a tab on its exact page an entry takes the tab of its domain nearest its old index', () =>
{
  const result = match(
    { 1: { 'bookmark-docs': entry(50, 'https://docs.test/a', 3) } },
    [liveWindow(1, [[1, 'https://docs.test/b'], [2, 'https://news.test/'], [3, 'https://docs.test/c'], [4, 'https://mail.test/']])]
  );

  assert.deepEqual(result.get(1), { currentId: 1, matchType: 'domain', tabMatches: { 'bookmark-docs': 3 } });
});
