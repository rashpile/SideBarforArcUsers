import assert from 'node:assert/strict';
import test from 'node:test';

import { RecentlyClosedManager } from '../src/managers/impl/recentlyClosedManager.ts';
import { RECENTLY_CLOSED_TABS_KEY } from '../src/managers/shared/recentlyClosedApi.ts';
import { RecentlyClosedTabs } from '../src/stores/recentlyClosedTabs.ts';

const record = (id, url, closedAt) => ({ id, url, title: url, favIconUrl: '', closedAt });

function storedList(bySpace)
{
  let tabs = RecentlyClosedTabs.empty();
  for (const [spaceId, records] of Object.entries(bySpace))
  {
    for (const entry of [...records].reverse()) tabs = tabs.add(spaceId, entry);
  }
  return JSON.stringify(tabs.toStored());
}

// Fake the chrome APIs the manager uses; returns the local area and the created tabs
function installChrome({ stored = {}, failRead = false, failCreate = false } = {})
{
  const local = { ...stored };
  const created = [];
  let nextTabId = 100;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) =>
        {
          if (failRead) throw new Error('read failed');
          return key in local ? { [key]: local[key] } : {};
        },
        set: async (values) => { Object.assign(local, values); },
      },
    },
    tabs: {
      create: async (props) =>
      {
        if (failCreate) throw new Error('create failed');
        const tab = { id: nextTabId++, ...props };
        created.push(tab);
        return tab;
      },
    },
  };
  return { local, created };
}

function createManager(spaceIds = ['work', 'home'])
{
  const registered = [];
  const manager = new RecentlyClosedManager({
    getSpaceIds: () => spaceIds,
    registerTab: async (windowId, tabId, spaceId) => { registered.push({ windowId, tabId, spaceId }); },
  });
  return { manager, registered };
}

test('reopen opens the page in the given window, registers it in the record\'s Space and drops the record', async () =>
{
  const { local, created } = installChrome({
    stored: {
      [RECENTLY_CLOSED_TABS_KEY]: storedList({
        work: [record('a', 'https://mail.test/', 2)],
        home: [record('b', 'https://mail.test/', 1)],
      }),
    },
  });
  const { manager, registered } = createManager();
  await manager.load();

  await manager.reopen(3, 'home', 'b');

  assert.deepEqual(created.map(tab => ({ windowId: tab.windowId, url: tab.url, active: tab.active })),
    [{ windowId: 3, url: 'https://mail.test/', active: true }]);
  assert.deepEqual(registered, [{ windowId: 3, tabId: created[0].id, spaceId: 'home' }]);
  const after = RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]);
  assert.deepEqual(after.forSpace('home'), []);
  assert.deepEqual(after.forSpace('work').map(entry => entry.id), ['a']);
});

test('a failed tab create keeps the record and reports the error', async () =>
{
  const stored = storedList({ work: [record('a', 'https://mail.test/', 2)] });
  const { local } = installChrome({ stored: { [RECENTLY_CLOSED_TABS_KEY]: stored }, failCreate: true });
  const { manager, registered } = createManager();
  await manager.load();

  await assert.rejects(manager.reopen(1, 'work', 'a'));

  assert.deepEqual(registered, []);
  assert.deepEqual(manager.forSpace('work').map(entry => entry.id), ['a']);
  assert.equal(local[RECENTLY_CLOSED_TABS_KEY], stored);
});

test('a failed initial read never writes over the stored list', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const stored = storedList({ work: [record('a', 'https://mail.test/', 2)] });
  const { local } = installChrome({ stored: { [RECENTLY_CLOSED_TABS_KEY]: stored }, failRead: true });
  const { manager } = createManager();
  await manager.load();

  await manager.recordClose('work', record('b', 'https://docs.test/', 3));
  await manager.clear('work');
  await manager.retainSpaces(['home']);

  assert.equal(manager.loaded, false);
  assert.equal(local[RECENTLY_CLOSED_TABS_KEY], stored);
});

