# Compact Archive, Favorites and Space header spacing

## Overview

- The sidebar spends too much height on three places: the collapsed Archive section (about 70px for one line of
  text), the padding around the Favorites grid, and the margins around the Space header (`Home`).
- Tighten the vertical spacing there, "Moderate" level chosen by the user: section header 28px, gaps 4px.
- Pure spacing change: CSS rules in `src/index.css` and two separator classes. No behaviour, no setting, no
  storage key.

## Context (from discovery)

- `src/components/SectionHeader.tsx` renders both the Space title (`SpaceTitle` in `src/App.tsx`) and the Archive
  header (`src/components/ArchiveSection.tsx`), each with `className="arc-space-title"`; its row has the class
  `arc-section-header`, `py-1` and a 2px transparent border (`border-2 border-transparent`).
- `src/index.css` (Arc theme, always on via `.arc-theme` on the App root):
  - `.arc-section-header`: `min-height: 34px`, `padding-top/bottom: 5px !important` (overrides `py-1`);
  - `.arc-space-title`: `margin-top: 4px`, `margin-bottom: 2px`;
  - `.arc-pinned-bar`: `padding: 8px 10px 10px` (overrides `px-2 py-1.5` on the Favorites grid in
    `src/components/PinnedBar.tsx`);
  - `.arc-theme [data-testid="sidebar-scroll-container"]`: `padding: 8px 10px 20px` (the scroll area under the
    Space header; its top padding is the gap between the Space header and the first bookmark).
- `.arc-new-tab-row` in `src/index.css` (`margin-top: 8px`): `+ New Tab` is always the first row of the Tab list
  (`src/utils/arcTabSection.ts`), and the scroll container is plain block flow, so the separator's bottom margin
  collapses with this margin; the gap under a separator is max(separator margin, 8px).
- Separators: `src/components/BookmarkTree.tsx` (under the Bookmarks tree, shown when bookmarks are visible) and
  `src/components/ArchiveSection.tsx` (under the Archive section) both use
  `border-t border-gray-200 dark:border-gray-700 my-2`.
- Header row height today: 22px `...` button (14px icon + `p-1`) + 10px padding + 4px border = 36px, plus 6px of
  margins = 42px.

## Development Approach

- **testing approach**: Regular. No new tests: this is a spacing-only change, and CLAUDE.md says to skip tests
  for looks and UI wiring ("Test decisions, not coverage"). Checks are `make test`, `make build` and `make lint`.
- complete each task fully before moving to the next
- make small, focused changes
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: none added (no logic changes). The existing suite (`make test`) must still pass.
- **build and lint**: `make build` (tsc + vite) and `make lint` must pass.
- **e2e tests**: the project has none.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

- One CSS rule styles both section headers, so the Space title and the Archive header shrink together and stay
  the same height.
- Keep the header's 2px transparent border: horizontally it keeps the header label aligned with tree row text.
  Only vertical padding and margins change.
- Tree rows (36px), the toolbar, the `+ New Tab` row's height and the Favorites tile size stay as they are. Only the
  New Tab row's top margin shrinks, because it collapses with the separator above it (see Technical Details).

## Technical Details

| place | now | after |
|---|---|---|
| `.arc-section-header` | `min-height: 34px`, padding top/bottom `5px !important` | `min-height: 28px`, padding top/bottom `1px !important` |
| `.arc-space-title` | `margin-top: 4px`, `margin-bottom: 2px` | no margins (rule keeps only what else it has; drop the margin lines) |
| `.arc-pinned-bar` | `padding: 8px 10px 10px` | `padding: 6px 10px` |
| scroll container (`.arc-theme [data-testid="sidebar-scroll-container"]`) | `padding: 8px 10px 20px` | `padding: 4px 10px 20px` |
| separator under Bookmarks (`BookmarkTree.tsx`) | `my-2` | `my-1` |
| separator under Archive (`ArchiveSection.tsx`) | `my-2` | `my-1` |
| `.arc-new-tab-row` | `margin-top: 8px` | `margin-top: 4px` (row height 40px unchanged) |

