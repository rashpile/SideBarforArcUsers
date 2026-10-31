import assert from 'node:assert/strict';
import test from 'node:test';

import { RECENTLY_CLOSED_PER_SPACE, RecentlyClosedTabs } from '../src/stores/recentlyClosedTabs.ts';

const record = (id, url, closedAt, extra = {}) => ({ id, url, title: `Title ${id}`, favIconUrl: '', closedAt, ...extra });
const urls = records => records.map(r => r.url);

test('a list survives the round trip through the stored JSON string', () =>
{
  const list = RecentlyClosedTabs.empty()
    .add('space-a', record('1', 'https://a.test/', 100, { favIconUrl: 'https://a.test/icon.png' }))
    .add('space-a', record('2', 'https://b.test/', 200))
    .add('space-b', record('3', 'https://c.test/', 300));

  const restored = RecentlyClosedTabs.fromStored(JSON.stringify(list.toStored()));

  assert.deepEqual(restored.toStored(), list.toStored());
  assert.deepEqual(urls(restored.forSpace('space-a')), ['https://b.test/', 'https://a.test/']);
  assert.equal(restored.find('space-b', '3').title, 'Title 3');
});

test('closing the same URL again in a Space replaces the older record and moves it to the top', () =>
{
  const list = RecentlyClosedTabs.empty()
    .add('space-a', record('1', 'https://a.test/', 100))
    .add('space-a', record('2', 'https://b.test/', 200))
    .add('space-a', record('3', 'https://a.test/', 300));

  const records = list.forSpace('space-a');
  assert.deepEqual(urls(records), ['https://a.test/', 'https://b.test/']);
  assert.equal(records[0].id, '3');
  assert.equal(list.find('space-a', '1'), undefined);
});

test('the same URL closed in another Space is a separate record', () =>
{
  const list = RecentlyClosedTabs.empty()
    .add('space-a', record('1', 'https://a.test/', 100))
    .add('space-b', record('2', 'https://a.test/', 200));

  assert.deepEqual(urls(list.forSpace('space-a')), ['https://a.test/']);
  assert.deepEqual(urls(list.forSpace('space-b')), ['https://a.test/']);
});

test('past the cap the oldest record is dropped', () =>
{
  let list = RecentlyClosedTabs.empty();
  for (let i = 0; i <= RECENTLY_CLOSED_PER_SPACE; i++)
  {
    list = list.add('space-a', record(String(i), `https://site.test/${i}`, i));
  }

  const records = list.forSpace('space-a');
  assert.equal(records.length, RECENTLY_CLOSED_PER_SPACE);
  assert.equal(records[0].url, `https://site.test/${RECENTLY_CLOSED_PER_SPACE}`);
  assert.equal(list.find('space-a', '0'), undefined);
  assert.ok(list.find('space-a', '1'));
});

test('retainSpaces drops the records of deleted Spaces only', () =>
{
  const list = RecentlyClosedTabs.empty()
    .add('space-a', record('1', 'https://a.test/', 100))
    .add('space-gone', record('2', 'https://b.test/', 200));

  const kept = list.retainSpaces(['space-a', 'space-c']);

  assert.deepEqual(Object.keys(kept.toStored()), ['space-a']);
  assert.equal(kept.hasRecords('space-gone'), false);
});

test('remove and clearSpace affect only their Space', () =>
{
  const list = RecentlyClosedTabs.empty()
    .add('space-a', record('1', 'https://a.test/', 100))
    .add('space-a', record('2', 'https://b.test/', 200))
    .add('space-b', record('3', 'https://c.test/', 300));

  assert.deepEqual(urls(list.remove('space-a', '1').forSpace('space-a')), ['https://b.test/']);
  assert.equal(list.remove('space-b', '1').find('space-a', '1').id, '1');
  const cleared = list.clearSpace('space-a');
  assert.equal(cleared.hasRecords('space-a'), false);
  assert.equal(cleared.hasRecords('space-b'), true);
});

test('fromStored turns a malformed value into an empty list and drops malformed records', () =>
{
  for (const raw of [undefined, null, '', 'not json', '[1,2]', 42, [], 'null'])
  {
    assert.deepEqual(RecentlyClosedTabs.fromStored(raw).toStored(), {}, `raw: ${JSON.stringify(raw)}`);
  }

  const mixed = RecentlyClosedTabs.fromStored({
    'space-a': [record('1', 'https://a.test/', 100), { id: '2', url: 5 }, null, record('', 'https://x.test/', 1)],
    'space-b': 'oops',
    'space-c': [{ title: 'no url' }],
  });

  assert.deepEqual(Object.keys(mixed.toStored()), ['space-a']);
  assert.deepEqual(urls(mixed.forSpace('space-a')), ['https://a.test/']);
});
