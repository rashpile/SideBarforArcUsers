# Task Spaces (#91)

## Overview

One-click temporary Spaces for a task, research or a one-off activity. A Task Space is a regular Space
with a task marker (`task` field on the Space record): tab separation, filters, search scope, Archive and
Favorites work as in any Space.

- **Create:** (+) menu → **New Task Space**: no dialog, name `YYYYMMDD-NN`, icon `list-todo`, color
  `green`, folder `Other Bookmarks/Tasks Spaces/{name}`, switched to at once.
- **Reach:** a hamburger (`Menu`) button left of (+) opens the Task Spaces list (oldest at top, older rows
  faded, 10 rows visible, opens scrolled to the newest). Task Spaces are not in the Space bar strip,
  except as a **temporary icon** while the Task Space is active in this window and for 10 minutes after
  its last use.
- **Convert to Regular Space** drops the marker; the Space then shows in the strip, folder unchanged.
- **Auto-archive:** setting **Archive Task Spaces after** (Never by default), counted from last use. A
  Task Space active in any window is never archived. Archiving saves the tabs whose page would otherwise
  be lost to the Space's `asd_Archive`, closes its tabs, and moves the record to an archived list; the
  list's **Archived** section restores it (without tabs). The bookmark folder always stays.

## Context (from discovery)

- Space record: `src/utils/spaceMessages.ts` (`Space`, `SPACES_STORAGE_KEY`).
- Space list owner: `src/managers/impl/spaceManager.ts` (background), API
  `src/managers/shared/spaceManagerApi.ts`, proxy with mirror `src/managers/proxies/spaceManagerProxy.ts`,
  hook `src/hooks/useSpaces.ts`, CRUD in `src/contexts/SpacesContext.tsx` (whole-list writes through
  `spaceManagerProxy.updateSpaces`).
