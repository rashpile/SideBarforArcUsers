import assert from 'node:assert/strict';
import test from 'node:test';

import { PageStyleApplier } from '../src/services/pageStyleApplier.ts';
import { SavedPageStyles } from '../src/stores/savedPageStyles.ts';

const WINDOW_ID = 1;
const VIDEO_CSS = 'video { width: 100% !important; }';

const entry = (css, autoApply, origin, rev, script = '') => ({ css, autoApply, origin, rev, script });

// Bookmark 10 and Favorite 20 have saved styles for videos.test; bookmark 30 has Auto-apply off
const DEFAULT_STYLES = {
  10: entry(VIDEO_CSS, true, 'https://videos.test', 'r1'),
  20: entry('main { max-width: none !important; }', true, 'https://videos.test', 'r2'),
  30: entry(VIDEO_CSS, false, 'https://videos.test', 'r3'),
};

// An applier over fake tabs; `inserted` records every insertCss call as [tabId, text], `ran` every
// runScript call as [tabId, url, code], and `pageCalls` both in order as ['css' | 'script', tabId]
function createApplier({
  tabs = [],
  associations = {},
  styles = DEFAULT_STYLES,
  markers = {},
  ready = true,
  sameBrowserSession = false,
  scriptsAvailable = true,
} = {})
{
  const inserted = [];
  const ran = [];
  const pageCalls = [];
  const markerReads = [];
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
  const savedStyles = SavedPageStyles.fromStored(styles);
  const applier = new PageStyleApplier({
    ready: Promise.resolve(ready),
    sameBrowserSession: Promise.resolve(sameBrowserSession),
    associationsOf: async (windowId) => (windowId === WINDOW_ID ? associations : {}),
    styles: () => savedStyles,
    getTab: async (tabId) =>
    {
      const tab = tabsById.get(tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      return tab;
    },
    queryTabs: async () => tabs,
    // Like chrome.scripting.insertCSS, the sheet is on the page only when the call resolves
    insertCss: async (tabId, text) =>
    {
      await new Promise(resolve => setImmediate(resolve));
      inserted.push([tabId, text]);
      pageCalls.push(['css', tabId]);
      markers[tabId] = /--sidebar-page-agent: "([^"]*)"/.exec(text)?.[1] ?? '';
    },
    scriptsAvailable: () => scriptsAvailable,
    runScript: async (tabId, url, code) =>
    {
      await new Promise(resolve => setImmediate(resolve));
      ran.push([tabId, url, code]);
      pageCalls.push(['script', tabId]);
    },
    readMarker: async (tabId) =>
    {
      markerReads.push(tabId);
      return markers[tabId] ?? '';
    },
    debug: false,
  });
  return { applier, inserted, ran, pageCalls, markerReads, savedStyles };
}

const tab = (id, url, extra = {}) => ({ id, windowId: WINDOW_ID, url, incognito: false, ...extra });

test('a commit in a bookmark\'s or a Favorite\'s tab on the saved origin inserts the saved style', async () =>
{
  const { applier, inserted, savedStyles } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2?t=5')],
    associations: { 1: 'bookmark-10', 2: 'pinned-20' },
  });

  await applier.committed(1, 0, []);
  await applier.committed(2, 0, ['from_address_bar']);

  assert.deepEqual(inserted, [
    [1, savedStyles.styleFor('10').insertedText],
    [2, savedStyles.styleFor('20').insertedText],
  ]);
  assert.match(inserted[0][1], /--sidebar-page-agent: "saved-r1"/);
});

test('no style goes to a hand-opened tab, another item, another site, Auto-apply off, unsafe CSS or incognito', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [
      tab(1, 'https://videos.test/u/1'),
      tab(2, 'https://videos.test/u/1'),
      tab(3, 'https://other.test/u/1'),
      tab(4, 'https://videos.test/u/1'),
      tab(5, 'https://videos.test/u/1'),
      tab(6, 'https://videos.test/u/1', { incognito: true }),
      tab(7, 'chrome://settings'),
      tab(8, 'https://videos.test/u/1'),
    ],
    associations: {
      // 1 is a hand-opened tab: no association
      2: 'tab-77',
      3: 'bookmark-10',
      4: 'bookmark-30',
      5: 'bookmark-40',
      6: 'bookmark-10',
      7: 'bookmark-10',
      8: 'bookmark-99',
    },
    styles: {
      ...DEFAULT_STYLES,
      40: entry('@import "https://evil.test/x.css";\nvideo { width: 100% !important; }', true, 'https://videos.test', 'r4'),
    },
  });

  for (const id of [1, 2, 3, 4, 5, 6, 7, 8])
  {
    await applier.committed(id, 0, []);
    await applier.loadComplete(id);
  }
  await applier.sweep();

  assert.deepEqual(inserted, []);
});

