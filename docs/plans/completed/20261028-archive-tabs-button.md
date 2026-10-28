# Archive Tabs Button

## Overview
- Add an **Archive** button next to **Clear** on the "+ New Tab" row. It saves every tab Clear would close into the active Space's archive (`asd_Archive`, feature 035) and then closes them, right away.
- Why: Clear throws tabs away; auto-archive keeps them but only after a period. The user wants to clean the Tab list now without losing anything.
- Undo works like Clear's: the toast's Undo reopens the tabs where they were and removes the archive items this press created.

### Decided with the user
- Same tab set as Clear: every tab in the Tab list of the current Space, **including the active tab and tabs playing audio** (auto-archive's exemptions don't apply). With the text filter active, only the matching tabs.
- Tabs are closed after archiving; nothing waits for the "Archive tabs after" setting, which can be `Never`.
- Undo like Clear, via the toast.
- Archiving runs in the sidebar as an `UndoableAction`, not in the background.

### Calls made while planning (for review)
- Empty pages (`chrome://newtab/`, `about:blank`, empty URL) are closed without an archive item, as in auto-archive.
- A tab whose archive bookmark can't be created stays open; the toast says how many stayed open. If no tab could be archived and nothing was closed, the action fails and the toast shows the error (no Undo).
- If archiving would close every tab in the window, the existing "close all tabs" confirmation is shown; after confirming, tabs are archived and closed without Undo (the window closes), same as Clear.
- Undo does not bring back an older archive item with the same URL that the press replaced (only its archive time differed).
- The button is hidden when the Tab list is empty or the active Space has no bookmark folder (no Space, the "All" view, or a missing folder) — there is nowhere to archive to.
- Button sits left of Clear, uses lucide's `Archive` icon and the "Archive" label, and shows on row hover like Clear.
- Feature 035's non-goal "manually closed tabs do not go to the archive" gets an exception note for this button instead of a new feature spec.

## Context (from discovery)
- `src/components/TabList.tsx`
  - `NewTabRow` (~line 474) renders Clear through `onClearTabs` in `actions`.
  - `handleCloseAllTabs` (~914) closes `visibleTabs` via `performClose` (~887), which opens `confirmCloseAllDialog` when every window tab would close, otherwise runs `CloseTabAction` through `onPerformAction`.
  - The confirm handler (~2440) calls `closeTabs(confirmCloseAllDialog.tabIds)` without undo.
  - The Space bookmark folder id is already looked up at ~1097: `findFolderBySegments(activeSpace.bookmarkFolderSegments, activeSpace.bookmarkFolderInAccount)?.id`.
- `src/actions/closeTabAction.ts` — `CloseTabAction`: snapshots tabs (URL, index, group, Space, association), closes them, `undo()` recreates them. Touches `chrome.*` and proxies, so it can't be imported by Node tests.
- `src/actions/types.ts` — `UndoableAction { description; do(); undo() }`. `App.tsx` `performAction` runs `do()`, shows `description` in a toast with Undo; a thrown error becomes the toast text with no Undo.
- `src/utils/archiveFolder.ts` — `SpaceArchive.archive(spaceFolderId, page)` finds or creates `asd_Archive`, creates the bookmark at index 0, removes older items with the same URL. Takes an injected `ArchiveBookmarksApi`; tested in `tests/archiveFolder.test.mjs`.
- `src/utils/autoArchivePolicy.ts` — `EMPTY_PAGE_URLS` (not exported), `tabPageUrl(tab)`; `src/utils/parkedTabAssociation.ts` — `getEffectiveTabUrl` (suspender-parked tabs → original URL). `src/services/tabAutoArchiver.ts` archives with `getEffectiveTabUrl(tabPageUrl(tab))`.
- Tests: `make test` = `node --test tests/*.test.mjs` with type stripping. Modules imported by tests need `.ts` import extensions, injected chrome APIs, no `import.meta.env` reads, no enums/parameter properties.

## Development Approach
- **testing approach**: TDD for the decisions listed under Testing Strategy — failing test first, then the code. Coverage is not a goal; no tests for trivial helpers, wording or wiring.
- complete each task fully before moving to the next
- make small, focused changes
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- maintain backward compatibility (Clear and auto-archive behave as before)

## Testing Strategy
Only the decisions that would lose data or close the wrong tabs if they broke:
- a tab whose archive bookmark can't be created stays open (the others still archive);
- empty pages close without an archive item;
- tabs archive one at a time, so a missing `asd_Archive` is created once, not per tab;
- the action closes only the tabs that were archived (or empty), and closes nothing when every archive failed;
- Undo reopens the tabs, then removes the archive items this press created.

Fakes: an in-memory `ArchiveBookmarksApi` (like `tests/archiveFolder.test.mjs`) and a fake close action. UI wiring is checked by `make build` and by hand (see Post-Completion).

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
Three layers, each testable on its own:

1. `isEmptyPage(url)` — exported from `autoArchivePolicy.ts`, shared by auto-archive and the button.
2. `TabArchiveBatch` (`src/utils/tabArchiveBatch.ts`) — pure logic with an injected `ArchiveBookmarksApi`: saves a list of tabs into one Space folder via `SpaceArchive`, sorts them into closable / kept open, remembers the bookmarks it created and can remove them again (`discard()`).
3. `ArchiveTabsAction` (`src/actions/archiveTabsAction.ts`) — `UndoableAction` that runs the batch, then closes the closable tabs through a close action it gets from a factory (in the app: `CloseTabAction`). `undo()` undoes the close action (reopens tabs), then `discard()`s the batch. Taking the factory keeps `CloseTabAction`'s `chrome.*` imports out of the test's import graph.

`TabList` builds the action with real `chrome.bookmarks` and a `CloseTabAction` factory and runs it through `onPerformAction`, so the toast and Undo come for free.

## Technical Details

### `TabArchiveBatch`
- Constructor: `(bookmarks: ArchiveBookmarksApi)`; builds its own `SpaceArchive` from it and keeps `bookmarks.remove` for `discard()`.
- `archive(spaceFolderId: string, tabs: readonly ArchivableTab[]): Promise<TabArchiveResult>` where `ArchivableTab = { id: number; title?: string; url?: string; pendingUrl?: string }`.
  - Tabs are processed **one at a time**: `SpaceArchive` creates `asd_Archive` on first use, so parallel calls could create several folders.
  - Per tab: `pageUrl = tabPageUrl(tab)`. Empty page → closable, nothing saved. Otherwise `spaceArchive.archive(folderId, { title, url: getEffectiveTabUrl(pageUrl) })`; success → closable + remember the created bookmark id; throw → kept open, `console.error`.
  - `TabArchiveResult` (class or readonly object, builder's choice per CLAUDE.md style): `closableTabIds`, `archivedCount`, `keptOpenCount`.
  - ➕ also `archivedTabIds` (with `archivedCount` as its length), so the toast can name the one archived tab (Task 3).
- `discard(): Promise<void>` removes every remembered bookmark id; a failed remove (e.g. the item was already replaced by a later tab with the same URL in the same batch, or the user deleted it) is ignored and logged, the rest continue.

### `ArchiveTabsAction implements UndoableAction`
- Constructor: `(tabs, spaceFolderId, batch: TabArchiveBatch, createCloseAction: (tabIds: number[]) => UndoableAction)`. Use `import type` / `.ts` extensions so Node can load it.
- `do()`:
  1. `result = await batch.archive(spaceFolderId, tabs)`.
  2. If `result.closableTabIds` is empty: throw `Error('Could not archive tabs')` when anything was kept open, else do nothing.
  3. `closeAction = createCloseAction(result.closableTabIds)`; `await closeAction.do()`.
  4. `description`: one archived tab → `Archived "<truncated title>"`; otherwise `Archived N tabs`; append `, M kept open` when `keptOpenCount > 0`. Empty pages count as closed, not archived — builder may phrase N as tabs closed if that reads better.
     - As built: N is the archived count (empty pages close silently alongside); only empty pages → `Closed N empty tabs`; no tabs at all → `No tabs to archive`.
- `undo()`: `await closeAction?.undo()` first (tabs come back even if bookmark cleanup fails), then `await batch.discard()`.

### `TabList` wiring
- `spaceFolderId` for the active Space (reuse the lookup at ~1097, without the "remembered folder" part); `undefined` hides the button.
- `handleArchiveAllTabs`: same tab set as `handleCloseAllTabs` (`visibleTabs`).
  - If every window tab would close: open the confirm dialog in archive mode — `confirmCloseAllDialog` gains `mode: 'close' | 'archive'`. On confirm in archive mode: build the action and `await action.do()` directly (no Undo, the window closes).
  - Otherwise `onPerformAction(new ArchiveTabsAction(...))` (fallback `action.do()` like `performClose`).
- Real deps: `new TabArchiveBatch({ getChildren: id => chrome.bookmarks.getChildren(id), create: b => chrome.bookmarks.create(b), remove: id => chrome.bookmarks.remove(id) })`; factory `ids => new CloseTabAction(ids, windowId, getItemKeyForTab, restoreItemAssociation)`.
- `NewTabRow` gets `onArchiveTabs?: () => void`; `actions` renders Archive then Clear in a `flex items-center gap-1` wrapper; both buttons stop pointer-down propagation like Clear. Reuse the `arc-clear-tabs` look (rename the CSS class to something shared, e.g. `arc-tab-list-action`, or add a second selector — builder's call).
- Clear selection after archiving, as the close-all confirm does.
- As built: `activeSpaceFolderId` memo (also feeds `lastSelectedBookmarkFolderDefaultId`); `closesWholeWindow(tabIds)` shared by `performClose` and the Archive button; CSS class renamed to `arc-tab-list-action` for both buttons. In archive mode the confirm dialog's details read "They are archived first. This will close the window."; after confirming, the action's description (or its error) goes to TabList's own toast, which only stays visible when some tab was kept open and the window survives.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code, tests, docs in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome

## Implementation Steps

### Task 1: Export the empty-page check

**Files:**
- Modify: `src/utils/autoArchivePolicy.ts`

- [x] add `export function isEmptyPage(url: string): boolean` backed by `EMPTY_PAGE_URLS`
- [x] use it in the policy's close-only branch instead of `EMPTY_PAGE_URLS.has(...)` (existing policy tests cover it)
- [x] run `make test` - must pass before task 2

### Task 2: Archive a batch of tabs into a Space folder

**Files:**
- Create: `src/utils/tabArchiveBatch.ts`
- Create: `tests/tabArchiveBatch.test.mjs`

- [x] write failing tests: a `create` that throws keeps that tab open while the others archive; an empty page is closable without an item; with no `asd_Archive`, a batch of several tabs creates exactly one
- [x] implement `TabArchiveBatch` and `TabArchiveResult`
- [x] run `make test` - must pass before task 3

### Task 3: Undoable archive action

**Files:**
- Create: `src/actions/archiveTabsAction.ts`
- Create: `tests/archiveTabsAction.test.mjs`

- [x] write failing tests with a fake bookmarks API and a fake close-action factory: `do()` closes exactly the archived/empty tab ids; every archive failing → `do()` throws and nothing is closed; `undo()` reopens (close action's `undo()`) and then the created archive items are gone
- [x] implement `ArchiveTabsAction` (type-only imports, `.ts` extensions, no `import.meta.env`)
- [x] run `make test` - must pass before task 4

### Task 4: Archive button in the Tab list

**Files:**
- Modify: `src/components/TabList.tsx`
- Modify: `src/index.css`

- [x] add `onArchiveTabs` to `NewTabRow` and render the Archive button left of Clear (lucide `Archive` icon, `title`/`aria-label` "Archive tabs")
- [x] compute the active Space's folder id; pass `onArchiveTabs` only when it exists and `visibleTabs` is not empty
- [x] add `handleArchiveAllTabs` with the real `TabArchiveBatch` and `CloseTabAction` factory, run through `onPerformAction`
- [x] extend `confirmCloseAllDialog` with `mode` and run the archive action on confirm in archive mode
- [x] make the hover-reveal CSS cover both buttons
- [x] run `make build` (type-check) and `make test` - must pass before task 5

### Task 5: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented (tab set incl. active/audible, filter respected, empty pages, failures kept open, confirm on full window, Undo)
- [x] verify edge cases are handled (no Space folder → no button, duplicate URLs in one batch, archive folder missing → created once)
- [x] run full test suite: `make test`
- [x] run `make build`
- ⚠️ known limitations (not fixed, rare; carry into the 035 spec in Task 6):
  - Pressing Archive again while the first press still runs starts a second batch over the same tabs. Undo of the press that finished last can then remove archive items while reopening nothing, since the other press closed the tabs. Clear has the same lack of an in-flight guard.
  - If background auto-archive and the button both find `asd_Archive` missing at the same moment, two archive folders can appear; `findArchiveFolder` then uses the one with the lowest index.

### Task 6: [Final] Update documentation
- [x] `docs/features/035-tab-auto-archive.md`: note the Archive button as the exception to "manually closed tabs do not go to the archive", with a short section on its rules
- [x] `docs/chrome-web-store-info.md`: mention the Archive button under Key Features if archive is listed there
  - ➕ also one line under "Latest Version" in `docs/changelog.md`, next to the other 035 entries
- [x] update CLAUDE.md only if a new pattern came up (none: injecting the close-action factory is the existing "take chrome APIs as arguments" rule)
- [x] move this plan to `docs/plans/completed/` (moved by orchestrator after completion)

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (reload the extension in Chrome):
- Hover "+ New Tab": Archive and Clear both show; Archive moves every tab (active and audible included) into the Space's Archive section and closes them; the toast says "Archived N tabs".
- Undo: tabs reopen in their places, groups and Space; the new archive items disappear.
- Text filter active: only matching tabs are archived.
- A Space with only New Tab pages: they close, nothing is added to the archive.
- All window tabs in the list: the confirmation appears; confirming archives and closes the window.
- "All" view / Space without a folder: no Archive button.
- `make lint` can't run: the repo has no ESLint config.
