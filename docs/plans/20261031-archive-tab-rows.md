# Archive button on tab rows and drag tabs to Archive (#38)

## Overview

Archive single tabs or a multi-selection by hand, not only all at once from the "+ New Tab" row's
Archive button or by auto-archive:

1. a hover **Archive** button on Tab-list rows (Mark · Archive · Close) and an **Archive** item in the tab
   context menu (single tab and multi-selection);
2. dragging tabs (or a multi-selection, or a tab group) onto the **Archive** section archives them.

All three entry points run the existing `ArchiveTabsAction` + `TabArchiveBatch` through
`createArchiveTabsAction` in `TabList.tsx`, with Undo, the `closesWholeWindow` confirm and the
one-run-at-a-time guard, exactly as the bulk Archive button does.

## Context (from discovery)

- `src/components/TabList.tsx`: `TabRow` hover actions (Mark, Close) and context menus;
  `createArchiveTabsAction`, `runArchiveOnce`, `handleArchiveAllTabs`, `archiveWholeWindow`,
  `closesWholeWindow`, `confirmCloseAllDialog` (`mode: 'archive'`), `activeSpaceFolderId`, `visibleTabs`
  (active Space, unmanaged tabs, text filter), `isTabMarked`, `getSelectedItems` / `getTabSelectionInfo`,
  `registerDropHandler('tabList', …)`, `getDragItems` (multi-drag items: TAB and TAB_GROUP).
- `src/components/ArchiveSection.tsx`: hidden when it has no items or under "With open tabs"; header via
  `SectionHeader`; rendered in `App.tsx` between `BookmarkTree` and `TabList`.
- `src/types/dragDrop.ts`: `DropZone = 'pinnedBar' | 'spaceBar' | 'tabList' | 'bookmarkTree'`, `DropData`,
  `acceptsFormatsIf`, `getItemsByFormat`.
- `src/contexts/UnifiedDndContext.tsx`: `handleDragEnd` dispatches to the handler registered for
  `dropData.zone`; exposes `activeDragData`, `sourceZone`, `overZone`.
- `src/utils/autoArchivePolicy.ts`: `isEmptyPage`, `tabPageUrl`. `src/utils/tabArchiveBatch.ts`:
  `ArchivableTab`.
- Tests: `node --test tests/*.test.mjs`, modules imported with `.ts` and without `chrome.*`.

## Development Approach

- **testing approach**: Regular (code first, then tests). Tests only for the decision of which tabs get
  archived (project rule "test decisions, not coverage"); no tests for buttons, menus, highlight, wiring.
- complete each task fully before moving to the next; `make lint && make test && make build` pass after
  each task.
- follow `CLAUDE.md`: Allman braces, classes over raw structures, comments say why, skip system folders,
  no hard-coded bookmark roots.

## Testing Strategy

- **unit tests**: `tests/tabArchiveCandidates.test.mjs` for `TabArchiveCandidates`.
- no e2e suite in this project; UI is checked by hand (Post-Completion).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix, blockers with ⚠️ prefix

## Solution Overview

- `TabList` keeps all archive logic: it already owns the action factory, the confirm dialog, marks, the
  selection and the active Space's folder. It registers the drop handler for a new `archive` drop zone.
  `ArchiveSection` only renders the droppable area and its highlight.
- One pure class, `TabArchiveCandidates`, decides which tabs a row button, menu item or drop archives,
  so the entry points cannot drift apart.
- One `archiveTabs(tabs)` path in `TabList` runs every manual archive (and `handleArchiveAllTabs`).

## Technical Details

### `TabArchiveCandidates` (`src/utils/tabArchiveCandidates.ts`)

```ts
export class TabArchiveCandidates
{
  constructor(spaceTabs: readonly chrome-like-tab[], isMarked: (tabId: number) => boolean)
  canArchiveRow(tab): boolean   // id set, in spaceTabs, not marked, not isEmptyPage(tabPageUrl(tab))
  pick(tabIds: readonly number[], groupIds: readonly number[]): ArchivableTab[]
}
```

- the tab type is a structural interface (`id?`, `url?`, `pendingUrl?`, `title?`, `groupId?`), so tests
  pass plain objects;
- `pick`: listed tabs plus the Space tabs whose `groupId` is listed, de-duplicated, in `spaceTabs` order;
  tabs not in `spaceTabs` (another Space, gone, managed), marked tabs and tabs without id are dropped;
  empty pages are kept (the batch closes them without an item, as the bulk Archive does);
