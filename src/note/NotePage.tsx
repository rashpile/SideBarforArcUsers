import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { MarkdownView } from '../components/pageAgent/MarkdownView';
import { parseMarkdown } from '../utils/markdown';
import { buildNoteUrl } from '../utils/noteUrl';
import { noteProxy } from '../managers/proxies/noteProxy';
import type { StoredNote } from '../managers/shared/noteApi';

const UNTITLED_NOTE_TITLE = 'Untitled note';

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing'; title: string }
  | { kind: 'view'; title: string; note: StoredNote }
  | { kind: 'edit'; title: string; note: StoredNote; selectTitle: boolean };

interface LoadedNote
{
  note: StoredNote | null;
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
}

const primaryButtonClass = 'px-3 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white text-sm';
const secondaryButtonClass = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800';

function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error);
}

async function loadNote(noteId: string, noteUrl: string): Promise<LoadedNote>
{
  const [note, bookmarks] = await Promise.all([
    noteProxy.get(noteId),
    chrome.bookmarks.search({ url: noteUrl }),
  ]);
  return { note, bookmarks };
}

function titleOf(bookmarks: readonly chrome.bookmarks.BookmarkTreeNode[]): string
{
  return bookmarks[0]?.title || UNTITLED_NOTE_TITLE;
}

// A record with empty text is a note nobody has written yet (New Note, or one cancelled before
// its first save), so opening it starts in the editor. A re-read never does: it must not pull a
// reader into the editor.
function stateFromLoad(loaded: LoadedNote, openEditorWhenEmpty: boolean): PageState
{
  const title = titleOf(loaded.bookmarks);
  if (!loaded.note)
  {
    return { kind: 'missing', title };
  }
  if (openEditorWhenEmpty && loaded.note.markdown === '')
  {
    return { kind: 'edit', title, note: loaded.note, selectTitle: true };
  }
  return { kind: 'view', title, note: loaded.note };
}

// Every bookmark of this note carries the title, so a pasted or duplicated-by-URL copy doesn't
// keep showing the old one.
async function renameNoteBookmarks(noteUrl: string, title: string): Promise<void>
{
  const bookmarks = await chrome.bookmarks.search({ url: noteUrl });
  for (const bookmark of bookmarks)
  {
    if (bookmark.title !== title)
    {
      await chrome.bookmarks.update(bookmark.id, { title });
    }
  }
}

function documentTitleOf(state: PageState): string
{
  switch (state.kind)
  {
    case 'loading':
    case 'error':
      return 'Note';
    case 'missing':
    case 'view':
    case 'edit':
      return state.title;
  }
}

export function NotePage({ noteId, extensionOrigin }: { noteId: string | null; extensionOrigin: string })
{
  if (noteId === null)
  {
    return <BrokenLink />;
  }
  return <NoteDocument noteId={noteId} noteUrl={buildNoteUrl(extensionOrigin, noteId)} />;
}

function BrokenLink()
{
  useEffect(() =>
  {
    document.title = 'Broken note link';
  }, []);

  return (
    <PageFrame>
      <p className="text-gray-600 dark:text-gray-300">This note link is broken.</p>
    </PageFrame>
  );
}

function NoteDocument({ noteId, noteUrl }: { noteId: string; noteUrl: string })
{
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const bookmarkIdsRef = useRef<Set<string>>(new Set());
  // Bumped by every re-read and by a save, so an older re-read can't replace a newer result
  const rereadSeqRef = useRef(0);

  const load = useCallback(async () =>
  {
    setState({ kind: 'loading' });
    try
    {
      const loaded = await loadNote(noteId, noteUrl);
      bookmarkIdsRef.current = new Set(loaded.bookmarks.map(bookmark => bookmark.id));
      setState(current => current.kind === 'loading' ? stateFromLoad(loaded, true) : current);
    }
    catch (error)
    {
      const message = errorMessage(error);
      setState(current => current.kind === 'loading' ? { kind: 'error', message } : current);
    }
  }, [noteId, noteUrl]);

  // Only the reading modes follow outside changes; the editor is never overwritten.
  const reread = useCallback(async () =>
  {
    const seq = ++rereadSeqRef.current;
    try
    {
      const loaded = await loadNote(noteId, noteUrl);
      if (seq !== rereadSeqRef.current) return;
      bookmarkIdsRef.current = new Set(loaded.bookmarks.map(bookmark => bookmark.id));
      setState(current => current.kind === 'view' || current.kind === 'missing'
        ? stateFromLoad(loaded, false)
        : current);
    }
    catch (error)
    {
      // The page keeps what it shows; a failed background re-read is no reason to replace it
      if (import.meta.env.DEV)
      {
        console.warn('[NotePage] re-read failed:', error);
      }
    }
  }, [noteId, noteUrl]);

  useEffect(() =>
  {
    void load();
  }, [load]);

  useEffect(() =>
  {
    const unsubscribe = noteProxy.onChanged((noteIds) =>
    {
      if (noteIds.includes(noteId))
      {
        void reread();
      }
    });
    const handleBookmarkChanged = (id: string, changeInfo: chrome.bookmarks.BookmarkChangeInfo) =>
    {
      if (bookmarkIdsRef.current.has(id) || changeInfo.url === noteUrl)
      {
        void reread();
      }
    };
    chrome.bookmarks.onChanged.addListener(handleBookmarkChanged);
    return () =>
    {
      unsubscribe();
      chrome.bookmarks.onChanged.removeListener(handleBookmarkChanged);
    };
  }, [noteId, noteUrl, reread]);

  useEffect(() =>
  {
    document.title = documentTitleOf(state);
  }, [state]);

  const saveNote = useCallback(async (draftTitle: string, markdown: string) =>
  {
    const saved = await noteProxy.save(noteId, markdown);
    // The text is stored now: if renaming fails below, Cancel and the unsaved-changes check
    // must compare against this text, not the one the editor opened with
    setState(current => current.kind === 'edit' ? { ...current, note: saved } : current);

    const title = draftTitle.trim() || UNTITLED_NOTE_TITLE;
    try
    {
      await renameNoteBookmarks(noteUrl, title);
    }
    catch (error)
    {
      throw new Error(`The text is saved, but the bookmark wasn't renamed: ${errorMessage(error)}`);
    }

    // A re-read started before the save may carry the old text
    rereadSeqRef.current++;
    setState({ kind: 'view', title, note: saved });
  }, [noteId, noteUrl]);

  const cancelEdit = useCallback(() =>
  {
    setState(current => current.kind === 'edit' ? { kind: 'view', title: current.title, note: current.note } : current);
  }, []);

  const startEdit = useCallback(() =>
  {
    setState(current => current.kind === 'view' ? { kind: 'edit', title: current.title, note: current.note, selectTitle: false } : current);
  }, []);

  switch (state.kind)
  {
    case 'loading':
      return (
        <PageFrame>
          <p className="text-gray-500 dark:text-gray-400">Loading…</p>
        </PageFrame>
      );
    case 'error':
      return (
        <PageFrame>
          <p className="font-medium">Couldn't open this note.</p>
          <p className="mt-1 text-red-600 dark:text-red-400">{state.message}</p>
          <button type="button" className={`${primaryButtonClass} mt-4`} onClick={() => void load()}>
            Retry
          </button>
        </PageFrame>
      );
    case 'missing':
      return (
        <PageFrame>
          <h1 className="text-2xl font-semibold break-words">{state.title}</h1>
          <p className="mt-6">This note's text is stored on another computer.</p>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            Import a backup from that computer (Settings → Import) to bring it here.
          </p>
        </PageFrame>
      );
    case 'view':
      return <NoteView title={state.title} note={state.note} onEdit={startEdit} />;
    case 'edit':
      return (
        <NoteEditor
          savedTitle={state.title}
          savedMarkdown={state.note.markdown}
          selectTitle={state.selectTitle}
          onSave={saveNote}
          onCancel={cancelEdit}
        />
      );
  }
}

