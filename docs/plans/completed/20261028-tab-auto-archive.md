# Tab Auto-Archive and Collapsible Sections

## Overview

Implements `docs/features/035-tab-auto-archive.md`:

- Regular tabs (Tab list) unused for a configurable period (`Never` / 12h / 24h / 3d / 7d / 30d) are saved as bookmarks in the Space's `asd_Archive` folder and closed.
- Open bookmark pages unused for the same period are closed without archiving (the bookmark stays).
- A new **Archive** section between Bookmarks and Tabs shows the active Space's archive: collapsed by default, hover popover with newest items + search (feature 034 popover), click an item = reopen as a regular tab and remove it from the archive.
- Bookmarks and Archive sections become collapsible. Tabs is not (for now).

The spec is the source of truth for behaviour; this plan only orders the work.

## Context (from discovery)

- Background: `src/background.ts` - manager loading `Promise.all` (~line 282), `TabAssociationReadiness` / `stateReady` (~line 295), `onActivated` (~line 370), `onRemoved` with the `isWindowClosing` guard (~line 507), `onCreated` assigns new tabs to the window's active Space (~line 682). Managers in `src/managers/impl/`.
- `TabSpaceRegistry.load` (`src/managers/impl/tabSpaceRegistry.ts:131-149`) re-matches stored tabs in one pass: exact ID + window, else same URL with the nearest index; exact hits ignore `claimedTabIds`.
- `TabAssociationReadiness` (`src/utils/tabAssociationReadiness.ts`) catches init errors and still resolves - callers can't tell success from failure today.
- Associations: `getTabAssociations(windowId)` (`src/utils/tabAssociations.ts`), keys `bookmark-{id}` / `pinned-{id}`.
- Space folder: `findFolderBySegments(roots, space.bookmarkFolderSegments, space.bookmarkFolderInAccount)` (`src/utils/bookmarkFolderLookup.ts`), with `roots = (await chrome.bookmarks.getTree())[0].children` as in `spaceManager.ts:89-90`.
- Setting pattern: `src/utils/followActiveTab.ts`; `useChromeLocalStorage` with `{ parse, serialize: v => v }` (`src/App.tsx:649-653`) so the background reads a raw string - the hook's default is `JSON.stringify`.
- Walks that must skip `asd_Archive`: `getVisibleSpaceRootItems` / `getVisibleBookmarkChildren` (`src/utils/bookmarkTreeVisibility.ts`), `collectFolderBookmarks` (`src/utils/folderRecentItems.ts`), `buildPersistentItemUrlIndex` behind `recoverFixedTabAssociations` (`src/utils/parkedTabAssociation.ts`), `getAllBookmarksInFolder` (`src/hooks/useBookmarks.ts:435`; used by Open as Tab Group / Open All / selection open in `BookmarkTree.tsx` and `getTabIdsInSpace` in `SpacesContext.tsx:467`), `handleExpandAll` and the filter in `BookmarkTree.tsx`, the folder list in `FolderPickerDialog.tsx`.
- Layout: `BookmarkTree` and `TabList` render in `SidebarContent` (`src/App.tsx` ~208-236); `SpaceTitle` lives in `SpaceTitleWrapper` at App level, outside `SidebarContent`.
- Popover reuse: `useFolderPeek` + `FolderRecentPopover` (`src/components/FolderRecentPopover.tsx`), ordering from `BookmarkRecency` (`src/stores/bookmarkRecencyStore.ts`). Lazy rows: `src/hooks/useInView.ts`.
- Tests: `node --test tests/*.test.mjs` (`make test`), Node 23 type stripping; modules under test import with `.ts` extensions and take storage/clock/chrome APIs as arguments.

## Development Approach

- **testing approach**: regular (code first), **only necessary tests** (user choice): unit tests for pure logic with real branching. No tests for React components or chrome-bound wiring; those are checked manually.
- Approving this plan covers the file edits listed in the tasks and `make test` runs. Anything outside the plan is discussed first (CLAUDE.md).
- Per the user's instructions for this run: no build runs (the user builds and verifies), no `git add` / `git commit` (the user commits), a short comment before loops and sizable `if` blocks as in the surrounding code.
- Per CLAUDE.md: classes with descriptive methods over raw records/maps, `if (import.meta.env.DEV)` around debug logs, new persistent state in `chrome.storage.local`.
- Modules imported by tests must not touch `chrome.*` at import time and must avoid TS-only runtime syntax (enums, parameter properties, namespaces).
- Complete each task before the next; run `make test` after tasks that touch tested code. Update this plan when scope changes.