- imports `./autoArchivePolicy.ts` and `type` from `./tabArchiveBatch.ts` only.

### `archive` drop zone

- `DropZone` gains `'archive'`.
- `ArchiveSection` wraps the header and, when expanded, its rows in one `useDroppable({ id: 'archive-section',
  data })` with `data = { zone: 'archive', targetId: activeSpace.id, isFolder: true, canAccept }`;
  `canAccept = acceptsFormatsIf([TAB_GROUP, TAB], () => hasSpaceFolder && sourceZone === 'tabList')`
  (`sourceZone` from `useUnifiedDnd()`: only Tab-list rows are archived, a future live-bookmark drag item
  with `TAB` must not light the zone). The element needs
  `data-dnd-id="archive-section"` (the context looks the element up by it to compute the drop position).
- Highlight: `overZone === 'archive'` from `useUnifiedDnd()` → a ring / tinted background on the section.
- Visibility: unchanged. A hidden section (no items, or "With open tabs") is no drop target: showing its
  header when a drag starts would shift the whole Tab list down on every reorder drag. With an empty
  archive the row button is the way in; after the first archived tab the section shows.
- `useDroppable` and `useUnifiedDnd()` are called unconditionally, before the `if (isHidden) return null`
  early return (rules of hooks).
- `[known-limitation]` collision detection falls back to `closestCenter`, so a drop in a gap that belongs to
  no droppable may resolve to the Archive section and archive the tabs. Undo covers it; other zones behave
  the same way.

### `TabList`

- `candidates = useMemo(() => new TabArchiveCandidates(visibleTabs, isTabMarked), …)`.
- `runManualArchive(tabsToArchive: ArchivableTab[])`: return without `activeSpaceFolderId` / `windowId`, while
  `archiveRunningRef` is set, or for an empty list; `closesWholeWindow(ids)` → `setConfirmCloseAllDialog({
  isOpen: true, tabIds, mode: 'archive' })`; else `createArchiveTabsAction` + `runArchiveOnce(onPerformAction …)`.
  `handleArchiveAllTabs` calls it with its own list. It never clears the selection: each caller does
  (`handleArchiveAllTabs`, the multi-selection branch of `handleArchiveSelectedTabs`, the drop handler), so
  archiving one unselected row leaves an unrelated selection alone.
- `handleArchiveSelectedTabs(clickedTabId)`: selection with more than one item → `candidates.pick(selected
  tab ids, selected group ids)` and `clearSelection()`; else `[clickedTab]` when `canArchiveRow`.
- `TabRow` gets `onArchive?: (tabId) => void` (undefined hides the button and the menu item). The
  list passes it when `activeSpaceFolderId` is set and `candidates.canArchiveRow(tab)`. Hover order:
  Mark · Archive · Close, lucide `Archive` icon, `aria-label="Archive tab"`.
- Context menu: single tab → **Archive** above **Close**; multi-selection → **Archive** above
  "Close N Tabs" (shown when the Space has a folder and the pick is non-empty; passed as
  `onArchiveSelection`). The selection's pick is worked out once per render in `TabList` and the result is
  passed to all three `TabRow` call sites.
- Drop handler for `archive`: return when `dropData.targetId !== activeSpace?.id` or no folder; tab ids
  from `getItemsByFormat(dragData, TAB)`, group ids from `getItemsByFormat(dragData, TAB_GROUP)`;
  `runManualArchive(candidates.pick(...))`; `clearSelection()`.

## What Goes Where

- **Implementation Steps**: code, tests, docs in this repo.
- **Post-Completion**: manual check in Chrome.

## Implementation Steps

### Task 1: `TabArchiveCandidates` decision class

**Files:**
- Create: `src/utils/tabArchiveCandidates.ts`
- Create: `tests/tabArchiveCandidates.test.mjs`

- [x] create `TabArchiveCandidates` with `canArchiveRow` and `pick` as in Technical Details (Allman braces,
      `.ts` imports, no `chrome.*`)
- [x] write tests: marked tabs skipped from `pick` and refused by `canArchiveRow`; tabs not in the Space
      list (another Space) skipped; a group expands to its Space tabs only (a same-group tab outside the
      list stays); de-dup when a tab is listed and in a listed group; result in Space-list order
- [x] write tests: empty pages refused by `canArchiveRow` but kept in `pick`; tabs without id skipped;
      empty input gives an empty list