- Window active Space: `src/managers/impl/spaceWindowStateManager.ts` (`setActiveSpace` is the single
  point where a window's active Space changes).
- Space bar: `src/components/SpaceBar.tsx` (sortable strip of `SpaceIcon`, (+) `DropdownMenu`),
  `src/components/SpaceIcon.tsx` (drop target accepts SPACE, TAB, URL), Space menu
  `src/components/SpaceContextMenuContent.tsx`, Space title menu in `src/App.tsx` (`SpaceTitle`), swipe in
  `src/App.tsx` (`SwipeableContainer`), Space dialogs `src/components/SpaceDialogs.tsx`,
  `src/components/SpaceEditDialog.tsx` (New Space folder flow: `getRootFolder('other')`,
  `isInAccountStorage`, `chrome.bookmarks.create`, `getBookmarkFolderLocation`).
- Folder lookup: `src/utils/bookmarkFolderLookup.ts` (`findRootFolder`, `getRootFolderType`,
  `isInAccountStorage`, `findFolderBySegments`); system folders: `isSystemFolder`
  (`src/utils/archiveFolder.ts`).
- Tab auto-archive to copy the shape of and reuse: `src/services/tabAutoArchiver.ts` (queue, alarm,
  last-run throttle in session storage, `startupRestoreSucceeded`, `tabMarksLoaded`, `beforeClose`,
  `#stillClosable`), `src/utils/autoArchive.ts` (raw-string setting with a DEV-only `1m`),
  `src/utils/autoArchivePolicy.ts` (`SavedPages`, `tabKind`, `isAlwaysKept`, `SplitViewsOnScreen`,
  `isEmptyPage`, `tabPageUrl`, `tabChangedDuringRun`), `src/utils/archiveFolder.ts`
  (`SpaceArchive.archive` dedupes by URL), `src/utils/spaceFavorites.ts` (`allFavoriteUrls`).
- Background-written, sidebar-read store pattern: `src/stores/bookmarkRecencyStore.ts`
  (`bookmarkLastActiveAt`, read in `App.tsx` with `useChromeLocalStorage`).
- Background wiring: `src/background.ts` (managers, `managerLoadPromise`, `stateReady`,
  `tabAssociationReadiness`, `handleTabActivation`, `openSpaceAtPosition`, alarms, `registerManager`,
  `recentlyClosedManager` `getSpaceIds` / `retainSpaces`).
- Navigation: `src/utils/spaceNumberCommand.ts`, `src/utils/spaceSelection.ts`
  (`resolveActiveSpaceId`, `resolveSpaceIdAfterDeletion`).
- Settings: `src/components/SettingsDialog.tsx` ("Archive tabs after" select), `src/App.tsx`
  (`useChromeLocalStorage` with `{ parse, serialize: v => v }`, `showToast`).
- Tests: `tests/*.test.mjs` run under Node type stripping; imported modules use `.ts` import extensions,
  take chrome APIs as arguments, don't read `import.meta.env`.

## Development Approach

- **testing approach**: Regular (code first, then tests), per CLAUDE.md "Test decisions, not coverage":
  tests only for behaviour that loses data or acts on the wrong tab, bookmark or Space (name counter,
  archive/restore list moves, which Task Spaces archive, which tabs are saved vs closed, last-use
  throttling, which Task Spaces the strip shows, convert dropping the marker). No tests for wording, menu
  wiring or popover layout.
- complete each task fully before moving to the next; small, focused changes
- `make lint && make test` must pass after each task; `make build` at the end
- Allman braces, comments say why, debug logs only under `import.meta.env.DEV`, classes over raw
  structures (CLAUDE.md "Code rules")
- update this plan file when scope changes during implementation

## Testing Strategy

- **unit tests**: Node tests in `tests/` for the pure modules and injectable classes named in each task
- **e2e tests**: the project has none

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview

- **Two lists, one owner.** `spaces` (local) keeps only live Spaces, Task Spaces among them. Archived Task
  Spaces move to a new key `archivedTaskSpaces` (local). `SpaceManager` owns both keys. Everything that
  reads `spaces` (switcher, search popup, navigator, bookmark → Space resolver, close follower, number
  shortcuts) needs no "archived" filter, so a hidden Space can't leak into navigation.
- **Guard against stale whole-list writes.** `SpaceManager.updateSpaces` drops ids that are in the
  archived list, so a sidebar whose mirror missed the archive broadcast can't re-add the Space.
- **Last use** lives in `taskSpaceLastUsedAt` (local), written only by background through
  `TaskSpaceLastUseStore` (serialized read-modify-write, like `BookmarkRecencyStore`); the sidebar reads
  it with `useChromeLocalStorage`. No manager or proxy: the sidebar never writes it. It feeds both the
  10-minute strip icon and auto-archive.
- **Auto-archive** is a background service (`TaskSpaceArchiver`) with injected dependencies, its own
  alarm and a pure selection policy. It shares one serial queue with `TabAutoArchiver`, so the two never
  create an `asd_Archive` folder in the same Space at once. It checks `TabAssociationReadiness.wait()`
  before closing anything, classifies tabs the way tab auto-archive does, and re-checks the Space and its
  tabs right before it archives and closes.

## Technical Details

### Data

```typescript
// src/utils/spaceMessages.ts
export interface TaskSpaceInfo
{
  createdAt: number;     // epoch ms
  archivedAt?: number;   // epoch ms; set only on records in archivedTaskSpaces
}
export interface Space { /* existing fields */ task?: TaskSpaceInfo; }
```

| key | area | shape | writer |
|---|---|---|---|
| `spaces` | local | `Space[]` (live only) | `SpaceManager` |
| `archivedTaskSpaces` | local | `Space[]` with `task.archivedAt` | `SpaceManager` |
| `taskSpaceLastUsedAt` | local | JSON string of `Record<spaceId, epochMs>` (as `bookmarkLastActiveAt`) | `TaskSpaceLastUseStore` (background) |
| `taskSpaceArchiveAfter` | local | raw string: `'never' \| '1m' \| '1d' \| '3d' \| '7d' \| '14d' \| '30d'` | Settings dialog |
| `taskSpaceArchiveLastRunAt` | session | epoch ms | `TaskSpaceArchiver` |

`'1m'` is accepted only in DEV builds (callers pass `import.meta.env.DEV`); in release it reads as
`'never'`, like `autoArchiveAfter`.

### Name and folder

- Name: `YYYYMMDD-NN` from the **local** date. NN = 1 + the highest NN for today found among live
  Space names, archived Task Space names and the child folder titles of `Tasks Spaces`
  (`/^YYYYMMDD-(\d{2,})$/`). Zero-padded to 2 digits; 100 and up as is.
- Folder: `findRootFolder(roots, 'other')` → first child folder (no URL) titled `Tasks Spaces`, created
  when missing → new subfolder `{name}`. Location via `getBookmarkFolderLocation` (segments +
  `inAccount`).

### Strip

`spaceBarItems(spaces, activeSpaceId, lastUse, now)` returns the regular Spaces (array order, `!task`),
the temporary Task Spaces (Task Spaces that are `activeSpaceId` or have `now - lastUse(id) < 10 min`,
ordered by `task.createdAt`), and the time the next temporary icon expires. One hook,
`useSpaceBarItems()`, owns the clock and the expiry timer and feeds both the strip and swipe, so swipe
never reaches an icon the strip has already hidden. Swipe uses `[...regular, ...temporary]`.

### Last use touches (background)

- `SpaceWindowStateManager.setActiveSpace(windowId, spaceId)`: when the window's Space changes, touch the
  Space left and the Space entered (Task Spaces only, via an injected `onActiveSpaceChanged` callback).
- `handleTabActivation`: touch the window's active Space when it is a Task Space.
- `SpaceManager.restoreTaskSpace`: touch the restored Space (injected `onRestored` callback).
- `touch` is skipped when the stored value is less than 60 s older than now, so tab switching doesn't
  flood storage. Every touch reads storage first (no in-memory cache), so no load ordering matters.
- `retain(taskSpaceIds)` drops entries of ids that are no longer live or archived Task Spaces; it runs on a
  `spaces` / `archivedTaskSpaces` change, chained on `managerLoadPromise`, and is skipped when the Space
  list is empty ("no Spaces means they aren't known", as the Recently Closed listener does).
- Last use for archiving = `max(task.createdAt, lastUse(id))`.

### Archive run

1. `startupRestoreSucceeded()` false or `tabMarksLoaded()` false → nothing.
2. Setting `'never'` → nothing. Else `selectTaskSpacesToArchive({ spaces, lastUse, activeSpaceIds, now, periodMs })`:
   live Task Spaces with `now - lastUse >= periodMs` that are not the active Space of any window.
3. Per selected Space, its tabs in all normal windows: registry-assigned to it, plus tabs associated with a
   bookmark (`bookmark-<id>` key) inside its folder subtree, skipping `asd_Archive` and `asd_Favorites`
   with `isSystemFolder` at any depth. Skip the Space this run when one of them is marked for attention or
   always kept by tab auto-archive's rule (`isAlwaysKept`: active, audible, Chrome-pinned, incognito, or
   in a split view on screen).
