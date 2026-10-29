import assert from 'node:assert/strict';
import test from 'node:test';

import { TabActivityTracker, TabActivityView } from '../src/stores/tabActivityTracker.ts';
import { isTabActivityRecording } from '../src/utils/tabAgeHighlight.ts';

const RECORDS_KEY = TabActivityTracker.RECORDS_KEY;
const ACTIVE_TABS_KEY = TabActivityTracker.ACTIVE_TABS_KEY;

class MemoryStorage
{
  data = {};

  async get(key)
  {
    return { [key]: structuredClone(this.data[key]) };
  }

  async set(values)
  {
    await Promise.resolve();
    Object.assign(this.data, structuredClone(values));
  }

  async remove(key)
  {
    await Promise.resolve();
    delete this.data[key];
  }
}

// One Chrome profile: local storage survives browser restarts, session storage only worker restarts
class Browser
{
  local = new MemoryStorage();
  session = new MemoryStorage();
  clock = 1000;
  // The three settings the background records for
  autoArchivePeriod = '12h';
  tabAgeHighlight = 'white';
  unvisitedTabMarker = 'off';
  #openTabs = new Map();

  // A fresh tracker instance, as after a service-worker restart
  tracker()
  {
    return new TabActivityTracker({
      local: this.local,
      session: this.session,
      isRecording: async () => isTabActivityRecording(this.autoArchivePeriod, this.tabAgeHighlight, this.unvisitedTabMarker),
      getTab: async (tabId) => this.#openTabs.get(tabId),
      now: () => this.clock,
    });
  }

  /** Make these the open tabs (what chrome.tabs.get finds) and return them. */
  open(tabs)
  {
    this.#openTabs = new Map(tabs.map(openTab => [openTab.id, openTab]));
    return tabs;
  }

  restart()
  {
    this.session = new MemoryStorage();
  }

  storedRecord(tabId)
  {
    return this.local.data[RECORDS_KEY]?.[tabId];
  }

  storedLastUsedAt(tabId)
  {
    return this.storedRecord(tabId)?.lastUsedAt;
  }

  storedLeftAt(tabId)
  {
    return this.storedRecord(tabId)?.leftAt;
  }
}

const tab = (id, windowId, url, index, active = false, fields = {}) =>
  ({ id, windowId, url, index, active, incognito: false, ...fields });

test('switching away stamps the tab left behind, not the new one; re-activating the same tab stamps nothing', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = browser.open([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);

  browser.clock = 5000;
  await tracker.markActivated(1, 2);
  browser.clock = 7000;
  await tracker.markActivated(1, 2);

  assert.equal(browser.storedLastUsedAt(1), 5000);
  assert.equal(browser.storedLastUsedAt(2), 1000);
});

