import assert from 'node:assert/strict';
import test from 'node:test';

import { nextTaskSpaceName, withoutTaskMarker } from '../src/utils/taskSpaces.ts';

const day = new Date(2026, 10, 15, 12, 0);

test('the first Task Space of the day is -01', () =>
{
  assert.equal(nextTaskSpaceName(day, []), '20261115-01');
});

test('the next name follows the highest number taken today', () =>
{
  assert.equal(nextTaskSpaceName(day, ['20261115-01', '20261115-02']), '20261115-03');
});

test('a gap is not reused, so a deleted Task Space never gives its number away', () =>
{
  assert.equal(nextTaskSpaceName(day, ['20261115-01', '20261115-03']), '20261115-04');
});

test('names of another day and names that do not match are ignored', () =>
{
  const taken = ['20261114-07', 'Work', '20261115-02 copy', 'x20261115-05', '20261115-9'];
  assert.equal(nextTaskSpaceName(day, taken), '20261115-01');
});

test('a folder left by an archived or deleted Task Space keeps its number taken', () =>
{
  const spaceNames = ['20261115-01'];
  const folderTitles = ['20261115-01', '20261115-02'];
  assert.equal(nextTaskSpaceName(day, [...spaceNames, ...folderTitles]), '20261115-03');
});

test('after -99 the number grows to three digits', () =>
{
  assert.equal(nextTaskSpaceName(day, ['20261115-99']), '20261115-100');
  assert.equal(nextTaskSpaceName(day, ['20261115-99', '20261115-100']), '20261115-101');
});

test('the name uses the local date, not the UTC one', () =>
{
  const lateEvening = new Date(2026, 10, 15, 23, 59);
  assert.equal(nextTaskSpaceName(lateEvening, []), '20261115-01');
  const earlyMorning = new Date(2026, 0, 2, 0, 1);
  assert.equal(nextTaskSpaceName(earlyMorning, []), '20260102-01');
});

test('withoutTaskMarker drops the task key and keeps every other field', () =>
{
  const taskSpace = {
    id: 'space-t',
    name: '20261115-01',
    icon: 'list-todo',
    color: 'green',
    bookmarkFolderPath: 'Other Bookmarks/Tasks Spaces/20261115-01',
    bookmarkFolderSegments: ['Other Bookmarks', 'Tasks Spaces', '20261115-01'],
    bookmarkFolderInAccount: true,
    task: { createdAt: 1000 },
  };

  const regular = withoutTaskMarker(taskSpace);

  assert.equal('task' in regular, false);
  const { task: _task, ...expected } = taskSpace;
  assert.deepEqual(regular, expected);
  assert.ok(taskSpace.task, 'the original record is left untouched');
});
