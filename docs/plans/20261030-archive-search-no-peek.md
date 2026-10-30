# Archive section: remove the hover popup, add a search field to the expanded header

## Overview
- Hovering the collapsed **Archive** header opens `FolderRecentPopover`: the newest archived items plus a
  search box. It repeats the list the expanded section already shows, in the same order, and opening on
  its own is distracting.
- Remove that popup from the Archive section. When Archive is expanded, its header row holds an
  always-visible search input that narrows the list. Collapsed, the header is a plain row again.
- The folder hover popup in the Bookmarks tree (`BookmarkTree.tsx`) stays as it is.

## Context (from discovery)
- `src/components/ArchiveSection.tsx` - the section; uses `useFolderPeek` + `FolderRecentPopover`, wraps
  `SectionHeader` in a `div` with pointer handlers, calls `closePeek()` in `handleRestore`, uses
  `useUnifiedDnd` only to suppress the peek during a drag.
- `src/components/SectionHeader.tsx` - shared header row: chevron+label toggle span (`role="button"`,
  Enter/Space toggles), whole row `onClick` toggles, optional "..." menu button. Label span is `flex-1`.
- `src/utils/archiveItems.ts` - `ArchiveItems`: `matching(filterText)` via `matchesFilter`
  (`src/utils/searchParser.ts`); `toRecency()` feeds only the popover.
- `src/App.tsx` ~line 227 - `<ArchiveSection key={activeSpaceId}>` with the comment "Keyed by Space so a
  Space switch closes an open archive peek".
- `tests/archiveItems.test.mjs` - tests `matching` and `toRecency`.
- `FolderRecentPopover.tsx` search input styling (Search icon, transparent input, `placeholder-gray-400`)
  is the visual reference for the new field.
- Docs mentioning the hover: `README.md` (~line 101), `docs/changelog.md` "Latest Version" Archive line,
  `src/data/changelog.ts` 1.0.352 Archive line. 1.0.352 is unreleased (package.json is 1.0.351).

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- make small, focused changes
- tests follow the project rule "test decisions, not coverage" (CLAUDE.md): the combined filter in
  `ArchiveItems.matching` decides which archived pages the user sees, so it gets tests; UI wiring
  (input, clearing on collapse, click not toggling) is not unit-tested
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run `make test` after each change; `make lint` and `make build` at the end

## Testing Strategy
- **unit tests**: `tests/archiveItems.test.mjs` (node --test with type stripping, via `make test`)
- **e2e tests**: the project has none

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- `ArchiveItems.matching(filterText, searchText = '')` returns items matching both the toolbar filter and
  the Archive search (blank query = match all). `toRecency()` goes away with its only caller.
- `SectionHeader` gets an optional `trailing` slot rendered after the toggle span and before the "..."
  button; with `trailing` the label keeps its natural width and the slot takes the remaining space.
- `ArchiveSection` drops the peek entirely, keeps a local `searchText` state, renders the search input in
  the header's `trailing` slot only while expanded, and clears the search when the section collapses. A
  Space switch remounts the section (existing `key={activeSpaceId}`), which clears it too.
- Section visibility stays driven by the toolbar filter only, so a search that matches nothing keeps the
  section (and the input) on screen and shows "No matching pages".

## Technical Details
- Visibility: `isHidden = filterLiveTabs || items.matching(filterText).length === 0`.
- Rows: `items.matching(filterText, searchText)`; empty with a non-blank `searchText` → one muted line
  "No matching pages".
- Input behaviour: Search icon, `placeholder="Search Archive..."`, clear (x) button while non-empty;
  `Escape` clears a non-empty search, otherwise blurs; no autofocus on expand. `onClick`/`onPointerDown`
  on the trailing wrapper stop propagation so the header row's `onClick` does not toggle the section; the
  input is outside the toggle span, so Enter/Space typed in it never reach `handleToggleKeyDown`.
- Clearing on collapse: `useEffect(() => { if (isCollapsed) setSearchText(''); }, [isCollapsed])`
  (Allman braces when multi-line).
- Clear (x) button visibility: the header has `className="arc-space-title"`, and `src/index.css`
  (`.arc-space-title button { opacity: 0 }`, shown only on `:hover` / `:focus-within`) would hide it while
  the input is blurred. A hidden x with an active search hides the fact that rows are filtered, so the x
  must stay visible whenever the search is non-empty: give it a class/style that overrides that opacity
  rule (and check the `.arc-section-header button` border-radius rule does not distort it).
- Escape: call `e.stopPropagation()` on the input's keydown for Escape, so the document-level Escape
  handler in `src/contexts/SelectionContext.tsx` does not also clear the tab/bookmark multi-selection.