function PageFrame({ children }: { children: ReactNode })
{
  return <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>;
}

function NoteView({ title, note, onEdit }: { title: string; note: StoredNote; onEdit: () => void })
{
  const blocks = useMemo(() => parseMarkdown(note.markdown), [note.markdown]);

  return (
    <PageFrame>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{title}</h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Edited {new Date(note.updatedAt).toLocaleString()}
          </p>
        </div>
        <button type="button" className={`${secondaryButtonClass} flex-shrink-0`} onClick={onEdit}>
          <Pencil size={14} /> Edit
        </button>
      </header>
      <article className="mt-6 text-[15px] leading-relaxed">
        {note.markdown.trim() === ''
          ? <p className="italic text-gray-500 dark:text-gray-400">This note is empty.</p>
          : <MarkdownView blocks={blocks} />}
      </article>
    </PageFrame>
  );
}

interface NoteEditorProps
{
  savedTitle: string;
  savedMarkdown: string;
  selectTitle: boolean;
  onSave: (title: string, markdown: string) => Promise<void>;
  onCancel: () => void;
}

function NoteEditor({ savedTitle, savedMarkdown, selectTitle, onSave, onCancel }: NoteEditorProps)
{
  const [draftTitle, setDraftTitle] = useState(savedTitle);
  const [draftMarkdown, setDraftMarkdown] = useState(savedMarkdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const dirty = draftTitle !== savedTitle || draftMarkdown !== savedMarkdown;

  useEffect(() =>
  {
    if (selectTitle)
    {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
    else
    {
      textRef.current?.focus();
    }
  }, [selectTitle]);

  const save = useCallback(async () =>
  {
    // Cmd+S held down repeats the keydown; one save at a time
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try
    {
      await onSave(draftTitle, draftMarkdown);
    }
    catch (saveError)
    {
      setError(errorMessage(saveError));
    }
    finally
    {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draftTitle, draftMarkdown, onSave]);

  useEffect(() =>
  {
    const handleKeyDown = (event: KeyboardEvent) =>
    {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's')
      {
        // Without this Chrome opens its Save Page dialog
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [save]);

  useEffect(() =>
  {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) =>
    {
      event.preventDefault();
      // Older Chrome versions show the prompt only when returnValue is set
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  return (
    <PageFrame>
      <input
        ref={titleRef}
        className="w-full bg-transparent text-2xl font-semibold border-b border-gray-200 dark:border-gray-700 pb-1 outline-none focus:border-blue-500"
        value={draftTitle}
        placeholder={UNTITLED_NOTE_TITLE}
        aria-label="Title"
        onChange={(event) => setDraftTitle(event.target.value)}
        onKeyDown={(event) =>
        {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing)
          {
            event.preventDefault();
            textRef.current?.focus();
          }
        }}
      />
      <textarea
        ref={textRef}
        className="mt-4 w-full min-h-[60vh] resize-y rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500"
        value={draftMarkdown}
        placeholder="Write in markdown: # headings, **bold**, *italic*, `code`, - lists, > quotes, links"
        aria-label="Note text"
        spellCheck
        onChange={(event) => setDraftMarkdown(event.target.value)}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={primaryButtonClass} disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">⌘S / Ctrl+S</span>
      </div>
    </PageFrame>
  );
}
