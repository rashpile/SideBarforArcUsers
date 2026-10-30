# Active bookmark row keeps the same box as other rows (#25)

## Overview
- In Arc mode the active bookmark row is narrower than the other rows and shifted right; a border such as
  the Mark for Attention ring shows it.
- Fix: the active row keeps the same box as the inactive rows at its depth and changes only its
  background and shadow. Favicon and title stay where they are.
- The override depends only on `visualState === 'active'`, not on Arc mode, so the non-Arc open mode's
  active row (no card background) lines up too.

## Context (from discovery)
- `src/components/BookmarkTree.tsx`: `BookmarkRow` sets `activeCardIndentPx = getIndentPadding(depth)` when
  `visualState === 'active'` and passes `style={{ marginLeft: indent, width: calc(100% - indent - 4px), paddingLeft: 0 }}`
  to `TreeRow`.
- `src/components/TreeRow.tsx`: every row gets `paddingLeft: getIndentPadding(depth)` via `getIndentStyle`,
  full width; `style` from the caller overrides it.
- `src/index.css`: `.arc-tree-row-active` sets background and shadow only; `.arc-attention-ring` is
  `inset: 0`, so it follows the row box.

## Development Approach
- **testing approach**: Regular
- No new automated test: layout only, CLAUDE.md says skip tests for UI wiring.
- Checks: `make lint && make test && make build`.

## Solution Overview
Remove the active card override. Content offset stays the same: before, `marginLeft(indent) + paddingLeft(0)`;
after, `paddingLeft(indent)`. The left edge moves to the row's left edge like other rows, the right edge
to full width. Background and shadow come from CSS that is not touched.

Rejected: give every row the Arc card offset. Changes the whole tree's look; not asked for.

## Implementation Steps

### Task 1: Drop the active card's layout override

**Files:**
- Modify: `src/components/BookmarkTree.tsx`

- [x] remove `activeCardIndentPx` and the `style` prop it feeds on the bookmark `TreeRow`; keep the
      `getIndentPadding` import (drop indicator offsets still use it)
- [x] confirm no other code gives the active bookmark row its own margin, width or padding
      (`grep -n "marginLeft\|calc(100% -" src/components/BookmarkTree.tsx`)
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: [Final] Update documentation

**Files:**
- Modify: `docs/changelog.md`

- [x] add under "Latest Version" in `docs/changelog.md`: "Fixed: the active bookmark row now lines up with the
      other rows and is as wide as they are"
- [x] no `README.md`, `docs/state-reference.md` or `src/data/changelog.ts` change (no feature, no storage
      key; `src/data/changelog.ts` omits bug fixes)
- [x] move this plan to `docs/plans/completed/` (left for the orchestrator)

## Post-Completion

**Manual verification**:
- Arc mode, open a bookmark at the top level and one inside a folder: the active row's left and right edges
  match the rows above and below; favicon and title don't move when the row turns active.
- Mark the active bookmark for attention: its ring is as long as the ring on an inactive marked row.
- Light and dark theme: active background and shadow unchanged.
- Non-Arc open mode: the active bookmark row has the same edges as the others.
- Audible active bookmark: speaker icon at the same x as on inactive rows.
- Drag onto or next to the active row: drop line at the same offset as on other rows.
