import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVisibleSpaceRootItems,
  getVisibleBookmarkChildren,
  resolveBookmarkRowKeyIntent,
  resolveBookmarkRowClickIntent,
} from '../src/utils/bookmarkTreeVisibility.ts';

const nestedTree = {
  id: 'folder-root',
  title: 'FaultScout',
  children: [
    {
      id: 'folder-nested',
      title: 'Nested',
      children: [
        { id: 'bookmark-active', title: 'Active', url: 'https://active.example.com' },
        { id: 'bookmark-idle', title: 'Idle', url: 'https://idle.example.com' },
      ],
    },
  ],
};

test('Space 根文件夹只作为容器，侧边栏直接展示它的子项', () =>
{
  assert.deepEqual(
    getVisibleSpaceRootItems(nestedTree),
    nestedTree.children,
  );
});

test('折叠文件夹时透出子树里的已打开固定 Tab', () =>
{
  const visibleChildren = getVisibleBookmarkChildren(
    nestedTree,
    false,
    (bookmarkId) => bookmarkId === 'bookmark-active',
  );

  assert.deepEqual(visibleChildren, [
    {
      node: nestedTree.children[0].children[0],
      isPeek: true,
    },
  ]);
});

test('折叠文件夹透出所有已打开的后代，保持树顺序', () =>
{
  const tree = {
    id: 'folder-home',
    title: '~',
    children: [
      { id: 'romanial', title: 'Romanial', url: 'https://ro.example.com' },
      { id: 'closed', title: 'Closed', url: 'https://closed.example.com' },
      {
        id: 'folder-sub',
        title: 'Sub',
        children: [
          { id: 'englishial', title: 'Englishial', url: 'https://en.example.com' },
        ],
      },
      { id: 'personalhub', title: 'PersonalHub', url: 'https://hub.example.com' },
    ],
  };
  const open = new Set(['personalhub', 'romanial', 'englishial']);

  const visibleChildren = getVisibleBookmarkChildren(tree, false, (id) => open.has(id));

  assert.deepEqual(
    visibleChildren.map(({ node, isPeek }) => [node.id, isPeek]),
    [['romanial', true], ['englishial', true], ['personalhub', true]],
  );
});

test('折叠文件夹没有活跃固定 Tab 时不展示后代', () =>
{
  assert.deepEqual(
    getVisibleBookmarkChildren(nestedTree, false, () => false),
    [],
  );
});

test('展开文件夹时保持原有直接子节点，不额外提升活跃后代', () =>
{
  assert.deepEqual(
    getVisibleBookmarkChildren(nestedTree, true, () => true),
    [{ node: nestedTree.children[0], isPeek: false }],
  );
});

test('普通点击文件夹行会切换折叠状态，组合键点击仍只处理选择', () =>
{
  assert.equal(resolveBookmarkRowClickIntent(true, false), 'toggle-folder');
  assert.equal(resolveBookmarkRowClickIntent(true, true), 'select-only');
  assert.equal(resolveBookmarkRowClickIntent(false, false), 'open-bookmark');
});

test('文件夹和固定页面支持 Arc 式键盘操作', () =>
{
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'Enter', false), 'toggle-folder');
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'ArrowRight', false), 'expand-folder');
  assert.equal(resolveBookmarkRowKeyIntent(true, true, 'ArrowLeft', false), 'collapse-folder');
  assert.equal(resolveBookmarkRowKeyIntent(false, false, ' ', false), 'open-bookmark');
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'Enter', true), 'none');
});