test('after a worker restart the next activation still stamps the previously active tab', async () =>
{
  const browser = new Browser();
  const first = browser.tracker();
  const tabs = browser.open([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);
  await first.load(tabs);
  await first.refresh(tabs);

  // The worker wakes up on the activation itself: the live state already shows tab 2 active
  browser.clock = 5000;
  const second = browser.tracker();
  await second.load(browser.open([tab(1, 1, 'https://a.test/', 0), tab(2, 1, 'https://b.test/', 1, true)]));
  await second.markActivated(1, 2);

  assert.equal(browser.storedLastUsedAt(1), 5000);
  assert.equal(browser.storedLastUsedAt(2), 1000);
});

test('within a browser session records follow the tab ID: a navigated tab keeps its time, a new tab on a closed tab\'s URL gets none', async () =>
{
  const browser = new Browser();
  const first = browser.tracker();
  const tabs = [
    tab(1, 1, 'https://a.test/', 0, true),
    tab(2, 1, 'https://b.test/', 1),
    tab(3, 2, 'https://x.test/', 0, true),
  ];
  await first.load(tabs);
  await first.refresh(tabs);

  // Window 2 closed (its record stays until the next run); tab 2 navigated; tab 4 opened on x.test
  browser.clock = 5000;
  const liveTabs = [
    tab(1, 1, 'https://a.test/', 0, true),
    tab(2, 1, 'https://b2.test/', 1),
    tab(4, 1, 'https://x.test/', 2),
  ];
  const second = browser.tracker();
  await second.load(liveTabs);
  const activity = await second.refresh(liveTabs);

  assert.equal(activity.lastUsedAt(2), 1000);
  assert.equal(activity.lastUsedAt(4), 5000);
});

test('refresh starts the clock of active, audible, Chrome-pinned and first-seen tabs and drops closed ones', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = [
    tab(1, 1, 'https://a.test/', 0, true),
    tab(2, 1, 'https://b.test/', 1),
    tab(3, 1, 'https://c.test/', 2),
    tab(5, 1, 'https://music.test/', 3, false, { audible: true }),
    tab(6, 1, 'https://pinned.test/', 4, false, { pinned: true }),
  ];
  await tracker.load(tabs);
  await tracker.refresh(tabs);

  // Tab 3 closed, tab 4 opened and moved to the front
  browser.clock = 5000;
  const activity = await tracker.refresh([
    tab(4, 1, 'https://d.test/', 0),
    tab(1, 1, 'https://a.test/', 1, true),
    tab(2, 1, 'https://b.test/', 2),
    tab(5, 1, 'https://music.test/', 3, false, { audible: true }),
    tab(6, 1, 'https://pinned.test/', 4, false, { pinned: true }),
  ]);

  assert.equal(activity.lastUsedAt(1), 5000);
  assert.equal(activity.lastUsedAt(2), 1000);
  assert.equal(activity.lastUsedAt(4), 5000);
  assert.equal(activity.lastUsedAt(5), 5000);
  assert.equal(activity.lastUsedAt(6), 5000);
  assert.equal(activity.lastUsedAt(3), undefined);
  assert.equal(browser.storedLastUsedAt(3), undefined);
  assert.equal(browser.storedRecord(2).index, 2);
});

test('refresh restarts the clock of tabs sharing a split view with their window\'s active tab, so leaving the split view gives a full period', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const splitTabs = [
    tab(1, 1, 'https://a.test/', 0, true, { splitViewId: 7 }),
    tab(2, 1, 'https://b.test/', 1, false, { splitViewId: 7 }),
    tab(3, 1, 'https://c.test/', 2, false, { splitViewId: 8 }),
    tab(4, 1, 'https://d.test/', 3, false, { splitViewId: -1 }),
  ];
  await tracker.load(browser.open(splitTabs));
  await tracker.refresh(splitTabs);

  // The split view stays on screen overnight: only the companion of the active tab counts as in use
  browser.clock = 50000;
  const overnight = await tracker.refresh(splitTabs);
  assert.equal(overnight.lastUsedAt(2), 50000);
  assert.equal(overnight.lastUsedAt(3), 1000);
  assert.equal(overnight.lastUsedAt(4), 1000);

  // In the morning the user switches to tab 4: the split view is no longer on screen
  browser.clock = 51000;
  const leftSplitView = browser.open([
    tab(1, 1, 'https://a.test/', 0, false, { splitViewId: 7 }),
    tab(2, 1, 'https://b.test/', 1, false, { splitViewId: 7 }),
    tab(3, 1, 'https://c.test/', 2, false, { splitViewId: 8 }),
    tab(4, 1, 'https://d.test/', 3, true, { splitViewId: -1 }),
  ]);
  await tracker.markActivated(1, 4);
  browser.clock = 52000;
  const activity = await tracker.refresh(leftSplitView);

  assert.equal(activity.lastUsedAt(1), 51000);
  assert.equal(activity.lastUsedAt(2), 50000);
  assert.equal(activity.lastUsedAt(4), 52000);
});

