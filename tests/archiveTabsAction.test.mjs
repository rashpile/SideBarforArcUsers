import assert from 'node:assert/strict';
import test from 'node:test';

import { ArchiveTabsAction } from '../src/actions/archiveTabsAction.ts';
import { TabArchiveBatch } from '../src/utils/tabArchiveBatch.ts';
import { FakeArchiveBookmarks } from './fakeArchiveBookmarks.mjs';

const tab = (id, url, title = `Tab ${id}`) => ({ id, title, url });

// Stand-in for CloseTabAction: records the ids it was built for and its calls
class FakeCloseActions
{
  created = [];
  events = [];
  /** Archive URLs present when the close action's undo ran. */
  urlsAtUndo = null;

  constructor(bookmarks)
  {
    this.bookmarks = bookmarks;
  }

  factory = (tabIds) =>
  {
    this.created.push(tabIds);
    return {
      description: '',
      do: async () => { this.events.push('close'); },
      undo: async () =>
      {
        this.events.push('reopen');
        this.urlsAtUndo = this.bookmarks.archivedUrls();
      },
    };
  };
}

function setUp()
{
  const bookmarks = new FakeArchiveBookmarks();
  const closeActions = new FakeCloseActions(bookmarks);
  const build = (tabs) => new ArchiveTabsAction(tabs, 'space', new TabArchiveBatch(bookmarks), closeActions.factory);
  return { bookmarks, closeActions, build };
}

test('do() closes exactly the archived tabs and empty pages', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const { bookmarks, closeActions, build } = setUp();
  bookmarks.failUrls.add('https://b.test/');

  await build([
    tab(1, 'https://a.test/'),
    tab(2, 'https://b.test/'),
    tab(3, 'chrome://newtab/', 'New Tab'),
    tab(4, 'https://c.test/'),
  ]).do();

  assert.deepEqual(closeActions.created, [[1, 3, 4]]);
  assert.deepEqual(closeActions.events, ['close']);
});

test('do() throws and closes nothing when every archive fails', async (t) =>
{
  t.mock.method(console, 'error', () => {});
  const { bookmarks, closeActions, build } = setUp();
  bookmarks.failUrls.add('https://a.test/');
  bookmarks.failUrls.add('https://b.test/');

  const action = build([tab(1, 'https://a.test/'), tab(2, 'https://b.test/')]);

  await assert.rejects(action.do());
  assert.deepEqual(closeActions.created, []);
  assert.deepEqual(closeActions.events, []);
});

test('undo() reopens the tabs, then removes the archive items it created', async () =>
{
  const { bookmarks, closeActions, build } = setUp();
  const action = build([tab(1, 'https://a.test/'), tab(2, 'https://b.test/')]);

  await action.do();
  await action.undo();

  assert.deepEqual(closeActions.events, ['close', 'reopen']);
  assert.deepEqual(closeActions.urlsAtUndo, ['https://b.test/', 'https://a.test/']);
  assert.deepEqual(bookmarks.archivedUrls(), []);
});
