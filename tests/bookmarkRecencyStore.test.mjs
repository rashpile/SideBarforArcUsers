import assert from 'node:assert/strict';
import test from 'node:test';

import { BookmarkRecencyStore, BOOKMARK_RECENCY_KEY } from '../src/stores/bookmarkRecencyStore.ts';

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
}

test('concurrent touches keep every bookmark', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1000;
  const store = new BookmarkRecencyStore(storage, () => clock++);

  await Promise.all([store.touch('a'), store.touch('b'), store.touch('c')]);

  const recency = await store.read();
  assert.equal(recency.lastActiveAt('a'), 1000);
  assert.equal(recency.lastActiveAt('b'), 1001);
  assert.equal(recency.lastActiveAt('c'), 1002);
});

test('touch overwrites the previous time', async () =>
{
  const storage = new MemoryStorage();
  let clock = 1;
  const store = new BookmarkRecencyStore(storage, () => clock);

  await store.touch('a');
  clock = 50;
  await store.touch('a');

  assert.equal((await store.read()).lastActiveAt('a'), 50);
});

test('stored value is a JSON string readable by useChromeLocalStorage', async () =>
{
  const storage = new MemoryStorage();
  const store = new BookmarkRecencyStore(storage, () => 7);

  await store.touch('a');

  assert.equal(typeof storage.data[BOOKMARK_RECENCY_KEY], 'string');
  assert.deepEqual(JSON.parse(storage.data[BOOKMARK_RECENCY_KEY]), { a: 7 });
});

test('forget removes only the given bookmarks', async () =>
{
  const storage = new MemoryStorage();
  const store = new BookmarkRecencyStore(storage, () => 1);

  await store.touch('a');
  await store.touch('b');
  await store.forget(['a', 'unknown']);

  const recency = await store.read();
  assert.equal(recency.wasEverActive('a'), false);
  assert.equal(recency.wasEverActive('b'), true);
});

test('corrupt stored value reads as empty', async () =>
{
  const storage = new MemoryStorage();
  storage.data[BOOKMARK_RECENCY_KEY] = '{not json';
  const store = new BookmarkRecencyStore(storage, () => 1);

  assert.equal((await store.read()).wasEverActive('a'), false);
  await store.touch('a');
  assert.equal((await store.read()).lastActiveAt('a'), 1);
});