## Testing Strategy

- **unit tests**: `tests/*.test.mjs` for the pure pieces in tasks 1-5.
- **e2e**: none automated; the in-panel runner (`src/tests/inpanel/`) is not extended.
- **manual**: the user builds (`make build-debug`) and runs the Post-Completion checks.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

Background (works with the sidebar closed):

- `TabActivityTracker` records, per tab, the moment it **stopped** being active. Records persist in `chrome.storage.local`; the active tab per window persists in `chrome.storage.session`, because the service worker usually wakes up *on* the `onActivated` event and can't learn the previous tab from memory or a fresh query.
- After a browser restart tab IDs are reused from a low counter, so the tracker re-matches by URL + nearest index only (shared `matchStoredTabs`, extracted from `TabSpaceRegistry.load`); within a browser session tab IDs are exact.
- `selectTabsToClose` (pure) applies the spec's rules, including the grace after switching on from `Never`, and splits candidates into "archive then close" and "close only".
- `SpaceArchive` (bookmarks API injected) finds/creates `asd_Archive` in a Space folder with fresh lookups per call, creates the new item before removing a duplicate.
- `TabAutoArchiver` runs only after a **successful** startup restore, collects tabs + associations, archives per Space, closes. Runs are serialized; a `chrome.alarms` alarm triggers them.

Sidebar:

- `isArchiveFolder(node)` (folder titled `asd_Archive`) is checked by every walk over a Space folder's descendants, so the folder never appears in the Bookmarks section and never feeds URL-based association recovery.
- `ArchiveSection` renders the active Space's archive with the existing popover and row components.
- `SectionCollapseState` (class over the stored record) is owned once in `App` and drives chevrons on the Space title (Bookmarks) and the Archive header.

## Technical Details

The final design differs from this section in places (alarm cleared on Never, tracker seeding in `load`, key names, readiness via `wait()`, records dropped on Never, run throttling); see the Implementation Notes in spec 035 and `docs/state-reference.md`.

- **Setting**: key `autoArchiveAfter`, raw string `'never' | '12h' | '24h' | '3d' | '7d' | '30d'`, default `'never'`; `parseAutoArchivePeriod` + period → milliseconds in `src/utils/autoArchive.ts`. DEV builds also accept and show `'1m'` (1 minute) for manual testing.
- **Grace after switching on**: background keeps `autoArchiveEnabledAt` (local storage, background is the only writer). Set to `now` when `chrome.storage.onChanged` shows `autoArchiveAfter` going from `never`/absent to a period, and at worker start if a period is set but no timestamp exists (upgrade, import). Effective last use = `max(lastUsedAt, autoArchiveEnabledAt)`.
- **Last-use records**: key e.g. `tabLastUsedAt`, records keyed by `tabId` with `{ windowId, url, index, lastUsedAt }`; background is the only writer, writes serialized.
  - `markActivated(windowId, tabId)` is called right after `await stateReady` in `onActivated`, before any other await: read the window's stored active tab (`chrome.storage.session`), stamp it `now`, store the new one. Windows with no stored entry are seeded from `chrome.tabs.query({ active: true })`.
  - `refresh(liveTabs)` - one write per run: re-key/drop dead tabs, update `url` / `index`, stamp first-seen tabs and every currently active tab with `now` (safety net for a missed deactivation), return a read-only `TabActivity` view for the policy.
  - `load(liveTabs)` never throws (bad data → log, start empty). A marker in `chrome.storage.session` tells a worker restart (IDs valid) from a browser restart (match by URL + nearest index only).
  - `onRemoved` → `forget(tabId)` only when `!removeInfo.isWindowClosing`; closed windows are cleaned by the next `refresh`.
- **Collapse state**: key `sectionCollapsedState`, `{ [spaceId]: { bookmarks: boolean; archive: boolean } }`; missing = Bookmarks expanded, Archive collapsed.
- **Alarm**: name e.g. `auto-archive`, `periodInMinutes` ~5 (1 in DEV with the `1m` setting is fine). **Create only if `chrome.alarms.get` finds none** - re-creating on every worker start resets the schedule. `chrome.alarms.onAlarm` listener registered at top level. One extra run at worker start.
- **Restore**: `chrome.tabs.create({ url, active: true, windowId })` first, then `chrome.bookmarks.remove(id)`.
- **Errors**: each tab handled in its own try/catch; failures logged with `console.error` (always), the run continues; success logs DEV-only.

