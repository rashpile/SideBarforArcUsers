# Vertical big toolbar layout (#74)

## Overview

- The Toolbar setting (Settings > Appearance) has two values: Horizontal and Vertical. Add a third, **Vertical
  big**: the same column at the left edge of the panel as Vertical, three times as wide.
- The extra width holds full-width buttons with an icon and a short text label (user's decision in brainstorm),
  so the buttons read without hovering and the whole row is the click target.
- Horizontal and Vertical keep their behaviour and their stored `toolbarLayout` values. Switching to Vertical big
  applies right away (Settings → Apply), in every window's panel, as the other values do.

## Context (from discovery)

- `src/utils/toolbarLayout.ts`: `ToolbarLayout = 'horizontal' | 'vertical'`, `TOOLBAR_LAYOUT_KEY`,
  `DEFAULT_TOOLBAR_LAYOUT`, `parseToolbarLayout` (unknown values → `'horizontal'`).
- Checks for `=== 'vertical'`:
  - `src/App.tsx:933` `toolbarMenuSide` (gear menu and audio list open to the right),
  - `src/App.tsx:1630` panel flex direction (`flex-row` puts the strip left of the content),
  - `src/components/Toolbar.tsx:66` `vertical` (strip classes, separators, Previous / Next lists to the right,
    gear `mt-auto`),
  - `src/components/FilterBar.tsx:286` top padding of the search rows.
- `src/components/Toolbar.tsx`: one element tree for both layouts, only classes change. Buttons are
  `p-1.5 rounded` with 16px lucide icons (`RotateCcwSquare`, `RotateCwSquare`, `Volume2`, the custom
  `TreeGutterIcon`, `Search`, `Sparkles`, `Settings`); two separators; the gear sits in its own `div` with
  `mt-auto` in the strip.
- `src/index.css`: `.arc-toolbar-vertical { padding: 8px 4px; border-right-color: var(--arc-hairline); }`. The
  strip's width now comes from its content: 4px + 28px button + 4px + 1px border = 37px (Tailwind preflight
  sets `box-sizing: border-box`).
- `src/components/SettingsDialog.tsx:325-340`: the Toolbar `<select>` with Horizontal / Vertical and a help line.
- Docs: `README.md:320` (Toolbar setting line), `docs/changelog.md` "Latest Version", `src/data/changelog.ts`
  `'2.0.388'` (unreleased; package version is 2.0.387), `docs/state-reference.md` `### toolbarLayout`.
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-vertical-big-toolbar-layout-74-20261105-1353/design.md`.

## Development Approach

- **testing approach**: Regular. No new unit tests: the change is layout and settings wiring; nothing here can
  lose data or act on the wrong tab, bookmark or Space, and CLAUDE.md says to skip tests for trivial helpers and
  UI wiring ("Test decisions, not coverage"). `parseToolbarLayout` and `isVerticalToolbar` are trivial helpers.
- complete each task fully before moving to the next
- make small, focused changes; Horizontal and Vertical must look exactly as today
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

- A new stored value `'vertical-big'` and a helper `isVerticalToolbar(layout)` (true for `'vertical'` and
  `'vertical-big'`). The four `=== 'vertical'` checks call the helper, so both vertical layouts share the column,
  the menu side and the filter padding, and a later value cannot be missed in one place.
- `Toolbar` adds `big = orientation === 'vertical-big'`. The element tree stays the same in all three layouts:
  big mode only changes classes and renders a label `<span>` inside each button, so switching the setting
  remounts nothing.
- A CSS class `.arc-toolbar-vertical-big` fixes the strip at 111px (3 × 37px) and keeps it from shrinking.

## Technical Details

- `ToolbarLayout = 'horizontal' | 'vertical' | 'vertical-big'`; stored as a raw string under `toolbarLayout`
  (unchanged key and serializer); `parseToolbarLayout('vertical-big') === 'vertical-big'`, absent and unknown
  values still `'horizontal'`.
- `export function isVerticalToolbar(layout: ToolbarLayout): boolean` in `src/utils/toolbarLayout.ts`.
- Strip in big mode: classes `arc-toolbar arc-toolbar-vertical arc-toolbar-vertical-big flex flex-col
  items-stretch gap-1 border-r ...` (items stretch to the full width instead of `items-center`). The inner button
  group is `flex flex-col items-stretch gap-1`.
- `.arc-toolbar-vertical-big { width: 111px; flex-shrink: 0; }` (border-box: the width includes the 4px side
  padding and the 1px right border from `.arc-toolbar-vertical`).
- Buttons in big mode: add `w-full flex items-center gap-2 text-left` to the existing `p-1.5 rounded ...` classes;
  icons stay 16px. Label: `<span className="text-xs truncate min-w-0">…</span>` rendered only when `big`
  (fixed 12px so the panel font size setting cannot overflow the fixed-width strip). Labels: Previous, Next,
  Audio, Active tab, Search, Agent, Menu. Tooltips (`title`) unchanged.
- Separators in big mode: `h-px w-full bg-gray-300 dark:bg-gray-600 my-0.5` (Vertical keeps the 16px stub).
- The gear's wrapper `div` keeps `mt-auto` in both vertical layouts; in big mode its button is full width with
  the "Menu" label.
- Settings select: `<option value="vertical-big">Vertical big</option>` after Vertical. Help line: "Vertical puts
  the toolbar buttons in a column at the left edge of the panel; Vertical big makes the column three times wider,
  with a label on each button".

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code changes and documentation in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome

## Implementation Steps

### Task 1: Add the `vertical-big` value and route every vertical check through one helper

**Files:**
- Modify: `src/utils/toolbarLayout.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/FilterBar.tsx`

- [x] in `src/utils/toolbarLayout.ts`, add `'vertical-big'` to `ToolbarLayout`, make `parseToolbarLayout` return
      it for the stored string `'vertical-big'` (unknown values still `'horizontal'`), update the file's top
      comment to name the third value, and add `isVerticalToolbar(layout)` (true for `'vertical'` and
      `'vertical-big'`)
- [x] in `src/App.tsx`, use `isVerticalToolbar(toolbarLayout)` for `toolbarMenuSide` (line ~933) and for the
      panel flex direction (line ~1630); update the comment above the flex container if it names only two
      layouts
- [x] in `src/components/Toolbar.tsx`, set `vertical = isVerticalToolbar(orientation)`
- [x] in `src/components/FilterBar.tsx`, use `isVerticalToolbar(orientation)` for `topPadding`; update its
      comment ("the vertical one" → both vertical layouts)
- [x] grep `src/` for any other `'vertical'` comparison on a `ToolbarLayout` and route it through the helper
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Render the wide strip with labelled full-width buttons

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/index.css`

