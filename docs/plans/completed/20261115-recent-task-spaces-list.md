# Recent Task Spaces list above the Space buttons

## Overview

Task Spaces (#91, unreleased, 2.0.404) show in the Space bar strip as temporary icons while active and for 10
minutes after their last use. Replace that with a short list at the bottom of the sidebar, right above the
Space buttons:

- Up to **3** Task Spaces used in the last **24 hours**, one row each: Space icon, name, relative time of last
  use (`now`, `5m`, `2h`), oldest at the top and the most recent at the bottom, next to the Space buttons.
- A **(−)** button on each row (shown on row hover, in place of the time) hides that Task Space from the list
  until it is entered again (it becomes a window's active Space by any route: the sandwich list, the Space
  Switcher, the search popup, Follow active tab).
- The Space bar strip shows **regular Spaces only**: no temporary Task Space icons, no divider, no 10-minute
  rule.
- The sandwich (Task Spaces) list button is unchanged and still lists every Task Space, live and archived.

Mockup (variant B, picked by the user):
`/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-task-spaces-bar-above-space-buttons-20261115-2325/mockup/mockup.png`.

## Context (from discovery)

- Strip today: `src/components/SpaceBar.tsx` renders `regular` (sortable) and `temporary` icons from
  `useSpaceBarItems()` (`src/hooks/useSpaceBarItems.ts`, minute-less expiry timer) over the pure
  `spaceBarItems()` (`src/utils/spaceBarItems.ts`, `TEMPORARY_TASK_SPACE_ICON_MS`, tests in
  `tests/spaceBarItems.test.mjs`).
- Swipe: `SwipeableContainer` in `src/App.tsx` uses `[...regular, ...temporary]` from the same hook; with the
  active Space missing from that list it currently swipes left to the first Space.
- Last use: `taskSpaceLastUsedAt` (local), written only by background through `TaskSpaceLastUseStore`
  (`src/stores/taskSpaceLastUse.ts`), read in the sidebar with `useChromeLocalStorage` and wrapped in
  `TaskSpaceLastUse.fromStored`. Touched on entering **and leaving** a Task Space
  (`SpaceWindowStateManager` `onActiveSpaceChanged` in `src/background.ts`), on tab activation inside one,
  and on restore. Throttled to one write per 60 s.
- Task Space helpers: `src/utils/taskSpaces.ts` (`isTaskSpace`, `regularSpaces`); the record's
  `task.createdAt` (`src/utils/spaceMessages.ts`).
- Sandwich list: `src/components/TaskSpacesPopover.tsx` (row look, `em` row height with `useFontSize`,
  `SpaceContextMenuContent` right-click menu, handlers passed in from `SpaceBar`).
- Drops: `SpaceIcon` registers `useSortable` with drop data `{ zone: 'spaceBar', targetId: space.id,
  canAccept, isContainerForFormat }`; `SpaceBar` handles the `spaceBar` zone (`registerDropHandler`) and
  highlights by `overId === 'space-<id>'`. `PinnedIcon.tsx` shows plain `useDroppable` use.
- Managers: pattern in `docs/development.md` "Shared state"; a small model is
  `src/managers/impl/favoriteIconsManager.ts` (injected `storage` + `broadcast`, `#commit`, serialized
  `#write`, `flushWrites`) with `src/managers/shared/favoriteIconsApi.ts` (key, CHANGED id, value class) and
  `src/managers/proxies/favoriteIconsManagerProxy.ts` (mirror `ExternalStore`, broadcast listener,
  optimistic mutate, resync on error). `ManagerId` in `src/managers/proxies/messageRouting.ts`;
  `managerLoadPromise` and `registerManager` in `src/background.ts`; manager tests such as
  `tests/attentionMarkManager.test.mjs`, `tests/noteManager.test.mjs`.
- Background: `recordTaskSpaceUse` and `onActiveSpaceChanged` (~line 188-215), the `spaces` /
  `archivedTaskSpaces` `storage.onChanged` listener that retains last-use entries (~line 687).

## Development Approach

- **testing approach**: Regular (code first, then tests), per CLAUDE.md "Test decisions, not coverage":
  tests only for what shows or opens the wrong Space (which Task Spaces the list shows, hide / unhide /
  retain of the hidden marks, which Space a swipe opens). No tests for row layout, hover, time labels,
  menus or wiring.
- complete each task fully before moving to the next; small, focused changes
- `make lint && make test` must pass after each task; `make build` at the end
- Allman braces, comments say why, debug logs only under `import.meta.env.DEV`, classes over raw
  structures (CLAUDE.md "Code rules")
- modules imported by tests: `.ts` import extensions, chrome APIs injected, no `import.meta.env`, no enums or
  parameter properties (CLAUDE.md "Testing")
- update this plan file when scope changes during implementation

## Testing Strategy

- **unit tests**: Node tests in `tests/` for the pure selection and swipe helpers and the hidden-marks
  manager with injected storage
- **e2e tests**: the project has none

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- **Selection is pure** and works on data that exists: the live Space list, `task.createdAt`, the last-use
  times, the hidden marks, this window's active Space and a clock. One hook owns the clock (a one-minute
  tick) and feeds both the list and swipe.
