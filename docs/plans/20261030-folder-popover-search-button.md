# Folder recent-pages popover from a search button (#23)

## Overview
- Hovering a bookmark folder row opens `FolderRecentPopover` after 400 ms, so it pops up whenever the pointer crosses a folder on its way elsewhere.
- Move the trigger to a lucide `Search` button in the folder row's hover actions. Crossing folder rows opens nothing; resting on the button (200 ms) or clicking it opens the popover.
- The popover itself (list, search, close rules, pointer handoff) stays as it is. Its horizontal position changes one line: on a sidebar wider than the popover, its right edge lines up with the row's right edge, so it sits under the button.

## Context (from discovery)
- `src/components/FolderRecentPopover.tsx`: `useFolderPeek(enabled)` hook (open/close timers, anchor rect, scroll-close, pointer handoff) and the `FolderRecentPopover` portal. `OPEN_DELAY_MS = 400`, `CLOSE_DELAY_MS = 150`.
- `src/components/BookmarkTree.tsx` ~line 297: `useFolderPeek(isFolder && !isSpecialFolder && !expandedState[node.id] && bookmarkOpenMode === 'arc' && !globalDragActive && !!bookmarkRecency)`.
- `BookmarkTree.tsx` ~line 562: `onPointerEnter` / `onPointerLeave` from `folderPeek.rowHandlers` on the whole `TreeRow`.
- `BookmarkTree.tsx` ~line 470: the `actions` block - expanded folder `-` collapse button (`arc-folder-collapse-action`), collapsed-with-peek `-` indicator, pin/delete buttons (`opacity-0 group-hover:opacity-100`, `onPointerDown` stops propagation so dnd does not start).
- `TreeRow` renders `actions` in an absolutely positioned `.arc-tree-row-actions` div; the row root carries `data-bookmark-id`.
- Docs: `README.md` line 54, `docs/changelog.md` "Latest Version", `src/data/changelog.ts` entry `'1.0.352'` (unreleased: package and manifest are 1.0.351) with the line "New: hover a collapsed folder to see its recently used pages, with search".

## Development Approach
- **testing approach**: Regular. This is UI wiring; per CLAUDE.md ("Test decisions, not coverage") no new unit tests. Each task runs `make lint && make test && make build`.
- complete each task fully before moving to the next
- Allman braces, comments say why (CLAUDE.md § Code rules)

## Testing Strategy
- **unit tests**: none added - no data-loss or wrong-item decision changes. Existing suite must keep passing.
- **e2e tests**: the project has none.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview
- `useFolderPeek` keeps its behaviour; its `rowHandlers` become `triggerHandlers` for the button, plus an `onClick` that opens at once.
- The popover stays anchored to the **folder row**, not the button: the trigger looks up its row (`closest('[data-bookmark-id]')`, falling back to the button) and stores that rect. A button at the right edge would push a 360 px popover off a narrow sidebar.
- The button shows on collapsed **and** expanded folders (user choice): the enabled condition drops `!expandedState[node.id]`.
- Horizontal position: `left = Math.max(VIEWPORT_MARGIN, anchorRect.left, anchorRect.right - MAX_WIDTH)`. The button sits at the row's right edge; with the popover left-aligned to the row, a sidebar wider than ~380 px puts the button past the popover's right edge and the pointer has to travel diagonally within the 150 ms close delay. A row wider than `MAX_WIDTH` gets the popover's right edge on the row's right edge (row 8..624 -> popover 264..624). A narrower row keeps today's position: the row's left edge, clamped to the viewport margin (row 40..300 -> popover from 40), with the width still limited by the viewport.
- Open delay 200 ms (user choice): a hover on a dedicated small button is already intent, but a pointer sliding down the row's right edge still crosses the buttons.

## Technical Details
- `FolderPeek`:
  ```ts
  triggerHandlers: {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
  };
  ```
