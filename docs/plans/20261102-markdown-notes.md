# Markdown notes as bookmarks in Space folders (#58)

## Overview

A markdown note that lives in a Space folder next to the bookmarks it is about: folder "Taxes" holds the
tax office and bank sites plus a note "How to pay taxes" with the steps. The note is for reading; no
checkboxes, no task tracking.

A note is a real Chrome bookmark whose URL is an extension page,
`chrome-extension://<id>/note.html?id=<noteId>`. Drag and drop, rename, delete + Undo, Open All / Open as
Tab Group and tab association work through the existing bookmark code. The text lives in
`chrome.storage.local`, keyed by `noteId`, so a move or a delete + Undo keeps it. The text stays on this
device: account bookmarks sync, so on another computer the note bookmark shows up without its text and the
page says so. The JSON backup carries the texts; Copy/Paste as YAML stays links only.

Decided with the user in issue #58 and its comment; the remaining choices were made in brainstorm (design
doc kept by the make-task run) and are listed under Solution Overview.

## Context (from discovery)

- Manager pattern to copy: `PageStyleManager` (`src/managers/impl/pageStyleManager.ts`), its API
  `src/managers/shared/pageStyleApi.ts`, proxy `src/managers/proxies/pageStyleProxy.ts`, immutable model
  `SavedPageStyles` (`src/stores/savedPageStyles.ts`), test `tests/pageStyleManager.test.mjs`. Manager ids in
  `src/managers/proxies/messageRouting.ts` (`ManagerId`, `callManager`, `CONTEXT_ID`, `RoutedManager`).
- Background: `managerLoadPromise` (~line 396), `chrome.bookmarks.onRemoved` (~line 497, already collects
  removed ids with `collectBookmarkIds(removeInfo.node)`), `chrome.bookmarks.onCreated` (~line 547),
  `registerManager(...)` (~line 1214) in `src/background.ts`.
- Markdown: `parseMarkdown` / `safeLinkHref` in `src/utils/markdown.ts` (headings, lists, bold/italic, code,
  blockquotes, http(s) links; no tables, images or checkboxes), renderer
  `src/components/pageAgent/MarkdownView.tsx` (links already `target="_blank"`).
- Build: `vite.config.ts` `rollupOptions.input` (sidepanel `index.html`, background, switcherOverlay);
  `tailwind.config.js` `content` (default `darkMode: 'media'` = system theme, as in the side panel);
  `src/index.css` sets `overflow: hidden` on `html, body, #root`, so the note page needs its own CSS entry.
- Sidebar: folder context menu in `src/components/BookmarkTree.tsx` (~line 746, New Folder / New Bookmark),
  `handleCreateBookmark` (~line 1734), `onOpenBookmark` (arc mode) vs `chrome.tabs.create` (row click
  ~line 400-420), `BookmarkEditModal onCreate` (~line 2864) for the expand + scroll pattern;
  `BookmarkFavicon.tsx` (used by `BookmarkTree.tsx` and `ArchiveSection.tsx`); `duplicateBookmark` in
  `src/hooks/useBookmarks.ts` (~line 420); `createBookmark` appends when `index` is undefined.
- Backup: `src/utils/backupRestore.ts` (`FullBackup`, `importBookmarkNode`, `importFullBackup`),
  `src/components/ExportDialog.tsx` (builds the backup itself), `src/components/ImportDialog.tsx`
  (flags per data type, `dataTypeCount`, result list). `backupRestore.ts` imports without `.ts`, so it is
  not testable under Node; logic that needs a test goes into `src/utils/noteUrl.ts` / `src/stores/noteRecords.ts`.
- Recently Closed: `src/utils/closedTabRecording.ts` (`INTERNAL_URL_PREFIXES` includes `chrome-extension:`),
  test `tests/closedTabRecording.test.mjs`; caller in `src/background.ts`.
- Tab association after restart: `matchBackupWindows` in `src/utils/tabAssociations.ts`, test
  `tests/tabAssociationBackupMatch.test.mjs`. All note tabs share one host (the extension id).
- lucide-react 0.562 has `NotebookText`.

## Development Approach

- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next; small, focused changes
- tests follow CLAUDE.md "Test decisions, not coverage": tests for behaviour that loses note text or acts
  on the wrong note or bookmark; no tests for the page UI, menu wiring, icons or wording
