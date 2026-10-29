import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveArcFolderIconState } from '../src/utils/folderIconState.ts';

test('the folder icon switches between the Arc collapsed, expanded and active peek states', () =>
{
  assert.equal(resolveArcFolderIconState(false, false), 'collapsed');
  assert.equal(resolveArcFolderIconState(true, false), 'expanded');
  assert.equal(resolveArcFolderIconState(false, true), 'active-peek');

  // An expanded folder shows the open icon; its active child still shows but doesn't override it.
  assert.equal(resolveArcFolderIconState(true, true), 'expanded');
});
