import assert from 'node:assert/strict';
import test from 'node:test';

import { HiddenTaskSpacesManager } from '../src/managers/impl/hiddenTaskSpacesManager.ts';
import {
  HIDDEN_TASK_SPACES_CHANGED,
  HIDDEN_TASK_SPACES_STORAGE_KEY,
} from '../src/managers/shared/hiddenTaskSpacesApi.ts';

// A loaded manager over a fake storage area; `writes` counts storage.set calls
async function createManager(stored)
{
  const local = stored === undefined ? {} : { [HIDDEN_TASK_SPACES_STORAGE_KEY]: stored };
  const fake = { writes: 0 };
  const broadcasts = [];
  const manager = new HiddenTaskSpacesManager({
    storage: {
      get: async (key) => (key in local ? { [key]: structuredClone(local[key]) } : {}),
      set: async (values) =>
      {
        fake.writes++;
        Object.assign(local, structuredClone(values));
      },
    },
    broadcast: async (message) =>
    {
      broadcasts.push(message);
    },
  });
  await manager.load();
  return { manager, local, fake, broadcasts };
}

test('hiding a Task Space stores and broadcasts it once; hiding it again changes nothing', async () =>
{
  const { manager, local, fake, broadcasts } = await createManager();

  assert.deepEqual(manager.hide('task-1'), ['task-1']);
  await manager.flushWrites();

  assert.deepEqual(local[HIDDEN_TASK_SPACES_STORAGE_KEY], ['task-1']);
  assert.equal(fake.writes, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].action, HIDDEN_TASK_SPACES_CHANGED);
  assert.deepEqual(broadcasts[0].hidden, ['task-1']);

  assert.deepEqual(manager.hide('task-1'), ['task-1']);
  await manager.flushWrites();

  assert.equal(fake.writes, 1);
  assert.equal(broadcasts.length, 1);
});

test('entering a hidden Task Space unhides only that one; entering a Space that is not hidden writes nothing', async () =>
{
  const { manager, local, fake, broadcasts } = await createManager(['task-1', 'task-2']);

  manager.unhide('task-1');
  await manager.flushWrites();

  assert.deepEqual(manager.getHidden(), ['task-2']);
  assert.deepEqual(local[HIDDEN_TASK_SPACES_STORAGE_KEY], ['task-2']);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].senderId, undefined);

  manager.unhide('work');
  await manager.flushWrites();

  assert.deepEqual(manager.getHidden(), ['task-2']);
  assert.equal(fake.writes, 1);
  assert.equal(broadcasts.length, 1);
});

test('retain drops the marks of Spaces that are no longer live Task Spaces and keeps the rest', async () =>
{
  const { manager, local, fake } = await createManager(['task-1', 'archived', 'task-2', 'converted']);

  manager.retain(['task-1', 'task-2', 'task-3']);
  await manager.flushWrites();

  assert.deepEqual(manager.getHidden(), ['task-1', 'task-2']);
  assert.deepEqual(local[HIDDEN_TASK_SPACES_STORAGE_KEY], ['task-1', 'task-2']);

  manager.retain(['task-1', 'task-2']);
  await manager.flushWrites();

  assert.equal(fake.writes, 1);
});

test('a corrupt stored value reads as no marks, and non-string items are dropped', async () =>
{
  for (const corrupt of [{ 'task-1': true }, 'task-1', 42, null])
  {
    const { manager } = await createManager(corrupt);
    assert.deepEqual(manager.getHidden(), []);
  }

  const { manager } = await createManager(['task-1', 7, null, { id: 'task-2' }, 'task-3']);
  assert.deepEqual(manager.getHidden(), ['task-1', 'task-3']);
});

test('a failed read starts with no marks instead of rejecting the load', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const manager = new HiddenTaskSpacesManager({
    storage: {
      get: async () => { throw new Error('storage unavailable'); },
      set: async () => {},
    },
    broadcast: async () => {},
  });

  await manager.load();

  assert.deepEqual(manager.getHidden(), []);
});

test('a hide from the sidebar is broadcast with the caller\'s senderId, so its own window skips the echo', async () =>
{
  const { manager, broadcasts } = await createManager();

  const ack = await manager.dispatch('hide', { spaceId: 'task-1', senderId: 'ctx_sidebar' });

  assert.deepEqual(ack, ['task-1']);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].senderId, 'ctx_sidebar');
  assert.deepEqual(await manager.dispatch('getHidden', {}), ['task-1']);
  await assert.rejects(manager.dispatch('show', { spaceId: 'task-1' }), /unknown method "show"/);
});
