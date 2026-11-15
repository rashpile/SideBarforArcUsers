import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskSpaceArchiver } from '../src/services/taskSpaceArchiver.ts';
import { SerialQueue } from '../src/utils/serialQueue.ts';
import { TaskSpaceLastUse } from '../src/stores/taskSpaceLastUse.ts';
import { ARCHIVE_FOLDER_TITLE } from '../src/utils/archiveFolder.ts';
import { FAVORITES_FOLDER_TITLE } from '../src/utils/favoritesFolder.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;
// Older than the 7-day period every test runs with
const CREATED = NOW - 10 * DAY;

const taskSpace = (id) => ({
  id,
  name: id,
  icon: 'list-todo',
  color: 'green',
  bookmarkFolderPath: '',
  bookmarkFolderSegments: ['Other Bookmarks', 'Tasks Spaces', id],
  task: { createdAt: CREATED },
});

const regularSpace = (id, segments = ['Other Bookmarks', id]) => ({
  id,
  name: id,
  icon: 'Briefcase',
  color: 'blue',
  bookmarkFolderPath: '',
  bookmarkFolderSegments: segments,
});

// An inactive, unpinned tab of window 1 on its own page, last accessed long before the run
const tab = (id, fields = {}) => ({
  id,
  windowId: 1,
  active: false,
  audible: false,
  pinned: false,
  incognito: false,
  url: `https://site${id}.test/`,
  title: `Site ${id}`,
  lastAccessed: CREATED,
  ...fields,
});

// Other Bookmarks holds `Tasks Spaces/<id>` for every Task Space and `<id>` for every regular
// Space, each with folderChildren[id] inside; Spaces listed in missingFolders have no folder
function bookmarkTree(spaces, folderChildren, missingFolders)
{
  const folderOf = (space) => ({ id: `folder-${space.id}`, title: space.id, children: folderChildren[space.id] ?? [] });
  const withFolder = spaces.filter(space => !missingFolders.includes(space.id));
  return [{
    id: '0',
    title: '',
    children: [{
      id: 'other',
      title: 'Other Bookmarks',
      children: [
        { id: 'tasks', title: 'Tasks Spaces', children: withFolder.filter(space => space.task).map(folderOf) },
        ...withFolder.filter(space => !space.task).map(folderOf),
      ],
    }],
  }];
}

// The archiver over fakes. registry: tab ID -> Space ID; associations: tab ID -> item key (window 1).
// `world` is what the fakes read now: tests change it from onSave to act during the run.
function setup({
  spaces = [taskSpace('t1')],
  tabs = [],
  registry = {},
  associations = {},
  folderChildren = {},
  missingFolders = [],
  period = '7d',
  startupOk = true,
  marksLoaded = true,
  marked = [],
  activeSpaceIds = [],
  failSaveUrls = [],
  failArchiveIds = [],
} = {})
{
  const events = [];
  const world = {
    tabs: new Map(tabs.map(snapshot => [snapshot.id, { ...snapshot }])),
    marked: new Set(marked),
    activeSpaceIds: [...activeSpaceIds],
    onSave: () => {},
  };

  const archiver = new TaskSpaceArchiver({
    queue: new SerialQueue(),
    startupRestoreSucceeded: async () => startupOk,
    tabMarksLoaded: () => marksLoaded,
    isTabMarked: (tabId) => world.marked.has(tabId),
    readPeriod: async () => period,
    getSpaces: () => spaces,
    readLastUse: async () => TaskSpaceLastUse.EMPTY,
    activeSpaceIds: async () => world.activeSpaceIds,
    queryTabs: async () => tabs,
    getTab: async (tabId) => world.tabs.get(tabId),
    spaceOf: (_windowId, tabId) => registry[tabId],
    associationsOf: async () => associations,
    getTree: async () => bookmarkTree(spaces, folderChildren, missingFolders),
    archivePage: async (folderId, page) =>
    {
      if (failSaveUrls.includes(page.url)) throw new Error('create failed');
      events.push(`save ${folderId} ${page.url}`);
      world.onSave();
      return { id: 'saved' };
    },
    archiveSpaces: async (ids) =>
    {
      if (ids.some(id => failArchiveIds.includes(id))) throw new Error('storage failed');
      events.push(`archive ${ids.join(',')}`);
    },
    beforeClose: (tabIds) => events.push(`beforeClose ${tabIds.join(',')}`),
    removeTabs: async (tabIds) =>
    {
      events.push(`remove ${tabIds.join(',')}`);
      for (const tabId of tabIds) world.tabs.delete(tabId);
    },
    alarms: { get: async () => undefined, create: async () => {}, clear: async () => true },
    session: { get: async () => ({}), set: async () => {} },
    now: () => NOW,
    debug: false,
  });

  const run = async () =>
  {
    await archiver.run();
    return events;
  };
  return { run, world };
}

