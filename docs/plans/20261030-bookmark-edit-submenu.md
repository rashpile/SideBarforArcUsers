# Bookmark context menu: Arc-style Edit submenu

## Overview
- Issue #11. The single-bookmark context menu (`BookmarkRow` in `src/components/BookmarkTree.tsx`) gets an **Edit** submenu, as in Arc:
  - **Replace Pinned URL with Current** — sets the bookmark URL to the current URL of its live tab with `chrome.bookmarks.update(id, { url })`. The title does not change. Shown only when the bookmark has a live tab (`isLoaded`), like Mute/Unmute.
  - **Edit Pinned Page** — opens the existing edit dialog (`BookmarkEditModal` via `onEdit(node)`), the one `Rename...` opens today.
- `Rename...` is removed from the bookmark menu.
- `src/components/menu/ContextMenu.tsx` has no submenu, so it gets `Sub` / `SubTrigger` / `SubContent` with the same viewport adjustment as `Content`.
- Out of scope: the folder menu, the multi-select menu, PinnedBar icons, keyboard navigation in menus, undo.

## Context (from discovery)
- `src/components/menu/ContextMenu.tsx` — `Root` (open state + cursor position), `Trigger`, `Portal`, `Content` (fixed div at the cursor, clamps to the viewport in an effect, `Overlay` closes on outside click, `useEscapeKey`), `Item` (wraps `MenuBase.Item`, closes the menu after `onSelect`).
- `src/components/menu/MenuBase.tsx` — shared `Item`, `Separator`, `Overlay`, `useEscapeKey`, `menuContainerClass`.
- `src/components/BookmarkTree.tsx` — `BookmarkRow` single-bookmark block (`!isFolder && node.url`): Copy Link, Share, AI Rename, `Rename...` (`onEdit(node)`), Mute/Unmute (`isLoaded`), Duplicate, Move to..., Remove Pin. The container wires `onToggleBookmarkMuted` with `getTabIdForBookmark` from `useBookmarkTabsContext()` (`handleToggleBookmarkMuted`, ~line 2027).
- `src/hooks/useBookmarks.ts` — `updateBookmark(id, title, url?)` always sends the title; `handleError` reports Chrome errors.
- `src/utils/parkedTabAssociation.ts` — `getEffectiveTabUrl(url)` returns a parked tab's original URL.
- Bookmark ↔ tab association is keyed by `bookmark-<id>` → tab id, so changing the bookmark URL keeps the tab associated.
- Tests: `make test` (`node --test tests/*.test.mjs`), `make lint`, `make build`.

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- make small, focused changes
- per CLAUDE.md, write tests for decisions that can act on the wrong item or lose data; skip tests for UI wiring and trivial helpers. Here only the pure menu placement function gets unit tests
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run `make test` and `make lint` after each change
- follow CLAUDE.md code rules: Allman braces, comments say why, no new npm packages, test modules import siblings with `.ts` and touch no `chrome.*` at import time

## Testing Strategy
- **unit tests**: `tests/menuPosition.test.mjs` for the placement function (fits as is; flips left when it overflows on the right; clamps when neither side fits; shifts up when it overflows at the bottom; root menu clamps as `Content` does today)
- **e2e tests**: the project has none
- manual check of the issue's acceptance list in the built extension (Post-Completion)

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- A pure placement module computes where a menu goes inside the viewport. `Content` keeps its current behaviour through it; `SubContent` uses it with the trigger's rectangle as the anchor and a flip to the left side.
- `Sub` holds the submenu's open state in its own React context. `SubTrigger` is an item-styled row with a chevron that opens the submenu on hover and on click without closing the root menu. `SubContent` renders, while open, a fixed-position panel next to the trigger; its children are ordinary `ContextMenu.Item`s, so choosing one runs the action and closes the whole menu.
- Hover handling: leaving the trigger or the panel starts a short close timer (~150 ms); entering either cancels it. This lets the pointer cross the gap between trigger and panel and closes the submenu when the pointer moves to another item of the parent menu.
- The bookmark menu replaces `Rename...` with the Edit submenu. The container gets a `handleReplaceBookmarkUrlWithCurrent(bookmarkId)` that reads the associated tab and writes its effective URL with a URL-only `useBookmarks` method.

