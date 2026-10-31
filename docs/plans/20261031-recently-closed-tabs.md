# Recently Closed Tabs per Space

## Overview
- A **Recently Closed** button (`History` icon) in the Space header, next to the "Search recent pages"
  button (#34). Hover or click opens a popover with the active Space's recently closed tabs, newest
  first, each with the time it was closed. Clicking an item reopens it in that Space; a Clear item
  empties the Space's list.
- The extension keeps its own list in `chrome.storage.local` (key `recentlyClosedTabs`): no
  `chrome.sessions`, no new permission. Survives a browser restart; records hold no tab ids.
- Issue #36. Design: see Solution Overview below.

## Context (from discovery)
- `src/background.ts`: `tabs.onRemoved` (calls `tabSpaceRegistry.unregister`), `tabs.onCreated`,
  `tabs.onUpdated`, `storage.onChanged` for `SPACES_STORAGE_KEY`, `registerManager(...)` routing,
  `TabAutoArchiver` construction with deps.
- `src/managers/impl/tabSpaceRegistry.ts`: per-window `tabId → spaceId`, `register` is the single entry
  for every Space assignment; `load` re-matches stored records against **live** tabs only.
- `src/managers/impl/attentionMarkManager.ts` + `proxies/attentionMarkProxy.ts` +
  `shared/attentionMarkApi.ts`: template for a background-owned key with a write tail and a
  "not loaded → don't write" guard. `tests/attentionMarkManager.test.mjs` shows how managers are tested
  with a fake `globalThis.chrome`.
- `src/managers/proxies/tabSpaceRegistryProxy.ts`: minimal proxy via `callManager`.
- `src/services/tabAutoArchiver.ts`: closes tabs with `chrome.tabs.remove` in background
  (`#archiveAndClose`, `#closeWithoutArchiving`).
- `src/App.tsx` `SpaceTitleWrapper`: the #34 search button in the `SectionHeader` `actions` slot,
  hover/click via `useFolderPeek` from `src/components/FolderRecentPopover.tsx`; bookmark recency read
  read-only with `useChromeLocalStorage`.
- `src/utils/tabAssociations.ts` `getTabAssociations(windowId)` (bookmark/Favorite tab associations),
  `getEffectiveTabUrl` (parked tab URLs), `src/utils/time.ts` (time constants).

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next; small, focused changes
- tests follow CLAUDE.md "Test decisions, not coverage": test the decisions that would show or open a
  tab in the wrong Space or lose records; no tests for the popover, button, wording or wiring
- modules imported by tests: `.ts` sibling imports, chrome/storage/clock passed in or faked via
  `globalThis.chrome` in tests, no `import.meta.env` at import time, no enums/parameter properties
- **all tests must pass before starting the next task**: `make lint && make test`
- **update this plan file when scope changes during implementation**
- code style: Allman braces, classes over raw records/maps, comments say why

## Testing Strategy
- unit tests with `node --test tests/*.test.mjs` (`make test`)
- no e2e suite in the project; UI is checked manually (Post-Completion)

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview

Background records every qualifying tab close into a per-Space list owned by a new
`RecentlyClosedManager` (single writer of `recentlyClosedTabs`). The sidebar reads the key read-only
with `useChromeLocalStorage` (as bookmark recency does) and calls the manager through a proxy to
reopen a record or clear the Space's list.

**Worker-sleep problem.** `tabs.onRemoved` gives no URL or title, and the MV3 worker sleeps after
~30 s idle. When a close wakes the worker, its state is rebuilt from live tabs; the closed tab is gone,
so neither an in-memory cache nor `TabSpaceRegistry` (its `load` re-matches only live tabs) knows it.
Per-tab page info, including the tab's Space, is therefore persisted in `chrome.storage.session`
(key `openTabPages`): it survives worker restarts and is cleared on browser restart / extension reload,
the same lifespan as tab ids.

Decisions (from brainstorm): icon `History`; skip tabs closed by auto-archive (already in the Archive);
skip tabs with a bookmark or Favorite association (pinned pages and Favorites — their item stays);
button shown only when the active Space has records; Clear item in the popover; cap 50 per Space;
same URL in the same Space replaces the older record; reopen opens an active tab in the sidebar's
window and registers it in the record's Space; no Back/Forward history on reopen.

## Technical Details

**`OpenTabPages`** (`src/stores/openTabPages.ts`): map `tabId → { url, title, favIconUrl, incognito,
spaceId?, associated }`, stored as an array under `openTabPages` in an injected storage area
(`chrome.storage.session` in background). Methods: `load()`, `update(tab)` (from a `chrome.tabs.Tab`-like;
keeps the known `spaceId`), `assignSpace(tabId, spaceId)`, `take(tabId)` (returns the entry and removes
it), `seed(liveTabs, spaceOf)` (merges live tabs over stored entries, keeps stored entries for tabs that
are not live — one of them may be the tab whose close woke the worker), `markAssociated(tabIds)`
(sets `associated`, never clears it). Every mutator skips the write when nothing changed (same URL,
title, icon, Space, flag); title-only `onUpdated` changes update from `changeInfo` without a
`tabs.get`. Writes go through a write tail. Malformed stored value → empty.

**Why `associated` lives in the cache.** The sidebar's own `tabs.onRemoved`
(`BookmarkTabsContext.tsx`) deletes the closed tab's `tabAssociations_{windowId}` entry at the same
moment background handles the close; on a worker wake background reads it after the whole startup
chain, so a close-time `getTabAssociations` usually finds nothing and pinned/Favorite tabs would be
recorded. Instead background sets the flag whenever it sees an association: at seed time (current
`tabAssociations_*` session maps) and from `storage.onChanged` (session area, `tabAssociations_*` keys,
added entries only). A removal never clears it, so a close-time removal changes nothing.

**Storage format.** `recentlyClosedTabs` is stored as a JSON **string** (`JSON.stringify(toStored())`),
like bookmark recency, because `useChromeLocalStorage` parses with `JSON.parse` by default; the sidebar
passes `{ parse: raw => RecentlyClosedTabs.fromStored(raw) }`-equivalent parsing so a malformed value
yields an empty list, never a crash. `fromStored` accepts the string and the parsed object.

**`RecentlyClosedTabs`** (`src/stores/recentlyClosedTabs.ts`): immutable-ish class over
`{ [spaceId]: ClosedTabRecord[] }`; `ClosedTabRecord = { id, url, title, favIconUrl, closedAt }`
(`id` = random string). `add(spaceId, record)` (dedupe by URL within the Space, newest first, cap 50),
`remove(spaceId, id)`, `clearSpace(spaceId)`, `retainSpaces(ids)`, `forSpace(spaceId)`, `find(spaceId, id)`,
`toStored()`, `static fromStored(raw)` (malformed → empty, malformed records dropped).

**`closedTabRecord(input)`** (`src/utils/closedTabRecording.ts`): pure decision.
Input: `{ page?: OpenTabPage, registrySpaceId?, existingSpaceIds, closedByArchive, now, id }`
(association comes from `page.associated`).
Space = `registrySpaceId ?? page.spaceId`. Returns `{ spaceId, record }` or `null` when: no page, no
Space, Space not in `existingSpaceIds`, incognito, internal URL (empty, `chrome:`, `chrome-extension:`,
`edge:`, `about:`, `devtools:`, `view-source:`, `chrome-search:`), `page.associated`,
`closedByArchive`. URL unwrapped with `getEffectiveTabUrl` (parked tabs) before the internal check.

**`RecentlyClosedManager`** (`src/managers/impl/recentlyClosedManager.ts`, `ManagerId.RECENTLY_CLOSED`):
- `load()`: reads `recentlyClosedTabs`; never rejects. A failed read leaves it not loaded and it
  writes nothing (never overwrite an unread list with nothing). After a successful load it runs
  `retainSpaces` once.
- injected deps: `getSpaceIds()`, `registerTab(windowId, tabId, spaceId)`.
- `recordClose(spaceId, record)` — inside the write tail drops the record when `getSpaceIds()` no longer
  has its Space (Space deletion closes tabs first, then deletes the Space; a late close must not
  leave records of a deleted Space).
- `expectArchiveClose(tabIds)` / `consumeArchiveClose(tabId)` (skip set) — called by the background
  auto-archiver right before `chrome.tabs.remove`, and by the sidebar's manual Archive action
  (`src/actions/archiveTabsAction.ts`) through the proxy, awaited, before it closes the tabs. Both
  archive paths put the tab in the Archive, so neither is recorded.
- `retainSpaces(ids)`, `clear(spaceId)`, `reopen(windowId, spaceId, recordId)`.
- `reopen`: find record → `chrome.tabs.create({ windowId, url, active: true })` → injected
  `registerTab(windowId, tabId, spaceId)` (background passes `tabSpaceRegistry.register`) → remove the
  record and save. Unknown record → no-op; `tabs.create` failure → record kept, error rethrown to the
  proxy caller.
- dispatch methods for the sidebar: `reopen`, `clear`, `expectArchiveClose`.
- Background `tabs.onCreated` also registers the new tab in the window's active Space, racing the
  explicit `registerTab`. Harmless: the popover lists the active Space's records, so both register the
  same Space. `[known-limitation]` if the user switches Space between click and create.

**`TabSpaceRegistry`**: optional constructor arg `{ onAssigned?(tabId, spaceId) }`, called from
`register`. Background passes `(tabId, spaceId) => openTabPages.assignSpace(tabId, spaceId)`.

**Startup.** `openTabPages.load()` then `seed(liveTabs, registry, associations)` are chained after
`tabSpaceRegistry.load` inside `managerLoadPromise`, before `assignUntrackedTabsToSpaces` (its
`register` calls reach the cache through `onAssigned`); `recentlyClosedManager.load()` joins the same
`Promise.all`. Both loads catch their own failures so `stateReady` never turns false because of them.

**Background `tabs.onRemoved`** (before `unregister`): `registrySpaceId = tabSpaceRegistry.getSpace(windowId, tabId)`,
`closedByArchive = recentlyClosedManager.consumeArchiveClose(tabId)`, `page = await openTabPages.take(tabId)`,
`closedTabRecord(...)` → `recentlyClosedManager.recordClose`. Wrapped so a failure is logged and the rest
of the handler (association cleanup) still runs. Same path for `isWindowClosing`.

**UI**: `SpaceTitle`'s single `peekButton` prop becomes `headerActions` (a node holding both buttons);
the History button does not depend on `canPeek` (search shows only in Arc mode with a Space folder).
`src/components/RecentlyClosedPopover.tsx` — list (favicon via existing favicon helper, title or
URL, relative time like `5m`, `2h`, `3d`), click → `recentlyClosedProxy.reopen(windowId, spaceId, id)`,
Clear item → `recentlyClosedProxy.clear(spaceId)`. In `SpaceTitleWrapper`, a `History` button in
`actions` next to the search button, using a second `useFolderPeek`, shown only when the Space has
records.

## What Goes Where
- Implementation Steps: code, tests, docs in this repo.
- Post-Completion: manual checks in Chrome.

## Implementation Steps

### Task 1: Recently closed records store

**Files:**
- Create: `src/stores/recentlyClosedTabs.ts`
- Create: `tests/recentlyClosedTabs.test.mjs`

- [ ] create `RecentlyClosedTabs` with `add`, `remove`, `clearSpace`, `retainSpaces`, `forSpace`, `find`, `toStored`, `fromStored` as in Technical Details (cap constant `RECENTLY_CLOSED_PER_SPACE = 50`)
- [ ] write tests: `fromStored(JSON.stringify(toStored()))` round-trip (the real stored format); same URL in the same Space replaces the older record and moves to the top; same URL in another Space stays; cap drops the oldest; `retainSpaces` drops deleted Spaces' records; `fromStored` on malformed input
- [ ] run `make lint && make test` - must pass before task 2

### Task 2: Per-tab page cache in session storage

**Files:**
- Create: `src/stores/openTabPages.ts`
- Create: `tests/openTabPages.test.mjs`

- [ ] create `OpenTabPages` with `load`, `update`, `assignSpace`, `markAssociated`, `take`, `seed`, no-op writes skipped, and a write tail, taking the storage area in its constructor
- [ ] write tests: a fresh instance loaded from the stored value still returns a closed tab's page and Space via `take` (worker woken by the close); `seed` keeps stored entries for tabs that are not live and keeps a known `spaceId` when a live tab's page is updated; `associated` survives an update and a reload; `take` removes the entry from storage
- [ ] run `make lint && make test` - must pass before task 3

### Task 3: Close recording decision

**Files:**
- Create: `src/utils/closedTabRecording.ts`
- Create: `tests/closedTabRecording.test.mjs`

- [ ] create `closedTabRecord(input)` as in Technical Details
- [ ] write tests for Space attribution: registry Space wins over cached Space; cached Space used when the registry doesn't know the tab (worker wake); tabs of one window closed together each land in their own Space
- [ ] write tests for skips: no Space, deleted Space, incognito, internal pages and new tab page, page flagged `associated`, archived tab; parked URL is unwrapped
- [ ] run `make lint && make test` - must pass before task 4

### Task 4: RecentlyClosedManager, API and proxy

**Files:**
- Create: `src/managers/shared/recentlyClosedApi.ts`
- Create: `src/managers/impl/recentlyClosedManager.ts`
- Create: `src/managers/proxies/recentlyClosedProxy.ts`
- Modify: `src/managers/proxies/messageRouting.ts`
- Create: `tests/recentlyClosedManager.test.mjs`

- [ ] add `ManagerId.RECENTLY_CLOSED`; `recentlyClosedApi.ts` with `RECENTLY_CLOSED_TABS_KEY = 'recentlyClosedTabs'`, record type and `RecentlyClosedApi` (`reopen`, `clear`, `expectArchiveClose`)
- [ ] implement `RecentlyClosedManager` (load guard, write tail, JSON-string storage, `recordClose` with deleted-Space drop, archive skip set, `retainSpaces`, `clear`, `reopen` with injected `registerTab`, `dispatch`)
- [ ] implement the proxy with `callManager`
- [ ] write tests: `reopen` creates the tab in the given window and registers it in the record's Space (not another Space), then removes the record; `tabs.create` failure keeps the record; a failed initial read never writes over the stored list
- [ ] run `make lint && make test` - must pass before task 5

### Task 5: Wire recording into background

**Files:**
- Modify: `src/managers/impl/tabSpaceRegistry.ts`
- Modify: `src/background.ts`
- Modify: `src/services/tabAutoArchiver.ts`
- Modify: `src/actions/archiveTabsAction.ts`

- [ ] `TabSpaceRegistry` optional `onAssigned` observer called from `register`
- [ ] background: create `OpenTabPages` (session storage) and `RecentlyClosedManager`; startup as in Technical Details (pages load + seed chained after `tabSpaceRegistry.load` inside `managerLoadPromise`, failures caught); `registerManager(recentlyClosedManager)`
- [ ] background: `storage.onChanged` (session, `tabAssociations_*`) marks newly associated tabs in the page cache
- [ ] background: `tabs.onCreated` / `tabs.onUpdated` (url, title, favIconUrl) update the page cache; `tabs.onRemoved` records the close before `unregister` (window close included), errors logged and not blocking
- [ ] background: `storage.onChanged` for `SPACES_STORAGE_KEY` calls `retainSpaces`; `TabAutoArchiver` gets a `beforeClose(tabId)` dep called right before each `chrome.tabs.remove`, wired to `expectArchiveClose`; the sidebar's manual Archive action awaits `recentlyClosedProxy.expectArchiveClose(tabIds)` before closing the tabs
- [ ] run `make lint && make test && make build` - must pass before task 6

### Task 6: Recently Closed button and popover

**Files:**
- Create: `src/components/RecentlyClosedPopover.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css` (only if needed)

- [ ] `RecentlyClosedPopover`: anchored like `FolderRecentPopover`, rows with favicon, title (fallback URL) and relative closed time, click reopens via the proxy and closes the popover, Clear item at the bottom
- [ ] `SpaceTitleWrapper`: read `recentlyClosedTabs` read-only with `useChromeLocalStorage` parsed through `RecentlyClosedTabs.fromStored`; `SpaceTitle` takes `headerActions`; `History` button next to the search button, only when the active Space has records, independent of `canPeek`, hover/click via `useFolderPeek`
- [ ] run `make lint && make test && make build` - must pass before task 7

### Task 7: Verify acceptance criteria
- [ ] verify every requirement in Overview and the issue's Recording / Storage / Reopen sections is implemented
- [ ] verify edge cases: window close, Space deletion, worker wake, auto-archive, associated tabs, incognito, internal pages
- [ ] run `make lint && make test && make build`

### Task 8: [Final] Update documentation
- [ ] `README.md`: the Recently Closed button and what is recorded
- [ ] `docs/changelog.md` entry; `src/data/changelog.ts` What's New entry
- [ ] `docs/state-reference.md`: `recentlyClosedTabs` (local, owner `RecentlyClosedManager`) and `openTabPages` (session, owner background)
- [ ] `docs/development.md` manager table: add `RecentlyClosedManager | recentlyClosedTabs (local)`
- [ ] `PRIVACY.md` Local Storage section: closed tabs' URLs, titles, close times (up to 50 per Space, removed by Clear or deleting the Space, incognito never recorded) and the session page cache; check `docs/chrome-web-store-info.md` storage justification still fits
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

**Manual verification**:
- close a tab, wait > 30 s idle before closing another (worker asleep), check both appear under the right Space
- close a window with tabs in two Spaces, each Space lists its own tabs
- reopen from the popover: tab opens in the current window and appears in the Space's tab list
- delete a Space: its records are gone; auto-archived tabs and bookmark/Favorite tabs don't appear

**Known limitations**:
- no Back/Forward history on reopen (needs `chrome.sessions`)
- tabs closed while Chrome quits are recorded only if Chrome delivers `onRemoved` during shutdown
- a tab that once had a bookmark/Favorite association stays `associated` in the page cache after the association is removed while it is open, so its close is not recorded
