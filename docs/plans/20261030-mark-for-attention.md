# Mark for Attention

Issue: https://github.com/rashpile/SideBarforArcUsers/issues/14

## Overview
- A context menu item **Mark for Attention** on tab rows (Tab list) and bookmark rows (Bookmarks section). On a marked row it reads **Clear Mark** and removes the mark. Folders get no mark.
- Multi-select: one item for all selected tabs or bookmarks. Any selected item unmarked → `Mark for Attention` marks all. All marked → `Clear Mark` clears all.
- A marked row shows a green ring. A marked tab row's close button shows `-` instead of `x`; clicking it clears the mark and leaves the tab open.
- Auto-archive (035) keeps marked tabs open. Bulk close commands skip marked tabs (user decision).
- The mark survives a sidebar reload, a service worker restart and a browser restart.
- Out of scope: Favorites/PinnedBar, Tab Switcher, Space Switcher.

### Decided with the user
- In place on a new branch.
- Bulk close skips marked tabs: Close Tabs Before / After, Close Other Tabs, Close on a multi-selection (menu and the `x` of a selected row), Close group, Close All (Tab section), the Space context menu's Close All Tabs (`App.tsx`, `SpaceBar.tsx`), and the Archive tabs button. A tab's own `Close` (single-tab context menu) still closes it; so does `-` then `x`. Delete Space still closes all the Space's tabs: deleting the Space is an explicit act on everything in it (call made while planning).

### Calls made while planning (for review)
- One background manager `AttentionMarkManager` owns two keys in `chrome.storage.local`: `attentionMarkedTabs` and `attentionMarkedBookmarks`. Background must write too (tab closed, bookmark deleted, tab navigated or moved), so per CLAUDE.md "one writer per storage key" the sidebar goes through a proxy with a mirror store and per-operation methods.
- Not stored in `TabActivityTracker` records: those exist only while auto-archive, the age highlight or the unvisited marker is on.
- Tab marks are `StoredTabRecord`s (`tabId`, `windowId`, `url`, `index`) and re-attach at worker start with `matchStoredTabs`, `idMatch` `sameWindow` on a worker restart and `sameWindowAndSite` after a browser restart or extension reload (`BrowserSessionMarker`), as `TabSpaceRegistry.load` does. Incognito live tabs are left out of the match. Records match no live tab → dropped. Each re-attached record is rebuilt from its live tab (new `tabId`, `windowId`, `url`, `index`), and `load` awaits writing that back before it resolves, so the session marker (set after `managerLoadPromise`) never sees old-session IDs in storage: a later worker restart matches by ID only against this session's IDs. The record follows the tab's URL, index and window (`tabs.onUpdated` with `changeInfo.url`, `onMoved`, `onAttached`).
- `tabs.onRemoved` with `isWindowClosing` keeps the mark (quitting the browser closes windows); the next worker start drops records with no live tab.
- Marks are recorded whatever the auto-archive / age highlight / unvisited settings are.
- Incognito tabs get no Mark item and are never stored (their URLs must not reach persistent storage).
- `bookmarks.onRemoved` drops the removed id and every descendant id (`removeInfo.node`). Worker start drops ids missing from the bookmark tree.
- A bookmark's mark does not affect auto-archive of the bookmark's open tab.
- Bookmark multi-select: the item only in the all-bookmarks multi menu; a selection with folders has none.
- The marks load is caught inside the manager (like `loadTabActivity`), so a malformed stored value doesn't fail `stateReady`. Tab and bookmark sides load separately. A failed tab side sets `tabMarksLoaded = false`: tab marks start empty in memory, events don't write the tab key, and the auto-archiver skips its runs. The user's next tab mark change writes the key and sets `tabMarksLoaded = true` again. A failed bookmark side (malformed value or `getTree` error) only keeps bookmark marks empty and unwritten until the user changes one; it doesn't stop auto-archive.
- Look: an overlay `<div className="absolute inset-0 rounded-md ring-2 ring-inset ring-green-500 pointer-events-none" />` inside the row, like the group drop-into overlay in `TabList.tsx` (~590). The row's own background and box-shadow carry the active, highlighted, selected and age styles and stay untouched. Bookmark rows hide it while `showDropInto` (folders only, which carry no mark, so in practice never). Tab rows have no drop-into state; on grouped tab rows the ring sits together with the group's hover border overlay.
- The multi-selection `Close {n} Tabs` label keeps counting every selected tab, marked ones included (the skipped ones simply stay open).
- Close button on a marked row: lucide `Minus`, hover-only like `X`, `aria-label="Clear mark"`, title "Clear mark".

