# Activate the previously used tab of the same Space when the active tab closes (#64)

## Overview

- Closing a window's active tab today leaves the choice to Chrome: it activates its tab-strip neighbour.
  `chrome.tabs.onRemoved` in `src/background.ts` only cleans up. The neighbour can be an unrelated tab or
  a tab of another Space, and with Follow active tab on, the sidebar then switches Space.
- New behaviour: when the active tab closes, activate the most recently used tab of the closed tab's Space
  that is still open. With no other open tab in that Space, open a New Tab in that Space and stay there.
- Any close of the active tab counts: X in the sidebar, Cmd+W, the tab strip, a page closing itself, and
  commands that close many tabs at once (Close Other Tabs, Clear, Archive, Close All Tabs In Space), which
  land on one tab, not hop through several.
- Closing a background tab or the whole window changes nothing. After a failed startup restore
  (`stateReady` resolved `false`) nothing changes either: tab ids may be stale.

## Context (from discovery)

- `src/background.ts`:
  - `chrome.tabs.onActivated` listener (~line 751): `await stateReady`, `tabActivityTracker.markActivated`,
    history push unless `historyManager.isNavigating`, `recordBookmarkActivation`, active Space
    normalisation, `getSpaceForActivatedTab`, Space switch per Follow active tab mode, `TAB_ACTIVATED`
    message to the sidebar.
  - `chrome.tabs.onRemoved` listener (~line 933): `await stateReady`, `recordClosedTab` (reads the registry
    Space first), `historyManager.remove`, `lastAudibleTracker.clearIfMatches`,
    `attentionMarkManager.handleTabRemoved`, `tabSpaceRegistry.unregister`, then association cleanup.
  - `chrome.windows.onRemoved` listener (~line 976) drops per-window state.
  - `openSpace` (~line 727) is the existing "Arc-style" pattern: `spaceStateManager.setActiveSpace` then
    `chrome.tabs.create({ windowId, active: true })`; `onCreated` registers the new tab to the window's
    active Space.
- `src/managers/impl/tabHistoryManager.ts`: per-window stack in `chrome.storage.session`
  (`bg_windowTabHistory`); `getActivationOrder(windowId)` returns tab ids from the current index back
  (most recent first); `remove(windowId, tabId)`.
- `src/managers/impl/tabSpaceRegistry.ts`: `getSpace(windowId, tabId)`. Its load re-matches live tabs
  only, so when a close wakes the stopped worker the closed tab is not in it.
- `src/stores/openTabPages.ts`: page and Space of every open tab in `chrome.storage.session`; the worker
  start keeps entries of tabs that are no longer live, exactly for the close that woke it.
  `recordClosedTab` already falls back to it (`closedTabRecording.ts`: `registrySpaceId ?? page.spaceId`).
- `src/stores/tabActivityTracker.ts`: `markActivated(windowId, tabId)` clears the activated tab's
  unvisited mark, stamps the previously active tab as left and stores the new active tab.
- `src/services/switcherLists.ts`: `TabWithLastAccess` type (`lastAccessed`, Chrome 121+).
- `src/actions/deleteSpaceAction.ts`: `do()` closes the Space's tabs, then writes the Space list without
  the Space (`spaceManagerProxy.updateSpaces`).