4. Folder missing → skip. Classify each tab as `tabKind` does, with `SavedPages.fromTree(roots,
   favorites)` (`allFavoriteUrls(roots, spaces)`): close without saving only a tab on its bookmark's exact
   page, a tab on a Favorite's page, or an empty page; every other tab — a bookmark or Favorite tab that
   navigated elsewhere included — is saved with `SpaceArchive.archive(folderId, { title, url:
   getEffectiveTabUrl(tabPageUrl(tab)) })`. Any save failure → skip the Space, close nothing.
5. Re-check right before acting: the Space is still not the active Space of any window, and each tab,
   re-read, is still closable (not marked, `tabChangedDuringRun(snapshot, current, runStartedAt)` false).
   Anything changed → skip the Space this run (saved pages are harmless: `SpaceArchive` dedupes by URL).
6. `spaceManager.archiveTaskSpaces([id], now)` (record moves, broadcast), then `beforeClose(tabIds)`
   (`recentlyClosedManager.expectArchiveClose`), then `chrome.tabs.remove(tabIds)`.

One Space failing (any thrown error) is logged and the run goes on with the next.

## What Goes Where

- **Implementation Steps**: code, tests, docs in this repo
- **Post-Completion**: manual checks in Chrome

## Implementation Steps

### Task 1: Task Space record, helpers and name counter

**Files:**
- Modify: `src/utils/spaceMessages.ts`
- Create: `src/utils/taskSpaces.ts`
- Modify: `src/utils/spaceSelection.ts`
- Create: `tests/taskSpaces.test.mjs`
- Modify: `tests/spaceSelection.test.mjs`