### Known limitations
- A tab suspender's park page replaces the tab: the mark is not carried over (`migrateParkedTabAssociation` is not extended).
- Undo of a closed marked tab (its own `Close`) re-creates the tab without the mark.
- After a browser restart a mark can move to another copy of the same page (re-match by URL and position), as Space assignments can.
- A marked tab that later becomes a bookmark tab (Add to Bookmark) leaves the Tab list; its mark stays on the tab and keeps auto-archive away from it until the tab closes.

## Context (from discovery)
- `src/managers/impl/tabSpaceRegistry.ts` — `load(sameBrowserSession)` with `matchStoredTabs` and `idMatch`; the model for re-attaching tab records.
- `src/utils/storedTabMatcher.ts` — `matchStoredTabs`, `StoredTabRecord`, `LiveTabLike`.
- `src/stores/tabActivityTracker.ts` — `TabUseRecords.fromStored` validation style, incognito rule, `isWindowClosing` handling.
- `src/managers/proxies/pinnedSitesManagerProxy.ts`, `src/managers/shared/pinnedSitesApi.ts`, `src/managers/impl/pinnedSitesManager.ts` — per-operation API, mirror store, in-flight write counter, broadcast; `src/hooks/usePinnedSites.ts` — `useSyncExternalStore` over the proxy store.
- `src/managers/proxies/messageRouting.ts` — `ManagerId`, `callManager`, `CONTEXT_ID`, `Remote`, `RoutedManager`.
- `src/background.ts` — managers built ~150; `managerLoadPromise` ~316 (`sameBrowserSession.then(...)`); `registerManager` ~927; `tabs.onRemoved` ~644; `onMoved` ~696; `onAttached` ~727; `onUpdated` ~743; `bookmarks.onRemoved` ~396.
- `src/services/tabAutoArchiver.ts` (`TabAutoArchiverDeps`, `selectTabsToClose` call ~286, per-tab re-check ~364–377) and `src/utils/autoArchivePolicy.ts` (`selectTabsToClose`, `TabsToCloseQuery`, `isAlwaysKept`).
- `src/components/TabList.tsx` — `TabRow` ~119 (actions with `X`, context menu single ~326 / multi ~290); `performClose` ~956; `handleCloseAllTabs` ~980; `closeGroup` ~2262; `closeTabsBefore/After/Others` ~2275–2325; `handleCloseSelectedTabs` ~2327; `handleCloseSelectedFromMenu` ~2502; Archive tabs ~2540.
- `src/components/BookmarkTree.tsx` — `BookmarkRow` ~210, `showDropInto` ring ~587, context menu ~617 (multi: `allSelectedAreBookmarks` branch), selection helpers ~1976 (`getSelectedBookmarkItems`).
- Tests: `tests/*.test.mjs`, run with `make test`.

## Development Approach
- **testing approach**: Regular — code first, then tests in the same task. Tests only for the decisions under Testing Strategy (CLAUDE.md: test decisions, not coverage); no tests for menu wording, ring styling, proxy plumbing or React wiring.
- complete each task fully before moving to the next
- make small, focused changes
- all tests must pass (`make test`), and `make lint` and `make build` must stay clean, before starting the next task
- update this plan file when scope changes during implementation
- follow CLAUDE.md code rules: Allman braces, classes over raw structures, comments say why, `import.meta.env.DEV` guard on debug logs
- modules imported by tests: `.ts` sibling imports, no `chrome.*` at import time, no `import.meta.env`, no TS-only runtime syntax

## Testing Strategy
- **unit tests** (`node --test`), only where a bug would lose a mark, put it on the wrong tab or bookmark, or close a marked tab:
  - `TabMarks`: after a browser restart a mark re-attaches by URL and position and does not go to an unrelated tab that reuses the old ID; on a worker restart it stays with its tab ID; `follow` keeps a navigated/moved tab matchable; records with no live tab are dropped; incognito tabs are refused; malformed stored values throw.
  - `BookmarkMarks`: `keptIn` drops ids missing from the tree.
  - `AttentionMarkManager` (fake `globalThis.chrome`, as `tests/tabSpaceRegistry.test.mjs`): a browser-restart load writes the new tab IDs back, so a later `load(true)` doesn't give the mark to a tab reusing the old ID; `isWindowClosing` keeps the record, a plain close clears it; a bookmark folder removal drops its descendants' marks; after a malformed stored tab value, a tab event doesn't overwrite the stored value.
  - `selectTabsToClose`: an overdue marked tab stays open; an overdue unmarked one still closes.
