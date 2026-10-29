import assert from 'node:assert/strict';
import test from 'node:test';

import { subscribeToTabAssociationChanges } from '../src/utils/tabAssociations.ts';

class FakeStorageChangeEvent
{
  listener = null;
  removeCount = 0;

  addListener(listener)
  {
    this.listener = listener;
  }

  removeListener(listener)
  {
    if (this.listener === listener)
    {
      this.listener = null;
      this.removeCount += 1;
    }
  }

  emit(changes, areaName)
  {
    this.listener?.(changes, areaName);
  }
}

test('the Side Panel is notified only when the session associations of its window change', () =>
{
  const event = new FakeStorageChangeEvent();
  let refreshCount = 0;
  const unsubscribe = subscribeToTabAssociationChanges(
    42,
    () => { refreshCount += 1; },
    event
  );

  event.emit({ tabAssociations_42: { newValue: { 1: 'bookmark-a' } } }, 'local');
  event.emit({ tabAssociations_7: { newValue: { 1: 'bookmark-a' } } }, 'session');
  assert.equal(refreshCount, 0);

  event.emit({ tabAssociations_42: { newValue: { 1: 'bookmark-a' } } }, 'session');
  assert.equal(refreshCount, 1);

  unsubscribe();
  assert.equal(event.removeCount, 1);
});
