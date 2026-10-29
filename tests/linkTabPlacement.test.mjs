import assert from 'node:assert/strict';
import test from 'node:test';

import { tabListTopIndexForLinkTab } from '../src/utils/linkTabPlacement.ts';

// Window strip: Tab list tabs 1 and 2, the bookmark tab 7 (hidden from the Tab
// list) between them, and the new tab 9 that Chrome put right after its opener
const tabListTabs = [
  { id: 1, index: 0 },
  { id: 2, index: 2 },
  { id: 9, index: 4 },
];

test('a tab opened from a bookmark tab goes to the top of the Tab list', () =>
{
  const index = tabListTopIndexForLinkTab({ id: 9, index: 4 }, 'bookmark-42', tabListTabs);

  assert.equal(index, 0);
});

test('a tab opened from a Favorite tab goes to the top of the Tab list', () =>
{
  const index = tabListTopIndexForLinkTab({ id: 9, index: 4 }, 'pinned-abc', tabListTabs);

  assert.equal(index, 0);
});

test('a tab opened from a regular tab stays where Chrome put it, next to its opener', () =>
{
  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 4 }, undefined, tabListTabs), undefined);
});

test('a tab already above every other Tab list tab is not moved', () =>
{
  const tabs = [{ id: 9, index: 1 }, { id: 1, index: 3 }];

  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 1 }, 'bookmark-42', tabs), undefined);
});

test('a tab that is alone in the Tab list is not moved', () =>
{
  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 4 }, 'bookmark-42', [{ id: 9, index: 4 }]), undefined);
});

test('Chrome-pinned tabs stay first: the tab goes right after them', () =>
{
  const tabs = [
    { id: 1, index: 0, pinned: true },
    { id: 2, index: 3 },
    { id: 9, index: 5 },
  ];

  assert.equal(tabListTopIndexForLinkTab({ id: 9, index: 5 }, 'bookmark-42', tabs), 3);
});
