import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveItemDoubleClick } from '../src/utils/itemDoubleClick.ts';

test('item that had a tab before the double-click loads its URL in that tab', () =>
{
  assert.equal(resolveItemDoubleClick({ hadTabOnPress: true, singleClickOpens: true }), 'load-url');
  assert.equal(resolveItemDoubleClick({ hadTabOnPress: true, singleClickOpens: false }), 'load-url');
});

test('tab opened by the first click is not loaded again', () =>
{
  assert.equal(resolveItemDoubleClick({ hadTabOnPress: false, singleClickOpens: true }), 'none');
});

test('without single-click opening, the double-click opens the item', () =>
{
  assert.equal(resolveItemDoubleClick({ hadTabOnPress: false, singleClickOpens: false }), 'open');
});
