// Client for background.ts's NoteManager, used by the note page and the sidebar.
//
// No mirror store: nothing renders note text during a render, so every read is a call, and
// onChanged only tells a context which notes to read again. Rejections carry the manager's
// reason alone, so the page can show it as is.

import { ManagerId, callManager, CONTEXT_ID, withManagerReason } from './messageRouting';
import type { Remote } from './messageRouting';
import { NOTES_CHANGED } from '../shared/noteApi';
import type { BackupNote, NoteApi, NoteRestoreResult, StoredNote } from '../shared/noteApi';

class NoteProxy implements Remote<NoteApi>
{
  async get(noteId: string): Promise<StoredNote | null>
  {
    return this.#call<StoredNote | null>('get', { noteId });
  }

  async list(noteIds: string[]): Promise<BackupNote[]>
  {
    return this.#call<BackupNote[]>('list', { noteIds });
  }

  async create(noteId: string): Promise<StoredNote>
  {
    return this.#call<StoredNote>('create', { noteId });
  }

  async save(noteId: string, markdown: string): Promise<StoredNote>
  {
    return this.#call<StoredNote>('save', { noteId, markdown });
  }

  async copy(fromId: string, toId: string): Promise<StoredNote | null>
  {
    return this.#call<StoredNote | null>('copy', { fromId, toId });
  }

  async restore(entries: unknown[]): Promise<NoteRestoreResult>
  {
    return this.#call<NoteRestoreResult>('restore', { entries });
  }

  /**
   * Calls `listener` with the ids of notes another context or background changed. This context's
   * own changes are skipped: the call that made them already returned the new text.
   * Returns the unsubscribe function.
   */
  onChanged(listener: (noteIds: string[]) => void): () => void
  {
    const handleMessage = (message: unknown): void =>
    {
      if (!isNotesChangedMessage(message) || message.senderId === CONTEXT_ID) return;
      listener(message.noteIds.filter((noteId): noteId is string => typeof noteId === 'string'));
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }

  #call<R>(method: string, payload: Record<string, unknown>): Promise<R>
  {
    return withManagerReason(ManagerId.NOTES, method, () => callManager<R>(ManagerId.NOTES, method, payload));
  }
}

interface NotesChangedMessage
{
  action: typeof NOTES_CHANGED;
  noteIds: unknown[];
  senderId?: string;
}

function isNotesChangedMessage(message: unknown): message is NotesChangedMessage
{
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return candidate.action === NOTES_CHANGED && Array.isArray(candidate.noteIds);
}

export const noteProxy = new NoteProxy();