- [ ] add `TaskSpaceInfo` and `task?: TaskSpaceInfo` to `Space` in `src/utils/spaceMessages.ts`, with a comment that `archivedAt` is set only on records in `archivedTaskSpaces`
- [ ] create `src/utils/taskSpaces.ts` (`.ts` imports, no chrome, no `import.meta.env`): constants `TASK_SPACES_FOLDER_TITLE = 'Tasks Spaces'`, `TASK_SPACE_ICON = 'list-todo'`, `TASK_SPACE_COLOR = 'green'`; `isTaskSpace(space)`; `regularSpaces(spaces)`; `withoutTaskMarker(space)` (a copy without the `task` key); `taskSpaceDatePrefix(date: Date)` → local `YYYYMMDD`; `nextTaskSpaceName(date, takenNames: Iterable<string>)` → `YYYYMMDD-NN` per Technical Details
- [ ] change `resolveActiveSpaceId` fallback to the first regular Space, else the first Space (`SpaceIdentity` gains optional `task?: unknown`); `resolveSpaceIdAfterDeletion` picks the neighbour within the deleted Space's group (regular among regular, Task among Task) and falls back to the first regular Space, else any Space
- [ ] write tests for `nextTaskSpaceName`: first of the day is `-01`; next after `-01`,`-02` is `-03`; a gap (`-01`,`-03`) gives `-04`; names of another day and non-matching names ignored; a folder-only name counts; `-99` → `-100`; local date used (construct `new Date(y, m, d, 23, 59)`)
- [ ] write tests for `withoutTaskMarker` (no `task` key left, other fields kept) and for `resolveActiveSpaceId` / `resolveSpaceIdAfterDeletion`: unknown id with a Task Space first in the list falls back to the first regular Space; only Task Spaces → first Space; deleting the active regular Space in `[R1, R2, T1]` lands on `R1`
- [ ] run `make lint && make test` - must pass before task 2

### Task 2: Archived list in SpaceManager and its proxy

**Files:**
- Create: `src/utils/spaceLists.ts`
- Modify: `src/utils/spaceMessages.ts`
- Modify: `src/managers/impl/spaceManager.ts`
- Modify: `src/managers/shared/spaceManagerApi.ts`
- Modify: `src/managers/proxies/spaceManagerProxy.ts`
- Create: `src/hooks/useArchivedTaskSpaces.ts`
- Modify: `src/background.ts`
- Create: `tests/spaceLists.test.mjs`

- [ ] create immutable class `SpaceLists` in `src/utils/spaceLists.ts` (`live`, `archived` readonly arrays) with: `withLive(spaces)` (drops ids present in `archived`), `archive(ids, now)` (moves live Task Spaces with those ids to the end of `archived` with `task.archivedAt = now`; ignores regular Spaces and unknown ids), `restore(id)` (moves the archived record to the end of `live` without `archivedAt`; no-op when absent), `forgetArchived(id)`, `taskSpaceIds()` (live + archived)
- [ ] `SpaceManager`: add `ARCHIVED_TASK_SPACES_STORAGE_KEY = 'archivedTaskSpaces'` (export from `spaceMessages.ts`), load it with `spaces`, keep state as `SpaceLists`; `updateSpaces` applies `lists.withLive(...)` **after** awaiting `resolveMissingSegments` and sets `migrated: true` in the broadcast when `withLive` dropped ids, so the originating proxy corrects its mirror; new API methods `getArchivedTaskSpaces()`, `restoreTaskSpace(id)`, `deleteArchivedTaskSpace(id)` (dispatch cases); background-internal `archiveTaskSpaces(ids, now)`; every change writes the changed key(s) and broadcasts `SPACES_CHANGED` with `spaces`, `archived`, `senderId`, `migrated`; constructor takes an optional `onRestored(spaceId)` callback (wired in Task 3)
- [ ] proxy: second mirror `archivedStore` (`ReadableStore<readonly Space[]>`), filled on `load()` and from broadcasts (`message.archived` when present); `restoreTaskSpace(id)` and `deleteArchivedTaskSpace(id)` apply the move optimistically to both mirrors through `SpaceLists`, then call the manager, resync both on failure; the own-echo rule stays as today
- [ ] create `src/hooks/useArchivedTaskSpaces.ts` (`useSyncExternalStore` over `archivedStore`, like `useSpaces.ts`)
- [ ] `background.ts`: Recently Closed keeps the lists of live **and** archived Spaces — `getSpaceIds` and the `retainSpaces` listener use the ids of both lists, and the listener also fires on an `archivedTaskSpaces` change, so a restored Task Space keeps its Recently Closed list
- [ ] write tests for `SpaceLists`: archive moves a Task Space and stamps `archivedAt`; archive ignores a regular Space; `withLive` drops an archived id (stale whole-list write) and keeps the rest in order; restore appends to live and drops `archivedAt`; restore of an unknown id is a no-op; `forgetArchived` removes only that record
- [ ] run `make lint && make test` - must pass before task 3

