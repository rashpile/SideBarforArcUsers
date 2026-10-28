import assert from 'node:assert/strict';
import test from 'node:test';

import { SectionCollapseState } from '../src/utils/sectionCollapseState.ts';

test('without stored flags Bookmarks is expanded and Archive collapsed', () =>
{
  const state = SectionCollapseState.EMPTY;

  assert.equal(state.isCollapsed('space-1', 'bookmarks'), false);
  assert.equal(state.isCollapsed('space-1', 'archive'), true);
});

test('toggling one section of one Space leaves the other section and other Spaces alone', () =>
{
  const state = SectionCollapseState.EMPTY.toggled('space-1', 'archive');

  assert.equal(state.isCollapsed('space-1', 'archive'), false);
  assert.equal(state.isCollapsed('space-1', 'bookmarks'), false);
  assert.equal(state.isCollapsed('space-2', 'archive'), true);
  assert.equal(state.toggled('space-1', 'archive').isCollapsed('space-1', 'archive'), true);
});

test('stored JSON round-trips; malformed entries fall back to the defaults', () =>
{
  const stored = SectionCollapseState.EMPTY.toggled('space-1', 'bookmarks').toJson();
  assert.equal(SectionCollapseState.fromJson(stored).isCollapsed('space-1', 'bookmarks'), true);

  const malformed = SectionCollapseState.fromJson(JSON.stringify({
    'space-1': { bookmarks: 'yes', archive: false },
    'space-2': 5,
    'space-3': null,
  }));
  assert.equal(malformed.isCollapsed('space-1', 'bookmarks'), false);
  assert.equal(malformed.isCollapsed('space-1', 'archive'), false);
  assert.equal(malformed.isCollapsed('space-2', 'archive'), true);
  assert.equal(malformed.isCollapsed('space-3', 'bookmarks'), false);
  assert.equal(SectionCollapseState.fromJson('[true]').isCollapsed('space-1', 'archive'), true);
  assert.throws(() => SectionCollapseState.fromJson('{not json'));
});

test('while the text filter is active every section shows expanded', () =>
{
  const state = SectionCollapseState.ALL_EXPANDED;

  assert.equal(state.isCollapsed('space-1', 'bookmarks'), false);
  assert.equal(state.isCollapsed('space-1', 'archive'), false);
});