// What a run did, with the save events reduced to their URLs
async function outcome(options)
{
  const events = await setup(options).run();
  return {
    saved: events.filter(event => event.startsWith('save ')).map(event => event.split(' ')[2]),
    archived: events.filter(event => event.startsWith('archive ')).map(event => event.slice('archive '.length)),
    closed: events.filter(event => event.startsWith('remove ')).flatMap(event => event.slice('remove '.length).split(',').map(Number)),
  };
}

const NOTHING = { saved: [], archived: [], closed: [] };

test('a failed startup restore, unloaded tab marks or the Never setting archive and close nothing', async () =>
{
  const base = { tabs: [tab(1)], registry: { 1: 't1' } };

  assert.deepEqual(await outcome({ ...base, startupOk: false }), NOTHING);
  assert.deepEqual(await outcome({ ...base, marksLoaded: false }), NOTHING);
  assert.deepEqual(await outcome({ ...base, period: 'never' }), NOTHING);
});

test('an unused Task Space saves its regular tab to its folder, then archives and closes it', async () =>
{
  const events = await setup({ tabs: [tab(1)], registry: { 1: 't1' } }).run();

  assert.deepEqual(events, [
    'save folder-t1 https://site1.test/',
    'archive t1',
    'beforeClose 1',
    'remove 1',
  ]);
});

test('a bookmark tab on its bookmark\'s page closes without a save, one that navigated away is saved', async () =>
{
  const result = await outcome({
    tabs: [tab(1), tab(2, { url: 'https://elsewhere.test/' })],
    registry: { 1: 't1', 2: 't1' },
    associations: { 1: 'bookmark-b1', 2: 'bookmark-b2' },
    folderChildren: { t1: [{ id: 'b1', url: 'https://site1.test/' }, { id: 'b2', url: 'https://site2.test/' }] },
  });

  assert.deepEqual(result, { saved: ['https://elsewhere.test/'], archived: ['t1'], closed: [1, 2] });
});

test('a Favorite tab on another page is saved, a tab on a Favorite\'s page and an empty page are not', async () =>
{
  const result = await outcome({
    tabs: [
      tab(1, { url: 'https://other.test/' }),
      tab(2, { url: 'https://fav.test/' }),
      tab(3, { url: 'chrome://newtab/' }),
    ],
    registry: { 1: 't1', 2: 't1', 3: 't1' },
    associations: { 1: 'pinned-f1', 2: 'pinned-f1' },
    folderChildren: { t1: [{ id: 'favorites', title: FAVORITES_FOLDER_TITLE, children: [{ id: 'f1', url: 'https://fav.test/' }] }] },
  });

  assert.deepEqual(result, { saved: ['https://other.test/'], archived: ['t1'], closed: [1, 2, 3] });
});

