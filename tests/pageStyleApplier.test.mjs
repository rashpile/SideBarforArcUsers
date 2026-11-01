import assert from 'node:assert/strict';
import test from 'node:test';

import { PageStyleApplier } from '../src/services/pageStyleApplier.ts';
import { SavedPageStyles } from '../src/stores/savedPageStyles.ts';

const WINDOW_ID = 1;
const VIDEO_CSS = 'video { width: 100% !important; }';

const entry = (css, autoApply, origin, rev) => ({ css, autoApply, origin, rev });

// Bookmark 10 and Favorite 20 have saved styles for videos.test; bookmark 30 has Auto-apply off
const DEFAULT_STYLES = {
  10: entry(VIDEO_CSS, true, 'https://videos.test', 'r1'),
  20: entry('main { max-width: none !important; }', true, 'https://videos.test', 'r2'),
  30: entry(VIDEO_CSS, false, 'https://videos.test', 'r3'),
};

// An applier over fake tabs; `inserted` records every insertCss call as [tabId, text]
function createApplier({
  tabs = [],
  associations = {},
  styles = DEFAULT_STYLES,
  markers = {},
  ready = true,
  sameBrowserSession = false,
} = {})
{
  const inserted = [];
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
      markers[tabId] = /--sidebar-page-agent: "([^"]*)"/.exec(text)?.[1] ?? '';
    },
    readMarker: async (tabId) =>
    {
      markerReads.push(tabId);
      return markers[tabId] ?? '';
    },
    debug: false,
  });
  return { applier, inserted, markerReads, savedStyles };
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

test('loadComplete inserts only into a page without the agent\'s sheet', async () =>
{
  const { applier, inserted } = createApplier({
    tabs: [tab(1, 'https://videos.test/u/1'), tab(2, 'https://videos.test/u/2'), tab(3, 'https://videos.test/u/3')],
    associations: { 1: 'bookmark-10', 2: 'bookmark-10', 3: 'bookmark-10' },
    // 2 already has the saved sheet; 3 has a sheet of the chat's own run
    markers: { 1: '', 2: 'saved-r1', 3: 'run-abc' },
  });

  await applier.loadComplete(1);
  await applier.loadComplete(2);
  await applier.loadComplete(3);

  assert.deepEqual(inserted.map(([tabId]) => tabId), [1]);
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