## Technical Details
- `src/utils/menuPosition.ts` (pure, no DOM/chrome imports):
  - `MENU_VIEWPORT_MARGIN = 8`
  - `placeMenuAtPoint(point, size, viewport)` → `{ x, y }`: today's `Content` logic (if `x + width > viewport.width` → `x = viewport.width - width - margin`; same for y).
  - `placeSubmenu(anchorRect, size, viewport)` → `{ x, y }`:
    - beside the trigger when one side fits: x = `anchorRect.right`; if `x + width > viewport.width - margin`, x = `anchorRect.left - width`. y = `anchorRect.top`; if `y + height > viewport.height - margin` → `max(margin, viewport.height - height - margin)`.
    - when neither side fits (`anchorRect.left - width < margin`, the usual case in a narrow side panel), the panel must never cover the trigger row: otherwise the hover-opened panel puts "Replace Pinned URL with Current" right under the pointer, and a click meant for "Edit" overwrites the pinned URL. x = `max(margin, viewport.width - width - margin)`; y = `anchorRect.bottom` when `anchorRect.bottom + height <= viewport.height - margin`, else `anchorRect.top - height` (clamped to `>= margin`).
  - plain object arguments (`{ x, y }`, `{ width, height }`, `{ left, right, top, bottom }`), no classes needed for this small pure function.
- `ContextMenu.tsx`:
  - `Content` effect calls `placeMenuAtPoint` (no behaviour change).
  - `Sub` — provider with `isOpen`, `setOpen`, `triggerRef`, `scheduleClose`, `cancelClose`; clears the timer on unmount.
  - `SubTrigger` — `div` with `MenuBase.Item`'s row classes (reuse `BaseItem` with `onSelect` that opens and does not close the root), `ChevronRight` (lucide-react, already a dependency) pushed right with `ml-auto`; `onMouseEnter` → cancel close + open; `onMouseLeave` → schedule close; `aria-haspopup="menu"`, `aria-expanded`.
  - `SubContent` — when open, rendered inside `Content`'s div as a sibling of `SubTrigger` (no portal; `Content` is a `fixed z-50` box with no transform/filter, so a nested `fixed` panel is placed against the viewport and stacks above the root menu's rows). A `div` with `menuContainerClass` and `whitespace-nowrap` (the long label must not wrap and skew the measured width), font size from `useFontSize()`. In a layout effect: render hidden (`visibility: hidden`) at `left: 0, top: 0`, measure, then position with `placeSubmenu(trigger.getBoundingClientRect(), panelSize, viewport)` and show. `onMouseEnter` → cancel close; `onMouseLeave` → schedule close.
  - `SubTrigger` keeps the hover background (`bg-gray-100 dark:bg-gray-700`) while its submenu is open, so the row the panel belongs to stays marked.
  - `[known-limitation]` leaving the whole menu onto the overlay closes the submenu after the ~150 ms delay (native menus keep it open). Intended; no fix needed.
- `useBookmarks.ts`: `updateBookmarkUrl(id, url)` → `chrome.bookmarks.update(id, { url }, () => handleError('update url'))`.
- `BookmarkTree.tsx`:
  - `BookmarkRowProps.onReplaceUrlWithCurrent?: (bookmarkId: string) => void`, passed through the recursive child rendering like `onToggleBookmarkMuted`.
  - Menu, in place of `Rename...`:
    ```
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger><Pencil/> Edit</ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        {isLoaded && onReplaceUrlWithCurrent && <Item onSelect={() => onReplaceUrlWithCurrent(node.id)}>Replace Pinned URL with Current</Item>}
        <Item onSelect={() => onEdit(node)}>Edit Pinned Page</Item>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
    ```
  - Handler: `tabId = getTabIdForBookmark(bookmarkId)`; undefined → return. `chrome.tabs.get(tabId)` in try/catch (tab may be gone) → return on failure. `url = getEffectiveTabUrl(tab.url)`; empty → return. `updateBookmarkUrl(bookmarkId, url)`.

## What Goes Where
- **Implementation Steps**: code, the placement test, docs in this repo
- **Post-Completion**: manual check in Chrome

## Implementation Steps

### Task 1: Pure menu placement function

**Files:**
- Create: `src/utils/menuPosition.ts`
- Create: `tests/menuPosition.test.mjs`
- Modify: `src/components/menu/ContextMenu.tsx`

