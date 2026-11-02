import assert from 'node:assert/strict';
import test from 'node:test';

import { NoteManager } from '../src/managers/impl/noteManager.ts';
import { BOOKMARK_NOTES_KEY, NOTES_CHANGED } from '../src/managers/shared/noteApi.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const OTHER_ORIGIN = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';

const noteUrl = (noteId, origin = ORIGIN) => `${origin}/note.html?id=${noteId}`;
const noteBookmark = (id, noteId) => ({ id, title: noteId, url: noteUrl(noteId) });
const folder = (id, title, children) => ({ id, title, children });
// The whole bookmark tree as chrome.bookmarks.getTree returns it
const treeOf = (...children) => [folder('0', '', [folder('1', 'Bookmarks bar', children)])];
const note = (markdown, updatedAt, removedAt) =>
  (removedAt === undefined ? { markdown, updatedAt } : { markdown, updatedAt, removedAt });

// A manager over a fake storage area. `local` is the area; `fake.readFails` / `fake.writeFails`
// make storage.get / storage.set reject; `fake.tree` is what getBookmarkTree returns.
function createManager({ stored = {}, tree = treeOf() } = {})
{
  const local = { [BOOKMARK_NOTES_KEY]: stored };
  const fake = { readFails: false, writeFails: false, tree, reads: 0, writes: 0, scans: 0, now: NOW };
  const broadcasts = [];
  const manager = new NoteManager({
    storage: {
      get: async (key) =>
      {
        fake.reads++;
        if (fake.readFails) throw new Error('storage unavailable');
        return key in local ? { [key]: structuredClone(local[key]) } : {};
      },
      set: async (values) =>
      {
        if (fake.writeFails) throw new Error('QUOTA_BYTES quota exceeded');
        fake.writes++;
        Object.assign(local, structuredClone(values));
      },
    },
    broadcast: async (message) =>
    {
      broadcasts.push(message);
    },
    now: () => fake.now,
    getBookmarkTree: async () =>
    {
      fake.scans++;
      return typeof fake.tree === 'function' ? fake.tree() : fake.tree;
    },
  });
  return { manager, local, fake, broadcasts };
}

test('removing the last bookmark of a note marks its text; a note another bookmark still references stays unmarked', async () =>
{
  // n2 is also a Favorite, so removing the folder takes only one of its two bookmarks
  const { manager, local, fake } = createManager({
    stored: { n1: note('steps', 10), n2: note('shared', 20) },
    tree: treeOf(folder('5', 'asd_Favorites', [noteBookmark('30', 'n2')])),
  });
  await manager.load();

  await manager.handleBookmarksRemoved(folder('7', 'Taxes', [noteBookmark('31', 'n1'), noteBookmark('32', 'n2')]));

  assert.equal(fake.scans, 1);
  assert.deepEqual(local[BOOKMARK_NOTES_KEY], { n1: note('steps', 10, NOW), n2: note('shared', 20) });
  assert.deepEqual(await manager.get('n1'), { markdown: 'steps', updatedAt: 10 });
});

test('a removal without note ids, or only with notes that have no text here, does not scan the tree', async () =>
{
  const { manager, fake } = createManager({ stored: { n1: note('steps', 10) } });
  await manager.load();

  await manager.handleBookmarksRemoved(folder('7', 'Taxes', [{ id: '40', url: 'https://tax.example/' }]));
  await manager.handleBookmarksRemoved(noteBookmark('41', 'from-another-computer'));

  assert.equal(fake.scans, 0);
  assert.equal(fake.writes, 0);
});

test('sweepExpired deletes an expired unreferenced text, keeps a young mark and clears the mark of a note referenced again', async () =>
{
  const { manager, local, broadcasts } = createManager({
    stored: {
      expired: note('gone', 1, NOW - 31 * DAY),
      young: note('kept', 2, NOW - 5 * DAY),
      // Archived again meanwhile (auto-archive saved its tab into asd_Archive)
      back: note('back', 3, NOW - 40 * DAY),
    },
    tree: treeOf(folder('5', 'Space', [folder('6', 'asd_Archive', [noteBookmark('30', 'back')])])),
  });
  await manager.load();

  await manager.sweepExpired();

  assert.deepEqual(local[BOOKMARK_NOTES_KEY], {
    young: note('kept', 2, NOW - 5 * DAY),
    back: note('back', 3),
  });
  assert.equal(await manager.get('expired'), null);
  assert.deepEqual(broadcasts.at(-1), { action: NOTES_CHANGED, noteIds: ['back', 'expired'], senderId: undefined });
});

test('a sweep with no expired mark does not scan the tree', async () =>
{
  const { manager, fake } = createManager({ stored: { young: note('kept', 2, NOW - 29 * DAY) } });
  await manager.load();

  await manager.sweepExpired();

  assert.equal(fake.scans, 0);
  assert.equal(fake.writes, 0);
});

