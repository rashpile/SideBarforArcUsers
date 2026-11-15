# Keep tab Spaces after a Chrome restart

## Overview

- Bug: after a Chrome restart every regular tab (Tab list tab) shows in the first Space (Home). The user
  had tabs in Space 2 and in a Task Space, quit Chrome, started it again, and all of them were in Home.
- Cause: `TabSpaceRegistry.load` gives the restored tabs their stored Spaces at worker start, but Chrome
  also dispatches `chrome.tabs.onCreated` for every tab it restores. The `onCreated` handler in
  `src/background.ts` waits for `stateReady` (after the load) and then registers the tab to the window's
  active Space without looking at the registry. The window's active Space lives in
  `chrome.storage.session`, which a browser restart clears, so it falls back to the first Space.
- Fix: a tab Chrome reports as created keeps a Space the registry already holds for it (from the
  startup restore, the worker-start pass `assignUntrackedTabsToSpaces`, or an explicit registration such
  as a Recently Closed reopen that got there first); only a tab without one joins the active Space.
- Bookmark tabs are not affected (their Space comes from the bookmark folder). A tab opened during a
  session normally has no Space yet when `onCreated` runs, so it still joins the active Space.
- Evidence: the unvisited-marker spike confirmed `onCreated` for restored tabs only for Cmd+Shift+T, not
  for a browser restart. The restart behaviour is inferred; Post-Completion has the check that tells this
  cause apart from the others.

## Context (from discovery)

- `src/managers/impl/tabSpaceRegistry.ts`: `TabSpaceRegistry` (`register`, `getSpace`, `load(sameBrowserSession)`), the only writer of `tabSpaceAssignments`
- `src/background.ts`: `chrome.tabs.onCreated` handler (registers to `resolveActiveSpaceId(...)`, then `moveLinkTabToTabListTop(tab.id, tab.windowId, tab.openerTabId, targetSpaceId)`)
- `src/managers/impl/spaceWindowStateManager.ts`: active Space per window in `chrome.storage.session`
- `src/utils/storedTabMatcher.ts`: `matchStoredTabs` used by `load`
- `tests/tabSpaceRegistry.test.mjs`: `installChrome` fake (storage, `tabs.query`, `runtime.sendMessage`; no `tabs.get` yet)
- `tests/spaceAssignmentBoundary.test.mjs`: asserts `chrome.tabs.onCreated[\s\S]*tabSpaceRegistry.register` in background source; `registerNewTab` still matches it
- Restored tabs firing `onCreated`: `docs/plans/completed/20261030-unvisited-tab-marker.md`, `RecentWindows` in `src/utils/unvisitedTabMarker.ts`

## Development Approach

- **testing approach**: Regular (code first, then tests): a small fix of one decision; CLAUDE.md asks for tests of decisions, not test-first
- complete each task fully before moving to the next
- tests only for the decision that puts a tab in the wrong Space (CLAUDE.md "Test decisions, not coverage"); no tests for docs or wiring
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- code style per CLAUDE.md: Allman braces, comments say why, test modules import siblings with `.ts`

## Testing Strategy

- **unit tests**: `node --test` via `make test`; the registry test fakes `chrome.*` as the existing tests do
- **e2e tests**: none in this project

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- New method `TabSpaceRegistry.registerNewTab(windowId, tabId, activeSpaceId)` names the decision: keep
  the Space the registry holds for the tab, else register the active Space. It lives in the class that
  owns the assignments (CLAUDE.md: classes with descriptive methods), and it is testable under Node.
- `onCreated` calls it instead of `register`, and passes the Space it returns to
  `moveLinkTabToTabListTop`.
- At a browser restart: `load(false)` matches records → restored tabs have Spaces → the queued
  `onCreated` events keep them → `assignUntrackedTabsToSpaces` still puts unmatched tabs into the active Space.

## Technical Details

```typescript
/**
 * Gives a tab Chrome reports as created its Space and returns it. A tab the registry already
 * holds keeps its Space: Chrome reports the tabs it restores at browser start as created too,
 * after load gave them their stored Spaces. Any other tab joins activeSpaceId.
 */
async registerNewTab(windowId: number, tabId: number, activeSpaceId: string | null): Promise<string | null>
```

- registry has a Space for `(windowId, tabId)` → return it, no write, no broadcast
- else `activeSpaceId` non-null → `await this.register(windowId, tabId, activeSpaceId)`, return `activeSpaceId`
- else return `null`
- Not added to `dispatch` / `TabSpaceRegistryApi` / the proxy: only background calls it.