test('leaving a tab records its current page, also for a tab without a record; a closed tab gets none', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = browser.open([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);

  // Tab 1 navigated before the user left it; tab 3 opened after the last refresh
  browser.clock = 3000;
  browser.open([tab(1, 1, 'https://a2.test/', 0), tab(2, 1, 'https://b.test/', 1), tab(3, 1, 'https://c.test/', 2)]);
  await tracker.markActivated(1, 3);
  browser.clock = 4000;
  await tracker.markActivated(1, 2);

  assert.deepEqual(browser.storedRecord(1), { windowId: 1, url: 'https://a2.test/', index: 0, lastUsedAt: 3000, leftAt: 3000 });
  assert.equal(browser.storedLastUsedAt(3), 4000);

  // Tab 2 closed before its activation event was handled
  browser.open([tab(1, 1, 'https://a2.test/', 0), tab(3, 1, 'https://c.test/', 2)]);
  await tracker.forget(2);
  await tracker.markActivated(1, 1);
  assert.equal(browser.storedRecord(2), undefined);
});

test('after a browser restart records follow their URL, so a reused tab ID gets no old record', async () =>
{
  const browser = new Browser();
  const before = browser.tracker();
  const tabs = [
    tab(4, 1, 'https://home.test/', 0, true),
    tab(5, 1, 'https://a.test/', 1),
    tab(6, 1, 'https://b.test/', 2),
  ];
  await before.load(tabs);
  await before.refresh(tabs);

  // Chrome hands out IDs from a low counter again: ID 5 in window 1 now holds another page, a.test came back as ID 2
  browser.restart();
  browser.clock = 9000;
  const after = browser.tracker();
  const restoredTabs = [
    tab(1, 1, 'https://home.test/', 0, true),
    tab(5, 1, 'https://c.test/', 1),
    tab(2, 1, 'https://a.test/', 2),
  ];
  await after.load(restoredTabs);
  const activity = await after.refresh(restoredTabs);

  assert.equal(activity.lastUsedAt(2), 1000);
  assert.equal(activity.lastUsedAt(5), 9000);
});

test('after a browser restart tabs on a URL shared by several records get the newest last use', async () =>
{
  const browser = new Browser();
  const before = browser.tracker();
  // The same page open at the same position in two windows
  const tabs = browser.open([
    tab(1, 1, 'https://home.test/', 0, true),
    tab(2, 1, 'https://mail.test/', 1),
    tab(3, 2, 'https://home.test/', 0, true),
    tab(4, 2, 'https://mail.test/', 1),
  ]);
  await before.load(tabs);
  await before.refresh(tabs);

  // Only window 2's copy was used again later
  browser.clock = 5000;
  await before.markActivated(2, 4);
  await before.markActivated(2, 3);

  // Window IDs changed, so nothing tells which copy is which
  browser.restart();
  browser.clock = 9000;
  const after = browser.tracker();
  const restoredTabs = [
    tab(1, 10, 'https://home.test/', 0, true),
    tab(2, 10, 'https://mail.test/', 1),
    tab(3, 11, 'https://home.test/', 0, true),
    tab(4, 11, 'https://mail.test/', 1),
  ];
  await after.load(restoredTabs);
  const activity = await after.refresh(restoredTabs);

  assert.equal(activity.lastUsedAt(2), 5000);
  assert.equal(activity.lastUsedAt(4), 5000);
});

test('only leaving a tab sets leftAt; refresh keeps it, also for a tab in use again, and never invents one', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = browser.open([
    tab(1, 1, 'https://a.test/', 0, true),
    tab(2, 1, 'https://b.test/', 1),
    tab(3, 1, 'https://music.test/', 2, false, { audible: true }),
  ]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);

  browser.clock = 5000;
  await tracker.markActivated(1, 2);
  assert.equal(browser.storedLeftAt(1), 5000);
  assert.equal(browser.storedLeftAt(2), undefined);

  // Tab 1 now plays audio (its auto-archive clock restarts); tab 4 is seen for the first time
  browser.clock = 9000;
  await tracker.refresh([
    tab(1, 1, 'https://a.test/', 0, false, { audible: true }),
    tab(2, 1, 'https://b.test/', 1, true),
    tab(3, 1, 'https://music.test/', 2, false, { audible: true }),
    tab(4, 1, 'https://d.test/', 3),
  ]);
  assert.equal(browser.storedLastUsedAt(1), 9000);
  assert.equal(browser.storedLeftAt(1), 5000);
  assert.equal(browser.storedLeftAt(2), undefined);
  assert.equal(browser.storedLeftAt(3), undefined);
  assert.deepEqual(browser.storedRecord(4), { windowId: 1, url: 'https://d.test/', index: 3, lastUsedAt: 9000 });
});