- [x] create `src/utils/menuPosition.ts` with `placeMenuAtPoint` and `placeSubmenu` as in Technical Details
- [x] switch `Content`'s viewport effect in `ContextMenu.tsx` to `placeMenuAtPoint` (same result as today)
- [x] write tests for `placeSubmenu`: fits to the right; flips left when the right side overflows; moves up when the bottom overflows; when neither side fits, the panel goes below the trigger, or above it when there is no room below, and its rectangle never overlaps the anchor rectangle
- [x] write one test for `placeMenuAtPoint` pinning today's clamp at the right and bottom edges
- [x] run `make test` and `make lint` - must pass before task 2

### Task 2: Submenu components in ContextMenu

**Files:**
- Modify: `src/components/menu/ContextMenu.tsx`

- [x] add `Sub` (open state, trigger ref, delayed close timer cleared on unmount) with its own context
- [x] add `SubTrigger`: item-styled row with `ChevronRight`, opens on hover and on click, does not close the root menu, keeps its highlight while open, `aria-haspopup`/`aria-expanded`
- [x] add `SubContent`: rendered inside `Content`'s div, `whitespace-nowrap`, measured hidden at 0,0, then placed with `placeSubmenu`; hover keeps it open
- [x] confirm `ContextMenu.Item` inside `SubContent` still closes the whole menu (root context) and Escape/overlay close everything
- [x] no unit tests (UI wiring; placement is covered by Task 1); run `make test`, `make lint` and `make build` - must pass before task 3

### Task 3: Edit submenu and Replace Pinned URL with Current in the bookmark menu

**Files:**
- Modify: `src/hooks/useBookmarks.ts`
- Modify: `src/components/BookmarkTree.tsx`

- [x] add `updateBookmarkUrl(id, url)` to `useBookmarks` (URL only, errors through `handleError`) and export it from the hook's return
- [x] add `handleReplaceBookmarkUrlWithCurrent` in the `BookmarkTree` container (association lookup by bookmark id, `chrome.tabs.get` with error handling, `getEffectiveTabUrl`, empty URL → no-op)
- [x] add `onReplaceUrlWithCurrent` to `BookmarkRowProps` and destructure it in `BookmarkRow`; pass it once where the container renders the top-level rows (next to `onToggleBookmarkMuted`, ~line 2666) — child rows already get every handler through `{...props}`
- [x] replace `Rename...` in the single-bookmark menu with the Edit submenu (Replace item only when `isLoaded`; Edit Pinned Page → `onEdit(node)`); folder and multi-select menus unchanged
- [x] no unit tests (Chrome call wiring; the association lookup is existing code); run `make test`, `make lint` and `make build` - must pass before task 4

### Task 4: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented (Edit submenu, Replace only with a live tab, Edit Pinned Page opens the dialog, `Rename...` gone, folder/multi-select menus unchanged)
- [x] verify edge cases: parked tab yields its original URL; closed tab / no association is a no-op; submenu flips/clamps in a narrow side panel
- [x] run full test suite: `make test`
- [x] run `make lint` and `make build`

### Task 5: [Final] Update documentation
- [x] update `README.md` "Bookmarks and pinned pages": describe the bookmark right-click menu including Edit → Replace Pinned URL with Current / Edit Pinned Page
- [x] add a `New:` line to `docs/changelog.md` under "Latest Version"
- [x] add a What's New line to `src/data/changelog.ts` under `'1.0.352'`
- [x] no new storage keys, so `docs/state-reference.md` stays as is
- [x] move this plan to `docs/plans/completed/` (left in place - the orchestrator moves it at the end)

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** in Chrome (`make build`, reload the unpacked extension):
- Open a pinned page, navigate its tab to another URL, right-click the bookmark → Edit → Replace Pinned URL with Current: the bookmark URL equals the tab URL, the title is unchanged, the tab is still shown as the bookmark's live tab.
- A bookmark without a live tab: Edit shows only Edit Pinned Page.
- Edit → Edit Pinned Page opens the edit dialog with title and URL filled in.
- `Rename...` is no longer in the bookmark menu; folder and multi-select menus look as before.
- In a narrow side panel the submenu flips to the left or, when neither side fits, opens below (or above) the Edit row and never covers it; clicking "Edit" never triggers Replace.
