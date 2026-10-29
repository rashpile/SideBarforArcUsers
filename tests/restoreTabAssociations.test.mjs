import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreTabAssociations } from '../src/utils/restoreTabAssociations.ts';

test('restoring pinned tab associations checks all tabs concurrently', async () =>
{
  const associations = {
    11: 'bookmark-a',
    22: 'bookmark-b',
    33: 'bookmark-c',
  };
  const started = [];
  const resolvers = new Map();

  const restoring = restoreTabAssociations(associations, (tabId) =>
  {
    started.push(tabId);
    return new Promise(resolve => resolvers.set(tabId, resolve));
  });

  await Promise.resolve();
  assert.deepEqual(started, [11, 22, 33]);

  resolvers.get(11)({ id: 11, title: 'A', audible: true });
  resolvers.get(22)(null);
  resolvers.get(33)({ id: 33, title: 'C', mutedInfo: { muted: true } });

  const result = await restoring;
  assert.deepEqual(result.associations, {
    11: 'bookmark-a',
    33: 'bookmark-c',
  });
  assert.equal(result.itemToTab.get('bookmark-a'), 11);
  assert.equal(result.itemToTab.get('bookmark-c'), 33);
  assert.equal(result.tabTitles.get(11), 'A');
  assert.equal(result.audibleTabs.has(11), true);
  assert.equal(result.mutedTabs.has(33), true);
});