test('a close recorded while the list is loading is added to the stored records, not written over them', async () =>
{
  const { local } = installChrome({
    stored: { [RECENTLY_CLOSED_TABS_KEY]: storedList({ work: [record('a', 'https://mail.test/', 2)] }) },
  });
  const { manager } = createManager();

  const loading = manager.load();
  const recording = manager.recordClose('work', record('b', 'https://docs.test/', 3));
  await Promise.all([loading, recording]);

  const after = RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]);
  assert.deepEqual(after.forSpace('work').map(entry => entry.id), ['b', 'a']);
});

test('a close handled after its Space was deleted is not recorded', async () =>
{
  const { local } = installChrome();
  const spaceIds = ['work', 'home'];
  const { manager } = createManager(spaceIds);
  await manager.load();

  spaceIds.splice(spaceIds.indexOf('home'), 1);
  await manager.recordClose('home', record('b', 'https://docs.test/', 3));

  assert.deepEqual(manager.forSpace('home'), []);
  assert.equal(local[RECENTLY_CLOSED_TABS_KEY], undefined);
});

test('load drops deleted Spaces\' records, but not while the Space list is still empty', async () =>
{
  const stored = storedList({
    work: [record('a', 'https://mail.test/', 2)],
    gone: [record('b', 'https://docs.test/', 1)],
  });

  const { local: notReady } = installChrome({ stored: { [RECENTLY_CLOSED_TABS_KEY]: stored } });
  await createManager([]).manager.load();
  assert.equal(notReady[RECENTLY_CLOSED_TABS_KEY], stored);

  const { local } = installChrome({ stored: { [RECENTLY_CLOSED_TABS_KEY]: stored } });
  await createManager(['work']).manager.load();
  const after = RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]);
  assert.deepEqual(after.forSpace('gone'), []);
  assert.deepEqual(after.forSpace('work').map(entry => entry.id), ['a']);
});

test('an archive close is skipped once', () =>
{
  installChrome();
  const { manager } = createManager();
  manager.expectArchiveClose([4, 5]);

  assert.equal(manager.consumeArchiveClose(4), true);
  assert.equal(manager.consumeArchiveClose(4), false);
  assert.equal(manager.consumeArchiveClose(6), false);
});

test('Undo of a Space delete brings back the records the delete snapshotted', async () =>
{
  const { local } = installChrome({
    stored: {
      [RECENTLY_CLOSED_TABS_KEY]: storedList({
        work: [record('a', 'https://a.test/', 3), record('b', 'https://b.test/', 2)],
        home: [record('c', 'https://c.test/', 1)],
      }),
    },
  });
  const spaceIds = ['work', 'home'];
  const { manager } = createManager(spaceIds);
  await manager.load();

  const snapshot = await manager.spaceRecords('work');
  spaceIds.splice(0, 1);
  await manager.retainSpaces(spaceIds);
  assert.deepEqual(RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]).forSpace('work'), []);

  spaceIds.unshift('work');
  await manager.restoreSpace('work', snapshot);

  const after = RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]);
  assert.deepEqual(after.forSpace('work').map(entry => entry.id), ['a', 'b']);
  assert.deepEqual(after.forSpace('home').map(entry => entry.id), ['c']);
});

test('restoreSpace keeps newer records and drops the older record of the same URL', async () =>
{
  const { local } = installChrome({
    stored: {
      [RECENTLY_CLOSED_TABS_KEY]: storedList({ work: [record('new', 'https://a.test/', 5)] }),
    },
  });
  const { manager } = createManager();
  await manager.load();

  await manager.restoreSpace('work', [record('old', 'https://a.test/', 3), record('b', 'https://b.test/', 4)]);

  const after = RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]);
  assert.deepEqual(after.forSpace('work').map(entry => entry.id), ['new', 'b']);
});

test('restoreSpace does nothing while the Space is still deleted', async () =>
{
  const { local } = installChrome({ stored: { [RECENTLY_CLOSED_TABS_KEY]: storedList({}) } });
  const { manager } = createManager(['home']);
  await manager.load();

  await manager.restoreSpace('work', [record('a', 'https://a.test/', 1)]);

  assert.deepEqual(RecentlyClosedTabs.fromStored(local[RECENTLY_CLOSED_TABS_KEY]).forSpace('work'), []);
});