- **e2e tests**: the project has none.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- Pure model (`src/stores/attentionMarks.ts`): `TabMarks` and `BookmarkMarks` classes with stored-form parsing, mutations and restart re-matching. Test-importable.
- Background manager (`src/managers/impl/attentionMarkManager.ts`): holds the two models, loads and re-attaches them at worker start, writes storage serialized, broadcasts, reacts to tab and bookmark events. Exposes `isTabMarked` and `tabMarksLoaded` to the auto-archiver.
- Shared API (`src/managers/shared/attentionMarkApi.ts`): method names, the broadcast action, the state shape.
- Sidebar proxy (`src/managers/proxies/attentionMarkProxy.ts`) + hook (`src/hooks/useAttentionMarks.ts`): mirror store, optimistic writes, synchronous `isTabMarked` / `isBookmarkMarked` for render.
- Auto-archive: `selectTabsToClose` takes an `isMarked` input; the archiver checks `tabMarksLoaded` and re-checks the mark before closing.
- UI: ring overlay, menu items, `Minus` button in `TabList.tsx` and `BookmarkTree.tsx`; bulk close callers filter marked tabs out.

## Technical Details
- `attentionMarkedTabs`: array of `{ tabId: number, windowId: number, url: string, index: number }`. Records with empty `url` can't be re-matched after a restart and are dropped by `matchStoredTabs` then; on a worker restart they still match by ID.
- `attentionMarkedBookmarks`: array of bookmark id strings.
- API methods: `markTabs(tabIds: number[])`, `clearTabs(tabIds: number[])`, `markBookmarks(ids: string[])`, `clearBookmarks(ids: string[])`, `getState(): { tabIds: number[]; bookmarkIds: string[] }`. `markTabs` reads each tab with `chrome.tabs.get` in the manager (URL, index, window, incognito); a tab gone or incognito is skipped. Broadcast action `ATTENTION_MARKS_CHANGED` with the full state and `senderId`.
- Writes: one promise queue in the manager, each a write from memory of the key that changed. A write happens after a change: a user or event change, or `load` re-attaching records under new IDs (awaited inside `load`). A side whose load failed is not written by events until the user changes a mark on that side.
- Proxy mirror: `{ tabIds: ReadonlySet<number>, bookmarkIds: ReadonlySet<string> }`, a new object per change so `getSnapshot` stays stable; same in-flight write counter and re-read-on-failure as `pinnedSitesManagerProxy`.
- Menu rule: `anyUnmarked = ids.some(id => !isMarked(id))` → label `Mark for Attention`, action mark all; else `Clear Mark`, clear all.
- Bulk close filter: a plain `.filter(... !isTabMarked(id))` in each bulk caller, before the "closes the whole window" check and the confirm dialog, so both paths see the filtered list; nothing to close after filtering → no-op.
- Bookmark subtree ids: `collectBookmarkIds(node)` already exists in `background.ts` (~389) for `bookmarks.onRemoved`; reuse it and pass the ids to `BookmarkMarks.clear(ids)` instead of a second tree walk.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation updates in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome

## Implementation Steps

### Task 1: Pure mark model

**Files:**
- Create: `src/stores/attentionMarks.ts`
- Create: `tests/attentionMarks.test.mjs`

- [x] create `TabMarks` in `src/stores/attentionMarks.ts`: `fromStored(value)` (throws on a malformed value or entry), `toStored()`, `isMarked(tabId)`, `markedTabIds()`, `mark(tab)` (refuses incognito and tabs without id), `clear(tabId)` → changed flag, `follow(tab)` → changed flag (only for marked tabs; takes url, index, windowId), `rematched(liveTabs, idMatch)` via `matchStoredTabs`: incognito live tabs left out, each matched record rebuilt from its live tab (its `id`, `windowId`, `url`, `index`)
- [x] create `BookmarkMarks`: `fromStored` / `toStored`, `isMarked(id)`, `markedIds()`, `mark(ids)`, `clear(ids)` → changed flag, `keptIn(existingIds)`
- [x] write tests for `TabMarks`: browser-restart re-match by URL/position (an unrelated tab reusing the old ID gets no mark) and the rebuilt record carries the new tab's ID, worker-restart ID match, `follow` keeps a navigated/moved tab matchable, unmatched records dropped, incognito refused (also as a re-match target), malformed stored value throws
- [x] write tests for `BookmarkMarks.keptIn`
- [x] run `make test` - must pass before task 2

