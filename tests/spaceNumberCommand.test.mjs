import assert from 'node:assert/strict';
import test from 'node:test';

import { SpaceNumberCommand } from '../src/utils/spaceNumberCommand.ts';

const spaces = [
  { id: 'space-a' },
  { id: 'space-b' },
  { id: 'space-c' },
];

function spaceToOpen(command, activeSpaceId)
{
  return SpaceNumberCommand.parse(command).spaceToOpen(spaces, activeSpaceId)?.id;
}

test('space-1 opens the first Space of the Space bar', () =>
{
  assert.equal(spaceToOpen('space-1', null), 'space-a');
});

test('space-3 opens the third Space of the Space bar', () =>
{
  assert.equal(spaceToOpen('space-3', null), 'space-c');
});

test('a position past the last Space opens nothing', () =>
{
  assert.equal(spaceToOpen('space-4', null), undefined);
});

test('the command of the active Space opens nothing', () =>
{
  assert.equal(spaceToOpen('space-2', 'space-b'), undefined);
});

test('another position opens its Space while a Space is active', () =>
{
  assert.equal(spaceToOpen('space-1', 'space-b'), 'space-a');
});

test('with no active Space the Space at the position opens', () =>
{
  assert.equal(spaceToOpen('space-2', null), 'space-b');
});

test('only space-1 to space-9 parse as a Switch to Space command', () =>
{
  for (const command of ['space-0', 'space-10', 'space-switcher-next', 'prev-used-tab', 'Space-1'])
  {
    assert.equal(SpaceNumberCommand.parse(command), undefined, command);
  }
});