### Task 3: Last use of Task Spaces (TaskSpaceLastUseStore)

**Files:**
- Create: `src/stores/taskSpaceLastUse.ts`
- Modify: `src/managers/impl/spaceWindowStateManager.ts`
- Modify: `src/background.ts`
- Create: `tests/taskSpaceLastUse.test.mjs`

- [ ] create `src/stores/taskSpaceLastUse.ts` modelled on `bookmarkRecencyStore.ts`: `TASK_SPACE_LAST_USE_KEY = 'taskSpaceLastUsedAt'`; read-only view class `TaskSpaceLastUse` (`lastUsedAt(id)`, `EMPTY`) for the sidebar and the archiver; background writer `TaskSpaceLastUseStore` (storage and clock injected, serialized read-modify-write) with `read()`, `touch(spaceId)` (skipped when the stored value is less than 60 s older than now), `retain(taskSpaceIds)`; junk values in storage read as absent
- [ ] `SpaceWindowStateManager`: optional constructor callback `onActiveSpaceChanged(windowId, previousSpaceId, nextSpaceId)`, called from `setActiveSpace` only when the id changes
- [ ] `background.ts`: create the store; touch both Spaces from `onActiveSpaceChanged` when they are Task Spaces (live list); touch the window's active Space in `handleTabActivation` when it is a Task Space; pass `onRestored` → `touch` to `SpaceManager`; `retain` with the task ids of both lists on a `spaces` / `archivedTaskSpaces` change, chained on `managerLoadPromise` and skipped when the Space list is empty
- [ ] write tests for `TaskSpaceLastUseStore`: first touch writes; touch within 60 s doesn't write; touch after 60 s updates; two concurrent touches of different ids both land; `retain` drops other ids; junk stored value reads as empty
- [ ] run `make lint && make test` - must pass before task 4

### Task 4: New Task Space in the (+) menu

**Files:**
- Create: `src/utils/taskSpaceFolder.ts`
- Modify: `src/contexts/SpacesContext.tsx`
- Modify: `src/components/SpaceBar.tsx`
- Modify: `src/App.tsx`
- Create: `tests/taskSpaceFolder.test.mjs`

- [ ] create `createTaskSpaceFolder(bookmarks, roots, date, takenNames)` in `src/utils/taskSpaceFolder.ts` (bookmarks API injected: `create`, `getChildren`; `.ts` imports): find the Other root with `findRootFolder(roots, 'other')` (error when missing), find the first child folder titled `Tasks Spaces` or create it, collect its child folder titles, pick the name with `nextTaskSpaceName(date, [...takenNames, ...folderTitles])`, create the subfolder, return `{ name, folderId }`
- [ ] `SpacesContext`: `createTaskSpace(): Promise<Space>` reads the live bookmark tree, takes `takenNames` from live and archived Spaces, calls `createTaskSpaceFolder`, resolves the location with `getBookmarkFolderLocation`, appends a Space `{ name, icon: TASK_SPACE_ICON, color: TASK_SPACE_COLOR, bookmarkFolder…, task: { createdAt: Date.now() } }` through the snapshot write like `createSpace`, and returns it; errors propagate
- [ ] `SpaceBar`: **New Task Space** item (`ListTodo` icon) in the (+) menu after New Space; on select `createTaskSpace()` then `switchToSpace(space.id)`; a failure shows a toast through a new `onShowToast` prop (App passes `showToast`) and is logged; no Space is created then
- [ ] write tests for `createTaskSpaceFolder`: creates `Tasks Spaces` under the Other root when missing; reuses an existing one; skips a number whose folder exists (archived/deleted Task Space); prefers the account Other root (`syncing: true`) when both exist; finds the Other root by `folderType` in a profile without ids `'1'`/`'2'`; throws when there is no Other root
- [ ] run `make lint && make test` - must pass before task 5

### Task 5: Strip with temporary Task Space icons, swipe and number shortcuts

**Files:**
- Create: `src/utils/spaceBarItems.ts`
- Create: `src/hooks/useSpaceBarItems.ts`
- Modify: `src/components/SpaceBar.tsx`
- Modify: `src/components/SpaceIcon.tsx`
- Modify: `src/App.tsx`
- Modify: `src/utils/spaceNumberCommand.ts`
- Create: `tests/spaceBarItems.test.mjs`
- Modify: `tests/spaceNumberCommand.test.mjs`

