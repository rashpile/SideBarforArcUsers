import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTabsForSpace, filterUnmanagedTabs } from '../src/utils/tabVisibility.ts';

test('only tabs associated with a bookmark or Favorite are hidden', () =>
{
  const tabs = [
    { id: 1, index: 0, title: 'Managed bookmark tab', url: 'https://managed.example', groupId: 8, pinned: false },
    { id: 2, index: 1, title: 'Unmanaged grouped tab', groupId: 8, pinned: true },
    { id: 3, index: 2, title: 'Managed favorite tab', url: 'https://favorite.example', groupId: -1, pinned: false },
    { id: 4, index: 3, title: 'Ordinary tab with bookmark URL', url: 'https://docs.example/page/', groupId: 8, pinned: false },
  ];
  const managedTabIds = new Set([1, 3]);

  const visible = filterUnmanagedTabs(tabs, managedTabIds);

  // A tab opened by hand on a bookmarked URL is not shown under the bookmark,
  // so it has to stay visible as a regular tab
  assert.deepEqual(visible, [tabs[1], tabs[3]]);
  assert.equal(visible[0].groupId, 8);
  assert.equal(visible[0].pinned, true);
});

test('regular tabs are filtered by the Space associations the extension keeps, not by Chrome groupId', () =>
{
  const tabs = [
    { id: 1, title: 'A', groupId: 91 },
    { id: 2, title: 'B', groupId: 91 },
    { id: 3, title: 'C', groupId: -1 },
  ];
  const assignments = { 1: 'space-a', 2: 'space-b', 3: 'space-a' };

  assert.deepEqual(
    filterTabsForSpace(tabs, assignments, 'space-a').map(tab => tab.id),
    [1, 3]
  );
});
