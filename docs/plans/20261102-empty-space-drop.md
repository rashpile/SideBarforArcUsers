# Drop onto the Space root target stays inside the Space (#55)

## Overview
- In a Space with no bookmarks, dragging a tab up from the Tab list shows no drop target, and the drop
  makes the tab disappear: the bookmark is created next to the Space folder, in its parent, and the tab
  is linked to it, so it leaves the Tab list and the bookmark is outside the Space tree.
- Fix: every drop position on the Space root target means "into the Space folder, appended at the end of
  its top level", for every drag format and for web links dragged in from a page. The root target shows a
  blue insertion line while it is the drop target.
- Result: the drop creates the bookmark inside the Space folder and the tab shows as its open tab, as in
  a Space that already has bookmarks.

## Context (from discovery)
- `src/components/BookmarkTree.tsx`
  - `SpaceRootDropTarget` (~line 985): 10px empty div after the last top-level bookmark, droppable with
    `isFolder: true, isExpanded: true, depth: -1`, no visual state; rendered at ~line 2881.
  - `resolveBookmarkDropTarget` (~line 1615): position for external web-link drags (`useExternalLinkDrop`).
  - `handleBookmarkDrop` (~line 2399): BOOKMARK branch guards only `before` on the Space folder; TAB/URL
    (~2510) and TAB_GROUP (~2574) duplicate a parent/index block whose `else` path inserts next to the
    target, in the target's parent.
  - Drop indicators: `dropTargetId` (unified `overId` without the `bookmark-` prefix),
    `effectiveExternalDropTarget` (web links); `DropIndicators` in `src/components/DropIndicators.tsx`.
- `src/contexts/UnifiedDndContext.tsx`: collision = `pointerWithin`, else `closestCenter`; position from
  `calculateDropPosition` (`src/utils/dragDrop.ts`). A pointer above the root target gives `before`.
- `src/hooks/useExternalLinkDrop.ts` `createBookmarkAtTarget`: `before`/`after` insert in the target's parent.
- `src/index.css:391` `.arc-space-root-drop-target { min-height: 10px; }`.
- Test pattern: pure modules under `src/utils/` imported with `.ts` by `tests/*.test.mjs`
  (e.g. `tests/newFolderSelection.test.mjs`).

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- make small, focused changes
- tests cover the placement decision (CLAUDE.md "Test decisions, not coverage"): a drop that resolves to
  the wrong parent moves user data out of the Space. No tests for the indicator or the wiring
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- follow CLAUDE.md code rules: Allman braces, comments say why, classes over raw structures, no
  `import.meta.env` and no `chrome.*` in modules imported by tests, no TS-only runtime syntax there

## Testing Strategy
- **unit tests**: `tests/bookmarkDropPlacement.test.mjs` for the pure helper (`make test`)
- **e2e tests**: the project has none
- checks: `make lint && make test && make build`

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- One rule, in one pure helper: a drop whose target is the Space folder itself is `into` that folder,
  whatever position the pointer gave. The root target sits after the last top-level bookmark, so
  appending matches where it is on screen. This also replaces the latent `intoFirst` case (bottom 25% of
  the root target put the item at the top of a non-empty Space).
- The same helper resolves `{ parentId, index }` for creating bookmarks, replacing the duplicated block in
  the TAB/URL and TAB_GROUP branches. The BOOKMARK branch and the external web-link resolver use the
  position rule.
- The root target gets a visual state: a top-level blue insertion line at its top edge while it is the
  drop target. No height change, no new droppable, no Space title highlight.
- Alternatives dropped: a fixed position in `DropData` honored by `UnifiedDndContext` (misses the external
  web-link path and still leaves the handler trusting the position); making the Space title a droppable
  (a second target for the same folder, does not fix the handler).