- Anchor element: `e.currentTarget.closest<HTMLElement>('[data-bookmark-id]') ?? e.currentTarget`.
- `onClick`: `stopPropagation()` (the row click toggles the folder), cancel any pending close, clear the open timer, and when not open set the anchor rect now; when already open, do nothing (keeps it open - toggling would close a popover hover just opened). Ignored when the peek is disabled.
- Button: `onPointerDown={(e) => e.stopPropagation()}` like the other row actions; `title`/`aria-label` "Search recent pages"; `Search` icon size 14; classes `arc-folder-collapse-action p-1.5 rounded bg-transparent` plus, via `clsx`, `folderPeek.anchorRect ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'` (as the Close-tab button does) so the button does not vanish while its popover is open. Rendered first in `actions`, only when the peek is enabled.
- The peek condition goes into one named const `canPeek` (folder, not a permanent root folder, Arc mode, no drag, recency loaded), used by both `useFolderPeek(canPeek)` and the button.
- Row: `onPointerEnter` / `onPointerLeave` removed from `TreeRow`; `folderPeek.close()` on row click and on context menu stays.

## What Goes Where
- **Implementation Steps**: code and docs in this repo.
- **Post-Completion**: manual check in the browser.

## Implementation Steps

### Task 1: Trigger the folder peek from a search button

**Files:**
- Modify: `src/components/FolderRecentPopover.tsx`
- Modify: `src/components/BookmarkTree.tsx`

- [x] in `FolderRecentPopover.tsx` rename `rowHandlers` to `triggerHandlers`, anchor to the trigger's closest `[data-bookmark-id]` row, add the `onClick` handler (open at once, no-op when open or disabled, stops propagation)
- [x] set `OPEN_DELAY_MS` to 200; update the file header and hook comments (no longer "on a collapsed folder" / "rests on the folder row") and the effect comment "Expanding the folder, starting a drag or leaving Arc mode closes the peek" (expanding no longer disables it)
- [x] in `FolderRecentPopover` set `left` to `Math.max(VIEWPORT_MARGIN, anchorRect.left, anchorRect.right - MAX_WIDTH)` with a why-comment (popover under the right-edge button on a wide sidebar)
- [x] in `BookmarkTree.tsx` move the peek condition into a `canPeek` const without `!expandedState[node.id]`, pass it to `useFolderPeek`, and update the comment above it
- [x] remove the row's `onPointerEnter` / `onPointerLeave` peek handlers from `TreeRow`
- [x] add the `Search` button first in `actions`, shown only when `canPeek`, hover-visible, kept visible while the popover is open, with `triggerHandlers` and `onPointerDown` stopping propagation; import `Search` from `lucide-react`
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Verify acceptance criteria
- [x] verify by reading the wiring: no pointer handler on the folder row opens the popover; only the button's handlers call the open path
- [x] verify the button stops `pointerdown` and `click` propagation (no folder toggle, no drag start) and is hidden for special folders, outside Arc mode and during a drag
- [x] verify the pointer handoff: leaving the button schedules a close that entering the popover cancels
- [x] run full checks: `make lint && make test && make build`

### Task 3: [Final] Update documentation
- [x] `README.md` line 54: hover or click the search button on a folder row to see its recently used pages, newest first, with search
- [x] `docs/changelog.md` "Latest Version": rewrite the unreleased line "New: hovering a collapsed bookmark folder shows its recently used pages, newest first, with search" in place (the feature has not shipped) - the search button on a folder row (hover or click) shows its recently used pages, newest first, with search; no separate Changed entry
- [x] `src/data/changelog.ts` `'1.0.352'`: rewrite the "hover a collapsed folder…" line to say the search button on a folder row opens its recently used pages, with search
- [x] `docs/state-reference.md`: no new storage keys - no change
- [x] move this plan to `docs/plans/completed/` (left in place - the orchestrator moves it at the end)

## Known limitations
- [known-limitation] Keyboard: Enter/Space on a focused search button bubbles to the row's key handler and toggles the folder, like the existing `-` collapse button. Keyboard access to the popover is out of scope.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- load the unpacked build, Arc mode: move the pointer across several folder rows - no popover
- hover the search icon on a collapsed and an expanded folder - popover opens below the row after ~200 ms; move into it - it stays; type to search and open a page
- click the search icon - opens at once; click the row - folder toggles and the popover closes