## What Goes Where

- **Implementation Steps**: registry method, background wiring, test, docs
- **Post-Completion**: manual Chrome restart check by the user

## Implementation Steps

### Task 1: Keep a restored tab's Space when Chrome reports it as created

**Files:**
- Modify: `src/managers/impl/tabSpaceRegistry.ts`
- Modify: `src/background.ts`
- Modify: `tests/tabSpaceRegistry.test.mjs`

- [x] add `registerNewTab(windowId, tabId, activeSpaceId)` to `TabSpaceRegistry` as in Technical Details, with the doc comment saying why (Chrome reports restored tabs as created after `load`)
- [x] in the `chrome.tabs.onCreated` handler of `src/background.ts`, replace the `if (targetSpaceId) await tabSpaceRegistry.register(...)` block with `const tabSpaceId = await tabSpaceRegistry.registerNewTab(tab.windowId, tab.id, targetSpaceId)` and pass `tabSpaceId` to `moveLinkTabToTabListTop`; update the handler's leading comment ("A new tab joins the current Space ...") to say a tab that already has a Space (restored at browser start) keeps it; make no claim there about native groups
- [x] extend `installChrome` in `tests/tabSpaceRegistry.test.mjs` with `tabs.get` (returns the live tab by id, rejects for an unknown id) so `register` stores url/index as in Chrome
- [x] write test: browser restart (`load(false)`), stored records put `https://code.test/agterm` in `task` and `https://swarm.test/` in `space2` under old tab ids and window 1; live tabs show those URLs under new ids in window 5 (window ids change at a restart too); `registerNewTab(5, id, 'home')` returns and keeps `task` and `space2`, and the stored `tabSpaceAssignments` still say so
- [x] write test: `registerNewTab` for a tab with no Space registers `activeSpaceId` and returns it; with `activeSpaceId` null it returns null and registers nothing
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Verify acceptance criteria

- [x] verify a tab created during a session still joins the window's active Space (handler reads only `registerNewTab`'s result)
- [x] verify `tests/spaceAssignmentBoundary.test.mjs` still passes
- [x] run full test suite: `make test`
- [x] run the build: `make build`

### Task 3: [Final] Update documentation

- [ ] `docs/changelog.md`: add under `## Latest Version` a line `- Fixed: after a browser restart, tabs keep their Space. Chrome reports the tabs it restores as new, and the sidebar put each of them into the window's active Space, which after a restart is the first Space, so every Space's tabs showed in that one`
- [ ] `docs/state-reference.md`, `tabSpaceAssignments`: add that `tabs.onCreated` keeps a Space the startup restore gave a restored tab and registers only tabs without one to the window's active Space
- [ ] no `src/data/changelog.ts` entry (it omits bug-fix-only changes); README unchanged (no user-facing feature change)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

**Manual verification**:
- open tabs in two non-first Spaces (one a Task Space), quit Chrome (Cmd+Q), start it again: each tab is in its Space; the sidebar opens on the first Space, or on the active tab's Space with Follow active tab on
- open a new tab and a link from a bookmark tab during the session: both join the active Space as before

**Diagnostic if tabs still land in the first Space** (service worker console, `chrome://extensions` > Inspect views):
- before Cmd+Q run `chrome.storage.local.get('tabSpaceAssignments')` and note the records of the non-first Spaces; after the restart run it again
- records gone after the restart: the quit removed them (`tabs.onRemoved` / `windows.onRemoved` during shutdown), a cause this fix doesn't touch
- records present with the old Spaces but the tabs in the first Space: the tabs were restored after `load` queried them (known limitation 1 below)

**Known limitations**:
- [known-limitation] a tab Chrome restores after `TabSpaceRegistry.load` has queried the tabs (a very slow session restore) has no matched record and still joins the active Space; add matching against the records `load` could not match if the diagnostic shows it
- [known-limitation] the window's active Space is not restored after a browser restart (it lives in `chrome.storage.session`)
- [known-limitation] Cmd+Shift+T on a closed window puts its tabs in the active Space: `windows.onRemoved` dropped that window's records, so there is nothing to keep
- [known-limitation] a tab created inside a native group titled like a Space, while that creation wakes the worker, now keeps the Space the worker-start pass `assignUntrackedTabsToSpaces` gives it by the group title, instead of the active Space; this needs a sleeping worker and a native group named after a Space
