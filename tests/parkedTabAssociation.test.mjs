import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findParkedReplacementTab,
  parseParkedTabUrl,
  recoverFixedTabAssociations,
  recoverParkedTabAssociations,
} from '../src/utils/parkedTabAssociation.ts';

const parkUrl = (sourceTabId, originalUrl) =>
  `chrome-extension://suspender-id/park.html?tabId=${sourceTabId}&url=${encodeURIComponent(originalUrl)}`;

test('recognizes the park page an external extension puts in place of a pinned tab', () =>
{
  assert.deepEqual(
    parseParkedTabUrl(parkUrl(42, 'https://example.com/docs')),
    { sourceTabId: 42, originalUrl: 'https://example.com/docs' }
  );
  assert.equal(
    parseParkedTabUrl('chrome-extension://suspender-id/options.html?tabId=42&url=https://example.com'),
    null
  );
});

test('a park page gets its pinned identity from the association of the tab it replaced', () =>
{
  const tabs = [
    { id: 100, url: parkUrl(42, 'https://example.com/docs') },
  ];

  assert.deepEqual(
    recoverParkedTabAssociations(tabs, { 42: 'bookmark-docs' }),
    { 100: 'bookmark-docs' }
  );
  assert.equal(findParkedReplacementTab(tabs, 42)?.id, 100);
});

test('a lost association heals by URL only for a park page; a regular tab on the same URL is not matched', () =>
{
  const tabs = [
    { id: 100, url: parkUrl(42, 'https://example.com/docs') },
    { id: 101, url: 'https://example.com/docs' },
    { id: 102, url: parkUrl(43, 'https://favorite.example.com/') },
  ];
  const bookmarks = [{
    id: 'root',
    children: [{ id: 'docs', url: 'https://example.com/docs/' }],
  }];
  const favorites = [{ id: 'favorite', url: 'https://favorite.example.com' }];

  assert.deepEqual(
    recoverParkedTabAssociations(tabs, {}, bookmarks, favorites),
    {
      100: 'bookmark-docs',
      102: 'pinned-favorite',
    }
  );
});

test('an open regular Chrome tab whose URL belongs to a bookmark or Favorite gets its pinned identity back', () =>
{
  const tabs = [
    { id: 101, active: false, url: 'https://example.com/docs/' },
    { id: 102, active: true, url: 'https://github.com/explore' },
    { id: 103, active: false, url: 'https://unmanaged.example.com' },
  ];
  const bookmarks = [{
    id: 'root',
    children: [
      { id: 'docs', url: 'https://example.com/docs' },
      { id: 'github', url: 'https://github.com/explore/' },
    ],
  }];

  assert.deepEqual(
    recoverFixedTabAssociations(tabs, {}, bookmarks, []),
    {
      101: 'bookmark-docs',
      102: 'bookmark-github',
    }
  );
});

test('bookmarks in asd_Archive take no part in URL healing; a tab on an archived URL stays a regular tab', () =>
{
  const tabs = [
    { id: 101, active: true, url: 'https://archived.example.com/page' },
    { id: 102, active: false, url: parkUrl(42, 'https://archived.example.com/parked') },
    { id: 103, active: false, url: 'https://kept.example.com' },
  ];
  const bookmarks = [{
    id: 'root',
    title: '',
    children: [{
      id: 'space',
      title: 'Home',
      children: [
        { id: 'kept', title: 'Kept', url: 'https://kept.example.com' },
        {
          id: 'archive',
          title: 'asd_Archive',
          children: [
            { id: 'archived-page', title: 'Page', url: 'https://archived.example.com/page' },
            { id: 'archived-parked', title: 'Parked', url: 'https://archived.example.com/parked' },
          ],
        },
      ],
    }],
  }];

  assert.deepEqual(recoverFixedTabAssociations(tabs, {}, bookmarks, []), { 103: 'bookmark-kept' });
  assert.deepEqual(recoverParkedTabAssociations(tabs, {}, bookmarks, []), {});
});
