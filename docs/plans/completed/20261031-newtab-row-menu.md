# `...` menu on the "+ New Tab" row (issue #42)

## Overview
- The "+ New Tab" row shows two hover text buttons, **Archive** and **Clear**. Replace them with one `...` (`MoreHorizontal`) button that opens a menu with **Archive** and **Clear**.
- Archive and Clear keep their behaviour: same tabs (visible ones, marked tabs left open), same close-window confirmation, same Undo.
- Fewer, quieter controls on the row; the menu matches the `...` menus elsewhere (Archive header, `SectionHeader`).

## Context (from discovery)
- `src/components/TabList.tsx`, `DroppableNewTabRow` (around line 561): `TreeRow` inside a right-click `ContextMenu.Root`; `actions` slot renders the two buttons from `onArchiveTabs` / `onClearTabs`. Call site around line 2920 passes `handleArchiveAllTabs` (only with visible tabs and a Space folder) and `handleCloseAllTabs` (only with visible tabs).
- `src/components/SectionHeader.tsx`: click-to-open pattern — `ContextMenu.Root` render prop `{ open, isOpen }`, `menuJustClosedRef` set on mousedown while open so the click closes instead of reopening, `openMenu(rect.right, rect.bottom)`.
- `src/components/menu/ContextMenu.tsx`: `Portal` uses `createPortal` to `document.body`; `Item` supports `disabled` (no `onSelect`, menu stays open).
- `src/index.css` around line 410: `.arc-tab-list-action` (hidden, shown on `.arc-new-tab-row:hover` / `:focus-within`).
- Docs: `README.md` lines 76 and 92; `docs/changelog.md` and `src/data/changelog.ts` unreleased 1.0.352 entry "Archive button next to Clear on the '+ New Tab' row" (package version is 1.0.351).

## Development Approach
- **testing approach**: Regular. Per CLAUDE.md ("test decisions, not coverage") no new unit tests: this is UI wiring and the Archive/Clear handlers are unchanged. Run `make lint && make test && make build` after each task.
- complete each task fully before moving to the next; small, focused changes.
- follow CLAUDE.md code rules (Allman braces, comments say why).

## Solution Overview
- Wrap the row in an outer `ContextMenu.Root` (render prop) for the `...` menu; the existing right-click `ContextMenu.Root` stays inside it around `TreeRow`.
- Only the `...` button goes into `TreeRow`'s `actions` slot. The `...` menu's `ContextMenu.Portal` renders as a sibling of the right-click root, outside `TreeRow`: React synthetic events bubble through portals along the React tree, so a menu inside `TreeRow` would fire the row's New Tab `onClick` when an item is clicked.
- Menu items: `Archive` (icon `Archive`), `Clear` (icon `ArrowDown`), each `disabled` when its handler is undefined. Archive is therefore grayed out with no Space folder; both are grayed out with no visible tabs.
- Button shown on row hover/focus (as the old buttons) and kept visible while its menu is open.
- No `menuJustClosedRef` mousedown trick from `SectionHeader`: while the menu is open its `Overlay` (`fixed inset-0`, `MenuBase.tsx`) covers the button, so a click there closes the menu via the overlay and never reaches the button.

## Technical Details
```
<ContextMenu.Root>                       // "..." menu
  {({ open, isOpen }) => <>
    <ContextMenu.Root>                   // existing right-click menu
      <ContextMenu.Trigger asChild>
        <TreeRow ref={setRefs} ... actions={<button "...">} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Content>{menuContent}</ContextMenu.Content></ContextMenu.Portal>
    </ContextMenu.Root>
    <ContextMenu.Portal><ContextMenu.Content>Archive / Clear</ContextMenu.Content></ContextMenu.Portal>
  </>}
</ContextMenu.Root>
```
- `...` button: `type="button"`, `title` and `aria-label` "Tab list actions", `aria-haspopup="menu"`, `aria-expanded={isOpen}`, `<MoreHorizontal size={14} />`. Handlers: `onPointerDown` → `stopPropagation` (no drag / row press); `onClick` → `stopPropagation`, then `open(rect.right, rect.bottom)`; `onKeyDown` → `stopPropagation` for Enter/Space so the row's `onKeyDown` doesn't open a New Tab (the native button click still fires).
- Button always rendered (so the menu can show disabled items); keep it visible while open via a modifier class/attribute (e.g. `data-open` on the button): the menu overlay takes the row's `:hover`, so this modifier is required.
- Droppable `end-of-list` ref and drop indicators unchanged.

## What Goes Where
- **Implementation Steps**: code and docs in this repo.
- **Post-Completion**: manual check in Chrome.

## Implementation Steps

### Task 1: Replace the Archive/Clear buttons with a `...` menu

**Files:**
- Modify: `src/components/TabList.tsx`
- Modify: `src/index.css`

- [x] in `DroppableNewTabRow`, wrap the existing right-click `ContextMenu.Root` in an outer `ContextMenu.Root` render prop and render the `...` menu's `ContextMenu.Portal` / `Content` as a sibling of the inner root, outside `TreeRow`
- [x] replace the two buttons in `actions` with one `MoreHorizontal` button (always rendered) with the pointerdown/click/keydown handling from Technical Details, opening the menu at the button's bottom-right
- [x] menu items: `<Archive size={14} className="mr-2" /> Archive` with `disabled={!onArchiveTabs}` and `<ArrowDown size={14} className="mr-2" /> Clear` with `disabled={!onClearTabs}`; update the prop comment on `onArchiveTabs` / `onClearTabs` (undefined now disables the item)
- [x] import `MoreHorizontal` from `lucide-react` if not imported; keep `Archive` / `ArrowDown` imports only if still used
- [x] in `src/index.css`, adapt `.arc-tab-list-action` for an icon button and keep it visible while its menu is open (modifier); update the CSS comment (say the menu overlay takes the row's hover); drop rules that only served the text labels
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Verify acceptance criteria
- [x] verify (by code reading; live UI check left to Post-Completion): one `...` button on the row; menu with Archive and Clear; Archive disabled with no Space folder; both disabled with no visible tabs
- [x] verify by reading the code: clicking `...` or a menu item does not trigger the row's New Tab click; Enter/Space on the focused button does not open a New Tab; the row stays the `end-of-list` drop target; right-click menu unchanged (right-click on `...` opens the row's right-click menu, acceptable); Tab from the row reaches `...` and Enter opens its menu, also with an empty Tab list
- [x] run full checks: `make lint && make test && make build`

### Task 3: [Final] Update documentation
- [x] `README.md` line 76: the "+ New Tab" row has a `...` menu with **Archive** and **Clear**; line 92: "Clear and Archive in the '+ New Tab' row's `...` menu"
- [x] `docs/changelog.md`: amend the unreleased "Archive button next to Clear on the '+ New Tab' row" entry to describe the `...` menu with Archive and Clear
- [x] `src/data/changelog.ts`: amend the 1.0.352 entry the same way
- [x] `docs/state-reference.md`: no new storage keys, no change
- [x] move this plan to `docs/plans/completed/` (left to the orchestrator)

## Post-Completion
**Manual verification**:
- hover the "+ New Tab" row: `...` appears; click it: menu with Archive and Clear; pick each, check the Undo toast and that marked tabs stay open
- Space without a bookmark folder: Archive grayed out; empty Tab list: both grayed out
- click `...` again while open: menu closes; dragging a tab onto the row still works