- [ ] create `spaceBarItems(spaces, activeSpaceId, lastUse, now)` in `src/utils/spaceBarItems.ts` (10-minute window constant) returning `{ regular, temporary, nextExpiryAt }` per Technical Details
- [ ] create `useSpaceBarItems()`: reads Spaces and the active Space from `SpacesContext`, last use with `useChromeLocalStorage(TASK_SPACE_LAST_USE_KEY, {})` wrapped in `TaskSpaceLastUse`, owns `now` and a `setTimeout` to `nextExpiryAt` that re-renders, returns the helper's result
- [ ] `SpaceIcon`: optional prop that limits its drop target to TAB and URL (no SPACE), so dropping a regular Space on a temporary icon can't reorder the list around a hidden Task Space
- [ ] `SpaceBar`: sortable strip from `regular` only (sortable ids from `regular`); when `temporary` is non-empty, a thin vertical divider then non-draggable `SpaceIcon`s with the TAB/URL-only drop target, same context menu, `canDelete` from all live Spaces; auto-scroll to the active icon keeps working
- [ ] `SwipeableContainer` in `App.tsx`: swipe over `[...regular, ...temporary]` from `useSpaceBarItems()`
- [ ] `SpaceNumberCommand.spaceToOpen` counts regular Spaces only (constraint `T extends SpaceIdentity & { task?: unknown }`)
- [ ] write tests for `spaceBarItems`: Task Space active in this window shows; used 9 min ago shows, 11 min ago doesn't; regular Spaces keep array order; temporary sorted by `createdAt`; `nextExpiryAt` is the earliest expiry, undefined when only the active one shows
- [ ] write tests for `spaceToOpen`: a Task Space before position 2 in the list doesn't shift position 2
- [ ] run `make lint && make test` - must pass before task 6

### Task 6: Task Spaces list popover

**Files:**
- Create: `src/components/TaskSpacesPopover.tsx`
- Modify: `src/components/SpaceBar.tsx`

- [ ] `SpaceBar`: button with the Lucide `Menu` icon left of (+), title "Task Spaces"; highlighted while the popover is open
- [ ] `TaskSpacesPopover` (portal, above the bar, transparent overlay under it that closes on click, Escape closes; follow `RecentlyClosedPopover` / `MenuBase` patterns): live Task Spaces sorted by `createdAt` ascending; each row icon (`getIcon`) + name; active row highlighted; opacity by age rank (newest 1.0, −0.07 per older row, floor 0.35, full on hover); max height of 10 rows with scroll; scrolled to the bottom on open; click → `switchToSpace` and close; right-click → `SpaceContextMenuContent` (Edit, Close All Tabs In Space, Delete, Convert — Task 7) through the same handlers `SpaceBar` uses for icons
- [ ] **Archived (N)** header at the top, shown when N > 0, collapsed by default; expanded rows dimmed with the archive date (`toLocaleDateString`); click → `spaceManagerProxy.restoreTaskSpace(id)` then `switchToSpace(id)` and close; right-click menu with Restore and Delete (`deleteArchivedTaskSpace`)
- [ ] empty state when there are no live and no archived Task Spaces: "No Task Spaces yet. Create one with + → New Task Space"
- [ ] no tests (UI wiring, per CLAUDE.md)
- [ ] run `make lint && make test` - must pass before task 7

### Task 7: Convert to Regular Space

**Files:**
- Modify: `src/contexts/SpacesContext.tsx`
- Modify: `src/components/SpaceContextMenuContent.tsx`
- Modify: `src/components/SpaceIcon.tsx`
- Modify: `src/components/SpaceBar.tsx`
- Modify: `src/components/TaskSpacesPopover.tsx`
- Modify: `src/App.tsx`

- [ ] `SpacesContext.convertToRegularSpace(id)`: snapshot write replacing the Space with `withoutTaskMarker(space)` (Task 1); expose it in the context value
- [ ] `SpaceContextMenuContent`: optional `onConvertToRegular` → item **Convert to Regular Space** (Lucide `LayoutGrid`), shown only when provided
- [ ] pass it for Task Spaces in the Space title `...` menu (`SpaceTitle` in `App.tsx`), the temporary strip icons (thread the prop through `SpaceIcon`) and the popover rows
- [ ] no new tests (the marker drop is covered by the `withoutTaskMarker` test in Task 1; the rest is wiring)
- [ ] run `make lint && make test` - must pass before task 8

