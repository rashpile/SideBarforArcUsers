# Restore tab Spaces after Chrome restores its windows

## Overview

- Bug: after a Chrome restart every regular tab shows in the first Space (Home). The first fix on this
  branch (`TabSpaceRegistry.registerNewTab` on `tabs.onCreated`) is needed but not enough.
- Cause, confirmed with a persistent trace on the user's Chrome:
  - at browser start the service worker runs about 1.8 s before Chrome has restored any window;
  - `TabSpaceRegistry.load` then finds 0 tabs, matches nothing and saves an empty list, so every stored
    Space assignment is lost;
  - `chrome.tabGroups.query({})` in `assignUntrackedTabsToSpaces` rejects with "No current window", so
    `managerLoadPromise` rejects and `stateReady` resolves false;
  - Chrome then restores the window, and each restored tab's `onCreated` puts it in the active Space,
    the first Space after a restart.
- Fix: in a new browser session the startup restore waits until Chrome has restored its windows; the
  startup no longer fails without a window; a load that sees no tab keeps the stored records; the
  registry's stored tab indexes follow the tab strip, so several tabs on one URL in different Spaces
  match the right tab after a restart.
- Verified by a POC on the user's Chrome: `stored=19 liveTabs=19 matched=19` and `stored=13 liveTabs=13
  matched=13`, every restored tab `(kept)` its Space, the user saw all tabs in their Spaces.
- Two traced quits logged no `tabs.onRemoved` / `windows.onRemoved` and the records survived the quit, so
  the POC's quit handling (`closeWindow`, the `isWindowClosing` skip) is dropped.

## Context (from discovery)

- POC patch, for reference only: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-restore-tab-spaces-after-chrome-restores-20261115-2148/poc-restore-wait.patch`; it holds the inline window wait, the `tabGroups.query` catch, `closeWindow` and a debug trace. Write the code from this plan; do not `git apply` the patch (its `closeWindow`, `closed` flag, `TabSpaceLoadSummary`, `#closedWindowRecords`, `#metadataOf` and trace must not land)
- Timer-injection pattern with a fake clock: `src/utils/submenuHoverTimer.ts`, `tests/submenuHoverTimer.test.mjs`
- `src/background.ts`: `sameBrowserSession` / `browserSessionMarker`, `managerLoadPromise` (loads `tabSpaceRegistry`, `attentionMarkManager`, `loadTabActivity`), `assignUntrackedTabsToSpaces` (`chrome.tabGroups.query({})`), `refreshBackupIndices` call sites in `tabs.onCreated`, `onRemoved`, `onMoved`, `onDetached`, `onAttached`
- `src/managers/impl/tabSpaceRegistry.ts`: `load(sameBrowserSession)`, `save()`, `refreshWindowMetadata(windowId)` (today called only from `onMoved`), `removeWindow`, `registerNewTab`
- `src/utils/storedTabMatcher.ts`: `matchStoredTabs`, URL pass picks the nearest stored index
- `tests/tabSpaceRegistry.test.mjs`: `installChrome` fake with `tabs.get`
- Pattern for testable classes with injected deps: `src/utils/tabAssociationReadiness.ts`, `src/stores/browserSessionMarker.ts`

## Development Approach

- **testing approach**: Regular (code first, then tests): tests cover the decisions that lose Space assignments (the wait, the zero-tab load, the index refresh); CLAUDE.md "Test decisions, not coverage"
- complete each task fully before moving to the next
- make small, focused changes
- tests for wiring in `background.ts` are skipped (not importable under Node; CLAUDE.md)
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- code rules per CLAUDE.md: Allman braces, comments say why, modules imported by tests take chrome APIs and timers as arguments, import siblings with `.ts`, no TS-only runtime syntax

## Testing Strategy

- **unit tests**: `make test` (`node --test tests/*.test.mjs`)
- **e2e tests**: none in this project

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- `RestoredWindowsWait` (new `src/utils/restoredWindowsWait.ts`) decides when the startup restore may
  run; background wires it to `chrome.windows` / `chrome.tabs` events and the real timers.
- `startupTabsReady` in background: `sameBrowserSession`, after the wait when the session is new. The
  loads that match stored tab records against live tabs start from it.
- `TabSpaceRegistry.load` keeps the records on a zero-tab load; `refreshWindowMetadata` runs where the
  bookmark backup indices are refreshed.

## Technical Details

`RestoredWindowsWait`:

```typescript
// Exported with why-comments; background passes them, tests use their own small values
export const RESTORE_QUIET_MS = 500;      // creations this close together are the browser still restoring
export const RESTORE_MAX_WAIT_MS = 5000;  // after the first window, so a user opening tabs right away doesn't hold the startup

interface RestoredWindowsWaitDeps
{
  countNormalWindows(): Promise<number>;
  // Chrome-shaped: background passes the same reference to add and remove
  addWindowCreatedListener(listener: () => void): void;
  removeWindowCreatedListener(listener: () => void): void;
  addTabCreatedListener(listener: () => void): void;
  removeTabCreatedListener(listener: () => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  quietMs: number;
  maxWaitMs: number;
}
```

- background wires the window listener with Chrome's filter, so the class only sees normal windows:
  `addWindowCreatedListener: (l) => chrome.windows.onCreated.addListener(l, { windowTypes: ['normal'] })`,
  `removeWindowCreatedListener: (l) => chrome.windows.onCreated.removeListener(l)`.
- `wait(): Promise<void>`: listeners are added first, then `countNormalWindows()`.
  - a normal window exists (at start or from a window event) → the quiet period starts; every later
    window or tab creation restarts it; it ends after `quietMs` with no creation;
  - `maxWaitMs` after the first window it ends whatever is still arriving;
  - no window → no timer runs; it waits for the first normal window;
  - tab creations before any window don't start the quiet period;
  - `countNormalWindows()` rejecting starts the quiet period and the cap as if a window existed (as the
    POC does): a wait that never ends would hold `stateReady` and every event forever;
  - on resolve both listeners are removed and both timers cleared; it never rejects.
- background: `const startupTabsReady = sameBrowserSession.then(async (same) => { if (!same) await restoredWindowsWait.wait(); return same; })`.
- `assignUntrackedTabsToSpaces`: `await chrome.tabGroups.query({}).catch((): chrome.tabGroups.TabGroup[] => [])`
  with a why-comment: it rejects with "No current window" while Chrome has no window, and that rejection
  used to reject `managerLoadPromise` and leave `stateReady` false.
- `TabSpaceRegistry.load`: when the tabs query returns no tab, return before matching and saving. The
  stored records stay for the next worker start; any registration in this worker rewrites the key (see
  known limitations).
- Index refresh: `tabSpaceRegistry.refreshWindowMetadata(windowId)` next to each existing
  `refreshBackupIndices(...)` call in `tabs.onCreated`, `tabs.onRemoved` (inside the non-closing branch),
  `tabs.onDetached` (old window), `tabs.onAttached` (new window); `onMoved` already has it.

## What Goes Where

- **Implementation Steps**: code, tests, docs in this repo
- **Post-Completion**: the user's Chrome restart check

## Implementation Steps

### Task 1: Wait for Chrome's restored windows before the startup restore

**Files:**
- Create: `src/utils/restoredWindowsWait.ts`
- Create: `tests/restoredWindowsWait.test.mjs`
- Modify: `src/background.ts`