## What Goes Where

- **Implementation Steps** (`[ ]`): code, tests, docs in this repo.
- **Post-Completion**: manual checks by the user after building.

## Implementation Steps

### Task 1: Shared stored-tab matcher

**Files:**
- Create: `src/utils/storedTabMatcher.ts`
- Modify: `src/managers/impl/tabSpaceRegistry.ts`
- Create: `tests/storedTabMatcher.test.mjs`

- [x] `matchStoredTabs(records, liveTabs, { matchById })` → `{ record, tab }` pairs in two passes: (1) when `matchById`, exact tab ID (+ same window); (2) same URL with the nearest index among unclaimed tabs; each live tab claimed once; unmatched records dropped
- [x] `TabSpaceRegistry.load` uses it with `matchById: true`; the two-pass order is a small intended change (an exact-ID record is no longer blocked by an earlier stale URL match); legacy session migration unchanged
- [x] tests: exact ID, ID reused in another window, URL + nearest index, two records with the same URL, stale URL record before an exact-ID record, `matchById: false` ignores IDs, unmatched dropped
- [x] run `make test`

### Task 2: Setting module and TabActivityTracker

**Files:**
- Create: `src/utils/autoArchive.ts`
- Create: `src/stores/tabActivityTracker.ts` (built in `src/managers/impl/`, moved in review)
- Create: `tests/tabActivityTracker.test.mjs`

- [x] `src/utils/autoArchive.ts`: storage keys, period type, `parseAutoArchivePeriod` (unknown → `'never'`; `'1m'` only meaningful in DEV), period → milliseconds
- [x] `TabActivityTracker` with injected local storage, session storage and clock: `load`, `markActivated`, `refresh` (returns `TabActivity`), `forget`; serialized writes like `BookmarkRecencyStore`; `load` never throws
- [x] tests: switching away stamps the previous tab, not the new one; a **new tracker instance on the same storage** (worker restart) still stamps the previous tab on the next activation; `refresh` stamps active and first-seen tabs and drops dead ones; browser restart (no session marker) matches by URL only, so a reused ID with another URL gets no old record; corrupt stored data → empty, no throw; period parsing
- [x] run `make test`

### Task 3: Archive folder operations

**Files:**
- Create: `src/utils/archiveFolder.ts`
- Create: `tests/archiveFolder.test.mjs`

- [x] `ARCHIVE_FOLDER_TITLE = 'asd_Archive'`, `isArchiveFolder(node)` (folder + title), `findArchiveFolder(children)` (first by index)
- [x] `SpaceArchive` over an injected `{ getChildren, create, remove }`: `archive(spaceFolderId, { title, url })` - fresh lookup of the folder and its items on every call, create the folder if missing, create the new item at index 0, then remove older items with the same URL; title falls back to URL; a failed create throws and removes nothing
- [x] tests: two archives in one Space → one folder; same URL twice → one item, newest on top; empty title; `create` throws → old item kept; several `asd_Archive` folders → first used
- [x] run `make test`

### Task 4: Tab selection rules

**Files:**
- Create: `src/utils/autoArchivePolicy.ts`
- Create: `tests/autoArchivePolicy.test.mjs`

- [x] `selectTabsToClose({ tabs, associationsByWindow, existingBookmarkIds, activity, enabledAt, now, periodMs })` → `{ archive, closeOnly }`: skip active, audible, Chrome-pinned, incognito, Favorite (`pinned-…`) tabs; bookmark tabs (`bookmark-…` with an existing bookmark) → `closeOnly`; a `bookmark-…` association to a deleted bookmark counts as regular; regular tabs → `archive`, empty pages (`isEmptyPageUrl(tab.url || tab.pendingUrl)`: `chrome://newtab/`, `about:blank`, empty) → `closeOnly`; only when `now - max(lastUsedAt, enabledAt) >= periodMs`
- [x] tests: each exemption, bookmark vs regular vs Favorite, deleted-bookmark association, unassociated tab on a bookmarked URL is regular, grouped tab archived, loading tab with `pendingUrl` not treated as empty, grace after switching on, exact threshold boundary
- [x] run `make test`

### Task 5: Hide asd_Archive from the Bookmarks section

