# One Vertical toolbar with an expand/collapse toggle, Space buttons on the right (#76)

## Overview

- Settings > Appearance > Toolbar has three values today: Horizontal, Vertical and Vertical big. Merge the two
  vertical ones into one **Vertical** option. A toggle button at the top of the toolbar strip switches the strip
  between collapsed (today's Vertical: narrow icon column) and expanded (today's Vertical big: 111px column with
  a label on each button).
- In Vertical, the Space bar at the bottom of the panel puts the "SPACE" label and the Space buttons at its right
  end, just before the "+" (Create) button (user's decision: the label moves with the buttons).
- Horizontal is unchanged: no toggle, Space bar as today.

## Context (from discovery)

- `src/utils/toolbarLayout.ts`: `ToolbarLayout = 'horizontal' | 'vertical' | 'vertical-big'`,
  `TOOLBAR_LAYOUT_KEY = 'toolbarLayout'`, `DEFAULT_TOOLBAR_LAYOUT`, `parseToolbarLayout` (unknown → `'horizontal'`),
  `isVerticalToolbar` (true for both vertical values).
- `src/App.tsx:927-933`: `useChromeLocalStorage<ToolbarLayout>(TOOLBAR_LAYOUT_KEY, …, { parse: parseToolbarLayout,
  serialize: (v) => v })` gives `[toolbarLayout, setToolbarLayout]`; `toolbarMenuSide`. `App.tsx:1135`:
  `setToolbarLayout(newSettings.toolbarLayout)` on Settings save. `App.tsx:1542`: `toolbarLayout` passed into the
  Settings dialog's `settings`. `App.tsx:1631-1633`: panel flex direction and `<Toolbar orientation=…>`.
  `App.tsx:1861`: `<SpaceBar …>` (no layout prop today).
- `src/components/Toolbar.tsx`: one element tree for all layouts, classes swap; `vertical`, `big`,
  `separatorClass`, `buttonLayoutClass`, `buttonLabel(text)` (label span only when `big`). Buttons: Previous,
  Next, separator, Audio, Active tab, separator, Search, Agent; gear in a `mt-auto` wrapper at the bottom.
- `src/components/SpaceBar.tsx:231-312`: `.arc-space-bar flex items-stretch` row = vertical "SPACE" label
  (`.arc-space-label`) + scroll container (`flex-1 flex items-center gap-1.5 px-1 py-1 overflow-x-auto`,
  `data-dnd-zone="spaceBar"`, `scrollContainerRef`, auto-scroll to the active Space) + Create "+" menu
  (`.arc-create-space`).
- `src/components/SettingsDialog.tsx:325-341`: the Toolbar `<select>` (`tempToolbarLayout`) with three options and
  a help line; `SettingsDialog.tsx:62,101,129` hold and save `tempToolbarLayout`.
- `src/index.css:55-69`: `.arc-toolbar-vertical` (padding, hairline) and `.arc-toolbar-vertical-big`
  (`width: 111px; flex-shrink: 0`).
- Docs: `README.md:320` (Toolbar setting line), `docs/changelog.md` Latest Version "New: Toolbar setting" bullet,
  `src/data/changelog.ts` `'2.0.388'` Toolbar line (2.0.388 is unreleased; package version is 2.0.387),
  `docs/state-reference.md` `### toolbarLayout`.
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-vertical-toolbar-one-layout-with-expand-20261105-1620/design.md`.

## Development Approach

- **testing approach**: Regular. No new unit tests: the change is layout, settings and UI wiring; nothing here
  can lose data or act on the wrong tab, bookmark or Space, and CLAUDE.md says to skip tests for trivial helpers
  and UI wiring ("Test decisions, not coverage"). The new toolbarLayout helpers are trivial.
- complete each task fully before moving to the next
- make small, focused changes; Horizontal must look exactly as today
- follow CLAUDE.md code rules: Allman braces, comments say why, no new npm packages
- **CRITICAL: `make lint`, `make test` and `make build` must pass at the end of every task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: none added (see Development Approach). The existing suite (`make test`) must still pass.
- **build and lint**: `make build` (tsc + vite) and `make lint` must pass.
- **e2e tests**: the project has none. The user checks the layout by hand (Post-Completion).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

- **Keep the `toolbarLayout` key and its three stored values.** `'vertical'` now means Vertical collapsed and
  `'vertical-big'` Vertical expanded. The strip's toggle calls App.tsx's existing `setToolbarLayout` with the
  other vertical value. No new storage key and no migration: a stored `'vertical-big'` shows as Vertical expanded,
  the state persists across panel reopen and follows in other windows through the existing
  `chrome.storage.onChanged` path, and App.tsx stays the one writer of the key.
- **Settings shows two options.** The select's value is `'vertical'` for both vertical stored values. On save,
  choosing Vertical while the current layout is already vertical keeps the current expanded/collapsed value;
  choosing Vertical from Horizontal gives `'vertical'` (collapsed).
- **Toggle at the top of the strip**, before Previous, followed by a separator; rendered in both vertical values,
  never in Horizontal.
- **Space bar right alignment in Vertical** with an auto left margin on the label, not
  `justify-content: flex-end` on the scroll container: `flex-end` in an `overflow-x: auto` container makes the
  leftmost Spaces unreachable once they overflow, while an auto margin collapses to 0 when there is no free space,
  so the overflowing row scrolls as today.

## Technical Details

- `src/utils/toolbarLayout.ts`:
  - `export function toggleVerticalToolbar(layout: ToolbarLayout): ToolbarLayout` — `'vertical'` →
    `'vertical-big'`, `'vertical-big'` → `'vertical'`, `'horizontal'` → `'horizontal'`.
  - `export function toolbarLayoutForChoice(current: ToolbarLayout, choice: ToolbarLayout): ToolbarLayout` for the
    Settings save: `choice === 'vertical' && isVerticalToolbar(current)` → `current`, else `choice`. Called in
    `SettingsDialog.handleApply`, so an expanded strip stays expanded after Save.
  - Header comment: Vertical has a collapsed (`'vertical'`) and an expanded (`'vertical-big'`) strip, switched
    from the strip's own toggle; Settings offers Horizontal and Vertical.
  - `TOOLBAR_LAYOUT_KEY` comment: written by App.tsx, from the Settings dialog and from the strip's toggle; read
    by App.tsx.
- `src/components/Toolbar.tsx`:
  - new optional prop `onToggleExpanded?: () => void`;
  - when `vertical && onToggleExpanded`: first child of the button group is a button with the shared classes
    (`p-1.5 rounded transition-all duration-150 focus:outline-none ${buttonLayoutClass} ${inactiveButtonClass}`),
    16px lucide icon `PanelLeftOpen` when collapsed / `PanelLeftClose` when expanded (both exported by the
    installed lucide-react 0.562.0), `title` "Expand toolbar" / "Collapse toolbar",
    `aria-label` the same, `buttonLabel('Collapse')` (shown only when expanded), then `<div className={separatorClass} />`.
  - Horizontal renders exactly the same elements and classes as today.
- `src/App.tsx`:
  - `<Toolbar … onToggleExpanded={() => setToolbarLayout(toggleVerticalToolbar(toolbarLayout))}>`;
  - Settings save (`App.tsx:1135`) stays as it is: the dialog hands over the resolved value;
  - `<SpaceBar … alignEnd={isVerticalToolbar(toolbarLayout)}>`.
- `src/components/SettingsDialog.tsx`:
  - initial and reset `tempToolbarLayout`: map `'vertical-big'` to `'vertical'` for the select's value;
  - `handleApply`: `toolbarLayout: toolbarLayoutForChoice(settings.toolbarLayout, tempToolbarLayout)`;
  - options: Horizontal, Vertical (remove the Vertical big option);
  - help line: "Vertical puts the toolbar buttons in a column at the left edge of the panel. The button at the top
    of the column widens it and shows a label on each button."
- `src/components/SpaceBar.tsx`, new prop `alignEnd?: boolean`:
  - `alignEnd` false: every class exactly as today;
  - `alignEnd` true: label wrapper gets `ml-auto`; the scroll container drops `flex-1` and gets `min-w-0` (no
    grow, may shrink), so it is only as wide as its icons until they overflow, then it shrinks and scrolls;
  - `data-dnd-zone="spaceBar"`, `scrollContainerRef`, the active-Space auto-scroll, `SortableContext` and the
    Create menu stay as they are.
- `src/index.css`: no change expected (`.arc-toolbar-vertical-big` still drives the expanded width).

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code changes and documentation in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome

## Implementation Steps

### Task 1: Toggle button at the top of the vertical strip

**Files:**
- Modify: `src/utils/toolbarLayout.ts`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`

- [x] in `src/utils/toolbarLayout.ts`, add `toggleVerticalToolbar(layout)` and update the file's header comment
      (`'vertical'` is the collapsed strip, `'vertical-big'` the expanded one, switched from the strip's toggle) and
      the `TOOLBAR_LAYOUT_KEY` comment (written by App.tsx, from the Settings dialog and from the strip's toggle)
- [x] in `src/components/Toolbar.tsx`, add the optional `onToggleExpanded` prop and, in both vertical layouts, a
      first button (before Previous) with the shared button classes, `PanelLeftOpen` / `PanelLeftClose` icon,
      title and aria-label "Expand toolbar" / "Collapse toolbar", label "Collapse" via `buttonLabel`, followed by
      a separator using `separatorClass`; nothing new in Horizontal
- [x] update the comment above `vertical` in `Toolbar.tsx` so it still holds (the toggle is the one element that
      exists only in the vertical layouts; switching collapsed/expanded still remounts nothing)
- [x] in `src/App.tsx`, pass `onToggleExpanded={() => setToolbarLayout(toggleVerticalToolbar(toolbarLayout))}` to
      `Toolbar`
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: One Vertical option in Settings

**Files:**
- Modify: `src/utils/toolbarLayout.ts`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] in `src/utils/toolbarLayout.ts`, add `toolbarLayoutForChoice(current, choice)`: Vertical chosen while the
      current layout is vertical keeps the current value, any other choice is saved as chosen
- [ ] in `src/components/SettingsDialog.tsx`, show `'vertical'` in the select for both vertical stored values
      (initial state and the reset at line ~101), remove the Vertical big option, and replace the help line with:
      "Vertical puts the toolbar buttons in a column at the left edge of the panel. The button at the top of the
      column widens it and shows a label on each button."
- [ ] in `SettingsDialog.handleApply` (line ~129), pass
      `toolbarLayout: toolbarLayoutForChoice(settings.toolbarLayout, tempToolbarLayout)`, so saving Settings with
      Vertical selected leaves an expanded strip expanded and a collapsed one collapsed; `App.tsx:1135` stays as
      it is
- [ ] run `make lint && make test && make build` - must pass before task 3

### Task 3: Space buttons at the right of the Space bar in Vertical

**Files:**
- Modify: `src/components/SpaceBar.tsx`
- Modify: `src/App.tsx`

- [ ] in `src/components/SpaceBar.tsx`, add an optional `alignEnd` prop; when set, give the label wrapper
      (`.arc-space-label`) `ml-auto` and the scroll container `min-w-0` instead of `flex-1`, with a short comment
      on why not `justify-end` (overflowing Spaces would become unreachable); when unset, classes exactly as today
- [ ] keep `data-dnd-zone="spaceBar"`, `scrollContainerRef`, the active-Space auto-scroll, `SortableContext` and
      the Create menu unchanged
- [ ] in `src/App.tsx`, pass `alignEnd={isVerticalToolbar(toolbarLayout)}` to `SpaceBar`
- [ ] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria

- [ ] verify Settings > Toolbar lists Horizontal and Vertical only, and a stored `'vertical-big'` shows Vertical
      selected
- [ ] verify saving Settings with Vertical selected keeps `'vertical-big'` when it was stored, and choosing
      Vertical from Horizontal stores `'vertical'`
- [ ] verify the toggle renders only in the vertical layouts, writes through `setToolbarLayout` (raw string,
      `serialize: v => v`), and Horizontal renders the same elements and classes as before
- [ ] verify the Space bar's classes are unchanged when `alignEnd` is false; with `alignEnd` the label wrapper has
      `ml-auto` and the scroll container `min-w-0` without `flex-1`, and `data-dnd-zone`, `scrollContainerRef` and
      `SortableContext` are unchanged
- [ ] verify `App.tsx` passes `alignEnd={isVerticalToolbar(toolbarLayout)}`, so both vertical values align right
- [ ] run full test suite: `make lint && make test && make build`

### Task 5: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/state-reference.md`

- [ ] `README.md` (~320): the Toolbar setting is Horizontal (default) or Vertical; Vertical puts the buttons in a
      column at the left edge, menus open to the right, the button at the top of the column widens it with a
      label on each button and narrows it again, and the Space buttons sit at the right of the Space bar
- [ ] `docs/changelog.md`: the Toolbar setting is still unreleased, so rewrite its existing "New: Toolbar
      setting" bullet under Latest Version instead of adding a second one: Horizontal or Vertical; the toggle at
      the top of the column switches between the narrow column and the wide one with labels, remembered and
      followed by every window; in Vertical the SPACE label and the Space buttons sit at the right end of the
      Space bar; keep the #74 reference for the wide strip next to the new #76
- [ ] `src/data/changelog.ts`: rewrite the existing `'2.0.388'` Toolbar What's New line the same way (Vertical,
      with a button at the top of the column that widens it with labels, and the Space buttons at the right of the
      Space bar), instead of adding a second line; escape apostrophes as the other entries do (`\'`)
- [ ] `docs/state-reference.md` `### toolbarLayout`: describe `'vertical'` as the collapsed and `'vertical-big'`
      as the expanded Vertical strip; writers: the Settings dialog (Horizontal / Vertical, keeping the expanded
      state) and the strip's toggle, both through App.tsx; add `src/components/SpaceBar.tsx` to consumers (Space
      buttons at the right in both vertical values)
- [ ] update CLAUDE.md only if a new pattern was discovered (none expected)
- [ ] run `make lint && make test && make build` - must pass (`src/data/changelog.ts` is TypeScript)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- `make build`, then reload the extension in Chrome
- Settings > Appearance > Toolbar shows Horizontal and Vertical; a profile that had Vertical big opens with the
  wide strip and Vertical selected
- Vertical: the top button widens the strip (labels appear, "Collapse" on the toggle) and narrows it again; the
  state survives closing and reopening the side panel and follows in another window's panel
- Settings → Apply with Vertical selected does not collapse an expanded strip
- Vertical: the SPACE label and the Space buttons sit at the right of the Space bar, next to "+"; with many
  Spaces the row fills the bar and scrolls, and the first and last Space can be reached; dragging a Space to
  reorder it and dropping a tab onto a Space icon still work
- Horizontal: no toggle, the Space bar looks as before
