// A markdown note is a bookmark whose URL is this extension's note page,
// `chrome-extension://<id>/note.html?id=<noteId>`. The text is stored by noteId,
// so the URL is the only link between a bookmark and its text.

export const NOTE_PAGE_PATH = '/note.html';

const NOTE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The fields of a bookmark node the note helpers read. */
export interface BookmarkNodeLike
{
  url?: string;
  children?: readonly BookmarkNodeLike[];
}

/** A note URL split into the extension origin that serves it and the note's id. */
export interface ParsedNoteUrl
{
  origin: string;
  noteId: string;
}

export function isValidNoteId(id: unknown): id is string
{
  return typeof id === 'string' && NOTE_ID_PATTERN.test(id);
}

// Callers pass `new URL(chrome.runtime.getURL('')).origin`, but a trailing slash
// (`chrome.runtime.getURL('')` itself) must not produce `//note.html` or fail an
// origin comparison.
function normalizeOrigin(origin: string): string
{
  return origin.replace(/\/+$/, '');
}

export function buildNoteUrl(extensionOrigin: string, noteId: string): string
{
  return `${normalizeOrigin(extensionOrigin)}${NOTE_PAGE_PATH}?id=${noteId}`;
}

/** The origin and noteId of a note URL of any extension; null for every other URL. */
export function parseNoteUrl(url: string | undefined): ParsedNoteUrl | null
{
  if (!url) return null;

  let parsed: URL;
  try
  {
    parsed = new URL(url);
  }
  catch
  {
    return null;
  }

  if (parsed.protocol !== 'chrome-extension:' || !parsed.host) return null;
  if (parsed.pathname !== NOTE_PAGE_PATH) return null;

  const noteId = parsed.searchParams.get('id');
  if (!isValidNoteId(noteId)) return null;

  // URL.origin is 'null' for chrome-extension: outside Chrome, so build it from the parts
  return { origin: `${parsed.protocol}//${parsed.host}`, noteId };
}

/** The noteId of a note URL served by this extension; null for another extension's note or any other URL. */
export function noteIdOfOwnUrl(url: string | undefined, extensionOrigin: string): string | null
{
  const parsed = parseNoteUrl(url);
  if (!parsed || parsed.origin !== normalizeOrigin(extensionOrigin)) return null;
  return parsed.noteId;
}

export function isOwnNoteUrl(url: string | undefined, extensionOrigin: string): boolean
{
  return noteIdOfOwnUrl(url, extensionOrigin) !== null;
}

/**
 * Every noteId referenced by a bookmark URL in the trees, whatever extension origin
 * the URL carries: cleanup and Export err on the side of keeping a text.
 *
 * Unlike every other walk of Space folders, this one descends into `asd_Archive`
 * and `asd_Favorites` on purpose: a note can be a Favorite, and Archive / auto-archive
 * save a note tab into `asd_Archive`. Skipping them would let the removal sweep delete
 * those texts and leave them out of the backup.
 */
export function collectNoteIds(nodes: readonly BookmarkNodeLike[]): Set<string>
{
  const ids = new Set<string>();
  const pending: BookmarkNodeLike[] = [...nodes];

  // Iterative so a deeply nested tree can't overflow the stack
  while (pending.length > 0)
  {
    const node = pending.pop()!;
    const parsed = parseNoteUrl(node.url);
    if (parsed)
    {
      ids.add(parsed.noteId);
    }
    if (node.children)
    {
      pending.push(...node.children);
    }
  }
  return ids;
}

/**
 * The URL a duplicate of a bookmark gets. A duplicate of this extension's note gets
 * its own copy of the text under a new noteId, so editing the copy leaves the original
 * alone. When this device holds no text for the note (synced from another computer),
 * `copyNote` resolves null and the duplicate shares the original's URL, as a YAML paste
 * does. A failed copy rejects, so the caller creates no bookmark.
 */
export async function urlForDuplicate(
  url: string,
  extensionOrigin: string,
  copyNote: (fromId: string, toId: string) => Promise<unknown>,
  makeNoteId: () => string,
): Promise<string>
{
  const noteId = noteIdOfOwnUrl(url, extensionOrigin);
  if (noteId === null) return url;

  const copyId = makeNoteId();
  const copied = await copyNote(noteId, copyId);
  return copied === null ? url : buildNoteUrl(extensionOrigin, copyId);
}

/**
 * Points a note URL of another extension origin at this extension when its noteId
 * is one whose text we hold (e.g. restored from a backup made under another unpacked
 * id). Own URLs, unknown noteIds (another extension's own `note.html?id=` page) and
 * every other URL come back unchanged.
 */
export function rewriteNoteUrl(url: string, extensionOrigin: string, knownNoteIds: ReadonlySet<string>): string
{
  const parsed = parseNoteUrl(url);
  if (!parsed) return url;
  if (parsed.origin === normalizeOrigin(extensionOrigin)) return url;
  if (!knownNoteIds.has(parsed.noteId)) return url;
  return buildNoteUrl(extensionOrigin, parsed.noteId);
}
