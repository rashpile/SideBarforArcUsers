import assert from 'node:assert/strict';
import test from 'node:test';

import { SpaceLists } from '../src/utils/spaceLists.ts';

const regular = id => ({ id, name: id, icon: 'Circle', color: 'blue', bookmarkFolderPath: `Other Bookmarks/${id}` });
const task = (id, createdAt = 100) => ({ ...regular(id), task: { createdAt } });
const archivedTask = (id, createdAt = 100, archivedAt = 500) => ({ ...regular(id), task: { createdAt, archivedAt } });
const ids = spaces => spaces.map(space => space.id);

test('archiving moves a Task Space to the end of the archived list and stamps archivedAt', () =>
{
  const lists = new SpaceLists([regular('r1'), task('t1'), task('t2')], [archivedTask('old', 1, 2)]);

  const next = lists.archive(['t1'], 500);

  assert.deepEqual(ids(next.live), ['r1', 't2']);
  assert.deepEqual(ids(next.archived), ['old', 't1']);
  assert.deepEqual(next.archived[1].task, { createdAt: 100, archivedAt: 500 });
  assert.equal(lists.live.length, 3, 'the original lists are not changed');
});

test('archiving ignores a regular Space and an unknown id', () =>
{
  const lists = new SpaceLists([regular('r1'), task('t1')], []);

  const next = lists.archive(['r1', 'missing'], 500);

  assert.equal(next, lists);
  assert.deepEqual(ids(next.live), ['r1', 't1']);
  assert.deepEqual(next.archived, []);
});

test('a stale whole-list write cannot bring an archived Space back, and keeps the rest in order', () =>
{
  const lists = new SpaceLists([regular('r1'), regular('r2')], [archivedTask('t1')]);

  const next = lists.withLive([regular('r2'), task('t1'), regular('r1'), task('t3')]);

  assert.deepEqual(ids(next.live), ['r2', 'r1', 't3']);
  assert.deepEqual(ids(next.archived), ['t1']);
});

test('restoring appends the Space to the live list without archivedAt', () =>
{
  const lists = new SpaceLists([regular('r1'), task('t2')], [archivedTask('t1')]);

  const next = lists.restore('t1');

  assert.deepEqual(ids(next.live), ['r1', 't2', 't1']);
  assert.deepEqual(next.live[2].task, { createdAt: 100 });
  assert.ok(!('archivedAt' in next.live[2].task));
  assert.deepEqual(next.archived, []);
});

test('restoring an id that is not archived changes nothing', () =>
{
  const lists = new SpaceLists([regular('r1'), task('t1')], [archivedTask('t2')]);

  const next = lists.restore('t1');

  assert.equal(next, lists);
});

test('forgetting an archived Space removes only that record', () =>
{
  const archived = [
    archivedTask('t1'),
    archivedTask('t2', 200, 600),
  ];
  const lists = new SpaceLists([regular('r1'), task('t3')], archived);

  const next = lists.forgetArchived('t1');

  assert.deepEqual(ids(next.archived), ['t2']);
  assert.deepEqual(ids(next.live), ['r1', 't3']);
});

test('Task Space ids cover live and archived Task Spaces, not regular Spaces', () =>
{
  const lists = new SpaceLists([regular('r1'), task('t1')], [archivedTask('t2')]);

  assert.deepEqual(lists.taskSpaceIds(), ['t1', 't2']);
});