- [x] run `make lint && make test` - must pass before task 2

### Task 2: Archive button and menu items on tab rows

**Files:**
- Modify: `src/components/TabList.tsx`

- [x] extract `runManualArchive(tabsToArchive)` from `handleArchiveAllTabs` (folder/window/busy/empty
      checks, `closesWholeWindow` confirm, `createArchiveTabsAction` + `runArchiveOnce`; no `clearSelection`
      inside); `handleArchiveAllTabs` uses it and keeps its own `clearSelection()`
- [x] add `candidates` (`TabArchiveCandidates` over `visibleTabs` and `isTabMarked`) and
      `handleArchiveSelectedTabs(clickedTabId)` (multi-selection → `pick` of selected tabs and groups +
      `clearSelection`; else the clicked tab)
- [x] add `onArchive` to `TabRow` props: hover button between Mark and Close (lucide `Archive`,
      `title`/`aria-label` "Archive tab"), single-tab menu item **Archive** above **Close**; pass it at all
      three `TabRow` call sites only when `activeSpaceFolderId` is set and `candidates.canArchiveRow(tab)`
- [x] add `onArchiveSelection` to `TabRow` props: multi-selection menu item **Archive** above
      "Close N Tabs"; passed when the Space has a folder and the selection's pick (computed once per render)
      is non-empty
- [x] no new tests (UI wiring; the decision is covered by task 1); run `make lint && make test && make build`
      - must pass before task 3

### Task 3: Drop tabs onto the Archive section

**Files:**
- Modify: `src/types/dragDrop.ts`
- Modify: `src/components/ArchiveSection.tsx`
- Modify: `src/components/TabList.tsx`

- [x] add `'archive'` to `DropZone`
- [x] `ArchiveSection`: one droppable (`id`/`data-dnd-id` `archive-section`, `zone: 'archive'`,
      `targetId: activeSpace.id`, `isFolder: true`, `canAccept` = `TAB_GROUP`/`TAB` only while the Space has
      a folder and `sourceZone === 'tabList'`) around the header and the expanded rows; works collapsed;
      hooks called before the `isHidden` early return
- [x] `ArchiveSection`: highlight while `overZone === 'archive'`; visibility unchanged (a hidden section is
      no drop target)
- [x] `TabList`: register a drop handler for `archive` (refuse a stale `targetId` or no folder; tab ids and
      group ids from the drag items; `runManualArchive(candidates.pick(...))`; `clearSelection()`), unregister on
      unmount
- [x] no new tests (wiring; `pick` covered by task 1); run `make lint && make test && make build` - must
      pass before task 4

### Task 4: Verify acceptance criteria

- [x] verify: button hidden for marked tabs, empty pages, Spaces without a folder and the All view (code review: `canArchiveRow` + `activeSpaceFolderId` undefined for All / no folder; in-Chrome check in Post-Completion)
- [x] verify: multi-selection button/menu/drop skip marked tabs and tabs of other Spaces; groups archive
      their tabs; bookmarks, Favorites, folders and external links are refused by the drop zone (code review: `pick` drops marked / non-Space tabs and expands groups;
      `canAccept` requires TAB/TAB_GROUP and `sourceZone === 'tabList'`, Favorites live in `pinnedBar`)
- [x] verify: archiving the last tabs of a window goes through the existing confirm (`mode: 'archive'`) (code review: `runManualArchive` checks `closesWholeWindow` first)
- [x] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`

- [x] `README.md`: Tab list section (hover Archive button, Archive menu item, multi-selection) and Archive
      section (drop tabs onto it, also collapsed; marked tabs stay open)
- [x] `docs/changelog.md`: a "New:" line under Latest Version
- [x] `src/data/changelog.ts`: What's New entry at the top of the current version's list
- [x] no new storage keys: `docs/state-reference.md` unchanged
- [x] move this plan to `docs/plans/completed/` (left in place - the orchestrator moves it at the end)

## Post-Completion

**Manual verification** (load `dist/` in Chrome):
- hover a tab: Mark · Archive · Close; click Archive → tab closes, item on top of the Archive, Undo
  reopens it and removes the item
- select three tabs (one marked) → Archive in the menu archives two, marked one stays open
- drag a tab onto the collapsed Archive header and onto the expanded list; drag a bookmark → no
  highlight, nothing happens
- archive the only tab of a window → confirm dialog
