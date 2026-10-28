import assert from 'node:assert/strict';
import test from 'node:test';

import { TabSpaceRegistry } from '../src/managers/impl/tabSpaceRegistry.ts';

// A stored assignment, as TabSpaceRegistry.save writes it
const assignment = (tabId, windowId, spaceId, url, index) => ({ windowId, tabId, spaceId, url, index });
const tab = (id, windowId, url, index) => ({ id, windowId, url, index });

// Fake the chrome APIs load() and save() use; returns the local storage area so tests can read it back
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
    tabs: { query: async () => liveTabs },
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
