# Hand-opened tabs stay regular tabs (#3)

## Overview
- `rebuildAssociations` (`src/contexts/BookmarkTabsContext.tsx`) runs the URL pass `recoverFixedTabAssociations` on every association rebuild. A rebuild fires on every change of `tabAssociations_{windowId}`, so a tab the user opened by hand on a bookmarked or Favorite URL gets bound to that item the next time any bookmark tab opens or closes. It leaves the Tab list and sometimes moves into another Space's tree.
- Fix: run that URL pass once per browser session per window, gated by a marker in `chrome.storage.session` (`urlRecoveryDone_{windowId}`). Session storage is cleared on browser restart and extension reload/update, which are the cases the pass exists for.
- The park-page branch (`hasUnresolvedParkedTab`) also runs the full URL pass over all tabs. A suspended regular tab is never associated, so with a tab suspender that branch fires on almost every rebuild. User decision: limit it to park pages (`recoverParkedTabAssociations` with bookmarks and Favorites).
- During a session, associations then come only from explicit actions: clicking a bookmark, dragging a tab to the tree, "Add to bookmark". Tabs reopened from the Archive stay in the Tab list.

## Context (from discovery)
- `src/contexts/BookmarkTabsContext.tsx:119-252` - `rebuildAssociations`: restore by stored tab IDs, park-page branch (154-171), deferred non-parked URL pass (210-241) behind `persistentItemsLoaded`
- `src/utils/parkedTabAssociation.ts` - `recoverFixedTabAssociations` (all tabs) and `recoverParkedTabAssociations` (park pages only; ID first, then URL) share `recoverAssociations`
- `src/stores/browserSessionMarker.ts` - `BrowserSessionMarker(storage, key)` with `isSameBrowserSession()` / `mark()`, never throws; `BrowserSessionStorage` interface `{ get, set }`
- `tests/browserSessionMarker.test.mjs` - in-memory session storage fake pattern
- Spec 035 (`docs/features/035-tab-auto-archive.md`) no longer exists: `docs/features/` was removed in 01b74ae. README and changelog carry the behaviour instead.
- Sidebar already writes `chrome.storage.session` (`App.tsx` scroll position), so the sidebar owning a session key is an existing pattern

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- make small, focused changes
- tests cover the decision that acts on the wrong tab when it breaks (CLAUDE.md "Test decisions, not coverage"): when the URL pass runs. No tests for the React wiring or docs
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run `make test` after each change; `make lint && make test && make build` must pass at the end

## Testing Strategy
- **unit tests**: `tests/urlRecoveryGate.test.mjs` for the new gate class (Node test runner, in-memory storage fake)
- existing `tests/parkedTabAssociation.test.mjs` stays as it is; the park-only URL fallback is already covered there (`recoverParkedTabAssociations(tabs, {}, bookmarks, favorites)`)
- no e2e tests in this project

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- New class `UrlRecoveryGate` (`src/utils/urlRecoveryGate.ts`) names the "once per browser session per window" decision. It wraps a `BrowserSessionMarker` keyed `urlRecoveryDone_{windowId}` and an in-flight flag.
- `rebuildAssociations` runs the deferred URL pass through `gate.runOnce(...)`. The pass no longer depends on `persistentItemsLoaded`: the park branch covers only park pages now, so the gated pass must still run on the first rebuild after a restart even when a park page was healed in the same rebuild.
- The park branch calls `recoverParkedTabAssociations(allTabs, associations, bookmarkRoots, pinnedSites)` instead of `recoverFixedTabAssociations(allTabs, …)`.