**Files:**
- Modify: `src/utils/bookmarkTreeVisibility.ts`
- Modify: `src/utils/folderRecentItems.ts`
- Modify: `src/utils/parkedTabAssociation.ts`
- Modify: `src/hooks/useBookmarks.ts`
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/components/FolderPickerDialog.tsx`
- Modify: `tests/bookmarkTreeVisibility.test.mjs`, `tests/folderRecentItems.test.mjs`, `tests/parkedTabAssociation.test.mjs`

- [x] add `title?: string` to `BookmarkTreeNodeLike` and `BookmarkNodeLike`
- [x] skip archive folders in `getVisibleSpaceRootItems`, `getVisibleBookmarkChildren` (expanded and peek), `buildPersistentItemUrlIndex`, `getAllBookmarksInFolder`; in `collectFolderBookmarks` skip archive folders among **descendants** only, so the Archive popover can pass the archive folder itself
- [x] `BookmarkTree`: skip them in filter results, `handleExpandAll`, drop targets; check remaining `children` walks in the file; `FolderPickerDialog`: hide them
- [x] tests (added to the three existing files): archive folder and its items never shown, never peeked, never matched by URL recovery; `collectFolderBookmarks(archiveFolder)` returns its items
- [x] run `make test`

### Task 6: TabAutoArchiver and background wiring

**Files:**
- Create: `src/services/tabAutoArchiver.ts` (built in `src/managers/impl/`, moved in review)
- Modify: `src/utils/tabAssociationReadiness.ts`
- Modify: `tests/tabAssociationReadiness.test.mjs`
- Modify: `src/background.ts`
- Modify: `public/manifest.json`

- [x] `TabAssociationReadiness`: expose whether initialization succeeded (e.g. `wait()` resolves to a boolean or a `succeeded()` method); test case for a failing step
- [x] `TabAutoArchiver.run()`: await the injected readiness and stop if it failed; read `autoArchiveAfter` / `autoArchiveEnabledAt`; stop on `'never'`; query all tabs; `tracker.refresh`; load associations per window and the bookmark tree once; `selectTabsToClose`; per archived tab resolve the Space (`TabSpaceRegistry`) and folder (`findFolderBySegments` on `getTree()[0].children`, skip Spaces without segments and tabs without Space/folder); archive the effective URL (`getEffectiveTabUrl`) through `SpaceArchive`, close only after the bookmark exists; close `closeOnly` tabs; per-tab try/catch; serialize runs
- [x] background: create tracker + archiver; `tracker.load` inside the manager loading; `onActivated` → `tracker.markActivated` right after `await stateReady`; `onRemoved` → `tracker.forget` under `!isWindowClosing`; `storage.onChanged` keeps `autoArchiveEnabledAt`; alarm created only when missing, top-level `onAlarm`, one run at worker start
- [x] manifest: `alarms` permission
- [x] run `make test` (readiness test); the archiver itself is chrome-bound and covered by tasks 1-4

### Task 7: Settings option

**Files:**
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/App.tsx`

- [x] `useChromeLocalStorage` for `autoArchiveAfter` with `{ parse: parseAutoArchivePeriod, serialize: v => v }`, passed through settings like `followActiveTab`
- [x] "Archive tabs after" select (Never / 12 hours / 24 hours / 3 days / 7 days / 30 days, plus "1 minute" in DEV) with a description naming both effects
- [x] no unit tests (UI)

### Task 8: Collapsible Bookmarks section

**Files:**
- Create: `src/hooks/useSectionCollapseState.ts`
- Modify: `src/components/SectionHeader.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/BookmarkTree.tsx`

- [x] `SectionCollapseState` class (`isCollapsed(spaceId, section)`, `toggled(spaceId, section)`, defaults) + hook on key `sectionCollapsedState`; **owned once in `App`**, state and toggles passed to `SpaceTitleWrapper`, `SidebarContent`, `BookmarkTree`, `ArchiveSection` (ArchiveSection is created in Task 9; `SidebarContentProps` already carries `sectionCollapseState` + `onToggleSection` for it)
- [x] `SectionHeader`: optional chevron + row-click toggle; the `…` menu keeps working
- [x] Space title shows the chevron and toggles Bookmarks
- [x] `BookmarkTree` collapsed: only open bookmark pages of the Space folder (active one as a card), reusing the collapsed-folder rule; text filter shows it expanded without touching the stored state
- [x] no unit tests (UI; the reused visibility rule is tested)

### Task 9: Archive section

**Files:**
- Create: `src/components/ArchiveSection.tsx`
- Modify: `src/components/FolderRecentPopover.tsx`
- Modify: `src/App.tsx`

