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

test('the Space root folder is only a container; the sidebar shows its children directly', () =>
{
  assert.deepEqual(
    getVisibleSpaceRootItems(nestedTree),
    nestedTree.children,
  );
});

test('a collapsed folder shows the open pinned tabs in its subtree', () =>
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

test('a collapsed folder shows all open descendants in tree order', () =>
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

test('a collapsed folder with no active pinned tab shows no descendants', () =>
{
  assert.deepEqual(
    getVisibleBookmarkChildren(nestedTree, false, () => false),
    [],
  );
});

test('an expanded folder keeps its direct children and does not lift active descendants', () =>
{
  assert.deepEqual(
    getVisibleBookmarkChildren(nestedTree, true, () => true),
    [{ node: nestedTree.children[0], isPeek: false }],
  );
});

test('a Space asd_Archive folder and its bookmarks stay out of the bookmark section, also when collapsed', () =>
{
  const nestedSpace = {
    id: 'folder-work',
    title: 'Work',
    children: [
      {
        id: 'work-archive',
        title: 'asd_Archive',
        children: [{ id: 'work-archived', title: 'Old', url: 'https://old.example.com' }],
      },
    ],
  };
  const space = {
    id: 'space-root',
    title: 'Home',
    children: [
      { id: 'docs', title: 'Docs', url: 'https://docs.example.com' },
      nestedSpace,
      {
        id: 'archive',
        title: 'asd_Archive',
        children: [{ id: 'archived', title: 'Archived', url: 'https://archived.example.com' }],
      },
    ],
  };
  const ids = (children) => children.map(({ node }) => node.id);

  assert.deepEqual(getVisibleSpaceRootItems(space).map((node) => node.id), ['docs', 'folder-work']);
  assert.deepEqual(ids(getVisibleBookmarkChildren(space, true, () => true)), ['docs', 'folder-work']);
  assert.deepEqual(ids(getVisibleBookmarkChildren(nestedSpace, true, () => true)), []);
  assert.deepEqual(ids(getVisibleBookmarkChildren(space, false, () => true)), ['docs']);
});

test('a plain click on a folder row toggles it; a modifier click still only selects', () =>
{
  assert.equal(resolveBookmarkRowClickIntent(true, false), 'toggle-folder');
  assert.equal(resolveBookmarkRowClickIntent(true, true), 'select-only');
  assert.equal(resolveBookmarkRowClickIntent(false, false), 'open-bookmark');
});

test('folders and pinned pages support Arc-style keyboard actions', () =>
{
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'Enter', false), 'toggle-folder');
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'ArrowRight', false), 'expand-folder');
  assert.equal(resolveBookmarkRowKeyIntent(true, true, 'ArrowLeft', false), 'collapse-folder');
  assert.equal(resolveBookmarkRowKeyIntent(false, false, ' ', false), 'open-bookmark');
  assert.equal(resolveBookmarkRowKeyIntent(true, false, 'Enter', true), 'none');
});