test('after a browser restart records stored without leftAt still load, and tabs on a shared URL keep their own leftAt', async () =>
{
  const browser = new Browser();
  // home.test stored before leftAt existed; mail.test open in two windows, left at different times
  browser.local.data[RECORDS_KEY] = {
    1: { windowId: 1, url: 'https://home.test/', index: 0, lastUsedAt: 100 },
    2: { windowId: 1, url: 'https://mail.test/', index: 1, lastUsedAt: 300, leftAt: 300 },
    3: { windowId: 2, url: 'https://mail.test/', index: 1, lastUsedAt: 500, leftAt: 200 },
  };

  // No session marker: a new browser session, the tabs came back with new IDs
  browser.clock = 9000;
  const tracker = browser.tracker();
  await tracker.load([
    tab(7, 10, 'https://home.test/', 0, true),
    tab(8, 10, 'https://mail.test/', 1),
    tab(9, 11, 'https://mail.test/', 1, true),
  ]);

  // Auto-archive judges both copies by the newest last use; the highlight keeps each copy's own leave
  assert.deepEqual(browser.storedRecord(7), { windowId: 10, url: 'https://home.test/', index: 0, lastUsedAt: 100 });
  assert.equal(browser.storedLastUsedAt(8), 500);
  assert.equal(browser.storedLastUsedAt(9), 500);
  assert.equal(browser.storedLeftAt(8), 300);
  assert.equal(browser.storedLeftAt(9), 200);

  const view = TabActivityView.fromStored(browser.local.data[RECORDS_KEY]);
  assert.equal(view.leftAt(8), 300);
  assert.equal(view.leftAt(7), undefined);
  assert.equal(view.isUnvisited(7), false);
  assert.ok(!('unvisited' in browser.storedRecord(7)));
});

test('TabActivityView refuses unreadable records, as the tracker does', () =>
{
  // One entry whose leftAt is not a number spoils the valid one next to it
  const unreadableValues = [
    {
      1: { windowId: 1, url: 'https://a.test/', index: 0, lastUsedAt: 1, leftAt: 1 },
      2: { windowId: 1, url: 'https://b.test/', index: 1, lastUsedAt: 1, leftAt: 'yesterday' },
    },
    // unvisited is true or absent
    { 1: { windowId: 1, url: 'https://a.test/', index: 0, lastUsedAt: 1, unvisited: false } },
    '{not json',
    null,
  ];
  for (const stored of unreadableValues)
  {
    assert.throws(() => TabActivityView.fromStored(stored));
  }
  assert.equal(TabActivityView.fromStored(undefined).leftAt(1), undefined);
});

test('incognito tabs are never recorded', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = browser.open([
    tab(1, 1, 'https://a.test/', 0, true),
    tab(9, 1, 'https://secret.test/', 1, false, { incognito: true }),
  ]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);
  await tracker.markActivated(1, 9);
  await tracker.markActivated(1, 1);

  assert.equal(browser.storedRecord(9), undefined);
  assert.ok(!JSON.stringify(browser.local.data).includes('secret.test'));
});

