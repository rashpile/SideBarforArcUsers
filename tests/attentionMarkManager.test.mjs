import assert from 'node:assert/strict';
import test from 'node:test';

import { AttentionMarkManager } from '../src/managers/impl/attentionMarkManager.ts';
import { ATTENTION_MARKED_BOOKMARKS_KEY, ATTENTION_MARKED_TABS_KEY } from '../src/managers/shared/attentionMarkApi.ts';

const record = (tabId, windowId, url, index) => ({ tabId, windowId, url, index });
const tab = (id, windowId, url, index) => ({ id, windowId, url, index, incognito: false });

// Fake the chrome APIs the manager uses; returns the local storage area so tests can read it back
function installChrome({ stored = {}, liveTabs = [], bookmarkTree = [] })
{
  const local = { ...stored };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in local ? { [key]: local[key] } : {}),
        set: async (values) => { Object.assign(local, values); },
      },
    },
    tabs: {
      query: async (filter = {}) =>
        liveTabs.filter(live => filter.windowId === undefined || live.windowId === filter.windowId),
      get: async (tabId) =>
      {
        const live = liveTabs.find(candidate => candidate.id === tabId);
        if (!live) throw new Error(`No tab with id: ${tabId}`);
        return live;
      },
    },
    bookmarks: { getTree: async () => bookmarkTree },
    runtime: { sendMessage: async () => {} },
  };
  return local;
}

test('a browser-restart load stores the new tab IDs, so a later worker restart does not give the mark to a tab reusing the old ID', async () =>
{
  // Chrome reused ID 7 for an unrelated page; the marked page now has ID 2
  const liveTabs = [tab(7, 1, 'https://news.test/', 0), tab(2, 1, 'https://mail.test/inbox', 3)];
  const local = installChrome({
    stored: { [ATTENTION_MARKED_TABS_KEY]: [record(7, 1, 'https://mail.test/inbox', 3)] },
    liveTabs,
  });

  const afterBrowserRestart = new AttentionMarkManager();
  await afterBrowserRestart.load(false);

  assert.equal(afterBrowserRestart.isTabMarked(2), true);
  assert.equal(afterBrowserRestart.isTabMarked(7), false);
  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], [record(2, 1, 'https://mail.test/inbox', 3)]);

  const afterWorkerRestart = new AttentionMarkManager();
  await afterWorkerRestart.load(true);

  assert.equal(afterWorkerRestart.isTabMarked(2), true);
  assert.equal(afterWorkerRestart.isTabMarked(7), false);
});

test('a worker-restart load drops the mark of a tab closed while the worker slept instead of giving it to a tab on the same URL', async () =>
{
  // Tab 10 was marked and closed (on its own or with its window); tab 20 shows the same page
  const local = installChrome({
    stored: {
      [ATTENTION_MARKED_TABS_KEY]: [record(10, 2, 'https://mail.test/inbox', 0), record(8, 1, 'https://docs.test/', 1)],
    },
    liveTabs: [tab(20, 1, 'https://mail.test/inbox', 0), tab(8, 1, 'https://docs.test/', 1)],
  });

  const manager = new AttentionMarkManager();
  await manager.load(true);

  assert.equal(manager.isTabMarked(20), false);
  assert.deepEqual(manager.getState().tabIds, [8]);
  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], [record(8, 1, 'https://docs.test/', 1)]);
});

test('a tab closed with its window keeps its mark; a tab closed on its own loses it', async () =>
{
  const marked = [record(7, 1, 'https://mail.test/inbox', 0), record(8, 1, 'https://docs.test/', 1)];
  const local = installChrome({
    stored: { [ATTENTION_MARKED_TABS_KEY]: marked },
    liveTabs: [tab(7, 1, 'https://mail.test/inbox', 0), tab(8, 1, 'https://docs.test/', 1)],
  });
  const manager = new AttentionMarkManager();
  await manager.load(true);

  await manager.handleTabRemoved(7, true);

  assert.equal(manager.isTabMarked(7), true);
  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], marked);

  await manager.handleTabRemoved(8, false);

  assert.equal(manager.isTabMarked(8), false);
  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], [record(7, 1, 'https://mail.test/inbox', 0)]);
});

test('removing a bookmark folder drops the marks of the bookmarks nested in it', async () =>
{
  const bookmarkTree = [{
    id: '0',
    children: [
      { id: '5', children: [{ id: '10' }, { id: '6', children: [{ id: '11' }] }] },
      { id: '12' },
    ],
  }];
  const local = installChrome({
    stored: { [ATTENTION_MARKED_BOOKMARKS_KEY]: ['10', '11', '12'] },
    bookmarkTree,
  });
  const manager = new AttentionMarkManager();
  await manager.load(true);

  // bookmarks.onRemoved for folder 5: its id and every descendant's
  await manager.handleBookmarksRemoved(['5', '10', '6', '11']);

  assert.deepEqual(manager.getState().bookmarkIds, ['12']);
  assert.deepEqual(local[ATTENTION_MARKED_BOOKMARKS_KEY], ['12']);
});

test('after a malformed stored tab value, tab events leave it alone until the user marks a tab', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const malformed = [record(7, 1, 'https://mail.test/inbox', 0), { tabId: 'eight' }];
  const local = installChrome({
    stored: { [ATTENTION_MARKED_TABS_KEY]: malformed },
    liveTabs: [tab(7, 1, 'https://mail.test/inbox', 0), tab(9, 1, 'https://docs.test/', 1)],
  });
  const manager = new AttentionMarkManager();
  await manager.load(true);

  assert.equal(manager.tabMarksLoaded, false);

  await manager.handleTabRemoved(7, false);
  await manager.handleTabChanged(tab(9, 1, 'https://docs.test/page', 1));
  await manager.refreshWindowTabs(1);

  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], malformed);

  await manager.markTabs([9]);

  assert.equal(manager.tabMarksLoaded, true);
  assert.deepEqual(local[ATTENTION_MARKED_TABS_KEY], [record(9, 1, 'https://docs.test/', 1)]);
});