### Task 8: "Archive Task Spaces after" setting and selection policy

**Files:**
- Create: `src/utils/taskSpaceArchive.ts`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/App.tsx`
- Create: `tests/taskSpaceArchive.test.mjs`

- [ ] create `src/utils/taskSpaceArchive.ts`: type `TaskSpaceArchivePeriod`, `TASK_SPACE_ARCHIVE_AFTER_KEY = 'taskSpaceArchiveAfter'`, default `'never'`, `parseTaskSpaceArchivePeriod(value, allowDevPeriod)` (DEV-only `'1m'` as in `autoArchive.ts`), `taskSpaceArchivePeriodMs(period)`, and `selectTaskSpacesToArchive({ spaces, lastUse, activeSpaceIds, now, periodMs })` → ids per Technical Details
- [ ] Settings dialog: **Archive Task Spaces after** select next to "Archive tabs after" (Never, 1 minute in DEV, 1 day, 3 days, 7 days, 14 days, 30 days) with a hint ("Task Spaces stay until you delete them" / "Unused Task Spaces save their tabs to the Space's Archive, close them and move to Archived in the Task Spaces list"); `App.tsx` stores it with `useChromeLocalStorage(TASK_SPACE_ARCHIVE_AFTER_KEY, …, { parse, serialize: v => v })`
- [ ] write tests for `parseTaskSpaceArchivePeriod`: unknown → never; `'1m'` → never without the DEV flag, `'1m'` with it
- [ ] write tests for `selectTaskSpacesToArchive`: overdue Task Space selected; one used within the period kept; regular Space never selected; Task Space active in any window kept; no stored last use falls back to `createdAt`; a recent touch after an old `createdAt` keeps it
- [ ] run `make lint && make test` - must pass before task 9

### Task 9: TaskSpaceArchiver background service

**Files:**
- Create: `src/utils/serialQueue.ts`
- Create: `src/services/taskSpaceArchiver.ts`
- Modify: `src/services/tabAutoArchiver.ts`
- Modify: `src/utils/autoArchivePolicy.ts`
- Modify: `src/background.ts`
- Create: `tests/taskSpaceArchiver.test.mjs`

- [ ] create `SerialQueue` in `src/utils/serialQueue.ts` (`run(label, task)`: chains on the tail, logs a failure, never rejects); `TabAutoArchiver` takes it as a dep instead of its private `#tail`/`#enqueue`; background creates one and passes it to both archivers
- [ ] export from `autoArchivePolicy.ts` what the Task Space run reuses (a tab-classification function built on `tabKind` that answers save / close-only for one tab, and `isAlwaysKept` / `SplitViewsOnScreen`), without changing tab auto-archive's behaviour
- [ ] create class `TaskSpaceArchiver` with injected deps (no `chrome.*` at import time, `.ts` imports, `debug` flag instead of `import.meta.env`): `queue`, `startupRestoreSucceeded`, `tabMarksLoaded`, `isTabMarked`, `readPeriod`, `getSpaces`, `readLastUse`, `activeSpaceIds`, `queryTabs`, `getTab`, `spaceOf(windowId, tabId)`, `associationsOf(windowId)`, `getTree`, `archivePage(folderId, page)`, `archiveSpaces(ids, now)`, `beforeClose(tabIds)`, `removeTabs(tabIds)`, `alarms` (`get`/`create`/`clear`), `session` (`get`/`set`), `now`; methods `start()`, `run()`, `handleSettingChange(change)` through the shared queue; alarm `task-space-archive` every 30 min (1 in DEV) only while the setting is on; worker start runs unless a run started within the alarm period (`taskSpaceArchiveLastRunAt`); a setting change to a period runs at once
- [ ] a run follows Technical Details "Archive run" steps 1–6: tab gathering (registry + bookmark associations inside the folder subtree, system folders skipped), skip on marked or always-kept tabs, folder missing → skip, classification with `SavedPages`, saves with the effective URL, any save failure → skip the Space, the re-check before acting, then `archiveSpaces` before `beforeClose` and `removeTabs`; one Space failing doesn't stop the others
- [ ] wire it in `background.ts`: deps from `tabAssociationReadiness.wait()`, `attentionMarkManager`, `spaceManager`, the last-use store, `spaceStateManager` (active Space of every open window), `tabSpaceRegistry`, `getTabAssociations`, `SpaceArchive`, `recentlyClosedManager.expectArchiveClose`; `chrome.alarms.onAlarm` for its alarm name, `chrome.storage.onChanged` for its key, `start()` at top level
- [ ] write tests: startup restore failed → nothing archived or closed; marks not loaded → nothing; setting never → nothing; regular tab saved and closed; bookmark tab on its bookmark's page only closed; bookmark tab navigated to another page saved, then closed; Favorite tab on another page saved; empty page only closed; marked, audible, Chrome-pinned or active tab keeps the Space; missing folder keeps the Space; a failed save keeps the Space and closes nothing; the Space becoming active (or a tab changing) during the save → not archived, nothing closed; `archiveSpaces` is called before `removeTabs`; a tab of another Space in the same window is not touched; a bookmark inside the Space's `asd_Archive` doesn't pull its tab in; one Space throwing doesn't stop the next
- [ ] run `make lint && make test` - must pass before task 10

