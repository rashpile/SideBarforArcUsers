import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserSessionMarker } from '../src/stores/browserSessionMarker.ts';

const MARKER_KEY = 'testSessionStarted';

// In-memory chrome.storage.session stand-in
function memoryStorage()
{
  const values = {};
  return {
    values,
    get: async (key) => (key in values ? { [key]: values[key] } : {}),
    set: async (entries) => { Object.assign(values, entries); },
  };
}

test('a new browser session has no marker until the restore marks it', async () =>
{
  const storage = memoryStorage();
  const marker = new BrowserSessionMarker(storage, MARKER_KEY);

  assert.equal(await marker.isSameBrowserSession(), false);
  await marker.mark();
  assert.equal(storage.values[MARKER_KEY], true);

  // The next worker of this browser session finds it; a marker under another key does not
  assert.equal(await new BrowserSessionMarker(storage, MARKER_KEY).isSameBrowserSession(), true);
  assert.equal(await new BrowserSessionMarker(storage, 'otherSessionStarted').isSameBrowserSession(), false);
});

test('an unreadable marker counts as a new browser session and a failed write does not throw', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const marker = new BrowserSessionMarker({
    get: async () => { throw new Error('storage unavailable'); },
    set: async () => { throw new Error('storage unavailable'); },
  }, MARKER_KEY);

  assert.equal(await marker.isSameBrowserSession(), false);
  await marker.mark();
});