- modules imported by tests follow CLAUDE.md § Testing: `.ts` sibling imports, chrome/storage/clock passed
  in, no `chrome.*` at import time, no `import.meta.env`, no enums or parameter properties
- Allman braces, comments say why, `createChromeErrorHandler` where a hook exposes an error state
- run `make test` after each task; `make lint && make test && make build` must pass at the end
- update this plan when scope changes

## Testing Strategy

- unit tests (`node --test tests/*.test.mjs`) for: note URL parsing and rewriting, `NoteRecords` (restore
  newer-wins, removal marks, 30-day expiry, malformed data), `NoteManager` (sweep, marks, unloaded guard),
  Recently Closed note URLs, association recovery of two note tabs
- no e2e suite in this project

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix, blockers with ⚠️ prefix
- keep the plan in sync with the work

## Solution Overview

- **Storage**: one key `bookmarkNotes` in `chrome.storage.local`, owned by a new background
  `NoteManager` (one writer per storage key). Writers in three contexts go through it: the note page
  (save), the sidebar (New Note, Duplicate, backup import) and background (removal marks, cleanup).
  The proxy has no mirror store: nothing in the sidebar renders note text during render.
- **New Note** creates an empty record first, then the bookmark. So a missing record means "stored on
  another computer", and an empty record opens the editor (New Note, or a note cancelled before its first
  save). No URL flag, which a later open would lack.
- **Cleanup**: deleting a note bookmark doesn't delete the text. Background marks a note `removedAt` when
  `bookmarks.onRemoved` left no bookmark referencing it. `onCreated` / `onChanged` with its URL (Undo, Chrome's
  bookmark manager undo, sync), a save and an import that restores the text clear the mark (a text kept as
  newer keeps its mark; the sweep re-scans the tree before deleting anyway). On NoteManager load, records marked more
  than 30 days ago are deleted when a fresh bookmark tree scan still finds no reference. Marks come only from
  real removal events, so a startup tree that lacks not-yet-synced account bookmarks can't delete text.
- **Backup**: `FullBackup.notes` (`noteId`, `markdown`, `updatedAt`). Export has a Notes checkbox (texts of
  the notes the bookmark tree references). Import has a Notes checkbox independent of Bookmarks (main use:
  synced note bookmarks on a second computer that lack text, where importing bookmarks again would
  duplicate them). A noteId that exists locally keeps the newer `updatedAt`; a tie keeps the local text.
  Imported bookmarks get this extension's origin in note URLs whose noteId is in `backup.notes`; existing
  (synced) bookmarks are never rewritten, and another extension's `note.html?id=` is never touched.
- **Duplicate** of a note copies its text to a new noteId, so editing the copy doesn't change the original.
  Copy/Paste as YAML keeps the URL (known limitation: on the same device both share one text).
- **Recently Closed** records this extension's note tabs; other `chrome-extension:` pages stay skipped.
- **Extension id** is not pinned: a manifest `key` would change the id of the user's existing unpacked
  install and its `chrome.storage` (Spaces, Favorite icons) would be lost. Known limitation, in README.
- **Icon**: `BookmarkFavicon` renders `NotebookText` for this extension's note URLs (tree and Archive);
  `note.html` has an SVG favicon for the tab.
- **Missing text** page: the message and a hint to import a backup from that computer; no editor.

## Technical Details

### Note URL (`src/utils/noteUrl.ts`)

```typescript
export const NOTE_PAGE_PATH = '/note.html';
export function isValidNoteId(id: unknown): id is string;          // /^[A-Za-z0-9-]{1,64}$/
export function buildNoteUrl(extensionOrigin: string, noteId: string): string; // `${origin}/note.html?id=${noteId}`
export function parseNoteUrl(url: string | undefined): { origin: string; noteId: string } | null;
//   protocol 'chrome-extension:', pathname exactly '/note.html', valid `id` param; anything else null
export function noteIdOfOwnUrl(url: string | undefined, extensionOrigin: string): string | null;
export function isOwnNoteUrl(url: string | undefined, extensionOrigin: string): boolean; // noteIdOfOwnUrl(...) !== null
export function collectNoteIds(nodes: readonly BookmarkNodeLike[]): Set<string>;
//   every noteId in bookmark URLs of the trees, ANY extension origin (cleanup errs on keeping text).
//   Deliberately walks asd_Archive and asd_Favorites too (the one exception to "Skip the system
//   folders"): a note can be a Favorite, and auto-archive / Archive saves a note tab into asd_Archive;
//   skipping them would let the sweep delete those texts and Export leave them out. Say so in a comment.
export function rewriteNoteUrl(url: string, extensionOrigin: string, knownNoteIds: ReadonlySet<string>): string;
//   another origin's note URL whose noteId is known → buildNoteUrl(extensionOrigin, noteId); else unchanged
```

