import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNewFolderParentId } from '../src/utils/newFolderSelection.ts';

test('selected items under one parent form the new folder in that parent', () =>
{
  const nodes = [
    { id: 'a', parentId: 'same-parent' },
    { id: 'b', parentId: 'same-parent' },
  ];

  assert.equal(resolveNewFolderParentId(nodes, 'space-root'), 'same-parent');
});

test('selected items from different parents move to the current Space root', () =>
{
  const nodes = [
    { id: 'a', parentId: 'parent-a' },
    { id: 'b', parentId: 'parent-b' },
  ];

  assert.equal(resolveNewFolderParentId(nodes, 'space-root'), 'space-root');
});

test('without a Space folder setting, the parent of the first selected item is used', () =>
{
  const nodes = [
    { id: 'a', parentId: 'parent-a' },
    { id: 'b', parentId: 'parent-b' },
  ];

  assert.equal(resolveNewFolderParentId(nodes, null), 'parent-a');
});
