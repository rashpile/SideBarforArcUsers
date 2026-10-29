import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBookmarkRowVisualState } from '../src/utils/bookmarkRowVisualState.ts';

test('a single selection of the active pinned tab still uses the active style', () =>
{
  assert.equal(resolveBookmarkRowVisualState({
    isActive: true,
    isSelected: true,
    selectionCount: 1,
  }), 'active');
});

test('a real multi-selection uses the selected style over active', () =>
{
  assert.equal(resolveBookmarkRowVisualState({
    isActive: true,
    isSelected: true,
    selectionCount: 3,
  }), 'selected');
});

test('an unselected inactive pinned tab uses the default style', () =>
{
  assert.equal(resolveBookmarkRowVisualState({
    isActive: false,
    isSelected: false,
    selectionCount: 0,
  }), 'default');
});
