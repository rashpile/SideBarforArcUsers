# Unvisited Tab Marker

Issue: https://github.com/rashpile/SideBarforArcUsers/issues/12

## Overview
- A tab opened in the background (Cmd+click, "Open link in new tab", Open All, middle-click on a bookmark) and never activated shows a dot at the left edge of its Tab list row until the user first switches to it, however long ago it was opened.
- Why: to see at a glance which new tabs you haven't looked at yet.
- Independent of "Highlight tabs by last use" (036): the dot works with any look, also with that setting Off. The row's age background stays as it is (graded by Chrome's `lastAccessed`, the creation time for such a tab).

### Decided with the user
- Look: a separate marker, a dot, not the age highlight's grade 0, so "not visited yet" reads differently from "just left".
- Place: the left edge of the row, before the favicon. The title doesn't shift.
- Which tabs: any tab created inactive, except restored tabs (Cmd+Shift+T on a window, session restore at browser start): those were visited before.
- Own setting in Settings → Appearance, **on** by default.
- Only regular tabs in the Tab list, same scope as 036.

### Calls made while planning (for review)
- Setting key `markUnvisitedTabs` in `chrome.storage.local`, raw string `'on' | 'off'` (background reads it), default `'on'`. Label "Mark unvisited tabs", description "A dot marks tabs opened in the background until you first switch to them."
- Stored in the existing `TabActivityTracker` records (`tabLastUsedAt`) as an `unvisited: true` field, like 036 added `leftAt`. The tracker already carries records across worker and browser restarts (`keptForLiveTabs`, `rematchedByUrl`), so the dot survives restarts. A separate store would need its own restart matching and serialized writes.
- The tracker records while auto-archive, the age highlight **or** this setting is on (`isTabActivityRecording` gets a third argument).
- Restored tabs: Chrome has no "restored" flag, and the spike (Task 1) showed it doesn't restore `lastAccessed` either (restored inactive tabs arrive with an age of ~5 ms). Rule: the background remembers window creation (`chrome.windows.onCreated`, in memory, `RecentWindows`) and skips inactive tabs created within 2 s of their window. The spike showed `windows.onCreated` arrives a few ms before the restored window's tabs.
- Park pages from tab suspenders (`parseParkedTabUrl`) are created inactive but are not new tabs: not marked.
- A never-activated tab's URL changes after creation (`pendingUrl` → redirects). Its record follows the URL on `tabs.onUpdated` (`changeInfo.url`, inactive tabs only) while it is unvisited, so a browser restart can still re-match it. Records also take `pendingUrl` when the tab has no committed URL yet.
- The marker is cleared on activation of the tab, independent of whether the previously active tab is known (worker just woke, previous tab closed, previous tab incognito), and whenever the user leaves the tab (`markLeft`). The sidebar never shows the dot on the active tab or on the tab it saw the user leave, so there is no flash while the background write is in flight.
- The dot shows on selected and grouped rows too (it doesn't fight the background). Colour: `--arc-tab-age-accent` (theme violet, or the Space accent when "Use space colour" is on).
- Bookmark tabs (Open All, middle-click on a bookmark in Arc mode) are flagged too, but they show in the Bookmarks section, which is out of scope. Their dot appears only if such a tab ends up in the Tab list.
- `TabLeftTimes` / `useTabLeftTimes` are renamed to `TabActivityView` / `useTabActivityView`: they now answer two questions. Few references (TabList.tsx, `docs/state-reference.md`).

### Known limitations
- Incognito tabs are never recorded, so they never get the dot.
- After a browser restart a dot can move to another copy of the same page (re-match by URL and position only), as `leftAt` can. Leaving that tab clears it.
- Tabs opened from a Saved Tab Group get dots (they are new inactive tabs to Chrome).
- "Open all in new window" (Chrome's bookmark manager, other extensions) creates a new window with inactive tabs: no dots, as for a restored window.
- Restoring a closed tab group into an existing window creates inactive tabs that get dots.
- If Chrome doesn't dispatch `windows.onCreated` before the tabs of windows restored at browser start, those tabs get dots. To check manually.

## Context (from discovery)
- `src/stores/tabActivityTracker.ts` — `TabUseRecords` (`fromStored`/`toStored`/`#put`, `markLeft`, `keptForLiveTabs`, `refreshedForLiveTabs`, `rematchedByUrl`), `TabLeftTimes` (read-only view for the sidebar), `TabActivityTracker.markActivated` / `load` / `refresh` / `forget`. All writes go through the `#enqueue` queue; `#attached` is false until `load` matched records to this session's tabs. `markActivated` reads/writes records only inside the "previous tab known and trackable" branch today.
- `src/utils/tabAgeHighlight.ts` — `isTabActivityRecording(period, style)`, setting parse pattern.
- `src/services/tabAutoArchiver.ts:74` — `readTabActivityRecording()` reads both keys.
- `src/background.ts` — tracker built ~162; `loadTabActivity()` ~269 (awaits `queryOpenTabs()` before enqueuing `load`); `storage.onChanged` for `TAB_AGE_HIGHLIGHT_KEY` ~283; `onActivated` → `markActivated` right after `await stateReady` ~499; `onUpdated` ~739 (fetches the tab when `changeInfo.url` is set); `onCreated` ~863.
- `src/utils/parkedTabAssociation.ts` — `parseParkedTabUrl(url)`.
- `src/hooks/useTabLeftTimes.ts` — reads `tabLastUsedAt`, follows `onChanged`, `enabled` flag, `SidebarTabLeftTimes` with the seen leave.
- `src/components/TabList.tsx` — `useTabLeftTimes(highlightTabAge, activeTabId)` ~900; `TabRow` ~115–250 (`hideChevronSlot`, so no left slot; speaker icon goes to badges for that reason); `TabRow` rendered at ~2734, ~2783, ~2889. Ungrouped tabs are depth 0 (8 px left padding, `src/utils/indent.ts`), so `TreeRow`'s `leadingIndicator` (absolute `left-2`, 26 px wide) would cover the favicon.
- `src/App.tsx` — settings via `useChromeLocalStorage` (raw-string pattern at `tabAgeHighlight` ~705); `highlightTabAge` goes through an intermediate component's props (~86, ~114, ~247) and the call at ~1511.
- `src/components/SettingsDialog.tsx` — Appearance tab, `tabAgeHighlight` select ~314.
- `src/index.css:23` — `--arc-tab-age-accent` defined on `.arc-theme`, overridden by `App` with the Space accent.
- Tests: `tests/tabActivityTracker.test.mjs`, `tests/tabAgeHighlight.test.mjs`.

## Development Approach
- **testing approach**: Regular — code first, then tests in the same task. Tests only for the decisions under Testing Strategy (CLAUDE.md: test decisions, not coverage); no tests for CSS, wording, settings plumbing, parse helpers or React wiring.
- complete each task fully before moving to the next
- make small, focused changes
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- backward compatibility: stored records without `unvisited` keep loading; auto-archive and the age highlight behave as before

## Testing Strategy
Decisions worth a test (they would mark the wrong tabs, lose the mark, or keep / drop records wrongly):
- recording condition with three settings (records dropped only when all three are off);
- which new tab is unvisited (`isOpenedUnvisited`): inactive new tab → yes; active → no; in a window created ≤ 2 s ago → no; in an older or unknown window → yes; park page → no; incognito → no;
- tracker: opening a tab unvisited creates a record with `unvisited` and no `leftAt`; activation clears it with a known previous tab, with no known previous tab, and with a closed previous tab; `markLeft` clears it; `refresh`, worker-restart keep and browser-restart rematch carry it; `followUrl` updates only unvisited records; a record written with only `pendingUrl` keeps that URL; records stored before this change load; nothing is recorded while not recording.

No e2e suite in the project; the UI is checked manually (Post-Completion).

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- **Background:** `tabs.onCreated` decides synchronously with `isOpenedUnvisited(tab, recentWindows, Date.now())`, then right after `await stateReady` (before any other await, like `onActivated`) enqueues `tracker.markOpenedUnvisited(tab)`. `stateReady` waits for `managerLoadPromise`, which includes the startup `loadTabActivity()`, so by then the records are matched to this session's tabs and a worker woken by `onCreated` still marks the tab. As a safety net `markOpenedUnvisited` is a no-op while the tracker is not attached (`#attached`, e.g. a failed load), so it never writes into records keyed by a previous session's tab IDs. `onActivated` → `markActivated` also clears the activated tab's `unvisited`. `onUpdated` with a URL on an inactive tab → `tracker.followUrl(tab)`. The setting joins the recording condition; changing it reloads the tracker like the age highlight does.
- **Sidebar:** the records hook reads while the age highlight or the marker is on and exposes `isUnvisited(tabId)` next to `leftAt(tabId)`. `TabRow` renders the dot as an absolute overlay in the row's 8 px left gutter.
- **CSS:** a small round dot in the accent colour.

## Technical Details

### Setting and decision — `src/utils/unvisitedTabMarker.ts` (new)
- `export type UnvisitedTabMarkerSetting = 'on' | 'off'`
- `export const UNVISITED_TAB_MARKER_KEY = 'markUnvisitedTabs'` (raw string, written by Settings, read by background.ts and App.tsx)
- `export const DEFAULT_UNVISITED_TAB_MARKER: UnvisitedTabMarkerSetting = 'on'`
- `export function parseUnvisitedTabMarker(value: unknown): UnvisitedTabMarkerSetting`
- `export class RecentWindows` — `markCreated(windowId, at)`, `isJustCreated(windowId, now)` (≤ 2 s, `RESTORED_WINDOW_MS`); forgets entries older than that on each call. Pure (time passed in).
- `export function isOpenedUnvisited(tab, recentWindows, now): boolean` — tab typed by the fields it reads (`active`, `incognito`, `windowId`, `url?`, `pendingUrl?`): `!active && !incognito && !parseParkedTabUrl(pendingUrl ?? url) && !recentWindows.isJustCreated(windowId, now)`.
- Imports `parseParkedTabUrl` with a `.ts` extension; check `parkedTabAssociation.ts` is importable under Node (no `chrome.*` at import time).

### Recording condition — `src/utils/tabAgeHighlight.ts`
- `isTabActivityRecording(period, style, marker)` — `period !== 'never' || style !== 'off' || marker === 'on'`. Update callers and the doc comment.
- `readTabActivityRecording()` (`tabAutoArchiver.ts`) reads the third key.

### Records — `src/stores/tabActivityTracker.ts`
- Stored entry: `{ windowId, url, index, lastUsedAt, leftAt?, unvisited? }`; `unvisited` is `true` or absent (`toStored` omits it when false). `isStoredTabUse` accepts absent or `true`.
- `TrackedTabLike` gains `pendingUrl?: string`; `#put` stores `tab.url || tab.pendingUrl || ''` in every path.
- `#put(tab, lastUsedAt, leftAt?, unvisited?)`; `keptForLiveTabs`, `refreshedForLiveTabs`, `rematchedByUrl` carry `unvisited` as they carry `leftAt` (each record its own). `markLeft` passes no `unvisited`, so leaving a tab clears it.
- `TabUseRecords.markOpenedUnvisited(tab, now)`: record with `lastUsedAt = now` (auto-archive starts its clock, as `refresh` does for first-seen tabs), no `leftAt`, `unvisited: true`.
- `TabUseRecords.markVisited(tabId)`: clears `unvisited`; returns whether anything changed.
- `TabUseRecords.followUrl(tab)`: an unvisited record takes the tab's current URL and index; returns whether it changed.
- `TabActivityTracker.markOpenedUnvisited(tab)`, `followUrl(tab)`: queued; no-ops while not recording, before the tracker is attached, and for incognito tabs.
- `markActivated(windowId, tabId)`: one read of the records; stamp the left tab when known and trackable; clear the activated tab's `unvisited` in every case; one write when anything changed.
- Rename `TabLeftTimes` → `TabActivityView` with `leftAt(tabId)` and `isUnvisited(tabId)`. Update the header comment (third use of the records).

### Background — `src/background.ts`
- `tabs.onCreated`: `const openedUnvisited = tab.id !== undefined && isOpenedUnvisited(tab, recentWindows, Date.now());` before the first await; right after `await stateReady`, `if (openedUnvisited) tabActivityTracker.markOpenedUnvisited(tab).catch(…)` before the Space / link placement work.
- `tabs.onUpdated` with `changeInfo.url` and the fetched tab inactive → `tabActivityTracker.followUrl(tab)`.
- `storage.onChanged` for `UNVISITED_TAB_MARKER_KEY` → `loadTabActivity()`, next to `TAB_AGE_HIGHLIGHT_KEY`; update the comment at the tracker's construction.
- `const recentWindows = new RecentWindows()`; `chrome.windows.onCreated` → `recentWindows.markCreated(window.id, Date.now())` (memory only, no `await stateReady`), registered before `tabs.onCreated`.

### Sidebar
- `App.tsx`: `useChromeLocalStorage<UnvisitedTabMarkerSetting>(UNVISITED_TAB_MARKER_KEY, DEFAULT_…, { parse: parseUnvisitedTabMarker, serialize: v => v })`; treat as `'off'` until loaded; pass `markUnvisitedTabs: boolean` along the same path as `highlightTabAge` (~86, ~114, ~247, ~1511) and the setting to `SettingsDialog`.
- Hook `useTabActivityView(enabled, activeTabId)` (renamed file): `enabled = highlightTabAge || markUnvisitedTabs`; `isUnvisited(tabId)` is false for the tab in the seen leave.
- `TabList.tsx`: the age grade still requires `highlightTabAge`. `TabRow` gets `isUnvisited` at all three render sites (~2734, ~2783, ~2889) and renders `<span className="arc-unvisited-dot" />` as a `TreeRow` child (the absolute-overlay slot) when `isUnvisited && !tab.active`.
- `SettingsDialog.tsx`: Appearance tab, a toggle "Mark unvisited tabs" with the description, under "Highlight tabs by last use"; temp state, reset-on-open and save like `tabAgeHighlight`.

### CSS — `src/index.css`
- `.arc-unvisited-dot`: absolute, about `left: 1px`, vertically centred, 5–6 px circle, `background: rgb(var(--arc-tab-age-accent))`, within the 8 px gutter so it never covers the favicon at depth 0. Tune on the real sidebar.

## What Goes Where
- **Implementation Steps**: code, tests, docs in this repo.
- **Post-Completion**: manual checks in Chrome.

## Implementation Steps

### Task 1: Spike — does Chrome restore `lastAccessed`?
- [x] temporary log in `tabs.onCreated` / `windows.onCreated`
- [x] the user restored a closed window with Cmd+Shift+T: `windows.onCreated` first, then the tabs; the 3 inactive restored tabs had `Date.now() - lastAccessed` of 5–6 ms. Chrome does not restore `lastAccessed`, so the `RecentWindows` rule is used. Group restore and browser restart were not tried (Post-Completion).
- [x] log removed

### Task 2: Setting, decision and recording condition

**Files:**
- Create: `src/utils/unvisitedTabMarker.ts`
- Create: `tests/unvisitedTabMarker.test.mjs`
- Modify: `src/utils/tabAgeHighlight.ts`
- Modify: `src/services/tabAutoArchiver.ts`
- Modify: `tests/tabAgeHighlight.test.mjs`

- [x] add `UnvisitedTabMarkerSetting`, key, default `'on'`, `parseUnvisitedTabMarker`
- [x] add `RecentWindows` and `isOpenedUnvisited`
- [x] `isTabActivityRecording` takes the marker setting; `readTabActivityRecording` reads it
- [x] write tests: `RecentWindows` (just created, older than 2 s, unknown window); `isOpenedUnvisited` — inactive new, active, in a just-created window, park page, incognito
- [x] update tests: recording condition — all off → false, each one on → true
- [x] run `make test` — must pass before task 3

### Task 3: `unvisited` in the tab activity records

**Files:**
- Modify: `src/stores/tabActivityTracker.ts`
- Modify: `tests/tabActivityTracker.test.mjs`

- [x] add `unvisited` to the stored entry, validation, `toStored`/`fromStored`, `#put`; `pendingUrl` fallback in `#put`; carry `unvisited` in `keptForLiveTabs`, `refreshedForLiveTabs`, `rematchedByUrl`
- [x] add `markOpenedUnvisited`, `markVisited`, `followUrl` on the records and the queued tracker methods (no-op while not recording or not attached)
- [x] `markActivated` clears the activated tab's `unvisited` outside the previous-tab branch
- [x] rename `TabLeftTimes` → `TabActivityView` with `isUnvisited`; update the header comment
- [x] write tests: open unvisited → record with `unvisited`, no `leftAt`; not recording / not attached → nothing written
- [x] write tests: activation clears it with a known, unknown and closed previous tab; `markLeft` clears it
- [x] write tests: `refresh`, worker-restart keep and browser-restart rematch carry it; `followUrl` changes only unvisited records; `pendingUrl` kept as URL; old records without the field load
- [x] run `make test` — must pass before task 4

### Task 4: Background events

**Files:**
- Modify: `src/background.ts`

- [x] `tabs.onCreated`: decide before the first await, enqueue right after `await stateReady`
- [x] `tabs.onUpdated` URL change on an inactive tab → `followUrl`
- [x] `storage.onChanged` for the new key → `loadTabActivity()`; update the tracker comment near its construction
- [x] `windows.onCreated` → `RecentWindows`
- [x] no new tests (wiring; decisions tested in tasks 2–3); `make test` and the build pass

### Task 5: Setting in the Settings dialog

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsDialog.tsx`

- [x] `useChromeLocalStorage` for `markUnvisitedTabs` (raw string), into the settings object and save handler
- [x] Appearance tab toggle with label and description
- [x] no tests (settings plumbing); `make test` and the build pass

### Task 6: Dot on Tab list rows

**Files:**
- Modify: `src/hooks/useTabLeftTimes.ts` (rename to `useTabActivityView.ts`)
- Modify: `src/components/TabList.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] hook enabled when either setting is on; exposes `isUnvisited` (false for the seen leave)
- [ ] `markUnvisitedTabs` passed along the `highlightTabAge` path; `TabRow` gets `isUnvisited` at all three render sites and renders the dot for non-active tabs; age grade still gated on `highlightTabAge`
- [ ] `.arc-unvisited-dot` in the left gutter, light and dark
- [ ] no tests (UI wiring, CSS); `make test` and the build pass

### Task 7: Verify acceptance criteria
- [ ] every item under "Decided with the user" works (against the code; the look on the real sidebar stays in Post-Completion)
- [ ] age highlight and auto-archive unchanged; all three settings off drops `tabLastUsedAt`
- [ ] `make test`, `make lint`, `npm run build`

### Task 8: [Final] Update documentation
- [ ] `README.md` (Settings) and `docs/changelog.md` (Latest Version)
- [ ] `src/data/changelog.ts` `1.0.352` — "New: "Mark unvisited tabs" setting (Settings > Appearance, on by default) - a dot marks tabs opened in the background until you first switch to them"
- [ ] `docs/state-reference.md` — key `markUnvisitedTabs`; `tabLastUsedAt.unvisited`; the three-setting recording condition at ~121–122, ~227, ~248, ~264–266; `TabLeftTimes` rename; writers `onCreated`, `onUpdated`, clear on activation
- [ ] `PRIVACY.md` (~15, the "Never and Off deletes them" sentence) and `docs/chrome-web-store-info.md` — records also kept while this setting is on
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Manual checks in Chrome — no checkboxes*

**Manual verification:**
- Cmd+click a few links: each new tab has a dot; switching to one removes its dot; the others keep theirs after 10 minutes
- close the active tab so a never-visited neighbour becomes active: its dot goes away
- "Open link in new tab" from the context menu: dot appears
- a link that redirects (e.g. a search result): dot stays; restart the browser: the dot comes back on that tab
- close a window with several tabs, restore it with Cmd+Shift+T: no dots; same for a restored tab group
- quit and reopen Chrome with session restore: no dots on restored tabs (except tabs that had a dot before)
- a tab suspender parks a tab: no dot
- the dot doesn't overlap the favicon on ungrouped (depth 0) rows; light, dark, Space colour; grouped and selected rows
- setting Off: no dots; with auto-archive Never and the age highlight Off, `tabLastUsedAt` disappears from `chrome.storage.local`
