import assert from 'node:assert/strict';
import test from 'node:test';

import { getArcTabSectionItems } from '../src/utils/arcTabSection.ts';

test('the Arc tab section shows New Tab first, then the regular tabs', () =>
{
  const tabs = [{ id: 1 }, { id: 2 }];

  assert.deepEqual(getArcTabSectionItems(tabs), [
    { type: 'new-tab' },
    { type: 'tab', tab: tabs[0] },
    { type: 'tab', tab: tabs[1] },
  ]);
});
