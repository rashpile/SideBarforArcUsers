import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectFolderBookmarks,
  selectFolderRecentItems,
  formatRelativeTime,
  RECENT_ROW_LIMIT,
} from '../src/utils/folderRecentItems.ts';
import { BookmarkRecency } from '../src/stores/bookmarkRecencyStore.ts';

const folder = {
  id: 'p',
  title: 'P',
  children: [
    { id: 'notion', title: 'Notion', url: 'https://notion.so' },
    { id: 'sheets', title: 'PK Finance - Google Sheets', url: 'https://docs.google.com/spreadsheets' },
    {
      id: 'bills',
      title: 'Service Bill',
      children: [
        { id: 'gas', title: 'Показания - Газ', url: 'https://gas.example.ua' },
        { id: 'power', title: 'Показания - ОДЕСАОБЛЕНЕРГО', url: 'https://ok.dtek-oem.com.ua' },
      ],
    },
  ],
};

const ids = (items) => items.map(item => item.bookmark.id);

test('collects bookmarks recursively in tree order, skipping folders', () =>
{
  assert.deepEqual(collectFolderBookmarks(folder).map(b => b.id), ['notion', 'sheets', 'gas', 'power']);
});

test('skips archive folders below the folder, but lists an archive folder passed itself', () =>
{
  const archive = {
    id: 'archive',
    title: 'asd_Archive',
    children: [
      { id: 'archived-new', title: 'New', url: 'https://new.example' },
      { id: 'archived-old', title: 'Old', url: 'https://old.example' },
    ],
  };
  const space = { id: 'space', title: 'Home', children: [...folder.children, archive] };

  assert.deepEqual(collectFolderBookmarks(space).map(b => b.id), ['notion', 'sheets', 'gas', 'power']);
  assert.deepEqual(collectFolderBookmarks(archive).map(b => b.id), ['archived-new', 'archived-old']);
});

test('without a query lists only previously active bookmarks, newest first', () =>
{
  const recency = new BookmarkRecency({ power: 100, sheets: 300, gas: 200 });
  const items = selectFolderRecentItems(collectFolderBookmarks(folder), recency, '');

  assert.deepEqual(ids(items), ['sheets', 'gas', 'power']);
  assert.equal(items[0].lastActiveAt, 300);
});

test('with a query searches all bookmarks, active ones first then tree order', () =>
{
  const recency = new BookmarkRecency({ power: 100 });
  const items = selectFolderRecentItems(collectFolderBookmarks(folder), recency, 'Показания');

  assert.deepEqual(ids(items), ['power', 'gas']);
  assert.equal(items[1].lastActiveAt, undefined);
});

test('query matches URLs too', () =>
{
  const items = selectFolderRecentItems(collectFolderBookmarks(folder), BookmarkRecency.EMPTY, 'notion.so');
  assert.deepEqual(ids(items), ['notion']);
});

test('recent list is capped', () =>
{
  const many = {
    id: 'f',
    title: 'F',
    children: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, title: `B${i}`, url: `https://b${i}.example` })),
  };
  const recency = new BookmarkRecency(Object.fromEntries(many.children.map((b, i) => [b.id, i])));

  assert.equal(selectFolderRecentItems(collectFolderBookmarks(many), recency, '').length, RECENT_ROW_LIMIT);
});

test('formats relative times like Arc', () =>
{
  const now = Date.UTC(2026, 9, 27);
  const minute = 60 * 1000;
  const day = 24 * 60 * minute;

  assert.equal(formatRelativeTime(now - 10 * 1000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 5 * minute, now), '5 min ago');
  assert.equal(formatRelativeTime(now - 60 * minute, now), '1 hour ago');
  assert.equal(formatRelativeTime(now - 3 * day, now), '3 days ago');
  assert.equal(formatRelativeTime(now - 65 * day, now), '2 months ago');
  assert.equal(formatRelativeTime(now - 400 * day, now), '1 year ago');
  assert.equal(formatRelativeTime(now + minute, now), 'Just now');
});
