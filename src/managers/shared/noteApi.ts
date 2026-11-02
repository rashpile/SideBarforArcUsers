// The wire contract for NoteManager, owned by neither side.
//
// impl/noteManager.ts implements NoteApi; proxies/noteProxy.ts implements Remote<NoteApi>.
// There is no mirror store: the note page, the sidebar and Export read texts through calls,
// and NOTES_CHANGED only tells a context which notes to read again.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting.ts';

export const BOOKMARK_NOTES_KEY = 'bookmarkNotes';

/** How long a note's text outlives the removal of its last bookmark. */
export const NOTE_REMOVAL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** The text of one note as a caller sees it. */
export interface StoredNote
{
  markdown: string;
  updatedAt: number;
}

/** One note in a JSON backup (`FullBackup.notes`). */
export interface BackupNote
{
  noteId: string;
  markdown: string;
  updatedAt: number;
}

/** What a backup restore did with its entries. */
export interface NoteRestoreResult
{
  restored: number;
  /** Notes whose local text is as new as the backup's or newer. */
  kept: number;
  /** Entries that aren't a valid note. */
  skipped: number;
}

/**
 * The subset of NoteManager the note page and the sidebar can call. Every method rejects with
 * a user-facing reason; while the stored notes can't be read, reads and writes both reject, so
 * no caller mistakes unread texts for missing ones.
 */
export interface NoteApi
{
  /** The note's text; null when this device has no record of it (stored on another computer). */
  get(noteId: string): Promise<StoredNote | null>;
  /** The texts of the given notes, for Export; notes without a record are left out. */
  list(noteIds: string[]): Promise<BackupNote[]>;
  /** An empty record for a new note; an existing record is returned unchanged. */
  create(noteId: string): Promise<StoredNote>;
  save(noteId: string, markdown: string): Promise<StoredNote>;
  /** The source's text under `toId` (Duplicate); null when the source has no record here. */
  copy(fromId: string, toId: string): Promise<StoredNote | null>;
  /** Backup texts in; a local text as new as the backup's or newer stays. */
  restore(entries: unknown[]): Promise<NoteRestoreResult>;
}

/** Broadcast when note records change: `{ noteIds, senderId }`, the changed ids and the requester's senderId. */
export const NOTES_CHANGED = makeManagerActionId(ManagerId.NOTES, 'changed');
