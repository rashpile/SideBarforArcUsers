import assert from 'node:assert/strict';
import test from 'node:test';

import { isActivationForWindow } from '../src/utils/tabActivationScope.ts';

test('only native tab activations in the Side Panel window are accepted', () =>
{
  assert.equal(isActivationForWindow(9, { windowId: 9 }), true);
  assert.equal(isActivationForWindow(9, { windowId: 10 }), false);
  assert.equal(isActivationForWindow(null, { windowId: 9 }), false);
});
