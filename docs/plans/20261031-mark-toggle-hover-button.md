# Mark toggle replaces the hover Pin button (#33)

## Overview
- Tab and bookmark rows show a Pin button on hover. Pinning is rare and is in the context menu; Mark for Attention is only in the context menu.
- Replace the hover Pin button with a Mark toggle (`Flag` "Mark for Attention" / `FlagOff` "Clear Mark") that calls the row's existing `onToggleMark`.
- Keep **Pin to Sidebar** in the context menu, and make sure a single bookmark has it (today only the mixed bookmark+folder multi-selection menu shows it).

## Context (from discovery)
- `src/components/TabList.tsx`: `actions` block (~l.175) holds the hover Pin button, then `-`/`x`. `showMarkItem` (~l.225) = `!!onToggleMark && tab.id !== undefined && !tab.incognito`. Single-tab menu already has Pin to Sidebar (~l.369).
- `src/components/BookmarkTree.tsx`: hover Pin button (~l.503); `showMark = !isFolder && !!isMarked` (~l.293); single-bookmark menu has Mark for Attention (~l.800) but no Pin to Sidebar; the all-bookmarks multi-selection menu (~l.636) has no Pin to Sidebar; the mixed multi-selection menu (~l.671) has it gated by `hasSelectedBookmarks`.
- `handlePinSelectedBookmarks` (~l.1760) pins all selected bookmarks when more than one is selected, else the clicked one.
- Icons from `lucide-react` (already a dependency).

## Development Approach
- **testing approach**: Regular. No new unit tests: this is UI wiring (CLAUDE.md "Test decisions, not coverage"); the toggle reuses `onToggleMark`, which is unchanged.
- complete each task fully before moving to the next
- run `make lint && make test && make build` after each task
- follow CLAUDE.md code rules (Allman braces, comments say why)

## Testing Strategy
- unit tests: none new (UI wiring only); existing suite must stay green
- no e2e tests in the project

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview
Edit both row components in place. No new state, storage or handlers. The hover slot where Pin was gets a toggle button with the same classes as the neighbouring action buttons; `onPointerDown` and `onClick` stop propagation like the other row buttons (drag and row click must not fire).

## Technical Details
- Tab: render the toggle when `showMarkItem`; move the `showMarkItem` constant above `actions`. `isMarked` → `FlagOff`, title/aria-label "Clear Mark"; else `Flag`, "Mark for Attention". Click → `onToggleMark(tab.id)`. The `-` / `x` button after it is unchanged.
- Bookmark: render the toggle when `!isFolder && node.url && onToggleMark`; `showMark` → `FlagOff` "Clear Mark", else `Flag` "Mark for Attention"; click → `onToggleMark(node.id)`; hover-only (`opacity-0 group-hover:opacity-100`) like the old Pin button.
- The flag button is hover-only on marked rows too (the ring shows the mark).

## What Goes Where
- Implementation Steps: code and docs in this repo
- Post-Completion: manual check in the browser

## Implementation Steps

### Task 1: Tab row - Mark toggle instead of Pin button

**Files:**
- Modify: `src/components/TabList.tsx`

- [x] remove the hover Pin button from the `actions` block
- [x] move `showMarkItem` above `actions` (keep its incognito comment)
- [x] add the Flag/FlagOff toggle button where Pin was, shown when `showMarkItem`, calling `onToggleMark(tab.id)`, titles "Mark for Attention" / "Clear Mark" (`Flag`, `FlagOff` are already imported)
- [x] leave the `-` close button on a marked tab and the single-tab and multi-selection Pin to Sidebar items unchanged
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Bookmark row - Mark toggle and Pin to Sidebar in the menus

**Files:**
- Modify: `src/components/BookmarkTree.tsx`

- [x] remove the hover Pin button
- [x] add the Flag/FlagOff toggle in its place for `!isFolder && node.url && onToggleMark`, calling `onToggleMark(node.id)`, hover-only; import `Flag`, `FlagOff`
- [x] add **Pin to Sidebar** (`Pin` icon) to the single-bookmark menu (`!isFolder && node.url` block), calling `onPin(node.url, node.title, getFaviconUrl(node.url))` when `onPin` is set
- [x] add **Pin to Sidebar** to the all-bookmarks multi-selection menu when `onPin` is set (pins every selected bookmark via `handlePinSelectedBookmarks`)
- [x] keep the mixed multi-selection menu's `hasSelectedBookmarks && onPin` item
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Verify acceptance criteria
- [x] hovering a tab or bookmark shows a flag button instead of the pin; none on folders or incognito tabs
- [x] the button toggles the mark (same handler as the context menu item)
- [x] Pin to Sidebar is in the context menu of a single tab, a single bookmark and a bookmark multi-selection
- [x] run full checks: `make lint && make test && make build`

### Task 4: [Final] Update documentation
- [x] README.md: Mark for Attention section mentions the flag button on hover; Pinned pages / Tabs bullets describe the hover actions and list Pin to Sidebar in the bookmark right-click menu; the Favorites bullet ("Pin a bookmark or a tab") says to right-click > Pin to Sidebar
- [x] docs/changelog.md: one "Changed" line under Latest Version
- [x] src/data/changelog.ts: one line in the `1.0.352` list
- [x] docs/state-reference.md: no change (no new storage keys)
- [x] move this plan to `docs/plans/completed/` (left in place - the orchestrator moves it)

## Post-Completion
**Manual verification**:
- load the unpacked build, hover a tab and a bookmark, click the flag twice; check the ring appears and goes
- right-click a single bookmark → Pin to Sidebar pins it; select several bookmarks → Pin to Sidebar pins all
- incognito window tab and folder rows show no flag