test('CSS the user wrote with a remote url() is inserted in the bookmark\'s tab; the same CSS from the agent is not', async () =>
{
  const remoteCss = 'body { background: url("https://images.test/bg.png") !important; }';
  const { applier, inserted, savedStyles } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2')],
    associations: { 1: 'bookmark-80', 2: 'bookmark-90' },
    styles: {
      80: { ...entry(remoteCss, true, 'https://videos.test', 'r8'), cssByUser: true },
      90: entry(remoteCss, true, 'https://videos.test', 'r9'),
    },
  });

  for (const id of [1, 2])
  {
    await applier.committed(id, 0, []);
    await applier.loadComplete(id);
  }
  await applier.sweep();

  assert.deepEqual(inserted, [[1, savedStyles.styleFor('80').insertedText]]);
  assert.match(inserted[0][1], /images\.test\/bg\.png/);
});

test('nothing is applied when the association restore failed', async () =>
{
  const { applier, inserted, markerReads } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1')],
    associations: { 1: 'bookmark-10' },
    ready: false,
  });

  await applier.committed(1, 0, []);
  await applier.loadComplete(1);
  await applier.sweep();
  await applier.start();

  assert.deepEqual(inserted, []);
  assert.deepEqual(markerReads, []);
});

test('loadComplete after a back/forward commit inserts only into a page without the agent\'s sheet', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2'), tab(3, 'https://videos.test/u/3')],
    associations: { 1: 'bookmark-10', 2: 'bookmark-10', 3: 'bookmark-10' },
    // 1 is a fresh document; 2 came back from the cache with the saved sheet; 3 with the chat's own run's
    markers: { 1: '', 2: 'saved-r1', 3: 'run-abc' },
  });

  for (const id of [1, 2, 3])
  {
    await applier.committed(id, 0, ['forward_back']);
    await applier.loadComplete(id);
  }

  assert.deepEqual(inserted.map(([tabId]) => tabId), [1]);
});

test('a later load complete of the same page, after a late iframe load, does not put back a style removed with Undo', async () =>
{
  const markers = {};
  // Tab 2's association is stored only after its page committed (a bookmark opened on a cached page)
  const associations = { 1: 'bookmark-10', 3: 'bookmark-10' };
  const { applier, inserted, markerReads } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2'), tab(3, 'https://videos.test/u/3')],
    associations,
    markers,
  });
  const insertedInto = () => inserted.map(([tabId]) => tabId);

  // Each page gets the style once: 1 from its commit, 2 and 3 from the load-complete check
  await applier.committed(1, 0, []);
  await applier.committed(2, 0, []);
  associations[2] = 'bookmark-10';
  await applier.committed(3, 0, ['forward_back']);
  for (const id of [1, 2, 3]) await applier.loadComplete(id);

  assert.deepEqual(insertedInto(), [1, 2, 3]);
  // The commit's insert landed, so tab 1's load complete had nothing to check
  assert.deepEqual(markerReads, [2, 3]);

  // The user presses Undo on every tab, then a late iframe load reports 'complete' again
  for (const id of [1, 2, 3])
  {
    markers[id] = '';
    await applier.loadComplete(id);
  }

  assert.deepEqual(insertedInto(), [1, 2, 3]);
  assert.deepEqual(markerReads, [2, 3]);

  // Undo holds for the document only: a reload commits a new one, which gets the style again
  await applier.committed(1, 0, []);
  await applier.loadComplete(1);

  assert.deepEqual(insertedInto(), [1, 2, 3, 1]);
});

test('a commit and the load-complete check of the same page insert the style once', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1')],
    associations: { 1: 'bookmark-10' },
  });

  await Promise.all([applier.committed(1, 0, []), applier.loadComplete(1)]);

  assert.equal(inserted.length, 1);
});