## Technical Details
- `UrlRecoveryGate`:
  - `constructor(storage: BrowserSessionStorage, windowId: number)`; key `` `urlRecoveryDone_${windowId}` `` (a static `keyFor(windowId)` or a `KEY_PREFIX` constant, so docs and code name one string)
  - `async runOnce(pass: () => Promise<void>): Promise<boolean>`:
    1. a pass already in flight in this instance → `false` (set the flag synchronously, before the first `await`, so two rebuilds in a row can't both start)
    2. `await marker.isSameBrowserSession()` true → `false`
    3. `await pass()`; resolved → `await marker.mark()`, `true`
    4. `pass` rejected → marker stays unset, the error propagates to the caller (it already logs `Failed to recover fixed tab associations`), so the next rebuild retries
    5. the in-flight flag is cleared in `finally`
  - no `chrome.*` at import, sibling imports with `.ts`, no enums / parameter properties (Node type stripping). Private fields `#…` as in `BrowserSessionMarker`
- `BookmarkTabsContext.tsx`:
  - one gate per sidebar window, held in a ref and created lazily inside `rebuildAssociations` from its `windowId` argument (replace the ref when its window differs; no extra effect), backed by `{ get: key => chrome.storage.session.get(key), set: values => chrome.storage.session.set(values) }`
  - the deferred block becomes `void gate.runOnce(async () => { …getTree + pinned sites, recoverFixedTabAssociations on latestAssociations, setTabAssociations, backups… }).catch(err => console.error('Failed to recover fixed tab associations:', err))`; the early `return` for an empty result stays inside the pass (it still counts as a finished pass and sets the marker)
  - remove `persistentItemsLoaded` if nothing else reads it
  - park branch: `recovered = { ...recovered, ...recoverParkedTabAssociations(allTabs, { ...associations, ...recovered }, bookmarkRoots, pinnedSites) }`
  - update the comment above `rebuildAssociations` ("no URL matching" is wrong today): URL matching runs for park pages on every rebuild, and for other tabs once per browser session per window
- Storage key `urlRecoveryDone_${windowId}`: `chrome.storage.session`, value `true`, written only by that window's sidebar (`BookmarkTabsContext`), read by the same

## What Goes Where
- **Implementation Steps**: the gate class + tests, the context wiring, docs
- **Post-Completion**: manual check of the issue's repro in Chrome

## Implementation Steps

### Task 1: UrlRecoveryGate class

**Files:**
- Create: `src/utils/urlRecoveryGate.ts`
- Create: `tests/urlRecoveryGate.test.mjs`

- [ ] create `UrlRecoveryGate` in `src/utils/urlRecoveryGate.ts` per Technical Details (wraps `BrowserSessionMarker` from `../stores/browserSessionMarker.ts`, key `urlRecoveryDone_{windowId}`, in-flight flag, `runOnce(pass)`); a short header comment says why the pass runs once per browser session (hand-opened tabs on bookmarked URLs must stay regular tabs; session storage is cleared exactly when associations get lost)
- [ ] test: the first `runOnce` runs the pass and returns true; a second call on the same instance and a call on a new instance over the same storage (sidebar reopened) don't run it
- [ ] test: cleared storage (browser restart / extension reload) → the pass runs again
- [ ] test: a pass that rejects leaves the marker unset and `runOnce` rejects; the next call runs the pass
- [ ] test: a call while a pass is in flight returns false without starting a second pass
- [ ] test: different window IDs are independent
- [ ] run `make test` - must pass before task 2

### Task 2: Gate the URL pass in rebuildAssociations and limit the park branch

**Files:**
- Modify: `src/contexts/BookmarkTabsContext.tsx`

- [ ] hold a `UrlRecoveryGate` in a ref, created lazily in `rebuildAssociations` for its `windowId` argument, backed by `chrome.storage.session`
- [ ] run the deferred `recoverFixedTabAssociations` block through `gate.runOnce(...)`, independent of `persistentItemsLoaded`; drop the flag if unused
- [ ] in the `hasUnresolvedParkedTab` branch call `recoverParkedTabAssociations(allTabs, { ...associations, ...recovered }, bookmarkRoots, pinnedSites)`; remove the `recoverFixedTabAssociations` import only if unused
- [ ] fix the comment above `rebuildAssociations` to say when URL matching runs
- [ ] run `make lint && make test && make build` - must pass before task 3

### Task 3: Verify acceptance criteria
- [ ] walk the issue's repro against the code: a hand-opened tab on a bookmarked URL is not associated by later rebuilds in the same session; after a restart / extension reload the first rebuild still re-links open bookmark pages; park pages still heal on every rebuild
- [ ] confirm the known limitations below still describe the code (incl. a bookmark tab dragged into an existing window)
- [ ] check the invariants: one writer for `urlRecoveryDone_{windowId}` (the window's sidebar), the archive folder skip and root handling in `buildPersistentItemUrlIndex` untouched
- [ ] run full suite: `make lint && make test && make build`

### Task 4: [Final] Update documentation
- [ ] `README.md` (Bookmarks and pinned pages section): a tab you open yourself on a bookmarked or Favorite URL stays in the Tab list; it becomes the bookmark's page only when you click the bookmark, drag the tab onto the tree or use "Add to bookmark". Tabs reopened from the Archive land in the Tab list
- [ ] `docs/changelog.md` (Latest Version): a `Fixed:` line - a tab opened by hand on a bookmarked page no longer jumps out of the Tab list into the bookmark (or another Space) when another bookmark opens or closes; open bookmark pages are still re-linked after a browser restart or extension reload. Check that it doesn't contradict the existing "Improved: fixed-page and Favorite recovery across Side Panel reopen…" line (`docs/changelog.md:31`); reword that line if needed
- [ ] `docs/state-reference.md`: section for `urlRecoveryDone_${windowId}` under Chrome Session Storage (owner `src/contexts/BookmarkTabsContext.tsx` via `UrlRecoveryGate`, value, instances 1 per window, lifespan, consumers; never removed - entries of closed windows stay until the session ends), and `urlRecoveryDone_{winId} (per window)` in the SESSION STORAGE diagram
- [ ] no `src/data/changelog.ts` entry (bug fix; that file omits fixes)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- issue repro: bookmark `https://react.dev/learn` (closed), open it from another app, click another bookmark → the react.dev tab stays in the Tab list
- restart Chrome with bookmark pages open → they show as open bookmark pages again after the sidebar opens
- with a tab suspender: suspend a regular tab and a bookmark tab, open a hand-opened tab on a bookmarked URL, click another bookmark → the hand-opened tab stays in the Tab list, the suspended bookmark tab stays associated

**Known limitations**:
- `[known-limitation]` right after a restart or extension reload, the first rebuild can still claim a hand-opened tab on a bookmarked URL once (accepted in the issue)
- `[known-limitation]` when a window's sidebar is first opened late in a session, its one URL pass runs then and can claim hand-opened tabs opened earlier
- `[known-limitation]` a bookmark or Favorite tab dragged into another, already open window becomes a regular tab there: associations are per window and the background moves only the Space on attach (`src/background.ts` `onAttached`), so only the URL pass used to re-link it. "Move to New Window" still works (a new window has no marker). Moving the association on attach would need the background to read it before the old window's sidebar drops it on detach (a race), so it is left for a follow-up
- `[known-limitation]` a park page of a regular tab whose original URL is bookmarked is still matched by URL on every rebuild; kept so suspended bookmark pages heal mid-session
