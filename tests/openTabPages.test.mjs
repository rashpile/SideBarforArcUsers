import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenTabPages } from '../src/stores/openTabPages.ts';

const KEY = OpenTabPages.STORAGE_KEY;

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

// A fresh cache over the same session storage, as after a service-worker restart
async function loaded(storage)
{
  const pages = new OpenTabPages(storage);
  await pages.load();
  return pages;
}

function tab(id, url, title = 'Page', extra = {})
{
  return { id, url, title, favIconUrl: `${url}/favicon.ico`, incognito: false, ...extra };
}

test('a worker woken by a close still knows the closed tab page and Space', async () =>
{
  const storage = new MemoryStorage();
  const before = await loaded(storage);
  await before.update(tab(7, 'https://a.example', 'A'));
  await before.assignSpace(7, 'space-work');

  // The worker slept; the close wakes a new instance that reads session storage
  const after = await loaded(storage);
  const page = await after.take(7);

  assert.equal(page.url, 'https://a.example');
  assert.equal(page.title, 'A');
  assert.equal(page.spaceId, 'space-work');
});

test('take removes the entry from storage', async () =>
{
  const storage = new MemoryStorage();
  const pages = await loaded(storage);
  await pages.update(tab(1, 'https://a.example'));
  await pages.update(tab(2, 'https://b.example'));

  await pages.take(1);

  assert.deepEqual(storage.data[KEY].map(entry => entry.tabId), [2]);
  assert.equal(await (await loaded(storage)).take(1), undefined);
});

test('seed keeps entries of tabs that are not live and the known Space of live tabs', async () =>
{
  const storage = new MemoryStorage();
  const before = await loaded(storage);
  await before.update(tab(1, 'https://closed.example'));
  await before.assignSpace(1, 'space-a');
  await before.update(tab(2, 'https://live.example', 'Old title'));
  await before.assignSpace(2, 'space-b');

  // Tab 1 was closed while the worker slept; the registry doesn't know tab 2 yet
  const after = await loaded(storage);
  await after.seed([tab(2, 'https://live.example/next', 'New title')], () => undefined);

  assert.equal(after.page(1).spaceId, 'space-a');
  assert.equal(after.page(2).url, 'https://live.example/next');
  assert.equal(after.page(2).title, 'New title');
  assert.equal(after.page(2).spaceId, 'space-b');
});

test('seed takes the registry Space over the cached one', async () =>
{
  const storage = new MemoryStorage();
  const pages = await loaded(storage);
  await pages.update(tab(2, 'https://live.example'));
  await pages.assignSpace(2, 'space-old');

  await pages.seed([tab(2, 'https://live.example')], tabId => (tabId === 2 ? 'space-new' : undefined));

  assert.equal(pages.page(2).spaceId, 'space-new');
});

test('associated survives an update and a reload', async () =>
{
  const storage = new MemoryStorage();
  const pages = await loaded(storage);
  await pages.update(tab(3, 'https://pinned.example'));
  await pages.markAssociated([3]);
  await pages.update(tab(3, 'https://pinned.example/other', 'Other'));

  const reloaded = await loaded(storage);
  assert.equal(reloaded.page(3).associated, true);

  await reloaded.seed([tab(3, 'https://pinned.example/other')], () => undefined, []);
  assert.equal((await reloaded.take(3)).associated, true);
});

test('seed marks tabs from the current associations', async () =>
{
  const pages = await loaded(new MemoryStorage());

  await pages.seed([tab(4, 'https://a.example'), tab(5, 'https://b.example')], () => undefined, [5]);

  assert.equal(pages.page(4).associated, false);
  assert.equal(pages.page(5).associated, true);
});

test('an update that changes nothing writes nothing', async () =>
{
  const storage = new MemoryStorage();
  const pages = await loaded(storage);
  await pages.update(tab(1, 'https://a.example'));
  const writes = storage.writes;

  await pages.update(tab(1, 'https://a.example'));
  await pages.assignSpace(1, 'space-a');
  await pages.assignSpace(1, 'space-a');

  assert.equal(storage.writes, writes + 1);
});

test('a change made while the stored pages load is applied over them', async () =>
{
  const storage = new MemoryStorage();
  storage.data[KEY] = [{ tabId: 1, url: 'https://a.example', title: 'A', incognito: false, spaceId: 'space-a', associated: false }];
  const pages = new OpenTabPages(storage);

  const update = pages.update(tab(2, 'https://b.example'));
  await pages.load();
  await update;

  assert.equal(pages.page(1).spaceId, 'space-a');
  assert.equal(pages.page(2).url, 'https://b.example');
  assert.deepEqual(storage.data[KEY].map(entry => entry.tabId).sort(), [1, 2]);
});

test('a malformed stored value starts empty', async () =>
{
  for (const value of ['nope', { 1: {} }, [{ tabId: 'x' }], null])
  {
    const storage = new MemoryStorage();
    storage.data[KEY] = value;
    const pages = await loaded(storage);
    assert.equal(await pages.take(1), undefined);
  }
});