## Technical Details
- New module `src/utils/bookmarkDropPlacement.ts`:
  - `spaceRootDropPosition(targetId, position, spaceFolderId)`: returns `'into'` when `spaceFolderId` is
    non-null and equals `targetId`; otherwise returns `position` unchanged. Types: `targetId: string`,
    `position: NonNullable<DropPosition>` (the literal union `'before' | 'after' | 'into' | 'intoFirst'`,
    never `null`: callers narrow first), `spaceFolderId: string | null | undefined`.
  - `class BookmarkDropPlacement` with fields `parentId: string` and `index: number | undefined`
    (`undefined` = append at the end; Chrome appends when `index` is omitted), assigned in the
    constructor body (no parameter properties), and
    `static resolve(targetId, targetNode, position, isFolder, spaceFolderId)`:
    - `targetNode`: `{ parentId?: string; index?: number } | null` (from `getBookmark`)
    - target is the Space folder (`spaceFolderId` non-null and equal to `targetId`) →
      `new BookmarkDropPlacement(targetId, undefined)` first, whatever `position` and `isFolder` are, so
      the Space-root guarantee does not depend on the caller's `isFolder` flag
    - `into` and `isFolder` → `new BookmarkDropPlacement(targetId, undefined)`
    - `intoFirst` → `new BookmarkDropPlacement(targetId, 0)`
    - otherwise, when `targetNode?.parentId` and `targetNode.index` are defined →
      parent `targetNode.parentId`, index `targetNode.index` for `before`, `targetNode.index + 1` else
    - otherwise → `new BookmarkDropPlacement(targetId, undefined)` (today's fallback)
  - `DropPosition` from `src/utils/dragDrop.ts` may be imported as a type only (`import type`, `.ts` extension).
- `handleBookmarkDrop`:
  - BOOKMARK: `const movePosition = spaceRootDropPosition(targetId, position, spaceFolder?.id)`; use it for
    `moveBookmark` of the first item and for the auto-expand check; delete the
    `targetId === spaceFolder.id && position === 'before'` guard.
  - TAB/URL and TAB_GROUP: `const targetNode = await getBookmark(targetId)` then
    `const placement = BookmarkDropPlacement.resolve(targetId, targetNode, position, !!dropData.isFolder, spaceFolder?.id)`;
    `parentId = placement.parentId`, `index = placement.index`. The TAB/URL loop already increments `index`
    only when defined, so several tabs keep drag order when appending. `findSpaceForFolder(parentId)`, the
    tab association and `onBookmarkCreated` stay as they are.
- `resolveBookmarkDropTarget`: after the position is final (including the expanded-folder `intoFirst`
  step), `position = spaceRootDropPosition(bookmarkId, position, spaceFolder?.id)` (skip when `position`
  is null) before the auto-expand logic, so `createBookmarkAtTarget` gets `into` for the root.
- `SpaceRootDropTarget({ node, isDropTarget })`: while `isDropTarget`, render a 2px blue line at the top
  edge, left 0 (reuse `DropIndicators` with `showBefore` or the same classes); the div gets `relative`
  positioning. Caller passes
  `isDropTarget={dropTargetId === spaceFolder.id || effectiveExternalDropTarget?.bookmarkId === spaceFolder.id}`.

## What Goes Where
- **Implementation Steps**: code, tests and docs in this repo
- **Post-Completion**: manual check in Chrome

## Implementation Steps

### Task 1: Pure drop placement helper

**Files:**
- Create: `src/utils/bookmarkDropPlacement.ts`
- Create: `tests/bookmarkDropPlacement.test.mjs`

- [x] create `src/utils/bookmarkDropPlacement.ts` with `spaceRootDropPosition` and `BookmarkDropPlacement.resolve` as in Technical Details (no `chrome.*`, no `import.meta.env`, Allman braces, a short why-comment on the Space root rule)
- [x] write tests: `spaceRootDropPosition` returns `'into'` for each of `before`, `after`, `into`, `intoFirst` when `targetId === spaceFolderId`, and the position unchanged for any other target
- [x] write tests: `before`, `after`, `intoFirst`, `into` on the Space root resolve the parent to the Space folder (never the Space folder's parent) and index `undefined`, with `isFolder` both true and false
- [x] write tests: `before`/`after` on a regular bookmark → its parent with index / index + 1; `into` on a regular folder → that folder, index `undefined`; `intoFirst` on a regular folder → index 0
- [x] write tests: `spaceFolderId` null or undefined → positions pass through unchanged (a `before` on a folder goes next to it); missing target node → falls back to the target id as parent
- [x] run `make test` - must pass before task 2

### Task 2: Use the helper in the bookmark drop paths

**Files:**
- Modify: `src/components/BookmarkTree.tsx`

- [ ] BOOKMARK branch of `handleBookmarkDrop`: move with `spaceRootDropPosition(targetId, position, spaceFolder?.id)` and use that position for the auto-expand check; delete the old `before`-on-Space-folder guard
- [ ] TAB/URL branch: replace the parent/index block with `BookmarkDropPlacement.resolve(...)`
- [ ] TAB_GROUP branch: replace the same block with `BookmarkDropPlacement.resolve(...)`
- [ ] `resolveBookmarkDropTarget`: normalize the final position with `spaceRootDropPosition(bookmarkId, position, spaceFolder?.id)` and add `spaceFolder?.id` to its dependency list
- [ ] no new tests: wiring only, the decision is tested in Task 1 (CLAUDE.md)
- [ ] run `make lint && make test` - must pass before task 3

### Task 3: Visible drop target on the Space root

**Files:**
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/index.css` (only if the line needs CSS beyond Tailwind classes)

- [ ] add an `isDropTarget` prop to `SpaceRootDropTarget`; while true, render a top-level 2px blue insertion line at its top edge (same look as `DropIndicators` before-line); make the div `relative`
- [ ] pass `isDropTarget` from the render site: `dropTargetId === spaceFolder.id || effectiveExternalDropTarget?.bookmarkId === spaceFolder.id`
- [ ] keep the idle layout unchanged (no height change)
- [ ] no new tests: UI wiring (CLAUDE.md)
- [ ] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria
- [ ] verify: a drop on the Space root target with any position, for BOOKMARK, TAB, URL and TAB_GROUP, resolves the parent to the Space folder (read the three branches and `resolveBookmarkDropTarget` against the helper)
- [ ] verify: the root target shows the insertion line for internal drags and external web-link drags
- [ ] verify: drops on regular rows (before/after/into/intoFirst) behave as before
- [ ] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation
- [ ] `docs/changelog.md`: add a "Fixed:" line at the top of Latest Version - dragging a tab, tab group or link into a Space with no bookmarks shows a drop line and saves it in the Space; it no longer lands next to the Space folder and vanishes from the Tab list. Also say that a drop in the empty area under the last bookmark now adds it at the end of the Space, not at the top
- [ ] `README.md`: extend "Drag a tab onto the tree to bookmark it" to say it also works in an empty Space, onto the area under the Space title
- [ ] no `docs/state-reference.md` change (no storage keys) and no `src/data/changelog.ts` entry (bug fix only)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- Empty Space: drag a tab from the Tab list up under the Space title → blue line shows; drop → the bookmark
  appears in the Space with the tab as its open tab; nothing new in the folder above the Space folder
- Non-empty Space: drag a tab into the gap under the last bookmark → line under the last top-level row;
  drop appends at the end of the top level
- Drag a tab group and a web link from a page into an empty Space → folder / bookmark inside the Space.
  A web link must be dropped right under the Space title, where the blue line appears (see known limitation)
- Bookmarks created next to Space folders by the old bug stay where they are; move them by hand

**Known limitations**:
- [known-limitation] Web links dragged in from a page find their target with `document.elementsFromPoint`
  and have no `closestCenter` fallback, so in an empty Space they hit the root target only over its 10px
  strip under the Space title. Dropped over the Space title itself nothing is created (no data loss).
