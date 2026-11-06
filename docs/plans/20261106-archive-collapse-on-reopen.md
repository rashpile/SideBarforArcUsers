# Collapse the Archive section after a page is reopened from it (#79)

## Overview

- Clicking an item in the expanded Archive section (any click, modifier clicks included, or Enter / Space on
  it) reopens the page in the active Space, but the section stays expanded. After this change it collapses
  once the page has opened, as if the user had clicked the Archive header.
- While the toolbar text filter is active the section is forced open and cannot be toggled; it stays open
  there. When the page fails to open, the section stays expanded with the error under it.

## Context (from discovery)

- `src/components/ArchiveSection.tsx:349-359`: `handleRestore` calls `chrome.tabs.create({ url, active: true,
  windowId })`; its callback returns on `handleError('reopen archived page')`, else removes the bookmark with
  `chrome.bookmarks.remove(page.id, …)`. `useCallback` deps: `[windowId, handleError]`.
- `src/components/ArchiveSection.tsx:290-291`: props `isCollapsed` (as shown; expanded while the text filter is
  active) and `onToggleCollapsed?: () => void` (undefined while the text filter is active).
- `src/components/ArchiveSection.tsx:342-345`: the effect `if (isCollapsed) setSearchText('')` clears the
  Archive search on collapse.
- `src/components/ArchiveSection.tsx:443-451`: item rows render only while `!isCollapsed`.
- `src/components/ArchiveSection.tsx:463-465`: the error paragraph renders outside the collapsed-only blocks,
  so it shows under a collapsed header too.
- `src/App.tsx:253-254`: `isCollapsed={sectionCollapseState.isCollapsed(activeSpaceId, 'archive')}` and
  `onToggleCollapsed={onToggleSection && (() => onToggleSection(activeSpaceId, 'archive'))}` — the same toggle
  the header uses; `src/App.tsx:1022-1024` passes `undefined` while the text filter is active.
- `src/hooks/useSectionCollapseState.ts`: the toggle writes `sectionCollapsedState` in `chrome.storage.local`,
  shared by every window.
- Docs: `README.md:177` ("Click an item to reopen it in the active Space."), `docs/changelog.md` "Latest
  Version".
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-collapse-archive-after-reopening-an-item-20261106-1243/design.md`.

## Development Approach

- **testing approach**: Regular. No new unit tests: the change is UI wiring inside a React component, which
  `node --test` doesn't render, and CLAUDE.md says to skip tests for UI wiring ("Test decisions, not
  coverage"). The existing suite must still pass.
- complete each task fully before moving to the next
- make small, focused changes
- follow CLAUDE.md code rules: Allman braces, comments say why, no new npm packages
- **CRITICAL: `make lint`, `make test` and `make build` must pass at the end of every task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: none added (see Development Approach). `make test` must still pass.
- **build and lint**: `make build` (tsc + vite) and `make lint` must pass.
- **e2e tests**: the project has none. The user checks the behaviour by hand (Post-Completion).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- Collapse through the existing `onToggleCollapsed` prop, from the success path of `handleRestore`. Rows
  render only while the section is expanded, so a toggle from a restore always collapses it. It is the same
  function the header calls, so the collapse is stored per Space in `sectionCollapsedState` and every window
  showing that Space follows, exactly like a header click.
- Collapse only after `chrome.tabs.create` succeeded: on failure the list stays open next to the error, so the
  user can retry or delete the item without expanding again.
- While the text filter is active `onToggleCollapsed` is `undefined`, so `onToggleCollapsed?.()` does nothing and
  the section stays open; the stored collapse state is not written while filtering.
- The existing collapse effect clears the Archive search field; nothing new for that.
- Rejected: a new idempotent "collapse" API through `SidebarContent` (more wiring for a millisecond race), and
  collapsing synchronously on click (hides the list when the open fails).

## Technical Details

- `handleRestore` callback order: `handleError('reopen archived page')` true → return (no collapse). Else
  `onToggleCollapsed?.()`, then `chrome.bookmarks.remove(page.id, …)` as now. A failed removal shows its error
  under the collapsed header.
- `useCallback` deps become `[windowId, handleError, onToggleCollapsed]`.
- No new props, state, storage keys or messages.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): the code change in `ArchiveSection.tsx` and the docs.
- **Post-Completion** (no checkboxes): manual check in the browser.

## Implementation Steps

### Task 1: Collapse the Archive section after a successful reopen

**Files:**
- Modify: `src/components/ArchiveSection.tsx`

- [ ] in `handleRestore`, after the `handleError('reopen archived page')` early return and before
      `chrome.bookmarks.remove`, call `onToggleCollapsed?.()`; add `onToggleCollapsed` to the `useCallback` deps
- [ ] update the comment above `handleRestore` with the reason only: the collapse waits for a successful open,
      so a failed open keeps the list next to its error (the prop comment already says the toggle is undefined
      while the text filter is active; don't repeat it)
- [ ] update the file header comment ("Clicking an item reopens it as a regular tab.") to mention the collapse
- [ ] run `make lint && make test && make build` - must pass before task 2

### Task 2: Verify acceptance criteria

- [ ] verify a click and Enter / Space on an item both go through `handleRestore`, so both collapse
- [ ] verify no collapse happens when `chrome.tabs.create` reports an error, and the error paragraph still
      renders while collapsed
- [ ] verify `onToggleCollapsed` is optional-called, so the text filter case (undefined) keeps the section open
      and writes nothing
- [ ] verify no other file changed behaviour (the header toggle, `SectionCollapseState`, App wiring unchanged)
- [ ] run full test suite: `make lint && make test && make build`

### Task 3: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`

- [ ] `README.md` § Archive (~177): extend "Click an item to reopen it in the active Space." — the section then
      collapses, as if you clicked the header; it stays expanded while the toolbar search is active, and when
      the page can't be opened (the error shows under it)
- [ ] `docs/changelog.md`: append one "Changed:" bullet after the last `Changed:` bullet in `## Latest Version`
      (the "closing the active tab switches…" line), with (#79): clicking an item in the expanded
      Archive section reopens it and collapses the section; it stays open while the toolbar search is active
      or when the page fails to open
- [ ] no `src/data/changelog.ts` line (a small polish, not worth a What's New line) and no
      `docs/state-reference.md` change (no new storage key; `sectionCollapsedState` already covers it)
- [ ] move this plan to `docs/plans/completed/`

## Known limitations

- [known-limitation] The collapse always ends with Archive collapsed (the toggle captured at the click flips a
  snapshot in which Archive is expanded), but it writes the whole `sectionCollapsedState` record as it was at
  the click. A section toggle made in another window in the milliseconds before the `chrome.tabs.create`
  callback is reverted. A millisecond race; per CLAUDE.md it is logged, not coded around.
- [known-limitation] A double-click on an item: the open finishes and the section collapses within the
  double-click interval, so the second click lands on what moved under the pointer. On the first archive row
  that is the Tab list's `+ New Tab` row, which opens a blank New Tab over the reopened page; on a lower row it
  activates another tab of the Tab list. Today the second click reopens the next archived page instead. Archive
  rows are single-click rows; the design keeps double-click handling out of scope.

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- `make test-build` builds this checkout into the main checkout's `dist/`; reload the extension in Chrome.
- expand Archive, click an item: the page opens in the active Space and the section collapses; expand again:
  the search field is empty
- the same with Enter on a focused item
- type in the toolbar search so an archived item matches, click it: the page opens and the section stays
  expanded; clear the search: the section shows its stored state
- a second window on the same Space follows the collapse, as with a header click
- double-click an archive item and note where the second click lands (see Known limitations)
