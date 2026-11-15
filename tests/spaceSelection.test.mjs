import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveActiveSpaceId,
  resolveSpaceIdAfterDeletion,
} from '../src/utils/spaceSelection.ts';

const spaces = [
  { id: 'space-a' },
  { id: 'space-b' },
  { id: 'space-c' },
];

test('the legacy All Space state migrates to the first real Space', () =>
{
  assert.equal(resolveActiveSpaceId(spaces, 'all'), 'space-a');
});

test('a real Space that still exists stays selected', () =>
{
  assert.equal(resolveActiveSpaceId(spaces, 'space-b'), 'space-b');
});

test('a deleted or unknown Space falls back to the first real Space', () =>
{
  assert.equal(resolveActiveSpaceId(spaces, 'missing'), 'space-a');
});

test('with no real Space there is no fallback to the All Space', () =>
{
  assert.equal(resolveActiveSpaceId([], 'all'), null);
});

test('deleting the current Space switches to the Space on its right first', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion(spaces, 'space-b', 'space-b'),
    'space-c',
  );
});

test('deleting the last Space switches to the Space on its left', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion(spaces, 'space-c', 'space-c'),
    'space-b',
  );
});

test('deleting another Space keeps the current Space', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion(spaces, 'space-a', 'space-c'),
    'space-c',
  );
});

const regularA = { id: 'regular-a' };
const regularB = { id: 'regular-b' };
const taskA = { id: 'task-a', task: { createdAt: 1 } };
const taskB = { id: 'task-b', task: { createdAt: 2 } };

test('an unknown Space falls back to the first regular Space, not a Task Space listed first', () =>
{
  assert.equal(resolveActiveSpaceId([taskA, regularA, regularB], 'missing'), 'regular-a');
});

test('with only Task Spaces an unknown Space falls back to the first Space', () =>
{
  assert.equal(resolveActiveSpaceId([taskA, taskB], 'missing'), 'task-a');
});

test('deleting the active regular Space lands on a regular neighbour, not a Task Space', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion([regularA, regularB, taskA], 'regular-b', 'regular-b'),
    'regular-a',
  );
});

test('deleting the active Task Space lands on another Task Space next to it', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion([taskA, regularA, taskB], 'task-a', 'task-a'),
    'task-b',
  );
});

test('deleting the only Task Space lands on the first regular Space', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion([regularA, taskA, regularB], 'task-a', 'task-a'),
    'regular-a',
  );
});

test('deleting the only regular Space lands on a Task Space', () =>
{
  assert.equal(
    resolveSpaceIdAfterDeletion([taskA, regularA], 'regular-a', 'regular-a'),
    'task-a',
  );
});

test('deleting the last Space leaves no Space to switch to', () =>
{
  assert.equal(resolveSpaceIdAfterDeletion([taskA], 'task-a', 'task-a'), null);
});