test('a back/forward commit and a subframe commit insert nothing', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1')],
    associations: { 1: 'bookmark-10' },
  });

  await applier.committed(1, 0, ['forward_back']);
  await applier.committed(1, 0, ['forward_back', 'from_address_bar']);
  await applier.committed(1, 3, []);

  assert.deepEqual(inserted, []);
});

test('start in a new browser session inserts into an already-loaded bookmark tab', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/1'), tab(3, 'https://videos.test/u/2')],
    associations: { 1: 'bookmark-10', 3: 'pinned-20' },
    sameBrowserSession: false,
  });

  await applier.start();

  assert.deepEqual(inserted.map(([tabId]) => tabId).sort(), [1, 3]);
});

test('start on a worker restart leaves a bookmark tab without the sheet alone, so an Undo stays undone', async () =>
{
  const { applier, inserted, markerReads } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1')],
    associations: { 1: 'bookmark-10' },
    markers: { 1: '' },
    sameBrowserSession: true,
  });

  await applier.start();

  assert.deepEqual(inserted, []);
  assert.deepEqual(markerReads, []);
});

const SEEK_SCRIPT = "agent.on(document, 'keydown', () => {});";

// Bookmark 50 has CSS and a script, Favorite 60 a script only
const SCRIPT_STYLES = {
  ...DEFAULT_STYLES,
  50: entry(VIDEO_CSS, true, 'https://videos.test', 'r5', SEEK_SCRIPT),
  60: entry('', true, 'https://videos.test', 'r6', SEEK_SCRIPT),
};

test('a saved script runs in the bookmark\'s tab after its sheet, also for a script-only style', async () =>
{
  const { applier, inserted, ran, pageCalls, savedStyles } = createApplier({
    tabs: [tab(1, 'https://videos.test/watch?v=1'), tab(2, 'https://videos.test/watch?v=2'), tab(3, 'https://videos.test/u/3')],
    associations: { 1: 'bookmark-50', 2: 'pinned-60', 3: 'bookmark-10' },
    styles: SCRIPT_STYLES,
  });

  await applier.committed(1, 0, []);
  await applier.committed(2, 0, []);
  await applier.committed(3, 0, []);

  assert.deepEqual(pageCalls, [['css', 1], ['script', 1], ['css', 2], ['script', 2], ['css', 3]]);
  assert.deepEqual(ran, [
    [1, 'https://videos.test/watch?v=1', SEEK_SCRIPT],
    [2, 'https://videos.test/watch?v=2', SEEK_SCRIPT],
  ]);
  // The script-only style still gets the marker sheet, so the page shows the saved set is on it
  assert.equal(inserted[1][1], savedStyles.styleFor('60').insertedText);
  assert.match(inserted[1][1], /--sidebar-page-agent: "saved-r6"/);
});

test('with user scripts unavailable only the sheet goes in', async () =>
{
  const { applier, inserted, ran } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1')],
    associations: { 1: 'bookmark-50' },
    styles: SCRIPT_STYLES,
    scriptsAvailable: false,
  });

  await applier.committed(1, 0, []);
  await applier.loadComplete(1);

  assert.equal(inserted.length, 1);
  assert.deepEqual(ran, []);
});

test('a page that already has the agent\'s marker gets neither the sheet nor the script again', async () =>
{
  const { applier, pageCalls } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2')],
    associations: { 1: 'bookmark-50', 2: 'pinned-60' },
    styles: SCRIPT_STYLES,
    // 1 came back from the cache with the saved set; 2 has the chat's own run
    markers: { 1: 'saved-r5', 2: 'run-abc' },
  });

  for (const id of [1, 2])
  {
    await applier.committed(id, 0, ['forward_back']);
    await applier.loadComplete(id);
  }
  await applier.sweep();

  assert.deepEqual(pageCalls, []);
});

test('a hand-opened tab of the saved site and a style with an oversized script get no script', async () =>
{
  const { applier, pageCalls } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/1')],
    // 1 is a hand-opened tab: no association
    associations: { 2: 'bookmark-70' },
    styles: {
      ...SCRIPT_STYLES,
      70: entry(VIDEO_CSS, true, 'https://videos.test', 'r7', 'x'.repeat(64 * 1024 + 1)),
    },
  });

  for (const id of [1, 2])
  {
    await applier.committed(id, 0, []);
    await applier.loadComplete(id);
  }
  await applier.sweep();

  assert.deepEqual(pageCalls, []);
});
