import assert from 'node:assert/strict';
import test from 'node:test';

import { ActiveTabCloseFollower } from '../src/services/activeTabCloseFollower.ts';

const WINDOW = 1;

// Lets pending promise callbacks run, as happens between two Chrome events
const flush = () => new Promise(setImmediate);

function deferred()
{
  let resolve;
  let reject;
  const promise = new Promise((res, rej) =>
  {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tab = (id, space, lastAccessed = 0) => ({ id, space, lastAccessed });

// One browser window, with the follower wired the way background.ts wires it
class FakeWindow
{
  existingSpaces = new Set(['a', 'b']);
  failingActivations = new Set();
  attempts = [];   // activateTab calls
  absorbed = [];   // activations onActivated handed to the follower
  finished = [];   // finishActivation calls
  forgotten = [];  // forgetActivation calls
  newTabs = [];    // Spaces openNewTab opened a tab in
  activeTabId;
  #nextTabId = 100;
  #now = 10_000;  // later than every lastAccessed a test sets up

  /** history: the window's tab history, most recent first; its first tab is the active one. */
  constructor(tabs, history)
  {
    this.tabs = tabs.map(({ id, lastAccessed }) => ({ id, lastAccessed }));
    this.spaces = new Map(tabs.map(({ id, space }) => [id, space]));
    this.history = [...history];
    this.activeTabId = history[0];
    this.queryWindowTabs = async () =>
      this.tabs.map((openTab) => ({ ...openTab, active: openTab.id === this.activeTabId }));
    this.follower = new ActiveTabCloseFollower({
      activationOrder: () => [...this.history],
      forgetActivation: (_windowId, tabId) =>
      {
        this.forgotten.push(tabId);
        this.#dropHistory(tabId);
      },
      spaceOf: (_windowId, tabId) => this.spaces.get(tabId),
      spaceExists: (spaceId) => this.existingSpaces.has(spaceId),
      tabExists: async (tabId) => this.#isOpen(tabId),
      windowTabs: () => this.queryWindowTabs(),
      activeTabId: async () => this.activeTabId,
      activateTab: async (tabId) =>
      {
        this.attempts.push(tabId);
        if (!this.#isOpen(tabId) || this.failingActivations.has(tabId)) return false;
        this.chromeActivates(tabId);
        return true;
      },
      openNewTab: async (_windowId, spaceId) =>
      {
        const tabId = this.#nextTabId++;
        this.tabs.push({ id: tabId, lastAccessed: 0 });
        this.spaces.set(tabId, spaceId);
        this.newTabs.push(spaceId);
        this.chromeActivates(tabId);
        return tabId;
      },
      // background's handleTabActivation pushes the tab to the history
      finishActivation: async (_windowId, tabId) =>
      {
        this.finished.push(tabId);
        this.#pushHistory(tabId);
      },
    });
  }

  /** Chrome activates a tab and sends onActivated, handled as background.ts does. */
  chromeActivates(tabId)
  {
    this.stripActivates(tabId);
    this.onActivated(tabId);
  }

  /** The tab strip side of an activation, without the event: Chrome sets the tab's lastAccessed to now. */
  stripActivates(tabId)
  {
    this.activeTabId = tabId;
    const openTab = this.tabs.find((candidate) => candidate.id === tabId);
    if (openTab) openTab.lastAccessed = this.#now++;
  }

  /** onActivated as background.ts handles it. */
  onActivated(tabId)
  {
    if (this.follower.absorbActivation(WINDOW))
    {
      this.absorbed.push(tabId);
      return;
    }
    this.follower.noteActivation(WINDOW, tabId);
    this.#pushHistory(tabId);
  }

  removeFromStrip(...tabIds)
  {
    this.tabs = this.tabs.filter((openTab) => !tabIds.includes(openTab.id));
  }

  /** onRemoved as background.ts handles it: the follower first, then history and registry forget the tab. */
  onRemoved(tabId, { isWindowClosing = false, restored = true } = {})
  {
    const follow = this.follower.tabRemoved(WINDOW, tabId, this.spaces.get(tabId), isWindowClosing, restored);
    this.#dropHistory(tabId);
    this.spaces.delete(tabId);
    return follow;
  }

  /** One chrome.tabs.remove call: every tab leaves the strip before the first onRemoved. */
  close(tabIds, options)
  {
    const ids = [].concat(tabIds);
    this.removeFromStrip(...ids);
    return Promise.all(ids.map((tabId) => this.onRemoved(tabId, options)));
  }

  #isOpen(tabId)
  {
    return this.tabs.some((openTab) => openTab.id === tabId);
  }

  #pushHistory(tabId)
  {
    this.#dropHistory(tabId);
    this.history.unshift(tabId);
  }

  #dropHistory(tabId)
  {
    this.history = this.history.filter((entry) => entry !== tabId);
  }
}

test('closing the active tab lands on the tab used before it in its Space, not on a more recent tab of another Space', async () =>
{
  const win = new FakeWindow([tab(1, 'a'), tab(2, 'b'), tab(3, 'a')], [3, 2, 1]);

  const landing = win.close(3);
  win.chromeActivates(2);  // Chrome's own pick, the strip neighbour
  assert.equal(win.follower.isFollowing(WINDOW), true);
  await landing;

  assert.deepEqual(win.attempts, [1]);
  assert.equal(win.activeTabId, 1);
  // Chrome's pick and the landing itself came during the follow and were left to it
  assert.deepEqual(win.absorbed, [2, 1]);
  assert.deepEqual(win.finished, [1]);
  assert.equal(win.follower.isFollowing(WINDOW), false);
  assert.equal(win.follower.absorbActivation(WINDOW), false);
});

test('a Space whose tabs are not in the history lands on its tab with the newest lastAccessed', async () =>
{
  const win = new FakeWindow(
    [tab(1, 'a', 100), tab(2, 'a', 300), tab(3, 'b', 500), tab(4, 'a', 50)],
    [4, 3],
  );

  await win.close(4);

  assert.deepEqual(win.attempts, [2]);
  assert.deepEqual(win.finished, [2]);
});

// The history misses Space a's older tab 1, as after a browser restart. 4 was opened from the active
// tab 3 in the background; Chrome activates it as the strip neighbour, which sets its lastAccessed to now.
const pickCases = [
  ['an older tab of the Space the history misses', [tab(1, 'a', 100), tab(2, 'b', 500), tab(3, 'a', 600), tab(4, 'a', 0)], [3, 2], 1],
  ['Chrome\'s pick when the history has it as the Space\'s previous tab', [tab(1, 'a', 100), tab(2, 'b', 500), tab(3, 'a', 600), tab(4, 'a', 0)], [3, 4, 2], 4],
  ['Chrome\'s pick when it is the Space\'s only other tab', [tab(2, 'b', 500), tab(3, 'a', 600), tab(4, 'a', 0)], [3, 2], 4],
];

for (const [name, tabs, history, landingTabId] of pickCases)
{
  test(`closing the active tab while Chrome activates a tab of its Space lands on ${name}`, async () =>
  {
    const win = new FakeWindow(tabs, history);

    win.removeFromStrip(3);
    win.stripActivates(4);  // part of the close, before either event
    const landing = win.onRemoved(3);
    win.onActivated(4);
    await landing;

    assert.deepEqual(win.attempts, [landingTabId]);
    assert.deepEqual(win.newTabs, []);
    assert.equal(win.activeTabId, landingTabId);
  });
}

test('Chrome\'s pick before onRemoved does not win the lastAccessed fallback either', async () =>
{
  const win = new FakeWindow([tab(1, 'a', 100), tab(2, 'b', 500), tab(3, 'a', 600), tab(4, 'a', 0)], [3, 2]);

  win.removeFromStrip(3);
  win.chromeActivates(4);
  await flush();
  await win.onRemoved(3);

  assert.deepEqual(win.forgotten, [4]);
  assert.deepEqual(win.attempts, [1]);
  assert.equal(win.activeTabId, 1);
});

test('a tab Chrome refuses to activate is skipped for the next one of the Space', async () =>
{
  const win = new FakeWindow([tab(1, 'a'), tab(2, 'a'), tab(3, 'a')], [3, 2, 1]);
  win.failingActivations.add(2);

  await win.close(3);

  assert.deepEqual(win.attempts, [2, 1]);
  assert.deepEqual(win.finished, [1]);
});

test('closing the last tab of a Space opens a New Tab in that Space', async () =>
{
  const win = new FakeWindow([tab(1, 'b'), tab(2, 'a')], [2, 1]);

  const landing = win.close(2);
  win.chromeActivates(1);
  await landing;

  assert.deepEqual(win.attempts, []);
  assert.deepEqual(win.newTabs, ['a']);
  assert.deepEqual(win.finished, [100]);
  assert.equal(win.activeTabId, 100);
});

test('a follow that fails still finishes the activation it skipped', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const win = new FakeWindow([tab(1, 'a'), tab(2, 'b'), tab(3, 'a')], [3, 2, 1]);
  const query = deferred();
  win.queryWindowTabs = () => query.promise;

  const landing = win.close(3);
  win.chromeActivates(2);
  query.reject(new Error('No window with id: 1'));
  await landing;

  assert.deepEqual(win.attempts, []);
  assert.deepEqual(win.finished, [2]);
  assert.equal(win.follower.isFollowing(WINDOW), false);
});

const untouchedCases = [
  ['a background tab', (win) => win.close(1)],
  ['the active tab with its window', (win) => win.close(3, { isWindowClosing: true })],
  ['the active tab after a failed startup restore', (win) => win.close(3, { restored: false })],
  ['an active tab with no Space', (win) =>
  {
    win.spaces.delete(3);
    return win.close(3);
  }],
  ['an active tab of a deleted Space', (win) =>
  {
    win.existingSpaces.delete('a');
    return win.close(3);
  }],
];

for (const [name, closeTab] of untouchedCases)
{
  test(`closing ${name} leaves Chrome's pick alone`, async () =>
  {
    const win = new FakeWindow([tab(1, 'a'), tab(2, 'a'), tab(3, 'a')], [3, 2, 1]);

    const removal = closeTab(win);
    assert.equal(win.follower.isFollowing(WINDOW), false);
    await removal;

    assert.deepEqual(win.attempts, []);
    assert.deepEqual(win.newTabs, []);
    assert.deepEqual(win.finished, []);
    assert.equal(win.follower.absorbActivation(WINDOW), false);
  });
}

test('a command closing several tabs, the active one among them, lands once on a tab it did not close', async () =>
{
  const win = new FakeWindow(
    [tab(1, 'a', 100), tab(2, 'a', 900), tab(3, 'a', 800), tab(4, 'a', 700), tab(5, 'b', 1000)],
    [4, 3, 2, 5, 1],
  );

  await win.close([4, 3, 2]);

  assert.deepEqual(win.attempts, [1]);
  assert.deepEqual(win.finished, [1]);
});

for (const answered of [true, false])
{
  test(`Chrome's pick before onRemoved is replaced by the closed tab's Space and dropped from history (check ${answered ? 'answered' : 'pending'})`, async () =>
  {
    const win = new FakeWindow([tab(1, 'a'), tab(2, 'b'), tab(3, 'a')], [3, 2, 1]);

    win.removeFromStrip(3);
    win.chromeActivates(2);
    if (answered) await flush();
    const landing = win.onRemoved(3);
    assert.equal(win.follower.isFollowing(WINDOW), true);
    await landing;

    assert.deepEqual(win.attempts, [1]);
    assert.deepEqual(win.forgotten, [2]);
    assert.deepEqual(win.finished, [1]);
    assert.deepEqual(win.history, [1]);
  });
}

test('closing the tab the user had just left is a background close', async () =>
{
  const win = new FakeWindow([tab(1, 'a'), tab(2, 'a'), tab(3, 'b')], [1, 3]);

  win.chromeActivates(2);  // the user switches from 1 to 2
  await flush();
  const removal = win.close(1);
  assert.equal(win.follower.isFollowing(WINDOW), false);
  await removal;

  assert.deepEqual(win.attempts, []);
  assert.deepEqual(win.forgotten, []);
  assert.deepEqual(win.finished, []);
});

for (const answered of [true, false])
{
  test(`closing the tab just left and the active tab in one call lands in the active tab's Space (check ${answered ? 'answered' : 'pending'})`, async () =>
  {
    const win = new FakeWindow([tab(1, 'a'), tab(2, 'b'), tab(3, 'a'), tab(4, 'b')], [1, 3, 4]);

    win.chromeActivates(2);  // the user switches from 1 to 2
    if (answered) await flush();
    await win.close([1, 2]);

    assert.deepEqual(win.attempts, [4]);
    assert.deepEqual(win.forgotten, []);
    assert.deepEqual(win.finished, [4]);
  });
}