test('records are kept while auto-archive or the highlight is on; with all three settings off they are dropped and nothing is recorded until one is on again', async () =>
{
  const browser = new Browser();
  browser.tabAgeHighlight = 'off';
  const tracker = browser.tracker();
  const tabs = browser.open([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);
  assert.equal(browser.storedLastUsedAt(2), 1000);

  // Auto-archive switched to Never with the highlight on: the archiver reloads, the records stay
  // and leaving a tab is still recorded
  browser.autoArchivePeriod = 'never';
  browser.tabAgeHighlight = 'white';
  await tracker.load(tabs);
  assert.equal(browser.storedLastUsedAt(2), 1000);
  browser.clock = 2000;
  await tracker.markActivated(1, 2);
  assert.equal(browser.storedLeftAt(1), 2000);

  // A look change (or a worker restart) reloads: leftAt stays as it is and none is invented
  browser.tabAgeHighlight = 'accent';
  await tracker.load(tabs);
  assert.equal(browser.storedLeftAt(1), 2000);
  assert.equal(browser.storedLeftAt(2), undefined);

  // The highlight switched off too: the background reloads, everything is dropped
  browser.tabAgeHighlight = 'off';
  await tracker.load(tabs);
  await tracker.markActivated(1, 1);
  assert.ok(!(RECORDS_KEY in browser.local.data));
  assert.ok(!(ACTIVE_TABS_KEY in browser.session.data));

  // A worker start while both are off drops records left from before
  browser.local.data[RECORDS_KEY] = { 2: { windowId: 1, url: 'https://b.test/', index: 1, lastUsedAt: 1 } };
  const restarted = browser.tracker();
  await restarted.load(tabs);
  assert.ok(!(RECORDS_KEY in browser.local.data));

  // Auto-archive switched on again: the archiver loads the open tabs, every clock starts now
  browser.autoArchivePeriod = '12h';
  browser.clock = 5000;
  await restarted.load(tabs);
  const activity = await restarted.refresh(tabs);
  assert.equal(activity.lastUsedAt(2), 5000);

  browser.clock = 6000;
  await restarted.markActivated(1, 2);
  assert.equal(browser.storedLastUsedAt(1), 6000);
});

test('refresh refuses to judge until load matched the records; the queue keeps working after a rejection', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const tabs = [tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)];

  // Never loaded in this worker
  const browser = new Browser();
  const tracker = browser.tracker();
  await assert.rejects(tracker.refresh(tabs), /load failed/);
  await tracker.markActivated(1, 1);
  assert.deepEqual(browser.session.data[ACTIVE_TABS_KEY], { 1: 1 });
  await tracker.load(tabs);
  await tracker.refresh(tabs);
  assert.equal(browser.storedLastUsedAt(2), 1000);

  // Load failed: storage can't be read
  const failing = { get: async () => { throw new Error('storage down'); }, set: async () => {}, remove: async () => {} };
  const broken = new TabActivityTracker({
    local: failing,
    session: failing,
    isRecording: async () => true,
    getTab: async () => undefined,
  });
  await broken.load(tabs);
  await assert.rejects(broken.refresh(tabs), /load failed/);
});

test('one malformed stored entry makes the whole value unreadable: every clock starts at first sight', async (t) =>
{
  const errors = t.mock.method(console, 'error', () => {});
  const tabs = [
    tab(1, 1, 'https://a.test/', 0),
    tab(2, 1, 'https://b.test/', 1),
    tab(3, 1, 'https://c.test/', 2, true),
  ];

  // A valid record next to one whose last use is not a number, and a value that isn't a record map
  const storedValues = [
    {
      1: { windowId: 1, url: 'https://a.test/', index: 0, lastUsedAt: 1 },
      2: { windowId: 1, url: 'https://b.test/', index: 1, lastUsedAt: null },
    },
    '{not json',
  ];
  for (const stored of storedValues)
  {
    const browser = new Browser();
    browser.local.data[RECORDS_KEY] = stored;
    browser.clock = 5000;
    const tracker = browser.tracker();

    await tracker.load(tabs);
    const activity = await tracker.refresh(tabs);
    assert.equal(activity.lastUsedAt(1), 5000);
    assert.equal(activity.lastUsedAt(2), 5000);
  }
  assert.ok(errors.mock.callCount() >= 2);
});

