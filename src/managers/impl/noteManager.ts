// NoteManager - owns the markdown texts of note bookmarks.
//
// Background-side implementation of shared/noteApi.ts, reached through proxies/noteProxy.ts.
// Single writer of the bookmarkNotes key: the note page saves, the sidebar creates, copies
// (Duplicate) and restores (backup import), and background marks the notes whose last
// bookmark was removed and deletes their texts once the mark is old enough.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import { BOOKMARK_NOTES_KEY, NOTE_REMOVAL_GRACE_MS, NOTES_CHANGED } from '../shared/noteApi.ts';
import type { BackupNote, NoteApi, NoteRestoreResult, StoredNote } from '../shared/noteApi.ts';
import { MAX_NOTE_MARKDOWN_LENGTH, NoteRecords } from '../../stores/noteRecords.ts';
import type { NoteRecord } from '../../stores/noteRecords.ts';
import { collectNoteIds, isValidNoteId, parseNoteUrl } from '../../utils/noteUrl.ts';
import type { BookmarkNodeLike } from '../../utils/noteUrl.ts';

/** The chrome APIs and the clock the manager uses, injected so tests run under Node. */
export interface NoteManagerDeps
{
  storage: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
  };
  broadcast: (message: Record<string, unknown>) => Promise<unknown>;
  now: () => number;
  getBookmarkTree: () => Promise<BookmarkNodeLike[]>;
}

const UNREADABLE_WRITE_REASON = 'Can\'t save the note: stored notes could not be read';
const UNREADABLE_READ_REASON = 'Stored notes could not be read';

export class NoteManager implements RoutedManager, NoteApi
{
  readonly managerId = ManagerId.NOTES;

  readonly #deps: NoteManagerDeps;
  #records = new NoteRecords();

  // Until the stored value has been read, nothing is written: a write would replace every
  // unread text with the one note being saved. Background events skip, user calls retry the load.
  #loaded = false;
  #loading: Promise<void> | null = null;

  #writeTail: Promise<unknown> = Promise.resolve();

  constructor(deps: NoteManagerDeps)
  {
    this.#deps = deps;
  }

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    // The calling context's CONTEXT_ID, echoed on the broadcast so it can skip its own echo
    const originId = message.senderId as string | undefined;

    switch (method)
    {
      case 'get':
        return this.get(message.noteId as string);

      case 'list':
        return this.list(message.noteIds as string[]);

      case 'create':
        return this.create(message.noteId as string, originId);

      case 'save':
        return this.save(message.noteId as string, message.markdown as string, originId);

      case 'copy':
        return this.copy(message.fromId as string, message.toId as string, originId);

      case 'restore':
        return this.restore(message.entries as unknown[], originId);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  /**
   * Never rejects: a broken key must not turn stateReady false, which would pause auto-archive
   * and the association restore. On a failure the manager stays unloaded. Concurrent calls share
   * one read.
   */
  load(): Promise<void>
  {
    if (this.#loaded) return Promise.resolve();
    this.#loading ??= this.#readStored().finally(() =>
    {
      this.#loading = null;
    });
    return this.#loading;
  }

  async get(noteId: string): Promise<StoredNote | null>
  {
    requireNoteId(noteId);
    await this.#requireLoaded(UNREADABLE_READ_REASON);
    const record = this.#records.get(noteId);
    return record ? toStoredNote(record) : null;
  }

  async list(noteIds: string[]): Promise<BackupNote[]>
  {
    if (!Array.isArray(noteIds))
    {
      throw new Error('Can\'t read the notes: no note ids given');
    }
    await this.#requireLoaded(UNREADABLE_READ_REASON);

    const notes: BackupNote[] = [];
    for (const noteId of new Set(noteIds))
    {
      const record = isValidNoteId(noteId) ? this.#records.get(noteId) : null;
      if (record) notes.push({ noteId, ...toStoredNote(record) });
    }
    return notes;
  }

  async create(noteId: string, originId?: string): Promise<StoredNote>
  {
    requireNoteId(noteId);
    await this.#requireLoaded(UNREADABLE_WRITE_REASON);
    return this.#commitWith(current =>
    {
      const next = current.withCreated(noteId, this.#deps.now());
      return [next, toStoredNote(next.get(noteId)!)];
    }, originId);
  }

  async save(noteId: string, markdown: string, originId?: string): Promise<StoredNote>
  {
    requireNoteId(noteId);
    if (typeof markdown !== 'string')
    {
      throw new Error('Can\'t save the note: the text is missing');
    }
    if (markdown.length > MAX_NOTE_MARKDOWN_LENGTH)
    {
      throw new Error(`Can't save the note: it is longer than ${MAX_NOTE_MARKDOWN_LENGTH.toLocaleString('en-US')} characters`);
    }
    await this.#requireLoaded(UNREADABLE_WRITE_REASON);
    return this.#commitWith(current =>
    {
      const next = current.withSaved(noteId, markdown, this.#deps.now());
      return [next, toStoredNote(next.get(noteId)!)];
    }, originId);
  }

  async copy(fromId: string, toId: string, originId?: string): Promise<StoredNote | null>
  {
    requireNoteId(fromId);
    requireNoteId(toId);
    await this.#requireLoaded(UNREADABLE_WRITE_REASON);

    return this.#commitWith(current =>
    {
      const next = current.withCopy(fromId, toId, this.#deps.now());
      return [next, current.has(fromId) ? toStoredNote(next.get(toId)!) : null];
    }, originId);
  }

  async restore(entries: unknown[], originId?: string): Promise<NoteRestoreResult>
  {
    if (!Array.isArray(entries))
    {
      throw new Error('Can\'t restore the notes: the backup has no list of notes');
    }
    await this.#requireLoaded(UNREADABLE_WRITE_REASON);

    return this.#commitWith(current =>
    {
      const { records, restored, kept, skipped } = current.withRestored(entries);
      return [records, { restored, kept, skipped }];
    }, originId);
  }