`extensionOrigin` is `new URL(chrome.runtime.getURL('')).origin` at the call site (no trailing slash).

### Stored value `bookmarkNotes`

```typescript
Record<string, {        // by noteId
  markdown: string,     // up to 200 000 characters
  updatedAt: number,    // ms epoch, set by the manager on create / save / copy; kept from the backup on restore
  removedAt?: number    // set when the last bookmark referencing the note was removed
}>
```

### `NoteRecords` (`src/stores/noteRecords.ts`)

Immutable; every `with*` / `without` returns the same instance when nothing changes.

- `static fromStored(value: unknown)`: drops entries with an invalid id, non-string or oversized markdown,
  non-finite `updatedAt`, non-finite `removedAt`; `toStored()`; `get(noteId)`; `has(noteId)`; `ids()`.
- `withCreated(noteId, now)`: an empty record when none exists.
- `withSaved(noteId, markdown, now)`: upsert, clears `removedAt`.
- `withCopy(fromId, toId, now)`: the source's markdown under `toId`; no source → unchanged.
- `withRestored(entries: readonly unknown[])` → `{ records, restored, kept, skipped }`: an invalid entry
  (not `{ noteId, markdown, updatedAt }` passing the same checks as `fromStored`) is skipped; a new id is
  added; an existing id is replaced only when the entry's `updatedAt` is strictly newer (otherwise `kept`,
  record untouched, mark included); a restored record keeps the backup's `updatedAt` and has no `removedAt`.
- `withRemovedMarks(noteIds, now)`: sets `removedAt` on existing records that have none.
- `withoutRemovedMark(noteId)`.
- `expiredRemovals(now, graceMs)`: ids with `now - removedAt >= graceMs`.
- `without(noteIds)`.

### `NoteManager` (`src/managers/impl/noteManager.ts`) and `NoteApi` (`src/managers/shared/noteApi.ts`)

```typescript
export const BOOKMARK_NOTES_KEY = 'bookmarkNotes';
export const NOTE_REMOVAL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export interface StoredNote { markdown: string; updatedAt: number }
export interface BackupNote { noteId: string; markdown: string; updatedAt: number }
export interface NoteRestoreResult { restored: number; kept: number; skipped: number }

export interface NoteApi
{
  get(noteId: string): Promise<StoredNote | null>;
  list(noteIds: string[]): Promise<BackupNote[]>;  // for export, ids without a record skipped
  create(noteId: string): Promise<StoredNote>;
  save(noteId: string, markdown: string): Promise<StoredNote>;
  copy(fromId: string, toId: string): Promise<StoredNote | null>;
  restore(entries: unknown[]): Promise<NoteRestoreResult>;
}
export const NOTES_CHANGED = makeManagerActionId(ManagerId.NOTES, 'changed'); // { noteIds, senderId }
```

All methods are async: reads also wait for a load retry (below).

- Deps: `storage.get/set`, `broadcast`, `now()`, `getBookmarkTree(): Promise<BookmarkNodeLike[]>`.
- `load()` never rejects; on failure the manager stays unloaded. A load already in flight is reused (one
  promise), and a load never replaces records once the manager is loaded, so a late first load can't
  overwrite a write that a retry let through.
- Every API call on an unloaded manager retries the load first. When it fails again, user writes
  (`create`, `save`, `copy`, `restore`) reject with "Can't save the note: stored notes could not be read",
  so a write never replaces unread texts with one note; reads (`get`, `list`) reject with "Stored notes
  could not be read", so the page doesn't claim the text is on another computer and Export doesn't write a
  backup without texts.
- Background changes (`handleBookmarksRemoved`, `handleNoteUrlSeen`, `sweepExpired`) do nothing while unloaded.
- `handleBookmarksRemoved(removedNode)`: noteIds in the removed subtree that have a record without a mark; none →
  return without a tree scan; else scan the tree and mark the ids it no longer references.
