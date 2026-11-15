import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTaskSpaceArchivePeriod,
  selectTaskSpacesToArchive,
  taskSpaceArchivePeriodMs,
} from '../src/utils/taskSpaceArchive.ts';
import { TaskSpaceLastUse } from '../src/stores/taskSpaceLastUse.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const now = Date.UTC(2026, 10, 15, 12, 0);
const periodMs = 3 * DAY;

function lastUse(entries)
{
  return new TaskSpaceLastUse(new Map(Object.entries(entries)));
}

function select({ spaces, used = {}, activeSpaceIds = [] })
{
  return selectTaskSpacesToArchive({ spaces, lastUse: lastUse(used), activeSpaceIds, now, periodMs });
}

function taskSpace(id, createdAt)
{
  return { id, task: { createdAt } };
}

test('unknown values read as Never, and the 1-minute period only in DEV builds', () =>
{
  assert.equal(parseTaskSpaceArchivePeriod(undefined), 'never');
  assert.equal(parseTaskSpaceArchivePeriod('12h'), 'never');
  assert.equal(parseTaskSpaceArchivePeriod(3), 'never');
  assert.equal(parseTaskSpaceArchivePeriod('1m'), 'never');
  assert.equal(parseTaskSpaceArchivePeriod('1m', true), '1m');

  for (const period of ['never', '1d', '3d', '7d', '14d', '30d'])
  {
    assert.equal(parseTaskSpaceArchivePeriod(period), period);
  }
  assert.equal(taskSpaceArchivePeriodMs('never'), null);
  assert.equal(taskSpaceArchivePeriodMs('14d'), 14 * DAY);
});

test('a Task Space unused for the period is selected, one used within it is kept', () =>
{
  const overdue = taskSpace('overdue', now - 10 * DAY);
  const recent = taskSpace('recent', now - 10 * DAY);

  const ids = select({
    spaces: [overdue, recent],
    used: { overdue: now - periodMs, recent: now - periodMs + MINUTE },
  });

  assert.deepEqual(ids, ['overdue']);
});

test('a regular Space is never selected, however old', () =>
{
  const ids = select({ spaces: [{ id: 'work' }], used: { work: now - 30 * DAY } });

  assert.deepEqual(ids, []);
});

test('a Task Space active in any window is kept', () =>
{
  const ids = select({
    spaces: [taskSpace('open-elsewhere', now - 10 * DAY), taskSpace('idle', now - 10 * DAY)],
    activeSpaceIds: ['work', 'open-elsewhere'],
  });

  assert.deepEqual(ids, ['idle']);
});

test('with no stored last use the period counts from creation', () =>
{
  const ids = select({
    spaces: [taskSpace('old', now - 4 * DAY), taskSpace('new', now - 2 * DAY)],
  });

  assert.deepEqual(ids, ['old']);
});

test('a recent touch keeps a Task Space created long ago', () =>
{
  const ids = select({
    spaces: [taskSpace('touched', now - 20 * DAY)],
    used: { touched: now - DAY },
  });

  assert.deepEqual(ids, []);
});
