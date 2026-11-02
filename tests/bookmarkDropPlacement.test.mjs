import assert from 'node:assert/strict';
import test from 'node:test';

import { BookmarkDropPlacement, spaceRootDropPosition } from '../src/utils/bookmarkDropPlacement.ts';

const SPACE_FOLDER_ID = 'space-folder';
const SPACE_FOLDER_NODE = { parentId: 'space-parent', index: 4 };
const POSITIONS = ['before', 'after', 'into', 'intoFirst'];

test('every position on the Space root becomes into', () =>
{
  for (const position of POSITIONS)
  {
    assert.equal(spaceRootDropPosition(SPACE_FOLDER_ID, position, SPACE_FOLDER_ID), 'into', position);
  }
});

test('positions on any other target pass through unchanged', () =>
{
  for (const position of POSITIONS)
  {
    assert.equal(spaceRootDropPosition('bookmark-1', position, SPACE_FOLDER_ID), position, position);
  }
});

test('every drop on the Space root appends inside the Space folder, never in its parent', () =>
{
  for (const position of POSITIONS)
  {
    for (const isFolder of [true, false])
    {
      const placement = BookmarkDropPlacement.resolve(
        SPACE_FOLDER_ID, SPACE_FOLDER_NODE, position, isFolder, SPACE_FOLDER_ID
      );
      const label = `${position}, isFolder=${isFolder}`;
      assert.equal(placement.parentId, SPACE_FOLDER_ID, label);
      assert.equal(placement.index, undefined, label);
    }
  }
});

test('before and after a regular bookmark go next to it in its parent', () =>
{
  const node = { parentId: 'parent-folder', index: 3 };

  const before = BookmarkDropPlacement.resolve('bookmark-1', node, 'before', false, SPACE_FOLDER_ID);
  assert.equal(before.parentId, 'parent-folder');
  assert.equal(before.index, 3);

  const after = BookmarkDropPlacement.resolve('bookmark-1', node, 'after', false, SPACE_FOLDER_ID);
  assert.equal(after.parentId, 'parent-folder');
  assert.equal(after.index, 4);
});

test('into a regular folder appends to that folder', () =>
{
  const placement = BookmarkDropPlacement.resolve(
    'folder-1', { parentId: 'parent-folder', index: 2 }, 'into', true, SPACE_FOLDER_ID
  );
  assert.equal(placement.parentId, 'folder-1');
  assert.equal(placement.index, undefined);
});

test('intoFirst on a regular folder puts the item at the top of that folder', () =>
{
  const placement = BookmarkDropPlacement.resolve(
    'folder-1', { parentId: 'parent-folder', index: 2 }, 'intoFirst', true, SPACE_FOLDER_ID
  );
  assert.equal(placement.parentId, 'folder-1');
  assert.equal(placement.index, 0);
});

test('without a Space folder id, positions pass through and before a folder goes next to it', () =>
{
  for (const spaceFolderId of [null, undefined])
  {
    assert.equal(spaceRootDropPosition(SPACE_FOLDER_ID, 'before', spaceFolderId), 'before');

    const placement = BookmarkDropPlacement.resolve(
      SPACE_FOLDER_ID, SPACE_FOLDER_NODE, 'before', true, spaceFolderId
    );
    assert.equal(placement.parentId, 'space-parent');
    assert.equal(placement.index, 4);
  }
});

test('a missing target node falls back to the target id as parent', () =>
{
  const placement = BookmarkDropPlacement.resolve('bookmark-1', null, 'after', false, SPACE_FOLDER_ID);
  assert.equal(placement.parentId, 'bookmark-1');
  assert.equal(placement.index, undefined);
});