- `handleNoteUrlSeen(url)`: a note URL (any origin) whose record has a mark → clear it.
- `sweepExpired()`: `expiredRemovals(now, NOTE_REMOVAL_GRACE_MS)`; none → return; else scan the tree, delete the
  expired ids it doesn't reference and clear the marks of those it does.
- Writes serialized through a write tail; every change broadcasts `NOTES_CHANGED` with the changed ids and the
  caller's `senderId`.
- Validation: `isValidNoteId`, markdown a string of at most 200 000 characters; errors carry a user-facing message.

### Note page (`note.html`, `src/note/main.tsx`, `src/note/NotePage.tsx`, `src/note/note.css`, `public/note-icon.svg`)

- `note.html` at the repo root: `<link rel="icon" type="image/svg+xml" href="/note-icon.svg">`, `#root`,
  `<script type="module" src="/src/note/main.tsx">`. Vite `input.note: 'note.html'` (emitted as `dist/note.html`).
  `tailwind.config.js` `content` gains `./note.html`. `note.css` = the three `@tailwind` directives plus the
  system font stack; the page scrolls.
- `id` from `location.search`; invalid → "This note link is broken."
- Loads `noteProxy.get(id)` and `chrome.bookmarks.search({ url: buildNoteUrl(location.origin, id) })`.
- States: loading; error (with Retry; also for a rejected `get`); **missing** (no record: the bookmark's title, "This note's text is
  stored on another computer." and "Import a backup from that computer (Settings → Import) to bring it here.");
  **edit** (title input, markdown textarea, Save, Cancel, hint "⌘S / Ctrl+S"); **view** (title, "Edited
  <date>" from `updatedAt` via `toLocaleString`, Edit, `MarkdownView` of `parseMarkdown(markdown)`, "This note
  is empty." for empty text).
- Opens in edit mode when the record's markdown is empty; the title is focused and selected then.
- Save: `noteProxy.save`, then `chrome.bookmarks.update` on every bookmark with this URL whose title differs
  (blank → "Untitled note"); errors inline, the editor stays. Cmd+S / Ctrl+S saves in edit mode.
- Cancel → view with the saved text (a new empty note keeps its bookmark and shows the empty view).
- `beforeunload` prompt while the title or text differs from the saved values.
- `document.title` = title. View and missing modes re-read on `NOTES_CHANGED` with its id (so a Notes import
  in the sidebar shows the text without a reload) and on `chrome.bookmarks.onChanged` of its bookmarks; edit
  mode is never overwritten.
- Errors from the proxy reach the user without the router's `NoteManager.<method> failed: Error:` prefix:
  `noteProxy` strips it the way `withManagerReason` in `src/hooks/usePageStyles.ts` does (move that helper
  to a shared module if both use it).
- Light/dark: Tailwind `dark:` classes on `media`, like the side panel.

## What Goes Where

- **Implementation Steps** (`[ ]`): code, tests and docs in this repo
- **Post-Completion**: manual checks in Chrome

## Implementation Steps

### Task 1: Note URL helpers

**Files:**
- Create: `src/utils/noteUrl.ts`
- Create: `tests/noteUrl.test.mjs`

- [x] create `src/utils/noteUrl.ts` with `NOTE_PAGE_PATH`, `isValidNoteId`, `buildNoteUrl`, `parseNoteUrl`, `isOwnNoteUrl`, `noteIdOfOwnUrl`, `collectNoteIds`, `rewriteNoteUrl` as in Technical Details (structural `BookmarkNodeLike` type with `url?` and `children?`)
- [x] write tests: `parseNoteUrl` accepts any extension origin and rejects other protocols, other paths (`/x/note.html`, `/note.htm`), missing or invalid ids
- [x] write tests: `rewriteNoteUrl` rewrites only known noteIds of another origin, leaves own-origin URLs, unknown ids (another extension's `note.html?id=`) and web URLs unchanged
- [x] write tests: `collectNoteIds` walks nested folders, collects ids of every origin, and collects ids inside `asd_Archive` and `asd_Favorites`
- [x] run `make test` - must pass before task 2

### Task 2: NoteRecords model

**Files:**
- Create: `src/stores/noteRecords.ts`
- Create: `tests/noteRecords.test.mjs`

- [x] create the immutable `NoteRecords` class with `fromStored`, `toStored`, `get`, `has`, `ids`, `withCreated`, `withSaved`, `withCopy`, `withRestored`, `withRemovedMarks`, `withoutRemovedMark`, `expiredRemovals`, `without` (same instance when unchanged)
- [x] write tests: `withRestored` adds new ids, replaces only on a strictly newer `updatedAt`, keeps local on older or equal, skips invalid entries, counts restored / kept / skipped, and clears `removedAt` of a restored record
- [x] write tests: `withRemovedMarks` keeps an existing mark's time; `withSaved` clears a mark; `expiredRemovals` returns only marks at least the grace old
- [x] write tests: `fromStored` drops malformed entries (bad id, non-string or oversized markdown, non-finite times) and keeps the valid ones; a non-object value reads as empty
- [x] run `make test` - must pass before task 3

### Task 3: NoteManager in the background

**Files:**
- Create: `src/managers/shared/noteApi.ts`
- Create: `src/managers/impl/noteManager.ts`
- Modify: `src/managers/proxies/messageRouting.ts`
- Create: `tests/noteManager.test.mjs`

- [x] add `NOTES: 'NoteManager'` to `ManagerId`; create `noteApi.ts` (key, grace, types, `NoteApi`, `NOTES_CHANGED`)
- [x] create `NoteManager` (`RoutedManager`, `NoteApi`) with injected deps, `dispatch`, never-rejecting `load` (in-flight promise reused, never replaces loaded records), serialized writes, broadcasts with `senderId`, validation, the unloaded guards (every API call retries the load; writes and reads reject on failure; background changes skip)
- [x] implement `handleBookmarksRemoved(removedNode)`, `handleNoteUrlSeen(url)`, `sweepExpired()` as in Technical Details
- [x] write tests: removing the last bookmark of a note marks it; removing one of two bookmarks of a note (the tree still references it) doesn't; a removal without note ids doesn't scan the tree
- [x] write tests: `sweepExpired` deletes an expired mark the tree doesn't reference, keeps a mark younger than 30 days, and clears an expired mark whose note the tree references again; `handleNoteUrlSeen` clears a mark
- [x] write tests: a manager whose load failed doesn't write on background events, and a `save` while the store still can't be read rejects without writing; `save` after a successful retry writes all records
- [x] write tests: on an unloaded manager whose retry fails, `list` and `get` reject (never `[]` / `null`)
- [x] write tests: `restore` keeps a newer local text and stores a newer backup text (through the manager, with the write)
- [x] run `make test` - must pass before task 4

### Task 4: Wire NoteManager into the background and add the proxy

**Files:**
- Modify: `src/background.ts`
- Create: `src/managers/proxies/noteProxy.ts`
- Modify: `src/managers/proxies/messageRouting.ts`, `src/hooks/usePageStyles.ts` (`withManagerReason` moved to `messageRouting.ts`, shared by both proxies' callers; it also drops the router's `Error: `)

- [x] construct `NoteManager` with `chrome.storage.local`, the broadcast helper the other managers use, `Date.now`, `chrome.bookmarks.getTree`; add `noteManager.load()` to `managerLoadPromise`; after `stateReady`, call `sweepExpired()` (errors logged)
- [x] in `bookmarks.onRemoved`, after `stateReady`, call `noteManager.handleBookmarksRemoved(removeInfo.node)` when the node is present; in `bookmarks.onCreated` and `bookmarks.onChanged` (url in changeInfo) call `handleNoteUrlSeen(url)` after `stateReady`
- [x] `registerManager(noteManager)`
- [x] create `noteProxy.ts` implementing `Remote<NoteApi>` over `callManager` (senderId `CONTEXT_ID`) plus `onChanged(listener): () => void` for `NOTES_CHANGED`; no mirror store; rejections carry only the manager's reason (strip the router prefix like `withManagerReason`)
- [x] run `make lint && make test` - must pass before task 5

### Task 5: Note page

**Files:**
- Create: `note.html`
- Create: `src/note/main.tsx`
- Create: `src/note/NotePage.tsx`
- Create: `src/note/note.css`
- Create: `public/note-icon.svg`
- Modify: `vite.config.ts`
- Modify: `tailwind.config.js`

- [x] add `note.html`, `public/note-icon.svg`, the Vite input `note` and the Tailwind content path; `note.css` with Tailwind directives and the font stack
- [x] create `NotePage.tsx` with the loading / error / broken-link / missing / edit / view states, `MarkdownView` rendering, "Edited <date>", Edit, empty-note view
- [x] implement Save (manager save, then bookmark title update of every bookmark with this URL, blank → "Untitled note"), Cmd+S / Ctrl+S, Cancel, inline save errors
- [x] implement the `beforeunload` prompt for unsaved changes, `document.title`, focus + select of the title for an empty note, re-read on `NOTES_CHANGED` and `bookmarks.onChanged` in view and missing modes only
- [x] `make build` emits `dist/note.html`; run `make lint && make test` - must pass before task 6

### Task 6: New Note, note icon and Duplicate in the sidebar

**Files:**
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/components/BookmarkFavicon.tsx`
- Modify: `src/hooks/useBookmarks.ts`

- [x] folder context menu: **New Note** (`NotebookText` icon) right after New Bookmark; handler creates `crypto.randomUUID()`, `noteProxy.create`, then `createBookmark(parentId, 'New note', buildNoteUrl(origin, noteId))` at the end of the folder, expands the parent, scrolls to it and opens it the way a row click does (arc mode with `onOpenBookmark`: that; otherwise `chrome.tabs.create({ url, active: true, windowId })`); a failed create shows the error the way the tree shows other bookmark errors
- [x] `BookmarkFavicon`: own note URLs render `NotebookText` (same size and colour classes as the folder/globe fallbacks) instead of the favicon image
- [x] `duplicateBookmark`: when the URL to duplicate is an own note URL, make a new noteId and `noteProxy.copy(oldId, newId)`: a record → create the duplicate with the new note URL; `null` (no local text, e.g. a note from another computer) → duplicate with the original URL (shares the note, like YAML paste); a rejection → create nothing and show the error. Other bookmarks unchanged
- [x] run `make lint && make test` - must pass before task 7

### Task 7: Recently Closed records note tabs

**Files:**
- Modify: `src/utils/closedTabRecording.ts`
- Modify: `src/background.ts`
- Modify: `tests/closedTabRecording.test.mjs`

- [x] add `extensionOrigin` to `ClosedTabInput`; an own note URL is not internal; pass the origin from the background caller
- [x] write tests: an unassociated note tab of this extension is recorded; another extension's page and this extension's other pages are still skipped
- [x] run `make test` - must pass before task 8

### Task 8: Note texts in the JSON backup

**Files:**
- Modify: `src/utils/backupRestore.ts`
- Modify: `src/components/ExportDialog.tsx`
- Modify: `src/components/ImportDialog.tsx`
- ➕ Modify: `src/utils/arcImport.ts` (`ArcImportResult` omits the note counts: Arc has no notes)

- [x] `FullBackup.notes?: BackupNote[]`; `ImportOptions.importNotes`; `ImportResult.notesRestored` / `notesKept`; `importBookmarkNode` takes a URL rewriter and the import passes `url => rewriteNoteUrl(url, origin, idsInBackupNotes)` (always, also when Notes is unchecked)
- [x] ➕ the backup's `pinnedSites` URLs go through the same rewriter, so a note Favorite written from them, and the icon restore that pairs them by URL with restored `asd_Favorites` bookmarks, see this extension's URL
- [x] `importFullBackup` calls `noteProxy.restore(backup.notes)` when Notes is checked (passed in as a function so the module stays free of new chrome calls)
- [x] Export dialog: **Notes** checkbox shown when the bookmark tree references notes, on by default; adds `backup.notes = await noteProxy.list([...collectNoteIds(bookmarks)])`; the early return in `handleExport` and `nothingSelected` include it; the dialog's local backup type (lines ~31-38) gets `notes`
- [x] Import dialog: `hasNotes` counts in `dataTypeCount`; **Notes (N)** checkbox independent of Bookmarks, on by default, and `importNotesFlag` in `nothingSelected`; a backup with only notes (`dataTypeCount === 1`) gets its own single-type branch (like the other single-type branches) so a Notes-only import works; the result lists restored notes and notes kept because the local text is newer
- [x] run `make lint && make test` - must pass before task 9

### Task 9: Note tabs re-attach after a browser restart

**Files:**
- Modify: `tests/tabAssociationBackupMatch.test.mjs`
- Modify (only if the test fails): `src/utils/tabAssociations.ts`

- [x] write test: after a browser restart (new tab ids, `sameBrowserSession: false`) a window with two note tabs of this extension, restored in swapped positions, gives each bookmark the tab showing its own note URL (also with the stored tab ids reused for the other note)
- [x] write test: a worker restart in the same session keeps both note tabs by id
- [x] if a test fails, fix the matcher so the exact URL wins among same-host tabs, and record the fix in this plan (both passed; `placeEntries` already prefers the exact URL, no fix needed)
- [x] run `make test` - must pass before task 10

### Task 10: Verify acceptance criteria

- [ ] verify every point of Overview and Solution Overview is implemented (New Note, editor, view, missing text, Duplicate, cleanup, backup, Recently Closed, icon)
- [ ] verify Space folder walkers need no change: note bookmarks are ordinary bookmarks, and `isSystemFolder` skipping is untouched; the one intended exception is `collectNoteIds` (cleanup and Export), which walks `asd_Archive` and `asd_Favorites`
- [ ] run `make lint && make test && make build`

### Task 11: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `docs/state-reference.md`
- Modify: `docs/development.md`
- Modify: `src/data/changelog.ts`

- [ ] `README.md`: notes (New Note, editing, what renders, text stays on this device, backup carries it, YAML doesn't, unpacked builds: moving `dist/` breaks note links)
- [ ] `docs/state-reference.md`: `bookmarkNotes` (shape, owner, consumers, updates, cleanup, unreadable value, backup, lifespan, instances), and a row in its Limitations table for the shared 10 MB `chrome.storage.local` quota
- [ ] `docs/development.md`: `NoteManager` row in the manager table; `src/note/` and the root `note.html` in the project layout; in "Shared state", a line that the note page is a proxy client without a mirror (it reads through messages, unlike "Reads never leave the sidebar")
- [ ] `docs/changelog.md` under `## Latest Version` and a What's New line in `src/data/changelog.ts` (`'1.0.352'`)
- [ ] move this plan to `docs/plans/completed/`

## Known limitations

- [known-limitation] Unpacked builds: the extension id depends on the `dist/` path. Moving `dist/` breaks note URLs, and the texts become unreachable (a new id has its own storage). Not pinned: a manifest `key` would change the existing install's id.
- [known-limitation] Copy/Paste as YAML on the same device: the pasted note bookmark shares the original's text.
- [known-limitation] Synced note bookmarks that carry another unpacked id are not rewritten; only bookmarks created by an import are.
- [known-limitation] A note bookmark deleted while the extension isn't running is never marked, so its text stays in storage.
- [known-limitation] Two tabs editing the same note: the last save wins.
- [known-limitation] Import with Bookmarks into a subfolder ("Creates a subfolder with imported bookmarks") on the device that already has the notes: the imported note bookmarks share text with the originals, as with YAML paste.
- [known-limitation] All texts share one `chrome.storage.local` key under the 10 MB quota (no `unlimitedStorage`) with every other key; a save that hits it fails inline and keeps the editor.
- [known-limitation] If Chrome fires `bookmarks.onRemoved` for account bookmarks on sign-out, a sign-out longer than 30 days lets the sweep delete the texts of notes in them (not verified that Chrome fires these events).
- [known-limitation] A note tab closed by the extension (auto-archive, Archive, the row's close button) may skip the `beforeunload` prompt, losing an unsaved draft.
- [known-limitation] New Note or Duplicate whose bookmark create fails after the text record was written leaves that record without a bookmark or a removal mark, so the sweep never deletes it (an empty or copied text; bookmark create failures are rare).

## Post-Completion

*Manual checks in Chrome, no checkboxes*

- New Note in a Space folder → editor tab; Save, Cmd+S, Cancel; reopen shows the rendered note with Edit and the date; links open in a new tab; light and dark system theme
- close the tab with unsaved edits → leave-page prompt
- rename, drag to another folder, delete + Undo: the text stays; Duplicate: editing the copy leaves the original
- Open All / Open as Tab Group on a folder with a note; the note tab associates with its bookmark; restart the browser → still associated
- note bookmark on a second computer (account sync) → "stored on another computer"; Export with Notes on computer A, Import with only Notes on computer B → the text appears
- close an unassociated note tab → it appears in Recently Closed and reopens
- close a note tab with unsaved edits through the sidebar (row close button, Archive) → does the leave-page prompt appear? (known limitation if not)