- Batch commands all close with one `chrome.tabs.remove(ids)` call (`CloseTabAction`, `useTabs.closeTabs`,
  `DeleteSpaceAction`, App's close-all confirmation).
- Tests: `tests/*.test.mjs` under `node --test` with type stripping (see CLAUDE.md § Testing);
  `tests/switcherLists.test.mjs` is a model for fake tabs.

## Development Approach

- **testing approach**: Regular (code first, then tests in the same task). Tests cover the decisions that
  act on the wrong tab or Space when they break (CLAUDE.md "Test decisions, not coverage"); no tests for
  the `background.ts` wiring or the `DeleteSpaceAction` reorder.
- complete each task fully before moving to the next; run `make test` after each change
- follow CLAUDE.md code rules: Allman braces, comments say why, classes over raw structures, debug logging
  only behind `import.meta.env.DEV` (and never in modules imported by tests)
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: `tests/activeTabCloseFollower.test.mjs` drives `ActiveTabCloseFollower` with fake deps
  (history order, registry, open tabs, activation results), both event orders and batch closes;
  `tests/openTabPages.test.mjs` covers `spaceOf` for a tab that closed before the worker woke.
- no e2e tests in this project; manual checks are listed under Post-Completion.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview

A background service class `ActiveTabCloseFollower` (`src/services/activeTabCloseFollower.ts`) decides
whether a removal was a close of the window's active tab and which tab to land on. All Chrome and manager
calls are injected, so `node --test` can drive it. `background.ts` wires it into `onRemoved`,
`onActivated` and `windows.onRemoved`.

Key decisions (recorded as assumptions in the make-task run):

- **Was the closed tab active?** It was when it is the top of `historyManager.getActivationOrder(windowId)`
  at `onRemoved`. The history is in `chrome.storage.session`, so it still names the active tab when the
  close wakes a stopped worker; an in-memory map or `tabs.query` would not.
- **The closed tab's Space** is `tabSpaceRegistry.getSpace(windowId, tabId) ??
  openTabPages.spaceOf(tabId)`, read in `onRemoved` before anything forgets the tab. The registry alone
  misses it when the close woke the worker (the most common case: Cmd+W after reading a page for more
  than 30 seconds); the page cache keeps it.
- **Chrome's own pick must not win.** Chrome activates its neighbour itself.
  - Usual order (`onRemoved` first): from that moment until the follow ends, the window is "following":
    `onActivated` there returns before anything else, `tabActivityTracker.markActivated` included (no
    unvisited mark cleared, no last-use stamp, no history push, no Space switch, no `TAB_ACTIVATED`). The
    follower runs that activation work itself, `markActivated` first, for the tab it lands on. Otherwise
    Chrome's pick, often a link the user opened in the background from the closed tab, would lose its
    unvisited dot and look recently used.
  - Pick first (`onActivated` for the neighbour before `onRemoved`, which the issue says may happen):
    `onActivated` records, before the push, the previous history top and whether that tab was already gone
    (`chrome.tabs.get` fails). When that tab's `onRemoved` arrives while the neighbour is the history top:
    check already settled "still existed" → a background tab, nothing happens; settled "gone" or not
    settled yet → a follow starts, and an unsettled one waits for the check. A refuted follow lands nowhere
    and replays only an activation it skipped. A confirmed one drops the neighbour's history entry.
- **Landing tab**: the first tab of the activation order that is still open and registered to the closed
  tab's Space; else that Space's open tab with the newest `lastAccessed`; else a New Tab in that Space
  (the window's active Space is set to it first, as `openSpace` does, because `onCreated` registers a new
  tab to the active Space).
- **Batch closes need no timer**: a removal in a window that is already following joins that follow; the
  follower's `chrome.tabs.query` is answered after Chrome finished the whole `chrome.tabs.remove` call, so
  closed tabs are never chosen.
- **Deleted Space**: the follower does nothing when the closed tab's Space no longer exists, and
  `DeleteSpaceAction.do()` now removes the Space before closing its tabs. Otherwise deleting the active
  Space would open a New Tab registered to a deleted Space, hidden from the sidebar.
- **No new storage key**: the follower's state is memory only; a follow lasts one round trip.

## Technical Details

### `ActiveTabCloseFollower` (`src/services/activeTabCloseFollower.ts`)

Imports only types (`import type`), with `.ts` extensions; no `chrome.*`, no `import.meta.env`, no enums
or parameter properties (CLAUDE.md § Testing).

```typescript
// Tab fields the follower reads from chrome.tabs.query
export interface FollowerTab
{
  id?: number;
  lastAccessed?: number;
}

export interface ActiveTabCloseFollowerDeps
{
  activationOrder(windowId: number): number[];             // historyManager.getActivationOrder
  forgetActivation(windowId: number, tabId: number): void; // historyManager.remove
  spaceOf(windowId: number, tabId: number): string | undefined; // tabSpaceRegistry.getSpace
  spaceExists(spaceId: string): boolean;                   // spaceManager.getSpaces().some(...)
  tabExists(tabId: number): Promise<boolean>;              // chrome.tabs.get -> true / false
  windowTabs(windowId: number): Promise<FollowerTab[]>;    // chrome.tabs.query({ windowId })
  activeTabId(windowId: number): Promise<number | undefined>; // chrome.tabs.query({ active: true, windowId })
  activateTab(tabId: number): Promise<boolean>;            // chrome.tabs.update(tabId, { active: true }) -> true / false
  openNewTab(windowId: number, spaceId: string): Promise<number | undefined>; // setActiveSpace, then chrome.tabs.create
  finishActivation(windowId: number, tabId: number): Promise<void>; // background's handleTabActivation
}
```

Public methods:

- `noteActivation(windowId, tabId): void` — call in `onActivated` before the history push. When
  `activationOrder(windowId)[0]` is defined and is not `tabId`, remember for the window: the activated
  tab, the previous top, and `tabExists(previousTop)` negated as `previousGone` (keep the promise and its
  settled value). Otherwise clear the window's record. A newer activation replaces it.
- `absorbActivation(windowId): boolean` — called first in `onActivated`. True while a follow runs in the
  window: the follow then owns that activation and records that it skipped one. False otherwise.
- `isFollowing(windowId): boolean` — true while a follow runs in the window (tests, diagnostics).
- `tabRemoved(windowId, tabId, closedTabSpaceId, isWindowClosing, restored): Promise<void>` — the
  decision runs synchronously before the method's first `await`, so it must be called before
  `historyManager.remove` forgets the tab. `closedTabSpaceId` is read by the caller (see `background.ts`
  wiring). The returned promise settles when the follow ends (at once when there is none); background
  `void`s it, tests await it.
  1. `isWindowClosing` or `!restored` → nothing.
  2. `isTop = activationOrder(windowId)[0] === tabId`.
  3. A follow runs in the window → the removal joins it: when `isTop`, mark the follow confirmed (a real
     close of the active tab inside a batch); return that follow's promise.
  4. No `closedTabSpaceId`, or `!spaceExists(closedTabSpaceId)` → nothing.
  5. `isTop` → the active tab closed: start a confirmed follow.
  6. Else the window's activation record has `previousTabId === tabId` and its activated tab is
     `activationOrder(windowId)[0]`:
     - its check settled "still existed" → nothing (the user had already left that tab);
     - settled "gone" → start a confirmed follow, remembering the pick to forget;
     - not settled → start an unconfirmed follow that waits for the check.
  7. Else → nothing (a background tab).
  Starting a follow clears the window's activation record. `noteActivation` replaces or clears the record
  on every activation, including one whose tab already is the history top (Back/Forward), so a stale
  record can't match later.
- `removeWindow(windowId): void` — drop the window's activation record and follow (the follow's promise
  still settles; its Chrome calls fail harmlessly on a closed window).

Follow (private, async; never throws: errors are logged with `console.error('[ActiveTabCloseFollower] …')`):

1. Unconfirmed follow only: await `previousGone`. False and no joined removal confirmed the follow → the
   tab was in the background when it closed: end the follow; replay the active tab only when an
   activation was skipped (step 6). True → `forgetActivation(windowId, pickedTabId)`. A follow started
   from a settled "gone" also forgets the pick.
2. `tabs = await windowTabs(windowId)`; open ids = `tabs` ids.
3. Candidates, in order, without duplicates and never the closed tab: the ids of
   `activationOrder(windowId)` that are open and whose `spaceOf` is the closed tab's Space; then the other
   open tabs of that Space by `lastAccessed`, newest first (missing `lastAccessed` counts as 0).
4. Try `activateTab` on each candidate in turn; the first `true` is the landing tab. End the follow, then
   `await finishActivation(windowId, landingTabId)` (Chrome sends no `onActivated` when the landing tab is
   already active, and one sent during the follow was skipped).
5. No candidate activated: when `spaceExists(spaceId)` still holds, `newTabId = await openNewTab(windowId,
   spaceId)`; end the follow; `finishActivation(windowId, newTabId)` when an id came back.
6. Anything else (Space gone meanwhile, `windowTabs` or `openNewTab` failed, nothing activated): end the
   follow and, when it skipped an activation and `activeTabId(windowId)` returns a tab,
   `finishActivation(windowId, thatTab)`, so the skipped activation is not lost.

Keep the per-window state in a small class (for example `WindowFollow` holding the closed tab's Space,
the follow's promise, whether it is confirmed, the pick to forget and whether it skipped an activation,
and `ActivationRecord` holding the activated tab, the previous tab and `previousGone`) instead of maps of
plain objects (CLAUDE.md "Classes over raw structures").

### `background.ts` wiring

- Move the body of the `onActivated` listener after `markActivated` into
  `async function handleTabActivation(windowId: number, tabId: number): Promise<void>` (unchanged logic:
  `isNavigating` check and push, bookmark recency, Space normalisation and switch, `TAB_ACTIVATED`).
- Construct `activeTabCloseFollower` after `historyManager`, `tabSpaceRegistry`, `spaceManager` and
  `spaceStateManager` exist, with the deps above. `openNewTab` sets
  `spaceStateManager.setActiveSpace(windowId, spaceId)` and then `chrome.tabs.create({ windowId, active: true })`.
  `finishActivation` calls `tabActivityTracker.markActivated(windowId, tabId)` (logged on failure, not
  awaited, as in the listener) and then `handleTabActivation(windowId, tabId)`.
- `onActivated`: `await stateReady`; if `activeTabCloseFollower.absorbActivation(windowId)` return
  (comment why: Chrome's own pick after the active tab closed; the follower handles the tab it lands on,
  and the pick must not lose its unvisited mark or look recently used); then `markActivated` (still before
  any other await); `activeTabCloseFollower.noteActivation(...)`; `await handleTabActivation(...)`.
- `OpenTabPages` (`src/stores/openTabPages.ts`): add `spaceOf(tabId): string | undefined`, the Space the
  cache last saw for the tab, which still answers for a tab that just closed (synchronous; the cache is
  loaded and seeded before `stateReady` resolves).
- `onRemoved`: `const restored = await stateReady;` then, first,
  `const closedTabSpaceId = tabSpaceRegistry.getSpace(removeInfo.windowId, tabId) ?? openTabPages.spaceOf(tabId);`
  and `void activeTabCloseFollower.tabRemoved(removeInfo.windowId, tabId, closedTabSpaceId,
  removeInfo.isWindowClosing, restored)`, before `recordClosedTab` (whose `take()` removes the page) and
  before `historyManager.remove` / `tabSpaceRegistry.unregister`.
- `windows.onRemoved` (the cleanup listener): `activeTabCloseFollower.removeWindow(windowId)`.

### `DeleteSpaceAction.do()` reorder

Snapshot the Space, its Recently Closed list and its tabs as today, then `await
spaceManagerProxy.updateSpaces(remaining)`, then `chrome.tabs.remove(tabIds)`. Undo is unchanged. Closed
tabs of the deleted Space are no longer recorded in Recently Closed (`closedTabRecord` skips missing
Spaces); before, they were recorded and then dropped with the Space's list, so the result is the same.
Keep the comment explaining why the Space goes first.

## What Goes Where

- **Implementation Steps**: code, unit tests, docs in this repo.
- **Post-Completion**: manual checks in Chrome.

## Implementation Steps

### Task 1: ActiveTabCloseFollower decides and performs the landing

**Files:**
- Create: `src/services/activeTabCloseFollower.ts`
- Create: `tests/activeTabCloseFollower.test.mjs`

- [ ] create `src/services/activeTabCloseFollower.ts` with `FollowerTab`, `ActiveTabCloseFollowerDeps` and the `ActiveTabCloseFollower` class (`noteActivation`, `absorbActivation`, `isFollowing`, `tabRemoved`, `removeWindow`) as in Technical Details
- [ ] implement the follow: pick-first confirmation (settled or awaited `previousGone`, confirmation by a joined close of the history top), candidate order (history of the Space, then `lastAccessed`), activation with fallback to the next candidate, New Tab when the Space has none, replay of the active tab only when an activation was skipped
- [ ] write tests for the landing: active tab closes → most recent open tab of its Space activated while a more recent tab of another Space is ignored; `finishActivation` called for it; `absorbActivation` true during the follow and false after; history misses the Space's tabs → newest `lastAccessed` of the Space; first candidate fails to activate → next one; no other tab in the Space → `openNewTab` with that Space and `finishActivation` for the new tab; `windowTabs` rejects after a skipped activation → `finishActivation` for the active tab
- [ ] write tests for the cases that must change nothing: background tab close, `isWindowClosing`, `restored` false, no `closedTabSpaceId`, Space that no longer exists (no follow, `isFollowing` stays false, no activation, no `finishActivation`)
- [ ] write tests for both event orders and batches: several removals in one window during a follow → one activation, closed tabs never chosen; pick first with the previous tab already gone → follow lands and the pick is forgotten from history; pick first with the previous tab's check settled "still existed" → no follow, no `finishActivation`; record {X, previous Y}, then Y removed and X removed in one batch → lands in X's Space
- [ ] run tests - must pass before next task

### Task 2: Wire the follower into background events

**Files:**
- Modify: `src/background.ts`
- Modify: `src/stores/openTabPages.ts`

- [ ] extract `handleTabActivation(windowId, tabId)` from the `onActivated` listener without changing its logic
- [ ] add `OpenTabPages.spaceOf(tabId)` in `src/stores/openTabPages.ts`
- [ ] write a test in `tests/openTabPages.test.mjs`: after a worker-start `seed` without the tab (the tab closed before the worker woke), `spaceOf` still returns its Space
- [ ] construct `activeTabCloseFollower` with the deps listed in Technical Details (`openNewTab` sets the window's active Space before `chrome.tabs.create`; `finishActivation` calls `markActivated` before `handleTabActivation`)
- [ ] `onActivated`: return when `absorbActivation` is true, before `markActivated`; then `markActivated`, `noteActivation`, `handleTabActivation`
- [ ] `onRemoved`: keep `restored` from `stateReady`, read the closed tab's Space from the registry with the page cache as fallback, and call `tabRemoved` first, before anything forgets the tab; `windows.onRemoved` calls `removeWindow`
- [ ] run `make lint && make test && make build` - must pass before next task

### Task 3: Delete Space removes the Space before closing its tabs

**Files:**
- Modify: `src/actions/deleteSpaceAction.ts`

- [ ] in `DeleteSpaceAction.do()`, call `spaceManagerProxy.updateSpaces(remaining)` after the snapshots and before `chrome.tabs.remove`, with a comment saying why (the follower must see the Space gone and not open a New Tab in it)
- [ ] check that `undo()` still recreates the Space before its tabs and needs no change
- [ ] run `make lint && make test && make build` - must pass before next task

### Task 4: Verify acceptance criteria

- [ ] verify every Overview requirement maps to code: active close (any path), background close and window close untouched, New Tab in an empty Space, batch closes land once, both event orders, `restored` false untouched, deleted Space untouched
- [ ] verify CLAUDE.md invariants: tab ids used only after a successful restore, no hard-coded bookmark roots, no new storage writer
- [ ] run full suite: `make lint && make test && make build`

### Task 5: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/development.md`

- [ ] `README.md`, Spaces section: closing the active tab switches to the tab you used before it in the same Space; a Space with no other open tab gets a new tab; commands that close many tabs land on one tab
- [ ] `docs/changelog.md`, under `## Latest Version`: a `Changed:` line for the new behaviour
- [ ] `src/data/changelog.ts`: add a `'2.0.388'` entry above `'2.0.387'` with one What's New line (the key only has to be newer than `2.0.387`; the release step sets the real version, as the release PR did for `1.0.352`)
- [ ] `docs/development.md`, Chrome API rules: when the active tab closes Chrome activates a neighbour itself; `ActiveTabCloseFollower` skips that activation in `onActivated` while it follows, so code added to `onActivated` must expect skipped activations
- [ ] `docs/state-reference.md`: no new storage key, nothing to add (confirm)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (in Chrome, `make test-build`):
- two Spaces, active tab in Space A with an older A tab and a more recent B tab: Cmd+W lands on the A tab, the sidebar stays on A
- the same with the sidebar X button, the tab strip's close button, and a page that calls `window.close()`
- close a background tab: the active tab and the Space stay
- close the last tab of a Space while other Spaces have tabs: a New Tab opens in that Space
- Close Other Tabs, Clear, Archive and Close All Tabs In Space on a Space whose active tab is among the
  closed: one landing, no hopping
- Delete Space on the active Space: no New Tab in the deleted Space; the sidebar ends in another Space
- Follow active tab off: the landing tab is in the closed tab's Space; the sidebar does not switch (when
  the Space has no other tab, the New Tab path does switch the sidebar to that Space: `onCreated`
  registers new tabs to the active Space)
- close the active tab after the worker stopped (`chrome://serviceworker-internals` → Stop, or wait more
  than 30 seconds): the landing still happens
- with Follow active tab set to switch and scroll, switch from tab Y to tab X, then close Y from the
  sidebar: no scroll, no Space change
- switch from Y to X within a Space, then Clear or Close Other Tabs closing both: one landing in that Space
- Cmd+click links into the background from a tab, then close that tab: the link tabs keep their unvisited
  dots

**Known limitations**:
- a tab whose unload handler delays its close in a batch can be chosen and then close; the follower then
  lands once more
- pick first: dropping the neighbour from history also drops its older history position
- after a browser restart, before the first activation the history is empty, so closing the active tab
  then keeps Chrome's pick
- after Back in tab history, the tab the user came back from sits ahead of the history index and is
  reached only through the `lastAccessed` fallback
- pick first: when Chrome's pick handling (`handleTabActivation` for the neighbour) finishes after the
  follower's landing, the sidebar can end on the neighbour's Space (millisecond race)
