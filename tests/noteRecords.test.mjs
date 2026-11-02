import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_NOTE_MARKDOWN_LENGTH, NoteRecords } from '../src/stores/noteRecords.ts';

const DAY = 24 * 60 * 60 * 1000;
const GRACE = 30 * DAY;

const backupEntry = (noteId, markdown, updatedAt) => ({ noteId, markdown, updatedAt });

test('withRestored adds new notes, replaces only on a strictly newer text and counts each entry', () =>
{
  const records = NoteRecords.fromStored({
    older: { markdown: 'local older', updatedAt: 100 },
    newer: { markdown: 'local newer', updatedAt: 500 },
    tie: { markdown: 'local tie', updatedAt: 300 },
  });

  const outcome = records.withRestored([
    backupEntry('fresh', 'from backup', 50),
    backupEntry('older', 'backup replaces', 200),
    backupEntry('newer', 'backup is stale', 400),
    backupEntry('tie', 'backup tie', 300),
  ]);

  assert.deepEqual(outcome.records.toStored(), {
    older: { markdown: 'backup replaces', updatedAt: 200 },
    newer: { markdown: 'local newer', updatedAt: 500 },
    tie: { markdown: 'local tie', updatedAt: 300 },
    fresh: { markdown: 'from backup', updatedAt: 50 },
  });
  assert.equal(outcome.restored, 2);
  assert.equal(outcome.kept, 2);
  assert.equal(outcome.skipped, 0);
});

test('withRestored skips invalid entries and returns the same records when nothing was restored', () =>
{
  const records = NoteRecords.fromStored({ a: { markdown: 'local', updatedAt: 100 } });

  const outcome = records.withRestored([
    null,
    'not an entry',
    [],
    backupEntry('bad id!', 'text', 1),
    backupEntry('', 'text', 1),
    backupEntry('b', 42, 1),
    backupEntry('b', 'x'.repeat(MAX_NOTE_MARKDOWN_LENGTH + 1), 1),
    backupEntry('b', 'text', Number.NaN),
    backupEntry('b', 'text', '100'),
    { noteId: 'b', markdown: 'no time' },
    backupEntry('a', 'older backup', 50),
  ]);

  assert.equal(outcome.skipped, 10);
  assert.equal(outcome.kept, 1);
  assert.equal(outcome.restored, 0);
  assert.equal(outcome.records, records);
});

test('withRestored clears the removal mark of a restored note and keeps the mark of a kept one', () =>
{
  const records = NoteRecords.fromStored({
    replaced: { markdown: 'local', updatedAt: 100, removedAt: 1000 },
    kept: { markdown: 'local', updatedAt: 900, removedAt: 1000 },
  });

  const { records: restored } = records.withRestored([
    backupEntry('replaced', 'backup', 200),
    backupEntry('kept', 'backup', 200),
  ]);

  assert.equal(restored.get('replaced').removedAt, null);
  assert.equal(restored.get('replaced').updatedAt, 200);
  assert.equal(restored.get('kept').removedAt, 1000);
  assert.equal(restored.get('kept').markdown, 'local');
});

test('withRemovedMarks marks only existing notes and keeps the time of an earlier mark', () =>
{
  const records = NoteRecords.fromStored({
    marked: { markdown: 'a', updatedAt: 1, removedAt: 1000 },
    unmarked: { markdown: 'b', updatedAt: 1 },
  });

  const next = records.withRemovedMarks(['marked', 'unmarked', 'missing'], 5000);

  assert.equal(next.get('marked').removedAt, 1000);
  assert.equal(next.get('unmarked').removedAt, 5000);
  assert.equal(next.has('missing'), false);
  assert.equal(next.withRemovedMarks(['marked', 'unmarked'], 9000), next);
});

test('withSaved stores the text and clears a removal mark', () =>
{
  const records = NoteRecords.fromStored({ a: { markdown: 'old', updatedAt: 1, removedAt: 1000 } });

  const saved = records.withSaved('a', 'new text', 2000);

  assert.deepEqual(saved.toStored(), { a: { markdown: 'new text', updatedAt: 2000 } });
});

test('expiredRemovals returns only marks at least the grace period old', () =>
{
  const now = 100 * DAY;
  const records = NoteRecords.fromStored({
    exactlyGrace: { markdown: '', updatedAt: 1, removedAt: now - GRACE },
    older: { markdown: '', updatedAt: 1, removedAt: now - GRACE - DAY },
    younger: { markdown: '', updatedAt: 1, removedAt: now - GRACE + 1 },
    unmarked: { markdown: '', updatedAt: 1 },
  });

  assert.deepEqual(records.expiredRemovals(now, GRACE).sort(), ['exactlyGrace', 'older']);
});

test('fromStored drops malformed entries and keeps the valid ones', () =>
{
  const records = NoteRecords.fromStored({
    good: { markdown: '# Taxes', updatedAt: 10 },
    marked: { markdown: '', updatedAt: 10, removedAt: 20 },
    'bad id!': { markdown: 'text', updatedAt: 10 },
    numberText: { markdown: 5, updatedAt: 10 },
    oversized: { markdown: 'x'.repeat(MAX_NOTE_MARKDOWN_LENGTH + 1), updatedAt: 10 },
    nanTime: { markdown: 'text', updatedAt: Number.NaN },
    infiniteTime: { markdown: 'text', updatedAt: Number.POSITIVE_INFINITY },
    stringTime: { markdown: 'text', updatedAt: '10' },
    badMark: { markdown: 'text', updatedAt: 10, removedAt: 'yesterday' },
    nullEntry: null,
  });

  assert.deepEqual(records.ids().sort(), ['good', 'marked']);
  assert.equal(records.get('good').markdown, '# Taxes');
  assert.equal(records.get('marked').removedAt, 20);
});

test('fromStored reads a value that is not an object as empty', () =>
{
  for (const value of [undefined, null, 'text', 42, [{ markdown: 'a', updatedAt: 1 }]])
  {
    assert.deepEqual(NoteRecords.fromStored(value).ids(), []);
  }
});