- [x] render in `SidebarContent` between `BookmarkTree` and `TabList`; find the active Space's archive folder (first `asd_Archive` child); hidden when missing/empty or with the "With open tabs" filter
- [x] header with chevron + "Archive" (`SectionHeader`), collapsed by default
- [x] collapsed: `useFolderPeek` + `FolderRecentPopover` with a `BookmarkRecency` built from `dateAdded`; add a label prop so the placeholder reads "Search Archive…"; works in every open mode
- [x] expanded: all items newest first, favicon + title + relative archive time, rows rendered lazily (`useInView`); text filter shows matching items expanded
- [x] click (any modifier) → `chrome.tabs.create({ url, active: true, windowId })`, then remove the bookmark; right-click "Delete from Archive"
- [x] no unit tests (UI; ordering/search reuse tested popover helpers)

### Task 10: Verify acceptance criteria

- [x] walk through every rule in `docs/features/035-tab-auto-archive.md` and tick it against the code
- [x] confirm edge cases: tab with no Space, missing Space folder, parked tab URL, duplicate URL, deleted bookmark association, bookmark tab closed while the sidebar is closed shows as not open after reopening, account-only bookmark roots
- [x] run `make test`
- [x] ask the user to run `make build-debug` and the manual checks below (deferred - not done in this run: the orchestrator asks the user at the end of the run; the user builds and runs the Post-Completion checks)
- ➕ fix found during verification: after a browser restart, tabs on a URL shared by several last-use records get the newest time among them (`TabUseRecords.rematchedByUrl` + test)

### Task 11: [Final] Update documentation

- [x] `docs/state-reference.md`: `autoArchiveAfter`, `autoArchiveEnabledAt`, last-use records, session active-tab key, `sectionCollapsedState`
- [x] `README.md`: Archive section, auto-archive setting, collapsible sections, `alarms` permission
- [x] `docs/changelog.md`, `src/data/changelog.ts`, `docs/chrome-web-store-info.md` (features, `alarms` permission)
- [x] `PRIVACY.md`: the extension now writes bookmarks and stores tab URLs and last-use times locally
- [x] `docs/features/035-tab-auto-archive.md`: status → `completed`, note any deviations
- [x] move this plan to `docs/plans/completed/`; remind the user to run `./tools/update-version.sh` before committing (deferred - not done yet: the orchestrator moves the plan at the end of the run, and the version bump before committing is left to the user per the user's instructions for this run)
- ➕ review fixes: Favorite URLs never close; bookmark tabs on another page (hash route included) are archived; same-site check for ID matches after a browser restart or extension reload, with the association restore falling back to index+domain matching when a reused window ID's entries don't all match (worker restarts in the same browser session keep matching by ID, gated by a `chrome.storage.session` marker); restored entries prefer the tab on their exact page; backup indices refreshed on tab create/attach/detach; no recording while Never; audible/pinned/split-view companion tabs restamped; worker-start runs throttled; split view kept; archive skipped in `getAllBookmarkItemsInFolder`; `SectionCollapseState` moved to `src/utils/` with tests
- ➕ review cleanup: tracker moved to `src/stores/`, archiver to `src/services/` (`src/managers/impl/` holds only `RoutedManager` classes); `BrowserSessionMarker` takes its storage key and also serves the tracker's marker; `ArchiveItems` moved to `src/utils/archiveItems.ts` with tests; shared `BookmarkFavicon` component for bookmark and archive rows

## Post-Completion

*Manual checks by the user after `make build-debug`; no checkboxes.*

- Set "Archive tabs after" to **1 minute** (DEV only). Leave a regular tab for >1 minute plus one alarm tick (sidebar closed): it lands in `<Space folder>/asd_Archive` and closes. An open bookmark page past the period closes and shows as not open.
- Active, audible, Chrome-pinned and Favorite tabs stay open.
- Switch from Never to a period: nothing closes before one period has passed.
- Switch between tabs, wait for the worker to idle (~30 s), switch again: the tab you just left is not archived early.
- Restart Chrome: last-use times survive; nothing that was not overdue closes right after the restart.
- Archive section: hidden when empty, collapsed by default, popover shows newest items and searches, click reopens in the Tab list and removes the item, "Delete from Archive" works.
- `asd_Archive` never shows in the Bookmarks tree, folder popovers, search, Expand All, Open as Tab Group, Open All or the folder picker; a tab on an archived URL stays in the Tab list after reopening the sidebar.
- Space title chevron collapses Bookmarks; open pages stay visible; state is kept per Space and across windows.
- Account-only bookmark roots (no `'1'/'2'/'3'`) work.
