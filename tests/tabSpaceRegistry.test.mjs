import assert from 'node:assert/strict';
import test from 'node:test';

import { TabSpaceRegistry } from '../src/managers/impl/tabSpaceRegistry.ts';

// A stored assignment, as TabSpaceRegistry.save writes it
const assignment = (tabId, windowId, spaceId, url, index) => ({ windowId, tabId, spaceId, url, index });
const tab = (id, windowId, url, index) => ({ id, windowId, url, index });

// Fake the chrome APIs load(), register() and save() use; returns the local storage area so tests can read it back
function installChrome(storedAssignments, liveTabs)
{
  const local = { [TabSpaceRegistry.STORAGE_KEY]: storedAssignments };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ [TabSpaceRegistry.STORAGE_KEY]: local[TabSpaceRegistry.STORAGE_KEY] }),
        set: async (values) => { Object.assign(local, values); },
      },
      session: { get: async () => ({}) },
    },
    tabs: {
      query: async () => liveTabs,
      get: async (tabId) =>
      {
        const live = liveTabs.find(candidate => candidate.id === tabId);
        if (!live) throw new Error(`No tab with id: ${tabId}.`);
        return live;
      },
    },
    runtime: { sendMessage: async () => {} },
  };
  return local;
}

test('same browser session: a tab that moved to another site while the worker slept keeps its Space', async () =>
{
  // The stored URL lags: tab 7 followed a sign-in redirect, the event that woke the worker
  const local = installChrome(
    [assignment(7, 1, 'work', 'https://mail.test/inbox', 3)],
    [tab(4, 1, 'https://news.test/', 2), tab(7, 1, 'https://login.test/sso', 3)]
  );
  const registry = new TabSpaceRegistry();

  await registry.load(true);

  assert.equal(registry.getSpace(1, 7), 'work');
  assert.equal(registry.getSpace(1, 4), undefined);
  assert.deepEqual(local[TabSpaceRegistry.STORAGE_KEY], [assignment(7, 1, 'work', 'https://login.test/sso', 3)]);
});

test('new browser session: a reused tab ID on another site is not taken; the record finds its page by URL', async () =>
{
  installChrome(
    [assignment(7, 1, 'work', 'https://mail.test/inbox', 3)],
    [tab(7, 1, 'https://login.test/sso', 3), tab(2, 1, 'https://mail.test/inbox', 4)]
  );
  const registry = new TabSpaceRegistry();

  await registry.load(false);

  assert.equal(registry.getSpace(1, 7), undefined);
  assert.equal(registry.getSpace(1, 2), 'work');
});

test('browser restart: a restored tab Chrome reports as created keeps the Space the startup restore gave it', async () =>
{
  // Window and tab ids change at a browser restart; the restored tabs are found by URL
  const local = installChrome(
    [
      assignment(12, 1, 'task', 'https://code.test/agterm', 0),
      assignment(15, 1, 'space2', 'https://swarm.test/', 1),
    ],
    [tab(3, 5, 'https://code.test/agterm', 0), tab(4, 5, 'https://swarm.test/', 1)]
  );
  const registry = new TabSpaceRegistry();
  await registry.load(false);

  // The queued onCreated events of the restored tabs, with the window's active Space fallen back to Home
  assert.equal(await registry.registerNewTab(5, 3, 'home'), 'task');
  assert.equal(await registry.registerNewTab(5, 4, 'home'), 'space2');

  assert.equal(registry.getSpace(5, 3), 'task');
  assert.equal(registry.getSpace(5, 4), 'space2');
  assert.deepEqual(local[TabSpaceRegistry.STORAGE_KEY], [
    assignment(3, 5, 'task', 'https://code.test/agterm', 0),
    assignment(4, 5, 'space2', 'https://swarm.test/', 1),
  ]);
});

test('a tab without a Space joins the active Space; without an active Space it stays unassigned', async () =>
{
  const local = installChrome([], [tab(8, 2, 'https://news.test/', 0), tab(9, 2, 'https://docs.test/', 1)]);
  const registry = new TabSpaceRegistry();
  await registry.load(true);

  assert.equal(await registry.registerNewTab(2, 8, 'work'), 'work');
  assert.equal(registry.getSpace(2, 8), 'work');

  assert.equal(await registry.registerNewTab(2, 9, null), null);
  assert.equal(registry.getSpace(2, 9), undefined);
  assert.deepEqual(local[TabSpaceRegistry.STORAGE_KEY], [assignment(8, 2, 'work', 'https://news.test/', 0)]);
});
