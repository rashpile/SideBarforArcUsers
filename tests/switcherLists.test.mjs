import assert from 'node:assert/strict';
import test from 'node:test';

import { findLastUsedTab } from '../src/services/switcherLists.ts';

// The window's Spaces as the lists see them: tab ID -> Space, plus the Favorites' tab IDs
function windowSpaces(assignments, favoriteTabIds = [])
{
  return {
    activeSpaceId: 'home',
    spaceOf: (tabId) => assignments[tabId],
    isFavorite: (tabId) => favoriteTabIds.includes(tabId),
  };
}

const tab = (id, lastAccessed) => ({ id, lastAccessed, index: id, active: false });

test('opening a Space brings its most recently used tab forward', () =>
{
  const tabs = [tab(1, 100), tab(2, 300), tab(3, 200)];

  assert.equal(findLastUsedTab(tabs, 'dev', windowSpaces({ 1: 'dev', 2: 'home', 3: 'dev' })), 3);
});

test('a Favorite is never the tab a Space opens on, even when it was used last', () =>
{
  const tabs = [tab(1, 100), tab(2, 300)];

  assert.equal(findLastUsedTab(tabs, 'dev', windowSpaces({ 1: 'dev', 2: 'dev' }, [2])), 1);
});

test('a Space whose only tabs are Favorites or in other Spaces has no tab to open', () =>
{
  const tabs = [tab(1, 100), tab(2, 300)];

  assert.equal(findLastUsedTab(tabs, 'dev', windowSpaces({ 1: 'home', 2: 'dev' }, [2])), undefined);
});
