# Marked bookmarks stay visible in collapsed folders (#46)

## Overview
- A bookmark marked for attention disappears when its folder is collapsed, unless it has an open tab. Marks are meant to keep an item in view.
- Fix: a collapsed folder, and the collapsed Bookmarks section, show bookmarks that are open (loaded or active) **or marked**.
- The visibility helpers already take a predicate; only the predicates at the call sites change.

## Context (from discovery)
- `src/utils/bookmarkTreeVisibility.ts`: `collectOpenBookmarks(nodes, isOpen)` and `getVisibleBookmarkChildren(folder, isExpanded, isOpen)`; both skip system folders (`isSystemFolder`) at any depth.
- `src/components/BookmarkTree.tsx` call sites:
  - ~line 1013 (`BookmarkTreeNode`): collapsed-folder children, predicate `checkIsLoaded || checkIsActive`. The node already receives `checkIsMarked`.
  - ~line 1281: collapsed Bookmarks section, predicate `isBookmarkLoaded || isBookmarkActive`.
  - ~line 1386: keyboard / range-selection flatten, same predicate. It must match the rows shown, else shift-range selection and arrow navigation skip the marked peek rows.
- `isBookmarkMarked` comes from `useAttentionMarks()` (line ~1107) and is passed to nodes as `checkIsMarked`.
- `hasActivePeek` (folder row highlight) uses `checkIsActive` only - stays as it is.
- `filterLiveTabs` runs after the collapse and drops non-loaded bookmarks - stays as it is.
- Tests: `tests/bookmarkTreeVisibility.test.mjs`.

## Development Approach
- **testing approach**: Regular (code first, then tests)
- Tests only for the decisions that matter (CLAUDE.md "Test decisions, not coverage"): a marked closed bookmark surfaces from a collapsed folder in tree order; a marked bookmark inside a system folder does not.
- Allman braces, comments say why.
- `make lint && make test && make build` must pass.

## Solution Overview
Add one pure helper `staysVisibleWhenCollapsed(isLoaded, isActive, isMarked)` in `src/utils/bookmarkTreeVisibility.ts` that returns the predicate `id => isLoaded(id) || isActive(id) || isMarked(id)`, and use it at all three call sites so they cannot drift apart. Rename `collectOpenBookmarks` to `collectPeekBookmarks` and the helpers' `isOpen` parameter to `staysVisible`; doc comments say "open or marked".

Visible side effect (intended): `hasPeek` becomes true for a collapsed folder whose only peek rows are marked closed bookmarks, so the folder icon state (`resolveArcFolderIconState(..., hasPeek)`) and the collapse `Minus` action follow, as for open peek rows.

## Technical Details
- `getVisibleBookmarkChildren(node, expanded, id => (checkIsLoaded?.(id) || checkIsActive?.(id) || checkIsMarked?.(id)) ?? false)`
- `collectOpenBookmarks(visibleBookmarks, id => isBookmarkLoaded(id) || isBookmarkActive(id) || isBookmarkMarked(id))`
- Flatten at ~1386: same as the section predicate.
- Clearing a mark updates `useAttentionMarks` state, so the tree re-renders and the row leaves the collapsed folder; no extra code.
- No new storage keys.

## What Goes Where
- Implementation Steps: code, tests, docs in this repo.
- Post-Completion: manual check in the browser.

## Implementation Steps

### Task 1: Keep marked bookmarks visible in collapsed folders and the collapsed section

**Files:**
- Modify: `src/utils/bookmarkTreeVisibility.ts`
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `tests/bookmarkTreeVisibility.test.mjs`

- [x] add `staysVisibleWhenCollapsed(isLoaded, isActive, isMarked)` to `src/utils/bookmarkTreeVisibility.ts`; rename `collectOpenBookmarks` → `collectPeekBookmarks` and the `isOpen` parameter → `staysVisible` in it and `getVisibleBookmarkChildren`; update their doc comments and the `VisibleBookmarkChild.isPeek` comment to "open or marked"
- [x] use `staysVisibleWhenCollapsed` at the three call sites in `BookmarkTree.tsx`: collapsed folder in `BookmarkTreeNode` (with `checkIsLoaded`/`checkIsActive`/`checkIsMarked`, optional props default to false), collapsed Bookmarks section and keyboard/range flatten (with `isBookmarkLoaded`/`isBookmarkActive`/`isBookmarkMarked`); check that any `useMemo`/`useCallback` dependency list around these includes `isBookmarkMarked`
- [x] update the comments that become wrong: `isPeek`/`hasPeek` prop comments (~lines 209-210), "Open pages surfaced under a collapsed folder" (~1019), "only the open pages stay" (~1279)
- [x] keep `hasActivePeek` on active only and the `filterLiveTabs` filter unchanged
- [x] test, through `staysVisibleWhenCollapsed` (so removing the mark from it fails the test): a collapsed folder with a marked closed bookmark nested two levels deep and an open one elsewhere returns both in tree order; a marked bookmark inside `asd_Archive` / `asd_Favorites` is not returned (both `getVisibleBookmarkChildren` and `collectPeekBookmarks`)
- [x] run `make lint && make test && make build` - must pass

### Task 2: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented (all three call sites use the mark)
- [x] verify system folders stay skipped and `hasActivePeek` / live-tabs filter are unchanged
- [x] run full checks: `make lint && make test && make build`

### Task 3: [Final] Update documentation
- [ ] `README.md`: line "A collapsed folder still shows its open pages" → open and marked pages; the collapsed Bookmarks section line ("Open pages stay visible") likewise; in the Mark for Attention section add that a marked bookmark stays visible in a collapsed folder and in the collapsed Bookmarks section
- [ ] `docs/changelog.md`: a `Fixed:` line at the top of Latest Version
- [ ] no `src/data/changelog.ts` entry (small fix) and no `docs/state-reference.md` change (no new keys)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
**Manual verification**:
- mark several bookmarks in a folder, keep one open, collapse the folder: all marked ones and the open one stay under the folder row
- clear a mark in the collapsed folder: that row disappears
- collapse the Bookmarks section: marked bookmarks stay
- turn on the live-tabs filter: marked-but-closed bookmarks are hidden
- shift-click range selection across a collapsed folder includes the marked peek rows
