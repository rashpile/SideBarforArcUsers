import assert from 'node:assert/strict';
import test from 'node:test';

import { TabRowSelection } from '../src/utils/tabRowSelection.ts';

test('an unselected row acts on itself, not on an unrelated multi-selection', () =>
{
  const selection = new TabRowSelection(['1', '2']);

  assert.equal(selection.actsOnSelection(3, -1), false);
  assert.equal(selection.actsOnSelection(3, undefined), false);
});

test('a selected row acts on the multi-selection', () =>
{
  const selection = new TabRowSelection(['1', '2']);

  assert.equal(selection.actsOnSelection(1, -1), true);
  assert.equal(selection.actsOnSelection(2, 7), true);
});

test('a row inside a selected group acts on the multi-selection; a row of another group does not', () =>
{
  const selection = new TabRowSelection(['group-5', '1']);

  assert.equal(selection.actsOnSelection(9, 5), true);
  assert.equal(selection.actsOnSelection(9, 6), false);
});

test('an ungrouped row does not match a group selection through groupId -1', () =>
{
  const selection = new TabRowSelection(['group--1', 'group-5']);

  assert.equal(selection.actsOnSelection(9, -1), false);
});

test('a selection of one item never acts as a multi-selection, even on the selected row', () =>
{
  assert.equal(new TabRowSelection(['1']).actsOnSelection(1, -1), false);
  assert.equal(new TabRowSelection(['group-5']).actsOnSelection(9, 5), false);
  assert.equal(new TabRowSelection([]).actsOnSelection(1, -1), false);
});
