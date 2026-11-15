import assert from 'node:assert/strict';
import test from 'node:test';

import { spaceBarItems, TEMPORARY_TASK_SPACE_ICON_MS } from '../src/utils/spaceBarItems.ts';
import { TaskSpaceLastUse } from '../src/stores/taskSpaceLastUse.ts';

const MINUTE = 60_000;
const now = Date.UTC(2026, 10, 15, 12, 0);

function lastUse(entries)
{
  return new TaskSpaceLastUse(new Map(Object.entries(entries)));
}

function ids(spaces)
{
  return spaces.map(space => space.id);
}

const work = { id: 'work' };
const home = { id: 'home' };
const taskOld = { id: 'task-old', task: { createdAt: now - 60 * MINUTE } };
const taskNew = { id: 'task-new', task: { createdAt: now - 30 * MINUTE } };

test('a Task Space active in this window shows as a temporary icon', () =>
{
  const items = spaceBarItems([work, taskOld], 'task-old', lastUse({}), now);

  assert.deepEqual(ids(items.regular), ['work']);
  assert.deepEqual(ids(items.temporary), ['task-old']);
});

test('a Task Space used 9 minutes ago shows, one used 11 minutes ago does not', () =>
{
  const items = spaceBarItems(
    [work, taskOld, taskNew],
    'work',
    lastUse({ 'task-old': now - 9 * MINUTE, 'task-new': now - 11 * MINUTE }),
    now,
  );

  assert.deepEqual(ids(items.temporary), ['task-old']);
});

test('a Task Space never used and not active stays out of the bar', () =>
{
  const items = spaceBarItems([work, taskOld], 'work', lastUse({}), now);

  assert.deepEqual(ids(items.temporary), []);
  assert.equal(items.nextExpiryAt, undefined);
});

test('regular Spaces keep the list order, Task Spaces between them left out', () =>
{
  const items = spaceBarItems([home, taskOld, work, taskNew], 'home', lastUse({}), now);

  assert.deepEqual(ids(items.regular), ['home', 'work']);
});

test('temporary icons are ordered by creation time, not by list order', () =>
{
  const items = spaceBarItems(
    [work, taskNew, taskOld],
    'work',
    lastUse({ 'task-old': now - MINUTE, 'task-new': now - 2 * MINUTE }),
    now,
  );

  assert.deepEqual(ids(items.temporary), ['task-old', 'task-new']);
});

test('nextExpiryAt is the earliest time a recently used icon goes away', () =>
{
  const items = spaceBarItems(
    [work, taskOld, taskNew],
    'work',
    lastUse({ 'task-old': now - MINUTE, 'task-new': now - 5 * MINUTE }),
    now,
  );

  assert.equal(items.nextExpiryAt, now - 5 * MINUTE + TEMPORARY_TASK_SPACE_ICON_MS);
});

test('nextExpiryAt is undefined when only the active Task Space shows', () =>
{
  const items = spaceBarItems([work, taskOld], 'task-old', lastUse({ 'task-old': now - MINUTE }), now);

  assert.deepEqual(ids(items.temporary), ['task-old']);
  assert.equal(items.nextExpiryAt, undefined);
});
