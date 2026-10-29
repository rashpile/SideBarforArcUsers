import assert from 'node:assert/strict';
import test from 'node:test';

import { tabListTopIndexForLinkTab } from '../src/utils/linkTabPlacement.ts';

// Window strip: Tab list tabs 1 and 2, a tab 5 of another Space, the bookmark
// tab 7 (hidden from the Tab list), and the new tab 9 that Chrome put right
// after its opener
const strip = [
  { id: 1, index: 0, groupId: -1 },
  { id: 5, index: 1, groupId: -1 },
  { id: 2, index: 2, groupId: -1 },
  { id: 7, index: 3, groupId: -1 },
  { id: 9, index: 4, groupId: -1 },
];
const tabListIds = new Set([1, 2, 9]);
const newTab = { id: 9, index: 4 };

test('a tab opened from a bookmark tab goes to the top of the Tab list', () =>
{
  const opener = { index: 3, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab(newTab, opener, strip, tabListIds), 0);
});

test('a tab opened from a Favorite tab goes to the top of the Tab list', () =>
{
  const opener = { index: 3, itemKey: 'pinned-abc' };

  assert.equal(tabListTopIndexForLinkTab(newTab, opener, strip, tabListIds), 0);
});

test('a tab opened from a regular tab stays where Chrome put it, next to its opener', () =>
{
  const opener = { index: 3, itemKey: undefined };

  assert.equal(tabListTopIndexForLinkTab(newTab, opener, strip, tabListIds), undefined);
});

test('a tab Chrome appended at the end (Cmd+T, the + button) is not moved, even with a bookmark tab active', () =>
{
  // Chrome gives such a tab the active tab as its opener, but puts it at the
  // end of the strip rather than right after the opener
  const opener = { index: 1, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab(newTab, opener, strip, tabListIds), undefined);
});

test('a tab already above every other Tab list tab is not moved', () =>
{
  const tabs = [
    { id: 7, index: 0, groupId: -1 },
    { id: 9, index: 1, groupId: -1 },
    { id: 1, index: 2, groupId: -1 },
  ];
  const opener = { index: 0, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 1 }, opener, tabs, new Set([9, 1])), undefined);
});

test('a tab that is alone in the Tab list is not moved', () =>
{
  const opener = { index: 3, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab(newTab, opener, strip, new Set([9])), undefined);
});

test('Chrome-pinned tabs stay first: the tab goes right after them', () =>
{
  const tabs = [
    { id: 1, index: 0, groupId: -1, pinned: true },
    { id: 2, index: 1, groupId: -1 },
    { id: 7, index: 2, groupId: -1 },
    { id: 9, index: 3, groupId: -1 },
  ];
  const opener = { index: 2, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 3 }, opener, tabs, new Set([1, 2, 9])), 1);
});

test('the tab goes before a Chrome group whose first member is hidden, not into the group', () =>
{
  // Group 30 starts with tab 5 of another Space; the Tab list's first tab 2 is its second member.
  // Moving to tab 2's index would put the new tab between two members, and Chrome would add it to the group.
  const tabs = [
    { id: 5, index: 0, groupId: 30 },
    { id: 2, index: 1, groupId: 30 },
    { id: 7, index: 2, groupId: -1 },
    { id: 9, index: 3, groupId: -1 },
  ];
  const opener = { index: 2, itemKey: 'bookmark-42' };

  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 3 }, opener, tabs, new Set([2, 9])), 0);
});