### Task 10: Verify acceptance criteria

- [ ] (+) → New Task Space creates `YYYYMMDD-01`, green, `list-todo`, folder `Tasks Spaces/YYYYMMDD-01`, active, no dialog; a second the same day is `-02` (code review against Tasks 1 and 4)
- [ ] Task Spaces absent from the sortable strip, temporary icon rule as designed; list oldest → newest, faded, 10 rows, scrolled to bottom
- [ ] Convert to Regular Space: leaves the list, shows in the strip, folder unchanged
- [ ] auto-archive: overdue Task Space archived (tabs saved/closed, record in Archived, folder kept), restorable; `stateReady` checked
- [ ] run `make lint && make test && make build`

### Task 11: [Final] Update documentation

- [ ] README.md: Spaces section — Task Spaces (create, name, folder, list button, temporary icon, convert, Archived section and restore), Settings list (**Archive Task Spaces after**), Keyboard note that Switch to Space 1…9 counts regular Spaces only
- [ ] docs/changelog.md: new `## Latest Version` section at the top with the feature entry (#91)
- [ ] docs/state-reference.md: `task` field in `spaces`; new `archivedTaskSpaces`, `taskSpaceLastUsedAt`, `taskSpaceArchiveAfter` (local) and `taskSpaceArchiveLastRunAt` (session) with owners and lifespans
- [ ] docs/development.md: manager table (`SpaceManager` owns `spaces` and `archivedTaskSpaces`); note under "Per-operation writes" that archive and restore are manager operations and `updateSpaces` drops archived ids; mention that both archivers share one queue
- [ ] src/data/changelog.ts: `'2.0.404'` entry for Task Spaces
- [ ] move this plan to `docs/plans/completed/`

## Known limitations

- [known-limitation] No conversion of a regular Space into a Task Space.
- [known-limitation] Backup export/import carries live Task Spaces (`task` field) but not the archived list.
- [known-limitation] Restoring a Task Space whose folder another live Space now uses gives two Spaces on one
  folder (the UI doesn't block it for regular Spaces either).
- [known-limitation] Two windows writing the Space list within milliseconds of a restore can drop the
  restored record from the live list (the existing whole-list write gap of `spaceManagerProxy`).
- [known-limitation] The last regular Space can be deleted while Task Spaces exist (`canDelete` counts all
  live Spaces); the strip then shows only the temporary icons.

## Post-Completion

**Manual verification** in Chrome (`make test-build`, reload the extension):
- New Task Space twice on one day: names `-01`, `-02`, folders under `Other Bookmarks/Tasks Spaces`, green list icon, a New Tab opens in it
- switch to a regular Space: the temporary icon stays, gone after 10 minutes; swipe reaches it while shown
- list: oldest at top, fading, scroll with more than 10, opens at the bottom; right-click menu works
- Convert to Regular Space on a Task Space with tabs: it joins the strip, tabs and folder unchanged
- set Archive Task Spaces after to 1 minute in a debug build (`make build-debug`): an unused Task Space with a regular tab and a bookmark tab archives — the tab in its Archive, both tabs closed, the Space under Archived; Restore brings it back without tabs
- an account-bookmarks profile (no `'1'`/`'2'` roots): `Tasks Spaces` goes under the account Other Bookmarks
