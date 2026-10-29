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