- Accessible names: `aria-label="Search Archive"` on the input; `title` and `aria-label` "Clear search"
  on the x (as `ArchiveItemRow`'s delete button does).
- While the toolbar filter hides the section, `ArchiveSection` returns `null` but stays mounted, so
  `searchText` survives and shows again when the section reappears expanded. Accepted, not a bug.

## What Goes Where
- **Implementation Steps**: code, tests, docs in this repo
- **Post-Completion**: manual check in the browser

## Implementation Steps

### Task 1: Combined filter in ArchiveItems

**Files:**
- Modify: `src/utils/archiveItems.ts`
- Modify: `tests/archiveItems.test.mjs`

- [x] change `matching(filterText)` to `matching(filterText, searchText = '')`: an item is kept when it
  matches the toolbar filter (blank = all) AND the Archive search (blank = all), both via `matchesFilter`;
  update its doc comment
- [x] add tests for the combined filter: toolbar filter only, Archive search only, both together (AND),
  blank search, a search that matches nothing
- [x] run `make test` - must pass before task 2

### Task 2: Trailing slot in SectionHeader

**Files:**
- Modify: `src/components/SectionHeader.tsx`

- [x] add optional prop `trailing?: ReactNode` (with a short field comment like the other props)
- [x] render it in the header row after the chevron+label toggle span and before the "..." menu button,
  in all three render paths (no menu, right-click menu, button menu) - they share `renderHeaderRow`
- [x] when `trailing` is given, drop `flex-1` from BOTH the toggle span (`flex flex-1 min-w-0`) and the
  inner label span (`arc-section-label flex-1`), so chevron+label keep their natural width, and the
  trailing wrapper is `flex-1 min-w-0`; without `trailing` the layout is unchanged for every other header
  (the toggle span also gets `flex-shrink-0` instead of `min-w-0`, so a narrow sidebar shrinks the
  trailing content rather than the label)
- [x] no unit test (UI wiring, per project rules); run `make test` - must pass before task 3

### Task 3: Remove the Archive peek, add the search input

**Files:**
- Modify: `src/components/ArchiveSection.tsx`
- Modify: `src/App.tsx`
- Modify: `src/utils/archiveItems.ts`
- Modify: `tests/archiveItems.test.mjs`

- [x] remove `useFolderPeek`, `FolderRecentPopover`, the pointer-handler wrapper `div` around
  `SectionHeader`, the `recency` memo, `closePeek()` in `handleRestore` (and its dependency), and
  `useUnifiedDnd` / `dragActiveId`
- [x] remove `ArchiveItems.toRecency()` (its only caller is gone; confirm with grep), the now unused
  `BookmarkRecency` / `BookmarkRecencyRecord` imports in `src/utils/archiveItems.ts`, and the `toRecency`
  test in `tests/archiveItems.test.mjs`
- [x] add `searchText` state; clear it when `isCollapsed` becomes true
- [x] compute `isHidden` from the toolbar filter only and the rows from `items.matching(filterText, searchText)`;
  show "No matching pages" (muted, like other empty-state text in the sidebar) when the search leaves no rows
- [x] render the search input in `SectionHeader`'s `trailing` slot only while expanded: Search icon,
  "Search Archive..." placeholder, clear (x) button while non-empty and visible even when the header is
  not hovered (override the `.arc-space-title button` opacity rule), Escape clears or blurs and does not
  propagate to the document, click and pointer-down do not toggle the section, accessible names on input
  and x (see Technical Details); styled to fit the header row in light and dark themes
- [x] update the file header comment (no hover peek; expanded header has a search field) and the
  `App.tsx` comment on `key={activeSpaceId}` (a Space switch now resets the Archive search)
- [x] no unit test (UI wiring, per project rules); run `make test` and `make lint` - must pass before task 4

### Task 4: Verify acceptance criteria
- [x] hovering the collapsed Archive header opens nothing; `FolderRecentPopover` is still used by
  `BookmarkTree.tsx` only
- [x] expanded Archive shows the search input in its header row; collapsed shows none
- [x] search narrows rows together with the toolbar filter; a no-match search keeps the section visible
  with "No matching pages"
- [x] clicking or typing (including Space/Enter) in the input never toggles the section
- [x] run full test suite: `make test`
- [x] run `make lint` and `make build`

### Task 5: [Final] Update documentation
- [ ] `README.md` Archive paragraph: no hover; expand to list everything, newest first, and search it
  from the header row
- [ ] `docs/changelog.md` "Latest Version" Archive entry: edit in place (expand to list and search,
  instead of hover)
- [ ] `src/data/changelog.ts` 1.0.352 Archive entry: edit in place the same way
- [ ] no new storage keys, so `docs/state-reference.md` stays unchanged
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- load the built extension; hover the collapsed Archive header (nothing opens); expand it, type in the
  search, combine with the toolbar filter, press Escape, collapse and expand again (search cleared),
  switch Space (search cleared); with a search typed, move the pointer away and blur the input (the x
  stays visible); Escape in the search with tabs multi-selected (selection kept); check light and dark
  themes and a narrow sidebar
