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

test('识别外部扩展用新 Tab 替换固定 Tab 的 park 页面', () =>
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

test('根据被替换的原 Tab 关联恢复 park 页的固定身份', () =>
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

test('旧关联已丢失时只按 park 页原始 URL 自愈，普通同 URL Tab 不会被误判', () =>
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

test('已有普通 Chrome Tab 的 URL 属于书签或 Favorite 时恢复为固定身份', () =>
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

test('asd_Archive 中的书签不参与 URL 自愈，归档网址上的 Tab 保持普通 Tab', () =>
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