- [x] create `src/utils/restoredWindowsWait.ts` with the `RestoredWindowsWait` class, its deps interface and the exported `RESTORE_QUIET_MS` / `RESTORE_MAX_WAIT_MS` with their why-comments, as in Technical Details (decision logic as in the POC patch's `waitForRestoredWindows`, without any `chrome.*` access; a why-comment that the worker can start before Chrome restores any window)
- [x] in `src/background.ts` create the instance with the `chrome.windows.getAll({ windowTypes: ['normal'] })` count, the filtered `chrome.windows.onCreated` listener (same reference for add and remove), `chrome.tabs.onCreated`, `setTimeout` / `clearTimeout` and the two exported constants; add `startupTabsReady`; start `tabSpaceRegistry.load`, `attentionMarkManager.load` and `loadTabActivity` in `managerLoadPromise` from it
- [x] in `assignUntrackedTabsToSpaces` catch the `chrome.tabGroups.query({})` rejection as an empty list, with the why-comment from Technical Details
- [x] do not bring over the POC's `closeWindow`, `closed` flag, `isWindowClosing` skip, `TabSpaceLoadSummary`, `#closedWindowRecords`, `#metadataOf` or `traceTabSpaces` debug trace
- [x] write `tests/restoredWindowsWait.test.mjs` with a fake clock and fake events (pattern of `tests/submenuHoverTimer.test.mjs`): no window at start waits for the first window event; resolves `quietMs` after the last creation; a tab creation inside the quiet period pushes it out; tab creations before any window don't start it; `maxWaitMs` ends it while tabs keep arriving; windows present at start resolve after `quietMs`; `countNormalWindows` rejecting still resolves after `quietMs` (and by `maxWaitMs` with tabs arriving); listeners removed (the same references that were added) and timers cleared after resolve
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Keep stored Space records when the load sees no tab

**Files:**
- Modify: `src/managers/impl/tabSpaceRegistry.ts`
- Modify: `tests/tabSpaceRegistry.test.mjs`

- [x] in `TabSpaceRegistry.load`, when the tabs query returns no tab, return before matching and saving, with a why-comment (Chrome may have restored no window yet; a save now would wipe every stored Space; the records stay for the next worker start, and any registration in this worker rewrites the key)
- [x] write test: `load(false)` with stored records and zero live tabs leaves `tabSpaceAssignments` unchanged and registers nothing; a later `load(false)` with the restored tabs matches them
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Keep the registry's stored tab indexes current

**Files:**
- Modify: `src/background.ts`
- Modify: `tests/tabSpaceRegistry.test.mjs`

- [x] call `tabSpaceRegistry.refreshWindowMetadata(windowId)` next to `refreshBackupIndices` in `tabs.onCreated`, in the non-closing branch of `tabs.onRemoved`, in `tabs.onDetached` (old window) and `tabs.onAttached` (new window), with one why-comment (a restart matches tabs on the same URL by stored position)
- [x] write test: two records on one URL in different Spaces whose tabs moved positions without a move event (a tab before them closed); after `refreshWindowMetadata` a browser-restart `load(false)` against the restored tabs gives each tab its own Space. Setup: the restored tabs get new tab and window IDs (so the `sameWindowAndSite` ID pass doesn't pair them), the record order puts the earlier tab first, and `installChrome` is installed a second time with the first fake's stored records (its `liveTabs` are fixed at install time). Assert the stale indexes as a precondition with a comment, not as a behaviour of their own
- [x] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria

- [x] verify a worker restart within the browser session (`sameBrowserSession` true) does not wait (`startupTabsReady` calls `restoredWindowsWait.wait()` only when `same` is false; the constructor adds no listener or timer)
- [x] verify `git diff` against the branch head before this plan has no `closeWindow`, `closed`, `TabSpaceLoadSummary`, `#closedWindowRecords`, `#metadataOf`, `debugTabSpaceTrace` or `traceTabSpaces` (checked `git diff 388daa3 HEAD` outside `docs/plans`: the only hit is the word "closed" in a test title)
- [x] run full test suite: `make test` (805 pass)
- [x] run `make lint` and `make build`

### Task 5: [Final] Update documentation

- [x] `docs/changelog.md`: rewrite this branch's `Fixed:` line under `## Latest Version` with the real cause: after a browser restart the extension could start before Chrome restored its windows, lost the stored Spaces and put every tab in the first Space; it now waits for the restored windows, and tabs on the same page in different Spaces keep their own Space
- [x] `docs/state-reference.md`, `tabSpaceAssignments`: the startup restore waits for the restored windows in a new browser session; a load with no tab keeps the records; indexes are refreshed on tab create/close/detach/attach/move
- [x] `docs/plans/completed/20261115-keep-tab-spaces-after-restart.md`: add a line under Overview that the startup order was the main cause, fixed by this plan
- [x] `CLAUDE.md`, invariant "Tab ids don't survive a browser restart": add a sub-bullet that startup code re-attaching stored per-tab records starts from `startupTabsReady` (`src/background.ts`), which in a new browser session waits for Chrome's restored windows (`RestoredWindowsWait`), not from `sameBrowserSession`
- [x] `docs/development.md` > Chrome API rules: add a bullet that at browser start the worker can run before Chrome has restored any window (`tabs.query` returns nothing; `chrome.tabGroups.query` rejects with "No current window")
- [x] no README change and no `src/data/changelog.ts` entry (bug fix only)
- [x] move this plan to `docs/plans/completed/` (skipped - the harness moves the plan after all phases finish)

## Post-Completion

**Manual verification** (the user, production build):
- put tabs in two non-first Spaces, including two tabs on the same URL in different Spaces, quit Chrome (Cmd+Q), start it: every tab is in its Space
- reload the extension on `chrome://extensions`: tabs keep their Spaces
- stop the service worker in `chrome://serviceworker-internals`, then switch tabs: no delay, Spaces intact

**Known limitations**:
- [known-limitation] a window Chrome restores more than `quietMs` (500 ms) after the previous window or tab creation, or more than `maxWaitMs` (5 s) after the first window, loses its tabs' stored Spaces: the load saves only the records it matched, and those tabs join the active Space
- [known-limitation] the zero-tab guard in `TabSpaceRegistry.load` keeps the records only for the next worker start: a registration in the same worker (such as a restored tab's `onCreated`) rewrites the key without them
- [known-limitation] a new browser session with no normal window (Chrome in background mode, only an app window) holds `stateReady` until the first normal window opens; events queued on it are lost if the idle worker stops first
- [known-limitation] the window's active Space is not restored after a browser restart (it lives in `chrome.storage.session`)
- [known-limitation] with Chrome's startup setting "Open the New Tab page", a fresh startup New Tab can match a stored New Tab record and keep that record's Space
