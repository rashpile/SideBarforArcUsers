import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpaceCards, buildTabCards, findLastUsedTab } from '../src/services/switcherLists.ts';

// The window's Spaces as the lists see them: tab ID -> Space
function windowSpaces(assignments, activeSpaceId = 'home')
{
  return {
    activeSpaceId,
    spaceOf: (tabId) => assignments[tabId],
  };
}

const tab = (id, lastAccessed, extra = {}) => ({ id, lastAccessed, index: id, active: false, ...extra });

test('opening a Space brings its most recently used tab forward', () =>
{
  const tabs = [tab(1, 100), tab(2, 300), tab(3, 200)];

  assert.equal(findLastUsedTab(tabs, 'dev', windowSpaces({ 1: 'dev', 2: 'home', 3: 'dev' })), 3);
});

test('a Space whose tabs are all in other Spaces has no tab to open', () =>
{
  const tabs = [tab(1, 100), tab(2, 300)];

  assert.equal(findLastUsedTab(tabs, 'dev', windowSpaces({ 1: 'home', 2: 'home' })), undefined);
});

// Tab 2 is Space A's Favorite tab: since Favorites are per Space it belongs to A only
test('in Space B the tab list does not offer Space A\'s Favorite tab', () =>
{
  const tabs = [tab(1, 100, { active: true }), tab(2, 300), tab(3, 200)];
  const spaces = windowSpaces({ 1: 'b', 2: 'a', 3: 'b' }, 'b');

  assert.deepEqual(buildTabCards(tabs, spaces).map((card) => card.id), ['1', '3']);
});

test('a Favorite tab counts for its own Space and can be the tab that Space opens on', () =>
{
  const tabs = [tab(1, 100), tab(2, 300), tab(3, 200)];
  const spaces = windowSpaces({ 1: 'a', 2: 'a', 3: 'b' }, 'b');
  const spaceList = [{ id: 'a', name: 'A', icon: '🅰' }, { id: 'b', name: 'B', icon: '🅱' }];

  const subtitles = Object.fromEntries(
    buildSpaceCards(spaceList, tabs, spaces).map((card) => [card.id, card.subtitle]));
  assert.deepEqual(subtitles, { a: '2 tabs', b: '1 tab' });
  assert.equal(findLastUsedTab(tabs, 'a', spaces), 2);
});