  /**
   * `bookmarks.onRemoved`: marks the notes in the removed subtree that no bookmark references any
   * more. The text stays until the sweep, so an Undo or a sync that brings the bookmark back
   * finds it.
   */
  async handleBookmarksRemoved(removedNode: BookmarkNodeLike): Promise<void>
  {
    if (!this.#loaded) return;

    const candidates = [...collectNoteIds([removedNode])].filter(noteId =>
    {
      const record = this.#records.get(noteId);
      return record !== null && !record.hasRemovedMark;
    });
    if (candidates.length === 0) return;

    // Another bookmark (a Favorite, a copy in another folder) may still reference the note
    const referenced = collectNoteIds(await this.#deps.getBookmarkTree());
    const unreferenced = candidates.filter(noteId => !referenced.has(noteId));
    if (unreferenced.length === 0) return;

    await this.#commit(current => current.withRemovedMarks(unreferenced, this.#deps.now()));
  }

  /** A bookmark with this URL was created or changed (Undo, sync): its note is referenced again. */
  async handleNoteUrlSeen(url: string | undefined): Promise<void>
  {
    if (!this.#loaded) return;

    const parsed = parseNoteUrl(url);
    if (!parsed || !this.#records.get(parsed.noteId)?.hasRemovedMark) return;

    await this.#commit(current => current.withoutRemovedMark(parsed.noteId));
  }

  /**
   * Deletes the texts whose removal mark is older than the grace period and that a fresh tree
   * scan still finds no bookmark for. A mark whose note is referenced again is cleared.
   */
  async sweepExpired(): Promise<void>
  {
    if (!this.#loaded) return;

    const now = this.#deps.now();
    if (this.#records.expiredRemovals(now, NOTE_REMOVAL_GRACE_MS).length === 0) return;

    const referenced = collectNoteIds(await this.#deps.getBookmarkTree());

    await this.#commit(current =>
    {
      // Taken again from the records the write starts from: a save during the scan cleared
      // its note's mark, and that text must not go
      const expired = current.expiredRemovals(now, NOTE_REMOVAL_GRACE_MS);
      const stillReferenced = expired.filter(noteId => referenced.has(noteId));
      const unreferenced = expired.filter(noteId => !referenced.has(noteId));
      let next = current.without(unreferenced);
      for (const noteId of stillReferenced)
      {
        next = next.withoutRemovedMark(noteId);
      }
      return next;
    });
  }

  async #readStored(): Promise<void>
  {
    try
    {
      const result = await this.#deps.storage.get(BOOKMARK_NOTES_KEY);
      // A read that lands after the manager loaded must not replace records written since
      if (this.#loaded) return;
      this.#records = NoteRecords.fromStored(result[BOOKMARK_NOTES_KEY]);
      this.#loaded = true;
    }
    catch (error)
    {
      console.error('[NoteManager] stored notes not loaded, kept unwritten until a read succeeds:', error);
    }
  }

  async #requireLoaded(reason: string): Promise<void>
  {
    await this.load();
    if (!this.#loaded)
    {
      throw new Error(reason);
    }
  }

  #commit(change: (current: NoteRecords) => NoteRecords): Promise<void>
  {
    return this.#commitWith(current => [change(current), undefined]);
  }

  // Changes run one at a time, each on the records the previous one left. The records in memory
  // change only after the write succeeded, so a failed write (the storage quota) leaves both
  // storage and what callers read as they were. `change` returns the new records and the
  // caller's answer, both taken from the same records.
  #commitWith<T>(change: (current: NoteRecords) => [NoteRecords, T], originId?: string): Promise<T>
  {
    const result = this.#writeTail.then(async () =>
    {
      const previous = this.#records;
      const [next, answer] = change(previous);
      if (next === previous) return answer;

      await this.#deps.storage.set({ [BOOKMARK_NOTES_KEY]: next.toStored() });
      this.#records = next;
      this.#broadcast(next.idsChangedFrom(previous), originId);
      return answer;
    });
    this.#writeTail = result.catch(() => {});
    return result;
  }

  // senderId lets the context that asked for the change skip its own echo (CONTEXT_ID in messageRouting.ts)
  #broadcast(noteIds: string[], originId?: string): void
  {
    this.#deps.broadcast({
      action: NOTES_CHANGED,
      noteIds,
      senderId: originId,
    }).catch(() =>
    {
      // No note page or sidebar open
    });
  }
}

function toStoredNote(record: NoteRecord): StoredNote
{
  return { markdown: record.markdown, updatedAt: record.updatedAt };
}

function requireNoteId(noteId: unknown): void
{
  if (!isValidNoteId(noteId))
  {
    throw new Error('This note link is broken: the note id is invalid');
  }
}
