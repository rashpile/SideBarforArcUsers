import assert from 'node:assert/strict';
import test from 'node:test';

import { TabAssociationBackupStore } from '../src/stores/tabAssociationBackupStore.ts';

class MemoryStorage
{
  data = {};

  async get(keys)
  {
    const keyList = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(keyList.map(key => [key, structuredClone(this.data[key])]));
  }

  async set(values)
  {
    await Promise.resolve();
    Object.assign(this.data, structuredClone(values));
  }

  async remove(keys)
  {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.data[key];
  }
}

test('concurrent saves of several pinned tabs do not overwrite each other', async () =>
{
  const storage = new MemoryStorage();
  const store = new TabAssociationBackupStore(storage);

  await Promise.all([
    store.save(42, 'bookmark-a', { tabId: 1, url: 'https://a.example', tabIndex: 0 }),
    store.save(42, 'bookmark-b', { tabId: 2, url: 'https://b.example', tabIndex: 1 }),
    store.save(42, 'pinned-c', { tabId: 3, url: 'https://c.example', tabIndex: 2 }),
  ]);

  assert.deepEqual(await store.read(42), {
    'bookmark-a': { tabId: 1, url: 'https://a.example', tabIndex: 0 },
    'bookmark-b': { tabId: 2, url: 'https://b.example', tabIndex: 1 },
    'pinned-c': { tabId: 3, url: 'https://c.example', tabIndex: 2 },
  });
  assert.deepEqual(await store.windowIds(), [42]);
});