- **Hidden marks are the only new state.** Shared by all windows and written from two sides (a sidebar's
  (−), background's unhide on entry), so per CLAUDE.md "One writer per storage key" they live in a new
  background manager with a sidebar proxy and mirror.
- **Unhide on entry, not on last use.** Background touches a Task Space's last use when the user *leaves*
  it, so a last-use rule would bring a hidden Space back on the next switch. Background clears the mark in
  `onActiveSpaceChanged` for the Space entered.
- **Swipe order stays stable**: regular Spaces, then the listed Task Spaces in creation order. The rows'
  recency order changes on every switch, and swiping in it would ping-pong between two rows.

## Technical Details

### Selection (`src/utils/recentTaskSpaces.ts`)

```typescript
export const RECENT_TASK_SPACES_WINDOW_MS = 24 * 60 * 60_000;
export const RECENT_TASK_SPACES_LIMIT = 3;

interface RecentTaskSpacesInput<T> {
  spaces: readonly T[];            // live Spaces (regular ones are ignored)
  activeSpaceId: string | null;    // this window's
  lastUse: LastUseLookup;          // lastUsedAt(spaceId): number | undefined
  hidden: HiddenLookup;            // isHidden(spaceId): boolean
  now: number;
}
```

- Candidates: `isTaskSpace(space) && !hidden.isHidden(space.id)`.
- **This window's active Task Space (when not hidden) always ranks newest**, whatever the stored times: it
  takes one of the `RECENT_TASK_SPACES_LIMIT` slots, sits at the bottom of the rows, and its label is `now`.
  Why: `now` comes from a once-a-minute clock and is up to 60 s old, while background stamps the Space just
  left (leave touch), and the sidebar's `createTaskSpace` stamps a new Task Space's `createdAt`, with the real
  time, which is after that `now`; ranking the active Space by `now` would put it above the Space just left,
  or push it out of the top 3.
- Other candidates: recent time `max(task.createdAt, lastUse ?? 0)`; keep `now - recentTime <
  RECENT_TASK_SPACES_WINDOW_MS` (exactly 24 h old is out; a time after `now` counts as in); sort by recent
  time descending, ties by `task.createdAt` descending (newer first) so the result is deterministic; fill the
  slots left after the active Space.
- Result: a small class (CLAUDE.md "Classes over raw structures"), e.g. `RecentTaskSpaces<T>` with
  `rows` (oldest first, the active Space last; each `{ space, recentAt, isActive }`) and `byCreation()` (the
  same Spaces by `task.createdAt` ascending, for swipe), `isEmpty`.
- `recentAgeLabel(row, now)`: `now` for the active row, under a minute **or a negative age** (a time after the
  stale clock), `Nm` under an hour, else `Nh` (floor). Trivial, no test.

### Swipe (in `src/utils/recentTaskSpaces.ts`)

- `swipeTarget(order, activeSpaceId, direction)`: `'left'` → the next Space in `order`, `'right'` → the
  previous one; `undefined` at either end **and when `activeSpaceId` is not in `order`** (a hidden or old
  Task Space is active).
- `order` = `[...regularSpaces(spaces), ...recent.byCreation()]`.

### Hidden marks

| key | area | shape | writer |
|---|---|---|---|
| `hiddenRecentTaskSpaces` | local | `string[]` (Space ids) | `HiddenTaskSpacesManager` (background) |

- `src/managers/shared/hiddenTaskSpacesApi.ts`: `HIDDEN_TASK_SPACES_STORAGE_KEY`,
  `HIDDEN_TASK_SPACES_CHANGED = makeManagerActionId(ManagerId.HIDDEN_TASK_SPACES, 'changed')`, the value class
  `HiddenTaskSpaces` (immutable: `EMPTY`, `fromStored(unknown)` — anything but an array of strings reads as
  empty, non-strings dropped — `isHidden(id)`, `with(id)`, `without(id)`, `retaining(ids)`, `toStored()`;
  each returns the same instance when nothing changes; a one-line comment says the marks hide a Task Space
  from the recent list only, never from the sandwich list), and `HiddenTaskSpacesApi`:
  `getHidden(): string[]`, `hide(spaceId: string): string[]`.
- `src/managers/impl/hiddenTaskSpacesManager.ts`: `ManagerId.HIDDEN_TASK_SPACES = 'HiddenTaskSpacesManager'`;
  injected `{ storage: { get, set }, broadcast }`; `load()` never rejects (a failed read is logged and starts
  from `EMPTY`, like the other "Never rejects" loads in `managerLoadPromise`); `dispatch` for `getHidden` / `hide`;
  background-internal `unhide(spaceId)` and `retain(liveTaskSpaceIds)`; one `#commit` that skips an unchanged
  value (no write, no broadcast), writes serially and broadcasts `{ action: HIDDEN_TASK_SPACES_CHANGED,
  hidden, senderId }`; `flushWrites()` for tests.
- `src/managers/proxies/hiddenTaskSpacesProxy.ts`: mirror `ExternalStore<HiddenTaskSpaces>`, `load()` (subscribe
  once + `getHidden`), `hide(id)` (optimistic, resync from `getHidden` on failure, rethrow), broadcast
  listener that skips its own echo. Hook `src/hooks/useHiddenTaskSpaces.ts` (`useSyncExternalStore` on the
  mirror, calls `load()` once, as other proxy hooks do).

### Background wiring (`src/background.ts`)

- Construct the manager with `chrome.storage.local` and `chrome.runtime.sendMessage`, add `load()` to
  `managerLoadPromise`, `registerManager` it.
- `onActiveSpaceChanged(_, previous, next)`: keep both last-use touches; add
  `managerLoadPromise.then(() => hiddenTaskSpacesManager.unhide(next))` with a logged `catch`. Leaving does not
  unhide.
- In the existing `spaces` / `archivedTaskSpaces` `storage.onChanged` listener (after the load, skipped while the
  live list is empty): also
  `hiddenTaskSpacesManager.retain(spaceManager.getSpaces().filter(isTaskSpace).map(space => space.id))` — live
  only (not `getTaskSpaceIds()`, which includes archived ones), so archived, deleted and converted Spaces lose
  their mark.

### List component (`src/components/RecentTaskSpacesList.tsx`)

- Rendered by `SpaceBar` above its bar `div` (inside the returned fragment), with `SpaceBar`'s handlers for
  select (`switchToSpace`), edit, delete, close all tabs, convert, and `canDelete`; not rendered when the list
  is empty.
- Look per mockup B: `border-t`, rows `2em` high (font size from `useFontSize`), icon (`getIcon`, 14-16 px), name
  truncated, time label right-aligned in gray; active row highlighted like the sandwich list's active row; the
  time hidden and a (−) button (`Minus` from lucide, `title="Hide"`, `aria-label="Hide from recent Task Spaces"`)
  shown on row hover (`group` / `group-hover`), also on keyboard focus of the row.
- (−) click: `stopPropagation`, `hiddenTaskSpacesProxy.hide(id)`; failure → `console.error` + toast
  "Could not hide the Task Space" (`onShowToast`).
- Right-click: `SpaceContextMenuContent` (Edit, Close All Tabs, Convert to Regular Space, Delete).
- Drops: each row `useDroppable({ id: 'space-<id>', data: { zone: 'spaceBar', targetId: space.id,
  canAccept: acceptsFormats(DragFormat.TAB, DragFormat.URL), isContainerForFormat: TAB/URL → true } })`;
  the row element also carries `data-dnd-id="space-<id>"` (`UnifiedDndContext.handleDragOver` looks the
  hovered element up by it and drops the hover without it, so the drop handler never runs; `SpaceIcon` and
  `PinnedIcon` set it too). `SpaceBar`'s existing `spaceBar` drop handler moves the tab / opens the URL;
  highlight the row while `overId === 'space-<id>'` during a TAB/URL drag (ring like the Space icons). Task
  Spaces are never in the strip any more, so the droppable id can't clash with a `SpaceIcon`'s.

## What Goes Where

- **Implementation Steps**: code, tests, docs in this repo
- **Post-Completion**: manual checks in Chrome

## Implementation Steps

### Task 1: Recent Task Spaces selection and swipe target

**Files:**
- Create: `src/utils/recentTaskSpaces.ts`
- Create: `tests/recentTaskSpaces.test.mjs`

- [x] create `src/utils/recentTaskSpaces.ts` (`.ts` imports, no chrome, no `import.meta.env`) with `RECENT_TASK_SPACES_WINDOW_MS`, `RECENT_TASK_SPACES_LIMIT`, the `LastUseLookup` / `HiddenLookup` interfaces, `recentTaskSpaces(input)` returning the `RecentTaskSpaces` class (`rows`, `byCreation()`, `isEmpty`) and `recentAgeLabel(row, now)` per Technical Details (takes the row, not `recentAt`, so the active row reads `now`)
- [x] add `swipeTarget(order, activeSpaceId, direction)` to the same module per Technical Details
- [x] write tests for `recentTaskSpaces`: regular Spaces never listed; 24 h cut-off (23h59m in, exactly 24 h out); only the 3 most recent of 5; rows oldest → newest; a hidden Task Space is left out, also when it is the active Space; the active Space is listed even with an old last use; **the active Space is listed and last even when three other Task Spaces have a last use or `createdAt` after `now`**; `createdAt` is used when there is no last use or it is newer; `byCreation()` order differs from row order when last use and creation disagree
- [x] write tests for `swipeTarget`: next / previous in the order, `undefined` at both ends, `undefined` when the active Space is not in the order
- [x] run `make lint && make test` - must pass before task 2

### Task 2: Hidden marks value class and manager

**Files:**
- Modify: `src/managers/proxies/messageRouting.ts`
- Create: `src/managers/shared/hiddenTaskSpacesApi.ts`
- Create: `src/managers/impl/hiddenTaskSpacesManager.ts`
- Create: `tests/hiddenTaskSpacesManager.test.mjs`

- [x] add `HIDDEN_TASK_SPACES: 'HiddenTaskSpacesManager'` to `ManagerId`
- [x] create `src/managers/shared/hiddenTaskSpacesApi.ts` with the key, the CHANGED action id, the `HiddenTaskSpaces` value class and `HiddenTaskSpacesApi` per Technical Details (imports with `.ts` extensions so tests can load it)
- [x] create `src/managers/impl/hiddenTaskSpacesManager.ts` (`RoutedManager`, `HiddenTaskSpacesApi`) with injected storage and broadcast, `load`, `dispatch` (`getHidden`, `hide`, unknown method throws), `unhide`, `retain`, `#commit` (unchanged value: no write, no broadcast), serialized writes and `flushWrites`
- [x] write tests: `hide` stores and broadcasts the id once and a second `hide` of the same id neither writes nor broadcasts; `unhide` removes only that id and does nothing for an id that isn't hidden; `retain` drops ids not in the given list and keeps the rest; `load` of a corrupt value (object, string, array with non-strings) reads as empty or drops the non-strings; the broadcast carries the caller's `senderId`
- [x] run `make lint && make test` - must pass before task 3

### Task 3: Background wiring, proxy and hook for the hidden marks

**Files:**
- Modify: `src/background.ts`
- Create: `src/managers/proxies/hiddenTaskSpacesProxy.ts`
- Create: `src/hooks/useHiddenTaskSpaces.ts`

- [x] in `src/background.ts` construct `HiddenTaskSpacesManager` (chrome storage local + `chrome.runtime.sendMessage`), add its `load()` to `managerLoadPromise` and `registerManager` it
- [x] in `onActiveSpaceChanged` unhide the Space entered (`next`) after `managerLoadPromise`, with a logged `catch`; keep both last-use touches; leaving does not unhide
- [x] in the `spaces` / `archivedTaskSpaces` `storage.onChanged` listener also `retain(spaceManager.getSpaces().filter(isTaskSpace).map(space => space.id))` — live Task Spaces only, not `getTaskSpaceIds()` — with the same load wait and `getSpaces().length === 0` guard as the last-use retain
- [x] update the background comments that say last use feeds "the temporary Space bar icon" / "its temporary icon stays for a while after the switch": it now feeds the recent Task Spaces list (a Space just left stays at the bottom of it) and auto-archive
- [x] create `src/managers/proxies/hiddenTaskSpacesProxy.ts` (mirror, `load`, optimistic `hide` with resync on failure, broadcast listener skipping its own echo) following `favoriteIconsManagerProxy.ts`, and `src/hooks/useHiddenTaskSpaces.ts` returning the `HiddenTaskSpaces` mirror value
- [x] no new tests (wiring; the manager logic is tested in task 2); run `make lint && make test` - must pass before task 4

### Task 4: Drop the temporary icons from the strip; new hook for the list and swipe

**Files:**
- Create: `src/hooks/useRecentTaskSpaces.ts`
- Delete: `src/hooks/useSpaceBarItems.ts`
- Delete: `src/utils/spaceBarItems.ts`
- Delete: `tests/spaceBarItems.test.mjs`
- Modify: `src/components/SpaceBar.tsx`
- Modify: `src/components/SpaceIcon.tsx`
- Modify: `src/App.tsx`

- [x] create `src/hooks/useRecentTaskSpaces.ts`: reads `useSpacesContext()` (`spaces`, `activeSpaceId`), `taskSpaceLastUsedAt` via `useChromeLocalStorage` + `TaskSpaceLastUse.fromStored` (as `useSpaceBarItems` did), `useHiddenTaskSpaces()`, and `useClock(true, 60_000)` (`src/hooks/useClock.ts`); returns `recentTaskSpaces(...)` and `now` (for the labels)
- [x] remove `useSpaceBarItems` and `spaceBarItems` (and their test): `SpaceBar`'s strip renders `regularSpaces(spaces)` (memoized) only — no divider, no temporary icons; `SpaceIcon` stays sortable for every strip icon
- [x] `SwipeableContainer` in `src/App.tsx`: order `[...regularSpaces(spaces), ...recent.byCreation()]` and `swipeTarget` for both directions, so a swipe from a Space not in the order does nothing; update the comment about the strip order
- [x] `SpaceIcon` (used only by `SpaceBar`): remove the `acceptsSpaceDrops` prop and its comment (every strip icon now takes SPACE, TAB and URL drops); keep passing `isDraggable` from `SpaceBar` (it defaults to `false`, so dropping it would make the strip unsortable)
- [x] tests: `tests/spaceBarItems.test.mjs` removed with its module; `swipeTarget` is covered in task 1; run `make lint && make test` - must pass before task 5
- ➕ also removed `SpaceIcon`'s `onConvertToRegular` prop and `SpaceBar`'s strip passing it: the strip holds regular Spaces only, so it was always undefined (the recent list and the sandwich list keep Convert)

### Task 5: Recent Task Spaces list component

**Files:**
- Create: `src/components/RecentTaskSpacesList.tsx`
- Modify: `src/components/SpaceBar.tsx`

- [x] create `src/components/RecentTaskSpacesList.tsx` per Technical Details (rows, icon, name, `recentAgeLabel`, active highlight, hover/focus (−), right-click `SpaceContextMenuContent`, `useDroppable` per row with `data-dnd-id="space-<id>"` on the row element and the TAB/URL drop highlight)
- [x] render it in `SpaceBar` above the bar `div`, fed by `useRecentTaskSpaces()`, with `SpaceBar`'s handlers (`switchToSpace`, `onEditSpace`, `handleDelete`, `handleCloseAllTabsInSpace`, `handleConvertToRegular`, `canDelete`) and a `hide` handler that calls `hiddenTaskSpacesProxy.hide` and toasts "Could not hide the Task Space" on failure
- [x] check the `spaceBar` drop handler resolves a row's `targetId` to the Task Space (it already takes `dropData.targetId`), so a tab dropped on a row moves into that Task Space and a link opens there
- [x] check the Arc styling selectors in `src/index.css` (`.arc-space-bar > div:nth-child(2)`) still target the strip, and give the list a background that matches the Space bar in light and dark mode
- [x] no tests (UI); run `make lint && make test` - must pass before task 6

### Task 6: Verify acceptance criteria

- [x] verify all requirements from Overview are implemented (≤3 rows, 24 h, order, (−) hides until entered, strip regular-only, sandwich list unchanged, swipe, drops)
- [x] verify edge cases: no Task Spaces / none recent → no list; hidden active Task Space → not listed, swipe does nothing; a just-created Task Space shows at once; a deleted / archived / converted Task Space leaves the list and loses its mark
- [x] run full test suite: `make lint && make test`
- [x] run `make build`

### Task 7: [Final] Update documentation

- [x] `README.md` Task Spaces section: replace the temporary-icon bullet with the recent list (3 rows, 24 h, oldest at top, time label, (−) hides until you switch to it again, drops), keep "Task Spaces aren't in the Space bar's row of icons"; fix the Convert bullet ("row or temporary icon" → rows of either list)
- [x] `docs/changelog.md` "Latest Version": Task Spaces are unreleased (2.0.404), so edit the existing Task Spaces entry in place instead of adding a new one: the recent list replaces the temporary icon and 10-minute rule, swipe order, new key `hiddenRecentTaskSpaces`
- [x] `src/data/changelog.ts` `2.0.404` Task Spaces line: replace "a temporary icon shows while you use one" with the recent list above the Space buttons
- [x] `docs/state-reference.md`: new `hiddenRecentTaskSpaces` section (owner, writes: `hide` from the sidebar, `unhide` on entering the Space, `retain` on Space list changes; consumers; unreadable value reads as empty; lifespan; instances) and in the storage tree; update `taskSpaceLastUsedAt` (feeds the recent list, not a temporary icon); update the `spaces` record's `task` bullet (it points at the deleted `spaceBarItems`, `src/utils/spaceBarItems.ts`)
- [x] `docs/development.md`: add `HiddenTaskSpacesManager` | `hiddenRecentTaskSpaces` (local) to the manager table; fix any mention of the temporary icon
- [x] comments that still describe the temporary icon: `src/components/TaskSpacesPopover.tsx` header, `src/stores/taskSpaceLastUse.ts` header
- [x] move this plan to `docs/plans/completed/` (skipped - the harness moves the plan after all phases finish)

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** in Chrome (load `dist/`):
- create 4 Task Spaces, switch between them: the list shows the 3 most recent, the active one at the bottom with `now`, and the strip has no Task Space icons
- hover a row → (−) replaces the time; click it → the row goes; open it from the sandwich list → it is back; hide the active one → it stays hidden until you switch away and back
- the list in a second window follows hides from the first
- drop a tab and a link on a row; right-click a row → Edit / Convert / Close All Tabs / Delete
- swipe from the last regular Space reaches the listed Task Spaces in creation order; swiping on a hidden active Task Space does nothing
- light and dark mode, Horizontal and Vertical toolbar, a narrow and a wide panel, a larger font size