test('a note saved while the sweep scans the tree keeps its new text', async () =>
{
  let releaseScan;
  const { manager, local } = createManager({
    stored: { expired: note('old', 1, NOW - 31 * DAY) },
    tree: () => new Promise((resolve) =>
    {
      releaseScan = () => resolve(treeOf());
    }),
  });
  await manager.load();

  const sweep = manager.sweepExpired();
  await new Promise(setImmediate);
  await manager.save('expired', 'written after Undo');
  releaseScan();
  await sweep;

  assert.deepEqual(local[BOOKMARK_NOTES_KEY], { expired: note('written after Undo', NOW) });
});

test('a bookmark with the note URL, of any extension origin, clears the mark', async () =>
{
  const { manager, local } = createManager({
    stored: { n1: note('a', 1, NOW - DAY), n2: note('b', 2, NOW - DAY) },
  });
  await manager.load();

  await manager.handleNoteUrlSeen(noteUrl('n1'));
  await manager.handleNoteUrlSeen(noteUrl('n2', OTHER_ORIGIN));
  await manager.handleNoteUrlSeen('https://tax.example/');

  assert.deepEqual(local[BOOKMARK_NOTES_KEY], { n1: note('a', 1), n2: note('b', 2) });
});

test('a manager whose load failed writes nothing on background events or a save, and a save after a successful retry keeps every text', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const stored = { n1: note('steps', 10, NOW - 40 * DAY), n2: note('shared', 20) };
  const { manager, local, fake } = createManager({ stored });
  fake.readFails = true;

  // stateReady waits on load, so a storage error must not reject it
  await manager.load();
  await manager.handleBookmarksRemoved(noteBookmark('30', 'n2'));
  await manager.handleNoteUrlSeen(noteUrl('n1'));
  await manager.sweepExpired();
  await assert.rejects(manager.save('n3', 'new note'), /Can't save the note: stored notes could not be read/);
  await assert.rejects(manager.create('n3'), /Can't save the note: stored notes could not be read/);

  assert.equal(fake.writes, 0);
  assert.equal(fake.scans, 0);
  assert.deepEqual(local[BOOKMARK_NOTES_KEY], stored);

  fake.readFails = false;
  await manager.save('n3', 'new note');

  assert.deepEqual(local[BOOKMARK_NOTES_KEY], { ...stored, n3: note('new note', NOW) });
});

test('on an unloaded manager whose retry fails, get and list reject instead of answering "no text"', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const { manager, fake } = createManager({ stored: { n1: note('steps', 10) } });
  fake.readFails = true;
  await manager.load();

  await assert.rejects(manager.get('n1'), /Stored notes could not be read/);
  await assert.rejects(manager.list(['n1']), /Stored notes could not be read/);
  assert.equal(fake.reads, 3);

  fake.readFails = false;

  assert.deepEqual(await manager.list(['n1', 'unknown']), [{ noteId: 'n1', markdown: 'steps', updatedAt: 10 }]);
});

test('restore keeps a newer local text, stores a newer backup text and writes it', async () =>
{
  const { manager, local, broadcasts } = createManager({
    stored: {
      edited: note('edited here', 500),
      stale: note('old here', 100, NOW - DAY),
    },
  });
  await manager.load();

  const result = await manager.restore([
    { noteId: 'edited', markdown: 'older backup', updatedAt: 400 },
    { noteId: 'stale', markdown: 'newer backup', updatedAt: 200 },
    { noteId: 'other-computer', markdown: 'from backup', updatedAt: 50 },
    { noteId: '../bad', markdown: 'x', updatedAt: 1 },
  ], 'ctx_sidebar');

  assert.deepEqual(result, { restored: 2, kept: 1, skipped: 1 });
  assert.deepEqual(local[BOOKMARK_NOTES_KEY], {
    edited: note('edited here', 500),
    stale: note('newer backup', 200),
    'other-computer': note('from backup', 50),
  });
  assert.deepEqual(broadcasts.at(-1), {
    action: NOTES_CHANGED,
    noteIds: ['stale', 'other-computer'],
    senderId: 'ctx_sidebar',
  });
});

test('a save the storage refuses leaves the old text, so it is neither read back nor written by the next save', async () =>
{
  const { manager, local, fake } = createManager({ stored: { n1: note('saved', 10) } });
  await manager.load();

  fake.writeFails = true;
  await assert.rejects(manager.save('n1', 'too much'), /quota exceeded/);
  fake.writeFails = false;
  await manager.save('n2', 'other note');

  assert.deepEqual(await manager.get('n1'), { markdown: 'saved', updatedAt: 10 });
  assert.deepEqual(local[BOOKMARK_NOTES_KEY], { n1: note('saved', 10), n2: note('other note', NOW) });
});
