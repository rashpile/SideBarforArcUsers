import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recentTaskSpaces,
  swipeTarget,
  RECENT_TASK_SPACES_WINDOW_MS,
} from '../src/utils/recentTaskSpaces.ts';
import { TaskSpaceLastUse } from '../src/stores/taskSpaceLastUse.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = Date.UTC(2026, 10, 15, 12, 0);

function lastUse(entries)
{
  return new TaskSpaceLastUse(new Map(Object.entries(entries)));
}

function hidden(...spaceIds)
{
  return { isHidden: spaceId => spaceIds.includes(spaceId) };
}

function task(id, createdAt)
{
  return { id, task: { createdAt } };
}

function rowIds(recent)
{
  return recent.rows.map(row => row.space.id);
}

function select({ spaces, activeSpaceId = 'work', uses = {}, hiddenIds = [] })
{
  return recentTaskSpaces({
    spaces,
    activeSpaceId,
    lastUse: lastUse(uses),
    hidden: hidden(...hiddenIds),
    now,
  });
}

const work = { id: 'work' };
const home = { id: 'home' };

test('regular Spaces are never listed', () =>
{
  const recent = select({ spaces: [work, home, task('a', now - HOUR)] });

  assert.deepEqual(rowIds(recent), ['a']);
});

test('no Task Spaces gives an empty list', () =>
{
  const recent = select({ spaces: [work, home] });

  assert.equal(recent.isEmpty, true);
  assert.deepEqual(recent.byCreation(), []);
});

test('a Task Space used 23h59m ago is listed, one used exactly 24 hours ago is not', () =>
{
  const recent = select({
    spaces: [work, task('in', now - 2 * RECENT_TASK_SPACES_WINDOW_MS), task('out', now - 2 * RECENT_TASK_SPACES_WINDOW_MS)],
    uses: { in: now - 23 * HOUR - 59 * MINUTE, out: now - RECENT_TASK_SPACES_WINDOW_MS },
  });

  assert.deepEqual(rowIds(recent), ['in']);
});

test('only the 3 most recent of 5 are listed, oldest at the top', () =>
{
  const recent = select({
    spaces: [work, task('a', now - 10 * HOUR), task('b', now - 9 * HOUR), task('c', now - 8 * HOUR),
      task('d', now - 7 * HOUR), task('e', now - 6 * HOUR)],
    uses: { a: now - MINUTE, b: now - 5 * HOUR, c: now - 2 * HOUR, d: now - 3 * HOUR },
  });

  assert.deepEqual(rowIds(recent), ['d', 'c', 'a']);
});

test('a hidden Task Space is left out', () =>
{
  const recent = select({
    spaces: [work, task('a', now - 2 * HOUR), task('b', now - HOUR)],
    hiddenIds: ['b'],
  });

  assert.deepEqual(rowIds(recent), ['a']);
});

test('a hidden Task Space is left out also when it is the active Space', () =>
{
  const recent = select({
    spaces: [work, task('a', now - 2 * HOUR), task('b', now - HOUR)],
    activeSpaceId: 'b',
    hiddenIds: ['b'],
  });

  assert.deepEqual(rowIds(recent), ['a']);
  assert.equal(recent.rows.some(row => row.isActive), false);
});

test('the active Task Space is listed even when its last use is older than 24 hours', () =>
{
  const recent = select({
    spaces: [work, task('old', now - 5 * RECENT_TASK_SPACES_WINDOW_MS)],
    activeSpaceId: 'old',
    uses: { old: now - 3 * RECENT_TASK_SPACES_WINDOW_MS },
  });

  assert.deepEqual(rowIds(recent), ['old']);
  assert.equal(recent.rows[0].isActive, true);
});

test('the active Task Space is listed and last even when three others have times after now', () =>
{
  // The clock lags the real time by up to a minute, so the Space just left and a new Task
  // Space can carry a later time than the active one's `now`
  const recent = select({
    spaces: [work, task('active', now - HOUR), task('left', now - 2 * HOUR), task('fresh', now + 20_000),
      task('other', now - 3 * HOUR)],
    activeSpaceId: 'active',
    uses: { left: now + 30_000, other: now + 10_000 },
  });

  assert.equal(recent.rows.length, 3);
  assert.deepEqual(rowIds(recent), ['fresh', 'left', 'active']);
  assert.equal(recent.rows[2].isActive, true);
});

test('createdAt counts when there is no last use or it is newer than the last use', () =>
{
  const recent = select({
    spaces: [work, task('never-used', now - 2 * HOUR), task('created-later', now - HOUR),
      task('used', now - 10 * HOUR)],
    uses: { 'created-later': now - 30 * HOUR, used: now - 3 * HOUR },
  });

  assert.deepEqual(rowIds(recent), ['used', 'never-used', 'created-later']);
  assert.equal(recent.rows[2].recentAt, now - HOUR);
});

test('byCreation() follows creation time while the rows follow last use', () =>
{
  const recent = select({
    spaces: [work, task('first', now - 3 * HOUR), task('second', now - 2 * HOUR), task('third', now - HOUR)],
    uses: { first: now - MINUTE, second: now - 10 * MINUTE },
  });

  assert.deepEqual(rowIds(recent), ['third', 'second', 'first']);
  assert.deepEqual(recent.byCreation().map(space => space.id), ['first', 'second', 'third']);
});

const order = [{ id: 'work' }, { id: 'home' }, { id: 'task' }];

test('swipe left opens the next Space in the order, swipe right the previous one', () =>
{
  assert.equal(swipeTarget(order, 'home', 'left')?.id, 'task');
  assert.equal(swipeTarget(order, 'home', 'right')?.id, 'work');
});

test('swipe does nothing past either end of the order', () =>
{
  assert.equal(swipeTarget(order, 'task', 'left'), undefined);
  assert.equal(swipeTarget(order, 'work', 'right'), undefined);
});

test('swipe does nothing when the active Space is not in the order', () =>
{
  assert.equal(swipeTarget(order, 'hidden-task', 'left'), undefined);
  assert.equal(swipeTarget(order, 'hidden-task', 'right'), undefined);
  assert.equal(swipeTarget(order, null, 'left'), undefined);
});