test('a marked, audible, Chrome-pinned or active tab keeps its Task Space with all its tabs', async () =>
{
  const cases = [
    { marked: [2] },
    { keptTab: { audible: true } },
    { keptTab: { pinned: true } },
    { keptTab: { active: true } },
  ];

  for (const { marked = [], keptTab = {} } of cases)
  {
    const result = await outcome({ tabs: [tab(1), tab(2, keptTab)], registry: { 1: 't1', 2: 't1' }, marked });
    assert.deepEqual(result, NOTHING);
  }
});

test('a Task Space whose bookmark folder is missing stays', async () =>
{
  const result = await outcome({ tabs: [tab(1)], registry: { 1: 't1' }, missingFolders: ['t1'] });

  assert.deepEqual(result, NOTHING);
});

test('a failed save keeps the Task Space and closes none of its tabs', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const result = await outcome({
    tabs: [tab(1), tab(2)],
    registry: { 1: 't1', 2: 't1' },
    failSaveUrls: ['https://site2.test/'],
  });

  assert.deepEqual(result, { saved: ['https://site1.test/'], archived: [], closed: [] });
});

test('the Task Space becoming active or one of its tabs changing during the saves keeps it', async () =>
{
  const changes = [
    (world) => { world.activeSpaceIds = ['t1']; },
    (world) => { world.tabs.get(2).url = 'https://next.test/'; },
    (world) => { world.tabs.get(2).lastAccessed = NOW; },
    (world) => { world.marked.add(2); },
  ];

  for (const change of changes)
  {
    const { run, world } = setup({ tabs: [tab(1), tab(2)], registry: { 1: 't1', 2: 't1' } });
    world.onSave = () => change(world);
    const events = await run();

    assert.ok(!events.some(event => event.startsWith('archive ') || event.startsWith('remove ')), events.join('; '));
  }
});

test('a tab of another Space in the same window is left alone', async () =>
{
  const result = await outcome({
    spaces: [regularSpace('r1'), taskSpace('t1')],
    tabs: [tab(1), tab(2)],
    registry: { 1: 't1', 2: 'r1' },
  });

  assert.deepEqual(result, { saved: ['https://site1.test/'], archived: ['t1'], closed: [1] });
});

test('a bookmark in a subfolder pulls its tab in, one in the Space\'s asd_Archive does not', async () =>
{
  const result = await outcome({
    spaces: [regularSpace('r1'), taskSpace('t1')],
    tabs: [tab(1), tab(2), tab(3)],
    registry: { 1: 't1', 2: 'r1', 3: 'r1' },
    associations: { 2: 'bookmark-a2', 3: 'bookmark-s3' },
    folderChildren: {
      t1: [
        { id: 'archive', title: ARCHIVE_FOLDER_TITLE, children: [{ id: 'a2', url: 'https://site2.test/' }] },
        { id: 'notes', title: 'Notes', children: [{ id: 's3', url: 'https://site3.test/' }] },
      ],
    },
  });

  assert.deepEqual(result, { saved: ['https://site1.test/'], archived: ['t1'], closed: [1, 3] });
});

test('the tab of a bookmark in a folder an earlier Space shares is left to that Space', async () =>
{
  const result = await outcome({
    spaces: [regularSpace('shared', ['Other Bookmarks', 'Tasks Spaces', 't1']), taskSpace('t1')],
    tabs: [tab(1), tab(2)],
    registry: { 1: 't1' },
    associations: { 2: 'bookmark-b2' },
    folderChildren: { t1: [{ id: 'b2', url: 'https://site2.test/' }] },
  });

  assert.deepEqual(result, { saved: ['https://site1.test/'], archived: ['t1'], closed: [1] });
});

test('a Task Space that fails to archive doesn\'t stop the next one', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const result = await outcome({
    spaces: [taskSpace('t1'), taskSpace('t2')],
    tabs: [tab(1), tab(2)],
    registry: { 1: 't1', 2: 't2' },
    failArchiveIds: ['t1'],
  });

  assert.deepEqual(result, { saved: ['https://site1.test/', 'https://site2.test/'], archived: ['t2'], closed: [2] });
});