test('events arriving together are applied one after another', async () =>
{
  const browser = new Browser();
  const tracker = browser.tracker();
  const tabs = browser.open([
    tab(1, 1, 'https://a.test/', 0, true),
    tab(2, 1, 'https://b.test/', 1),
    tab(3, 2, 'https://c.test/', 0, true),
    tab(4, 2, 'https://d.test/', 1),
  ]);
  await tracker.load(tabs);
  await tracker.refresh(tabs);

  // Activations in two windows at the same moment
  browser.clock = 5000;
  await Promise.all([tracker.markActivated(1, 2), tracker.markActivated(2, 4)]);

  assert.equal(browser.storedLastUsedAt(1), 5000);
  assert.equal(browser.storedLastUsedAt(3), 5000);
  assert.deepEqual(browser.session.data[ACTIVE_TABS_KEY], { 1: 2, 2: 4 });
});

// A Browser recording only for the unvisited marker, with its tracker loaded on these tabs
async function markerOnly(tabs)
{
  const browser = new Browser();
  browser.autoArchivePeriod = 'never';
  browser.tabAgeHighlight = 'off';
  browser.unvisitedTabMarker = 'on';
  const tracker = browser.tracker();
  await tracker.load(browser.open(tabs));
  return { browser, tracker };
}

test('a tab opened in the background gets an unvisited record with no leftAt; nothing is written while not recording, before load or for incognito', async () =>
{
  const { browser, tracker } = await markerOnly([tab(1, 1, 'https://a.test/', 0, true)]);
  browser.clock = 3000;
  await tracker.markOpenedUnvisited(tab(2, 1, 'https://b.test/', 1));
  await tracker.markOpenedUnvisited(tab(3, 1, 'https://secret.test/', 2, false, { incognito: true }));

  assert.deepEqual(browser.storedRecord(2), { windowId: 1, url: 'https://b.test/', index: 1, lastUsedAt: 3000, unvisited: true });
  assert.equal(browser.storedRecord(3), undefined);
  assert.ok(TabActivityView.fromStored(browser.local.data[RECORDS_KEY]).isUnvisited(2));

  // All three settings off: the reload drops the records and nothing new is written
  browser.unvisitedTabMarker = 'off';
  await tracker.load(browser.open([tab(1, 1, 'https://a.test/', 0, true)]));
  await tracker.markOpenedUnvisited(tab(4, 1, 'https://c.test/', 1));
  await tracker.followUrl(tab(4, 1, 'https://c2.test/', 1));
  assert.ok(!(RECORDS_KEY in browser.local.data));

  // A worker whose load never ran (or failed) may hold records of a previous browser session
  const fresh = new Browser();
  fresh.unvisitedTabMarker = 'on';
  fresh.local.data[RECORDS_KEY] = { 5: { windowId: 1, url: 'https://old.test/', index: 0, lastUsedAt: 1 } };
  await fresh.tracker().markOpenedUnvisited(tab(5, 1, 'https://new.test/', 0));
  assert.deepEqual(fresh.storedRecord(5), { windowId: 1, url: 'https://old.test/', index: 0, lastUsedAt: 1 });
});

test('activating an unvisited tab clears its mark, whether the tab left behind is known, unknown or closed', async () =>
{
  const { browser, tracker } = await markerOnly([tab(1, 1, 'https://a.test/', 0, true)]);
  for (const id of [2, 3, 4, 5])
  {
    await tracker.markOpenedUnvisited(tab(id, 1, `https://t${id}.test/`, id - 1));
  }

  // Known previous tab: tab 1 is stamped as left, tab 2 loses its mark
  browser.open([tab(1, 1, 'https://a.test/', 0), tab(2, 1, 'https://t2.test/', 1, true)]);
  browser.clock = 2000;
  await tracker.markActivated(1, 2);
  assert.equal(browser.storedLeftAt(1), 2000);
  assert.equal(browser.storedRecord(2).unvisited, undefined);
  assert.equal(browser.storedRecord(3).unvisited, true);

  // Closed previous tab: the active tab (2) was closed, its neighbour 3 becomes active
  browser.open([tab(1, 1, 'https://a.test/', 0), tab(3, 1, 'https://t3.test/', 1, true)]);
  await tracker.forget(2);
  await tracker.markActivated(1, 3);
  assert.equal(browser.storedRecord(3).unvisited, undefined);

  // Unknown previous tab: the tab moved to a window whose active tab the background never saw
  await tracker.markActivated(7, 4);
  assert.equal(browser.storedRecord(4).unvisited, undefined);
  assert.equal(browser.storedRecord(5).unvisited, true);
});