- [x] in `src/components/Toolbar.tsx`, add `big = orientation === 'vertical-big'`; in big mode give the root the
      extra class `arc-toolbar-vertical-big` and `items-stretch` instead of `items-center`, and the inner button
      group `items-stretch`
- [x] in big mode give every toolbar button (Previous, Next, Audio, Show active tab, Search, Page agent, gear)
      `w-full flex items-center gap-2 text-left` and a label `<span className="text-xs truncate min-w-0">`
      rendered only when `big`: Previous, Next, Audio, Active tab, Search, Agent, Menu; keep icons, tooltips,
      handlers, refs and active/inactive classes as they are
- [x] in big mode make both separators full width (`h-px w-full ... my-0.5`); Vertical keeps the 16px stub and
      Horizontal the vertical bar
- [x] update the comment above `vertical` in `Toolbar.tsx` ("Both layouts keep the same elements…"): three
      layouts, and Vertical big only adds the label spans, so switching still remounts nothing
- [x] in `src/index.css`, add `.arc-toolbar-vertical-big { width: 111px; flex-shrink: 0; }` after
      `.arc-toolbar-vertical`, with a comment saying why 111px (3 × the 37px Vertical strip, border-box)
- [x] check that Horizontal and Vertical render the same classes and elements as before (diff the JSX for those
      branches) and that the element tree is the same in all three layouts (labels are the only extra nodes)
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Add Vertical big to the Settings dialog

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

- [x] add `<option value="vertical-big">Vertical big</option>` after Vertical in the Toolbar select
- [x] update the help line: Vertical puts the toolbar buttons in a column at the left edge of the panel; Vertical
      big makes the column three times wider, with a label on each button
- [x] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria

- [ ] verify the select lists Horizontal, Vertical, Vertical big in that order and stores `'vertical-big'` as a
      raw string (same `serialize: v => v` path as the other values)
- [ ] verify `'horizontal'` and `'vertical'` are parsed and rendered as before, and an unknown stored value still
      reads as Horizontal
- [ ] verify all four former `=== 'vertical'` sites go through `isVerticalToolbar`
- [ ] run full test suite: `make lint && make test && make build`

### Task 5: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/state-reference.md`

- [ ] `README.md`: the Toolbar setting line (~320) lists Horizontal (default), Vertical or Vertical big, and says
      Vertical big is the Vertical column three times wider with a label on each button
- [ ] `docs/changelog.md`: the Toolbar setting (#70) is still unreleased, so extend its existing "New: Toolbar
      setting" bullet under Latest Version instead of adding a second one: Horizontal, Vertical or Vertical big,
      plus one sentence on what Vertical big does (#74)
- [ ] `src/data/changelog.ts`: extend the existing `'2.0.388'` Toolbar What's New line with Vertical big (a wider
      column with a label on each button), instead of adding a second line for the same setting
- [ ] `docs/state-reference.md` `### toolbarLayout`: type includes `'vertical-big'`; consumers say the column,
      right-side menus and filter padding apply to both vertical layouts, and Toolbar shows labels in
      `'vertical-big'`
- [ ] update CLAUDE.md only if a new pattern was discovered (none expected)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- run `make test-build` in this worktree (builds into the main checkout's `dist/`, which Chrome loads), then
  reload the extension
- Settings > Appearance > Toolbar > Vertical big → Apply: the strip at the left is about three times as wide as
  Vertical, each button shows its icon and label, the gear with "Menu" sits at the bottom
- Previous / Next hold-for-history lists, the audio list and the gear menu open to the right of their button
- the search rows get the same top padding as in Vertical; the Space bar stays full width at the bottom
- switch Horizontal → Vertical → Vertical big → Horizontal: the search text and the tree scroll position survive
  (nothing remounts); Horizontal and Vertical look as before
- a narrow side panel: the strip keeps its width, labels truncate instead of wrapping
- another window's panel follows the setting
