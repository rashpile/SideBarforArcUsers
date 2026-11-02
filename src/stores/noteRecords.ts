// Markdown note texts as NoteManager keeps them in chrome.storage.local under `bookmarkNotes`,
// by noteId. The bookmark only carries the noteId in its URL, so a move, a rename or a
// delete + Undo keeps the text; a delete only marks the record, and the record goes away
// once the mark is old enough and no bookmark references the note any more.

import { isValidNoteId } from '../utils/noteUrl.ts';

export const MAX_NOTE_MARKDOWN_LENGTH = 200_000;

/** One note as chrome.storage.local holds it. */
export interface StoredNoteRecord
{
  markdown: string;
  updatedAt: number;
  removedAt?: number;
}

/** The value of the `bookmarkNotes` key: note records by noteId. */
export type StoredNoteRecords = Record<string, StoredNoteRecord>;

/** What a backup restore did: the new records and how many backup entries went where. */
export interface NoteRestoreOutcome
{
  records: NoteRecords;
  restored: number;
  /** Entries for notes whose local text is as new as the backup's or newer. */
  kept: number;
  /** Entries that aren't a valid note. */
  skipped: number;
}

function isObject(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMarkdown(value: unknown): value is string
{
  return typeof value === 'string' && value.length <= MAX_NOTE_MARKDOWN_LENGTH;
}

function isFiniteTime(value: unknown): value is number
{
  return typeof value === 'number' && Number.isFinite(value);
}

/** The text of one note. */
export class NoteRecord
{
  readonly markdown: string;
  /** When the text was created, saved or copied; for a restored note, the backup's time. */
  readonly updatedAt: number;
  /** When the last bookmark referencing the note was removed; null while a bookmark may still reference it. */
  readonly removedAt: number | null;

  constructor(markdown: string, updatedAt: number, removedAt: number | null = null)
  {
    this.markdown = markdown;
    this.updatedAt = updatedAt;
    this.removedAt = removedAt;
    Object.freeze(this);
  }

  get hasRemovedMark(): boolean
  {
    return this.removedAt !== null;
  }

  withRemovedMark(now: number): NoteRecord
  {
    return this.hasRemovedMark ? this : new NoteRecord(this.markdown, this.updatedAt, now);
  }

  withoutRemovedMark(): NoteRecord
  {
    return this.hasRemovedMark ? new NoteRecord(this.markdown, this.updatedAt) : this;
  }

  equals(other: NoteRecord): boolean
  {
    return this.markdown === other.markdown
      && this.updatedAt === other.updatedAt
      && this.removedAt === other.removedAt;
  }

  toStored(): StoredNoteRecord
  {
    const stored: StoredNoteRecord = { markdown: this.markdown, updatedAt: this.updatedAt };
    if (this.removedAt !== null)
    {
      stored.removedAt = this.removedAt;
    }
    return stored;
  }

  /** The record of a stored entry; null when the entry is malformed. */
  static fromStoredEntry(value: unknown): NoteRecord | null
  {
    if (!isObject(value)) return null;
    if (!isValidMarkdown(value.markdown) || !isFiniteTime(value.updatedAt)) return null;
    if (value.removedAt !== undefined && !isFiniteTime(value.removedAt)) return null;
    return new NoteRecord(value.markdown, value.updatedAt, value.removedAt ?? null);
  }
}

/**
 * Note records by noteId. Immutable: every change returns a new collection, and a change that
 * changes nothing returns this same instance, so a caller can skip the storage write.
 */
export class NoteRecords
{
  readonly #byId: ReadonlyMap<string, NoteRecord>;

  constructor(byId: ReadonlyMap<string, NoteRecord> = new Map())
  {
    this.#byId = byId;
  }

  /** Parse the stored value; malformed entries are dropped and a value that isn't an object reads as empty. */
  static fromStored(value: unknown): NoteRecords
  {
    if (!isObject(value)) return new NoteRecords();

    const byId = new Map<string, NoteRecord>();
    for (const [noteId, entry] of Object.entries(value))
    {
      const record = NoteRecord.fromStoredEntry(entry);
      if (isValidNoteId(noteId) && record) byId.set(noteId, record);
    }
    return new NoteRecords(byId);
  }

  toStored(): StoredNoteRecords
  {
    return Object.fromEntries(Array.from(this.#byId, ([noteId, record]) => [noteId, record.toStored()]));
  }

  get(noteId: string): NoteRecord | null
  {
    return this.#byId.get(noteId) ?? null;
  }

  has(noteId: string): boolean
  {
    return this.#byId.has(noteId);
  }

  ids(): string[]
  {
    return Array.from(this.#byId.keys());
  }

  /**
   * An empty note, unless the note already has a record. New Note writes it before the bookmark
   * exists, so a missing record always means the text was never on this device.
   */
  withCreated(noteId: string, now: number): NoteRecords
  {
    if (this.#byId.has(noteId)) return this;
    return this.#with(noteId, new NoteRecord('', now));
  }

  /** Store the text; a save also means a bookmark references the note, so it clears a removal mark. */
  withSaved(noteId: string, markdown: string, now: number): NoteRecords
  {
    return this.#withRecord(noteId, new NoteRecord(markdown, now));
  }

  /** The source note's text under another noteId (Duplicate); this same instance when the source has no record. */
  withCopy(fromId: string, toId: string, now: number): NoteRecords
  {
    const source = this.#byId.get(fromId);
    if (!source) return this;
    return this.#withRecord(toId, new NoteRecord(source.markdown, now));
  }

  /**
   * Put backup texts in. A note that has a record here is replaced only by a strictly newer
   * backup text, so restoring an old backup never overwrites later edits, and on a tie the local
   * text stays. A kept record stays as it is, removal mark included.
   */
  withRestored(entries: readonly unknown[]): NoteRestoreOutcome
  {
    const byId = new Map(this.#byId);
    let restored = 0;
    let kept = 0;
    let skipped = 0;

    for (const entry of entries)
    {
      if (!isObject(entry) || !isValidNoteId(entry.noteId)
        || !isValidMarkdown(entry.markdown) || !isFiniteTime(entry.updatedAt))
      {
        skipped++;
        continue;
      }

      const current = byId.get(entry.noteId);
      if (current && current.updatedAt >= entry.updatedAt)
      {
        kept++;
        continue;
      }

      byId.set(entry.noteId, new NoteRecord(entry.markdown, entry.updatedAt));
      restored++;
    }

    return {
      records: restored > 0 ? new NoteRecords(byId) : this,
      restored,
      kept,
      skipped,
    };
  }

  /** Mark the notes no bookmark references any more; a note marked earlier keeps its first mark's time. */
  withRemovedMarks(noteIds: Iterable<string>, now: number): NoteRecords
  {
    return this.#mapEach(noteIds, record => record.withRemovedMark(now));
  }

  withoutRemovedMark(noteId: string): NoteRecords
  {
    return this.#mapEach([noteId], record => record.withoutRemovedMark());
  }

  /** The notes whose removal mark is at least `graceMs` old. */
  expiredRemovals(now: number, graceMs: number): string[]
  {
    const expired: string[] = [];
    for (const [noteId, record] of this.#byId)
    {
      if (record.removedAt !== null && now - record.removedAt >= graceMs)
      {
        expired.push(noteId);
      }
    }
    return expired;
  }

  /** The records without the given notes; this same instance when none of them had one. */
  without(noteIds: Iterable<string>): NoteRecords
  {
    const remaining = new Map(this.#byId);
    let changed = false;
    for (const noteId of noteIds)
    {
      changed = remaining.delete(noteId) || changed;
    }
    return changed ? new NoteRecords(remaining) : this;
  }

  /** The notes added, changed or removed since `previous`, for the change broadcast. */
  idsChangedFrom(previous: NoteRecords): string[]
  {
    const changed: string[] = [];
    for (const [noteId, record] of this.#byId)
    {
      const before = previous.get(noteId);
      if (!before || !before.equals(record)) changed.push(noteId);
    }
    for (const noteId of previous.ids())
    {
      if (!this.#byId.has(noteId)) changed.push(noteId);
    }
    return changed;
  }

  #mapEach(noteIds: Iterable<string>, change: (record: NoteRecord) => NoteRecord): NoteRecords
  {
    let next: Map<string, NoteRecord> | null = null;
    for (const noteId of noteIds)
    {
      const record = (next ?? this.#byId).get(noteId);
      if (!record) continue;
      const changed = change(record);
      if (changed === record) continue;
      next ??= new Map(this.#byId);
      next.set(noteId, changed);
    }
    return next ? new NoteRecords(next) : this;
  }

  #withRecord(noteId: string, record: NoteRecord): NoteRecords
  {
    const current = this.#byId.get(noteId);
    if (current && current.equals(record)) return this;
    return this.#with(noteId, record);
  }

  #with(noteId: string, record: NoteRecord): NoteRecords
  {
    const next = new Map(this.#byId);
    next.set(noteId, record);
    return new NoteRecords(next);
  }
}