test('leaving a tab clears its unvisited mark', async () =>
{
  const { browser, tracker } = await markerOnly([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);

  // The mark landed on the tab the user is on (its activation was handled before the mark)
  await tracker.markOpenedUnvisited(tab(1, 1, 'https://a.test/', 0, true));
  browser.clock = 2000;
  await tracker.markActivated(1, 2);

  assert.deepEqual(browser.storedRecord(1), { windowId: 1, url: 'https://a.test/', index: 0, lastUsedAt: 2000, leftAt: 2000 });
});

test('refresh, a worker restart and a browser restart keep the unvisited mark on its own tab', async () =>
{
  const { browser, tracker } = await markerOnly([tab(1, 1, 'https://a.test/', 0, true)]);
  await tracker.markOpenedUnvisited(tab(2, 1, 'https://b.test/', 1));
  await tracker.markOpenedUnvisited(tab(3, 1, 'https://c.test/', 2));

  // Tab 3 moved to the front; tab 4 is seen for the first time
  const moved = browser.open([
    tab(3, 1, 'https://c.test/', 0),
    tab(1, 1, 'https://a.test/', 1, true),
    tab(2, 1, 'https://b.test/', 2),
    tab(4, 1, 'https://d.test/', 3),
  ]);
  await tracker.refresh(moved);
  assert.equal(browser.storedRecord(3).unvisited, true);
  assert.equal(browser.storedRecord(3).index, 0);
  assert.equal(browser.storedRecord(4).unvisited, undefined);

  // Worker restart: same tab IDs
  const restartedWorker = browser.tracker();
  await restartedWorker.load(moved);
  assert.equal(browser.storedRecord(2).unvisited, true);
  assert.equal(browser.storedRecord(3).unvisited, true);
  assert.equal(browser.storedRecord(1).unvisited, undefined);

  // Browser restart: new IDs, the marks follow their URL
  browser.restart();
  const restartedBrowser = browser.tracker();
  await restartedBrowser.load(browser.open([
    tab(10, 5, 'https://c.test/', 0),
    tab(11, 5, 'https://a.test/', 1, true),
    tab(12, 5, 'https://b.test/', 2),
    tab(13, 5, 'https://d.test/', 3),
  ]));
  const view = TabActivityView.fromStored(browser.local.data[RECORDS_KEY]);
  assert.ok(view.isUnvisited(10));
  assert.ok(view.isUnvisited(12));
  assert.ok(!view.isUnvisited(11));
  assert.ok(!view.isUnvisited(13));
});

test('an unvisited tab\'s record follows its URL from pending URL through redirects; a visited tab\'s record does not', async () =>
{
  const { browser, tracker } = await markerOnly([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);
  await tracker.refresh([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1)]);

  // A new tab has no committed URL yet: its record keeps the pending one, also through a refresh
  const pending = tab(3, 1, '', 2, false, { pendingUrl: 'https://go.test/?q=x' });
  await tracker.markOpenedUnvisited(pending);
  await tracker.refresh([tab(1, 1, 'https://a.test/', 0, true), tab(2, 1, 'https://b.test/', 1), pending]);
  assert.equal(browser.storedRecord(3).url, 'https://go.test/?q=x');

  // The redirect lands; the visited tab 2 navigates too
  await tracker.followUrl(tab(3, 1, 'https://result.test/', 2));
  await tracker.followUrl(tab(2, 1, 'https://b2.test/', 1));
  assert.deepEqual(browser.storedRecord(3), { windowId: 1, url: 'https://result.test/', index: 2, lastUsedAt: 1000, unvisited: true });
  assert.equal(browser.storedRecord(2).url, 'https://b.test/');
});
