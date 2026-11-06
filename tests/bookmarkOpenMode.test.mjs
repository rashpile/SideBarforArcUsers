import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBookmarkOpenMode } from '../src/utils/bookmarkOpenMode.ts';

// The sidebar and the search popup both read the setting through this parser, so a wrong mode
// would make a bookmark replace the active tab or open a duplicate tab in either of them
test('parseBookmarkOpenMode migrates the old boolean and defaults to arc', () =>
{
  assert.equal(parseBookmarkOpenMode('true'), 'arc');
  assert.equal(parseBookmarkOpenMode('false'), 'newTab');
  assert.equal(parseBookmarkOpenMode('arc'), 'arc');
  assert.equal(parseBookmarkOpenMode('newTab'), 'newTab');
  assert.equal(parseBookmarkOpenMode('activeTab'), 'activeTab');
  assert.equal(parseBookmarkOpenMode('"arc"'), 'arc');
  assert.equal(parseBookmarkOpenMode('"activeTab"'), 'arc');
  assert.equal(parseBookmarkOpenMode(undefined), 'arc');
  assert.equal(parseBookmarkOpenMode(true), 'arc');
});
