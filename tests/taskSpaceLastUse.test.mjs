import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TaskSpaceLastUse,
  TaskSpaceLastUseStore,
  TASK_SPACE_LAST_USE_KEY,
} from '../src/stores/taskSpaceLastUse.ts';

class MemoryStorage
{
  data = {};
  writes = 0;

  async get(key)
  {
    return { [key]: structuredClone(this.data[key]) };
  }

  async set(values)
  {
    await Promise.resolve();
    this.writes++;
    Object.assign(this.data, structuredClone(values));
  }
}

test('first touch writes a JSON string readable by useChromeLocalStorage', async () =>
{
  const storage = new MemoryStorage();
  const store = new TaskSpaceLastUseStore(storage, () => 5000);

  await store.touch('t1');

  assert.equal(storage.writes, 1);
  assert.equal(typeof storage.data[TASK_SPACE_LAST_USE_KEY], 'string');
  assert.deepEqual(JSON.parse(storage.data[TASK_SPACE_LAST_USE_KEY]), { t1: 5000 });
  assert.equal((await store.read()).lastUsedAt('t1'), 5000);
});

test('touch within 60 s of the stored time does not write', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1_000_000;
  const store = new TaskSpaceLastUseStore(storage, () => clock);

  await store.touch('t1');
  clock += 59_999;
  await store.touch('t1');

  assert.equal(storage.writes, 1);
  assert.equal((await store.read()).lastUsedAt('t1'), 1_000_000);
});

test('touch 60 s or more after the stored time updates it', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1_000_000;
  const store = new TaskSpaceLastUseStore(storage, () => clock);

  await store.touch('t1');
  clock += 60_000;
  await store.touch('t1');

  assert.equal(storage.writes, 2);
  assert.equal((await store.read()).lastUsedAt('t1'), 1_060_000);
});

test('a stored time ahead of the clock is overwritten', async () =>
{
  const storage = new MemoryStorage();
  storage.data[TASK_SPACE_LAST_USE_KEY] = JSON.stringify({ t1: 2_000_000 });
  const store = new TaskSpaceLastUseStore(storage, () => 1_000_000);

  await store.touch('t1');

  assert.equal((await store.read()).lastUsedAt('t1'), 1_000_000);
});

test('concurrent touches of different Task Spaces both land', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1000;
  const store = new TaskSpaceLastUseStore(storage, () => clock++);

  await Promise.all([store.touch('t1'), store.touch('t2')]);

  const lastUse = await store.read();
  assert.equal(lastUse.lastUsedAt('t1'), 1000);
  assert.equal(lastUse.lastUsedAt('t2'), 1001);
});

test('retain drops the entries of other ids', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1000;
  const store = new TaskSpaceLastUseStore(storage, () => clock++);

  await store.touch('t1');
  await store.touch('t2');
  await store.touch('t3');
  await store.retain(['t2', 'unknown']);

  const lastUse = await store.read();
  assert.equal(lastUse.lastUsedAt('t1'), undefined);
  assert.equal(lastUse.lastUsedAt('t2'), 1001);
  assert.equal(lastUse.lastUsedAt('t3'), undefined);
});

test('retain that drops nothing does not write', async () =>
{
  const storage = new MemoryStorage();
  const store = new TaskSpaceLastUseStore(storage, () => 1000);

  await store.touch('t1');
  await store.retain(['t1', 't2']);

  assert.equal(storage.writes, 1);
});

test('junk stored value reads as empty and the next touch replaces it', async () =>
{
  for (const junk of ['{not json', '[1,2]', '42', 'null', JSON.stringify({ t1: 'yesterday' })])
  {
    const storage = new MemoryStorage();
    storage.data[TASK_SPACE_LAST_USE_KEY] = junk;
    const store = new TaskSpaceLastUseStore(storage, () => 7);

    assert.equal((await store.read()).lastUsedAt('t1'), undefined, junk);
    await store.touch('t1');
    assert.equal((await store.read()).lastUsedAt('t1'), 7, junk);
  }
});

test('the sidebar view skips junk entries of the parsed value', () =>
{
  const lastUse = TaskSpaceLastUse.fromStored({ t1: 100, t2: 'soon', t3: null, t4: Number.NaN });

  assert.equal(lastUse.lastUsedAt('t1'), 100);
  assert.equal(lastUse.lastUsedAt('t2'), undefined);
  assert.equal(lastUse.lastUsedAt('t3'), undefined);
  assert.equal(lastUse.lastUsedAt('t4'), undefined);
  assert.equal(TaskSpaceLastUse.fromStored([5]).lastUsedAt('0'), undefined);
  assert.equal(TaskSpaceLastUse.fromStored(undefined).lastUsedAt('t1'), undefined);
});