### Task 2: AttentionMarkManager in background

**Files:**
- Create: `src/managers/shared/attentionMarkApi.ts`
- Create: `src/managers/impl/attentionMarkManager.ts`
- Modify: `src/managers/proxies/messageRouting.ts`
- Modify: `src/background.ts`
- Create: `tests/attentionMarkManager.test.mjs`

- [x] create `attentionMarkApi.ts`: `AttentionMarkApi` interface (`markTabs`, `clearTabs`, `markBookmarks`, `clearBookmarks`, `getState`), `AttentionMarksState`, `ATTENTION_MARKS_CHANGED`
- [x] add `ManagerId.ATTENTION_MARKS` to `messageRouting.ts`
- [x] create `AttentionMarkManager` (`RoutedManager`, `AttentionMarkApi`; `.ts` sibling imports so tests can load it): `dispatch`, serialized writes, broadcast with `senderId`, `load(sameBrowserSession)` (rematch tabs against `chrome.tabs.query({})` and await writing the rebuilt records back when they differ from storage; drop bookmark ids missing from `chrome.bookmarks.getTree()`; each side's failure caught and logged, per the `tabMarksLoaded` rule under "Calls made while planning"), `isTabMarked(tabId)`, `tabMarksLoaded`
- [x] add event methods: `handleTabRemoved(tabId, isWindowClosing)` (keeps the mark when the window is closing), `handleTabChanged(tab)` (follow), `handleBookmarksRemoved(ids)`
- [x] wire in `background.ts`: build the manager, add `sameBrowserSession.then(same => attentionMarkManager.load(same))` to `managerLoadPromise`, `registerManager`, call the event methods from `tabs.onRemoved`, `onUpdated` (when `changeInfo.url`), `onMoved` (a move shifts other tabs' indexes: refresh every marked tab of that window), `onAttached`, `bookmarks.onRemoved` (ids from the existing `collectBookmarkIds`)
- [x] write `tests/attentionMarkManager.test.mjs` with a fake `globalThis.chrome` (as `tests/tabSpaceRegistry.test.mjs`): (a) a browser-restart `load(false)` writes the new tab IDs, so a later `load(true)` doesn't give the mark to a tab reusing the old ID; (b) `handleTabRemoved` with `isWindowClosing` keeps the record, without it clears it; (c) `handleBookmarksRemoved` with a folder's subtree ids drops the nested bookmarks' marks; (d) after a malformed stored tab value, a tab event doesn't overwrite the stored value
- [x] run `make test`, `make lint`, `make build` - must pass before task 3

### Task 3: Sidebar proxy and hook

**Files:**
- Create: `src/managers/proxies/attentionMarkProxy.ts`
- Create: `src/hooks/useAttentionMarks.ts`

- [x] create `attentionMarkProxy` implementing `Remote<AttentionMarkApi>` with an `ExternalStore` mirror, `load()` from `getState`, optimistic writes, own-broadcast skip, in-flight write counter and re-read after failure (as `pinnedSitesManagerProxy`)
- [x] create `useAttentionMarks()` returning `isTabMarked(tabId)`, `isBookmarkMarked(id)` and the mutators, reading the mirror with `useSyncExternalStore`
- [x] load the proxy where other proxies load in the sidebar (in `useAttentionMarks`' mount effect, as `usePinnedSites` loads its proxy)
- [x] no new tests (plumbing); run `make test`, `make lint`, `make build` - must pass before task 4

### Task 4: Auto-archive keeps marked tabs

**Files:**
- Modify: `src/utils/autoArchivePolicy.ts`
- Modify: `src/services/tabAutoArchiver.ts`
- Modify: `src/background.ts`
- Modify: `tests/autoArchivePolicy.test.mjs`

- [x] add `isMarked: (tabId: number) => boolean` to `TabsToCloseQuery`; `selectTabsToClose` keeps marked tabs; the existing query helper in `tests/autoArchivePolicy.test.mjs` (~36) gets a default `isMarked: () => false`
- [x] add the marks to `TabAutoArchiverDeps` (`isTabMarked`, `tabMarksLoaded: () => boolean`); a run returns without closing anything when the tab marks failed to load; the per-tab re-check before closing also keeps a tab marked meanwhile
- [x] pass the manager into the archiver in `background.ts`
- [x] write tests in `tests/autoArchivePolicy.test.mjs`: overdue marked tab stays open; overdue unmarked tab still selected
- [x] run `make test` - must pass before task 5

### Task 5: Tab list mark UI

**Files:**
- Modify: `src/components/TabList.tsx`

- [x] pass `isMarked` and `onToggleMark` into `TabRow` for every place it is rendered (~2734, ~2783, ~2889)
- [x] draw the green ring overlay on marked rows (alongside the grouped row's hover border overlay)
- [x] replace `X` with `Minus` on a marked row; click clears the mark, does not close; `aria-label`/title "Clear mark"
- [x] single-tab context menu: `Mark for Attention` / `Clear Mark` (hidden for incognito tabs)
- [x] multi-selection menu: one item for all selected tabs with the any/all rule (incognito tabs left out)
- [x] no new tests (UI wiring); run `make test`, `make lint`, `make build` - must pass before task 6

### Task 6: Bulk close skips marked tabs

**Files:**
- Modify: `src/components/TabList.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SpaceBar.tsx`

- [x] in `TabList.tsx` filter marked tabs out of `closeTabsBefore`, `closeTabsAfter`, `closeOthers`, `handleCloseSelectedFromMenu`, `closeGroup`, `handleCloseAllTabs`, and the `selectedItems.length > 1` branch of `handleCloseSelectedTabs`; its `performClose([clickedTabId])` branch (row `x` and single-tab menu `Close`, both `onClose`) stays unfiltered
- [x] Archive tabs button (`handleArchiveAllTabs`): filter `archiveTabs` by `isTabMarked(tab.id)` before the length check and `closesWholeWindow`
- [x] Space context menu Close All Tabs: filter in `App.tsx` `handleCloseAllTabs` (~368) and `SpaceBar.tsx` `handleCloseAllTabsInSpace` (~90), before the `remaining.length === 0` check and the confirm dialog
- [x] every filter runs before the whole-window check; an empty list after filtering does nothing (no dialog, no action)
- [x] no new tests (each is a one-line filter in UI handlers); run `make test`, `make lint`, `make build` - must pass before task 7

### Task 7: Bookmark mark UI

**Files:**
- Modify: `src/components/BookmarkTree.tsx`

- [x] pass `isMarked` / `onToggleMark` into `BookmarkRow` (bookmarks only, never folders)
- [x] draw the green ring overlay on marked bookmark rows (not while `showDropInto`)
- [x] single bookmark context menu: `Mark for Attention` / `Clear Mark`
- [x] multi-selection menu, `allSelectedAreBookmarks` branch only: one item with the any/all rule over `getSelectedBookmarkItems()`
- [x] no new tests (UI wiring); run `make test`, `make lint`, `make build` - must pass before task 8

### Task 8: Verify acceptance criteria
- [ ] verify all requirements from Overview are implemented (menu items single and multi, ring, `-` button, auto-archive, bulk close, restart survival paths)
- [ ] verify edge cases: incognito, folder in selection, bookmark folder deleted, window closed, marks load failure
- [ ] run full test suite: `make test`
- [ ] run `make lint` and `make build`

### Task 9: [Final] Update documentation
- [ ] update `README.md`: Mark for Attention, the `-` button, bulk close skips marked tabs, auto-archive keeps them
- [ ] update `docs/changelog.md` and add a `src/data/changelog.ts` What's New entry
- [ ] update `docs/state-reference.md` with `attentionMarkedTabs` and `attentionMarkedBookmarks` (owner `AttentionMarkManager`, lifespan)
- [ ] add `AttentionMarkManager` to the manager table in `docs/development.md`
- [ ] update `PRIVACY.md` and `docs/chrome-web-store-info.md` where they list stored data (URLs of marked tabs)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- mark a tab and a bookmark; reload the sidebar; reload the extension's service worker (chrome://serviceworker-internals or the extensions page); quit and restart Chrome — marks stay on the same rows
- the `-` button clears the mark and the row shows `x` again
- with Archive tabs after 1m (DEV build), a marked tab stays open past the limit
- Close Other Tabs leaves marked tabs open
- active, selected and age-highlighted rows keep their look under the ring; dragging a bookmark onto a folder still shows the blue drop ring