Expected result:

- collapsed Archive block, last bookmark → `+ New Tab`: 4 + 1 + 4 + 28 + 4 + 1 + 4 ≈ 46px (was 8 + 1 + 8 + 36 + 8 + 1 + 8 ≈ 70px;
  today the header's 4px / 2px margins collapse into the separators' 8px);
- the gap under each separator is 4px only with the `.arc-new-tab-row` change: its `margin-top` collapses with the
  separator's bottom margin, so with `my-1` alone it would stay 8px;
- a Space with no bookmarks and no Archive: Space header → `+ New Tab` is 4px scroll padding + 4px margin (was 8 + 8);
- Favorites bottom → Space header → first bookmark: 6px + 1px + 28px + 4px ≈ 39px (was ≈ 61px);
- the expanded Archive search field (input with `py-0.5`, about 24px) still fits: that header is about 30px.

`.arc-space-title` has no other declarations today; if only the margins were in it, remove the whole rule rather
than leave an empty one (the other `.arc-space-title ...` selectors stay).

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): the CSS and class changes, the changelog line, the checks.
- **Post-Completion** (no checkboxes): looking at the sidebar in Chrome.

## Implementation Steps

### Task 1: Tighten section header, Favorites and scroll area spacing in CSS

**Files:**
- Modify: `src/index.css`

- [ ] `.arc-section-header`: `min-height` 34px → 28px; `padding-top` and `padding-bottom` 5px → 1px (keep `!important`)
- [ ] `.arc-space-title`: remove `margin-top: 4px` and `margin-bottom: 2px` (remove the rule if it becomes empty)
- [ ] `.arc-pinned-bar`: `padding: 8px 10px 10px` → `padding: 6px 10px`
- [ ] `.arc-theme [data-testid="sidebar-scroll-container"]`: `padding: 8px 10px 20px` → `padding: 4px 10px 20px`
- [ ] `.arc-new-tab-row`: `margin-top: 8px` → `margin-top: 4px` (keep `min-height: 40px` and `padding-top: 4px`)
- [ ] run `make build` and `make lint` - must pass before task 2

### Task 2: Halve the separator margins around the Archive section

**Files:**
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/components/ArchiveSection.tsx`

- [ ] `BookmarkTree.tsx`: the separator under the tree (`border-t border-gray-200 dark:border-gray-700 my-2`, shown when `hasVisibleBookmarks`) → `my-1`
- [ ] `ArchiveSection.tsx`: the separator at the end of the section → `my-1`
- [ ] leave every other `my-2` separator in the repo (dialogs, toolbar menus) as it is
- [ ] run `make build` and `make lint` - must pass before task 3

### Task 3: Verify acceptance criteria

- [ ] verify every row of the Technical Details table is in place (grep the changed rules and classes)
- [ ] verify nothing else changed: tree row `min-height`, toolbar, `+ New Tab` row height, Favorites tile size (`git diff` shows only the lines above)
- [ ] run full test suite: `make test`
- [ ] run `make build` and `make lint`

### Task 4: [Final] Update documentation

- [ ] `docs/changelog.md`: add a `## Latest Version` section above `## 2.0.387` with one line: `- Changed: the Archive section, the Favorites grid and the Space title take less height - smaller section headers and tighter gaps around them`
- [ ] no `src/data/changelog.ts` entry (a spacing tweak is not worth a What's New line), no README or `docs/state-reference.md` change (no feature or storage key change)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- `make test-build` builds this checkout into the main checkout's `dist/`; reload the extension in Chrome.
- Look at: collapsed and expanded Archive (search field fits, drop ring when dragging a tab onto it), the Space
  title with its hover buttons (search, Recently Closed, `...`), Favorites with one and two rows of tiles, a
  Space without Favorites (Space title right under the toolbar), dark mode, and a large font size setting.
- Expected, and older than this change: when the Favorites tiles exactly fill their last row, the `pinnedBar-end`
  drop placeholder wraps to a new zero-height grid row and adds the 8px grid gap under the tiles (6 + 8 = 14px).
