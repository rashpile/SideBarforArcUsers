# Vertical toolbar layout (#69)

## Overview

- The toolbar runs across the top of the panel: Previous / Next used tab, the audio button, Show active tab,
  search, Page agent and the gear Menu (`src/components/Toolbar.tsx`).
- Add a setting **Toolbar: Horizontal (default) / Vertical**. Vertical turns the toolbar into a narrow column of
  icon buttons at the left edge of the panel. The search/filter rows, the Favorites grid, the Space title, the
  tree and the Page agent drawer take the rest of the width; the Space bar stays at the bottom, full width.
- In vertical layout the hold-for-history lists of Previous / Next, the audio list and the gear menu open to the
  right of their button instead of below it.
- Switching the setting changes the layout right away (Settings → Apply), in every window's panel.

## Context (from discovery)

- `src/App.tsx` → `Sidebar()` renders, inside `AppContainer` (`flex flex-col h-screen`): the dialogs, the audio
  `DropdownMenu.Root` (anchored on `audioButtonRef`, content `AudioTabsDropdown`), a `<div ref={toolbarRef}
  className="relative">` wrapping `<Toolbar>` and the gear menu `DropdownMenu.Root` (anchored on `buttonRef`,
  `<DropdownMenu.Content align="end">`), then `PinnedBar`, `SpaceTitleWrapper`, `SwipeableContainer`
  (`flex-1 overflow-hidden`), `PageAgentDrawer` (when `showPageAgent`), `SpaceDialogs`, `SpaceBar`, `Toast`
  (`fixed`), `UnifiedDragOverlay`. `toolbarRef` is attached but never read.
- `src/components/Toolbar.tsx`: root `div.arc-toolbar flex flex-col border-b` holds the button row
  (`flex items-center justify-between px-2 py-1`: left group of buttons and separators, gear on the right) and,
  when `showFilterArea`, the filter rows (input with saved/recent dropdown, Save, syntax help, "With open tabs"
  checkbox). The filter part has its own state (`inputValue`, debounce timer, `sessionRecentEntry`,
  `showDropdown`, `showSyntaxHelp`) and the `focus-filter-input` command listener; it shares nothing with the
  buttons but props.
- Prev / Next history lists: `DropdownMenu.Root` + `DropdownMenu.Content` inside Toolbar, anchored on
  `prevButtonRef` / `nextButtonRef`.
- `src/components/menu/DropdownMenu.tsx` → `Content` places the menu below the trigger (above when the bottom is
  tight), `align: 'start' | 'end'`, and computes `maxHeight`.
- `src/utils/menuPosition.ts` → `placeSubmenu(anchorRect, size, viewport)`: right of the anchor, top-aligned,
  moved up when it overflows the bottom, left side or below/above as fallbacks, never on top of the anchor.
  Covered by `tests/menuPosition.test.mjs`.
- `src/index.css`: `.arc-toolbar` (background, border colour), `.arc-toolbar > div:first-child` (min-height 44px,
  padding 7px 10px: today's button row), `.arc-toolbar button` (radius), dark-mode `.arc-toolbar` background.
- Settings pattern to copy: `src/utils/attentionMarkStyle.ts` (key, default, options, parser), stored in App
  with `useChromeLocalStorage(..., { parse, serialize: v => v })`, `SettingsValues` + temp state + select in
  `src/components/SettingsDialog.tsx` (Appearance tab), applied in App's `handleApplySettings`.
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-vertical-toolbar-layout-option-69-20261104-1235/design.md`.

## Development Approach

- **testing approach**: Regular. No new unit tests: this is layout and settings wiring; nothing here can lose
  data or act on the wrong tab, bookmark or Space, and CLAUDE.md says to skip tests for UI wiring ("Test
  decisions, not coverage"). The right-side placement reuses `placeSubmenu`, already covered by
  `tests/menuPosition.test.mjs`.
- complete each task fully before moving to the next
- make small, focused changes; keep the horizontal layout looking exactly as today
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

- One DOM structure for both layouts, switched by classes, so switching does not remount the tree or the
  filter input:

  ```
  AppContainer (flex-col, h-screen)
    div  (horizontal: flex flex-col / vertical: flex flex-row), flex-1 min-h-0
      Toolbar            (button strip, orientation prop)
      div (flex flex-col flex-1 min-h-0 min-w-0)
        FilterBar        (search rows, only when the search bar is shown)
        PinnedBar
        SpaceTitleWrapper
        SwipeableContainer (tree, flex-1)
        PageAgentDrawer  (when open)
    SpaceDialogs, SpaceBar (full width), Toast, UnifiedDragOverlay
  ```

- The filter rows move out of `Toolbar` into a new `FilterBar` component, because in vertical layout they sit in
  the right column, not under the buttons.
- `DropdownMenu.Content` gets `side?: 'bottom' | 'right'`; `'right'` uses `placeSubmenu`.
- Vertical strip: same buttons, same order, top to bottom; the gear is pushed to the bottom of the strip
  (mirrors its far-right place in the horizontal row); separators become horizontal lines.

## Technical Details

- `src/utils/toolbarLayout.ts`:
  - `export type ToolbarLayout = 'horizontal' | 'vertical';`
  - `export const TOOLBAR_LAYOUT_KEY = 'toolbarLayout';` (chrome.storage.local, raw string)
  - `export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = 'horizontal';`
  - `export function parseToolbarLayout(value: unknown): ToolbarLayout` → `'vertical'` only for exactly
    `'vertical'`, else `'horizontal'`.
  - No `chrome.*`, no `import.meta.env` (Node-safe like the other utils).
- App: `const [toolbarLayout, setToolbarLayout] = useChromeLocalStorage<ToolbarLayout>(TOOLBAR_LAYOUT_KEY,
  DEFAULT_TOOLBAR_LAYOUT, { parse: parseToolbarLayout, serialize: (v) => v });` with a one-line comment that
  it is a raw string like the other appearance settings and only the sidebar reads it.
- `DropdownMenu.Content` with `side === 'right'`: measure the list's full height with `menu.scrollHeight`, not
  the clipped `rect.height` (the `position` state, and with it the inline `maxHeight`, survives between opens
  and starts at 400, so `rect.height` can be cut short). Then
  `height = Math.min(menu.scrollHeight, viewportHeight - 2 * MENU_VIEWPORT_MARGIN)`,
  `{ x, y } = placeSubmenu(triggerRect, { width: rect.width, height }, { width: viewportWidth, height:
  viewportHeight })` and `maxHeight = viewportHeight - MENU_VIEWPORT_MARGIN - y`, so the list never runs past
  the bottom and scrolls inside. `align` is ignored for `'right'`. `'bottom'` keeps today's code path unchanged.
  Review fix: when the list fits neither beside the button (narrow panel), it is cut to the larger of the room
  below and above the button before placing, and `maxHeight` is that height, so it never covers its own button
  (`placeScrollingMenuBesideAnchor` in `src/utils/menuPosition.ts`, tested in `tests/menuPosition.test.mjs`).
- Borders and background in horizontal layout must look as today: today one `.arc-toolbar` box with
  `border-b` wraps the button row and the filter rows. After the split:
  - the button row has `border-b` only while the search bar is hidden;
  - the `FilterBar` root keeps the `arc-toolbar` class (so it inherits the background, the hairline bottom
    border colour, the dark-mode background and the 10px button radius from the existing rules) and carries
    the `border-b`;
  - the min-height and padding of today's button row (`.arc-toolbar > div:first-child`) move to a dedicated
    class `.arc-toolbar-row` on the horizontal Toolbar root; neither FilterBar nor the vertical strip gets it.
- Vertical strip classes: `arc-toolbar arc-toolbar-vertical flex flex-col items-center gap-1 border-r`, its own
  padding and `border-right-color: var(--arc-hairline)` (CSS), gear wrapper `mt-auto`; separators
  `h-px w-4 my-0.5` instead of `w-px h-4 mx-0.5`. The Toolbar root must be a direct child of the layout div,
  so it stretches to the full height and `mt-auto` puts the gear at the bottom.
- In vertical layout `FilterBar` is the first child of the right column, with nothing above it: it gets top
  padding there (prop `orientation`); horizontal stays as today (its rows have only `pb-1.5`).

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code and docs changes in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome by the user

## Implementation Steps

### Task 1: Add the Toolbar layout setting

**Files:**
- Create: `src/utils/toolbarLayout.ts`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/App.tsx`

- [x] create `src/utils/toolbarLayout.ts` with `ToolbarLayout`, `TOOLBAR_LAYOUT_KEY`, `DEFAULT_TOOLBAR_LAYOUT`
      and `parseToolbarLayout` (Technical Details); a short header comment like `attentionMarkStyle.ts` (who
      writes and reads the key)
- [x] `SettingsDialog.tsx`: add `toolbarLayout: ToolbarLayout` to `SettingsValues`, a `tempToolbarLayout` state
      synced on open and passed in `handleApply`, and on the Appearance tab (after Pinned Icon Size) a
      **Toolbar** `<select>` with Horizontal / Vertical and the hint "Vertical puts the toolbar buttons in a
      column at the left edge of the panel", styled like the other selects
- [x] `App.tsx`: read the setting with `useChromeLocalStorage` (Technical Details), pass it in the `settings`
      object of `SettingsDialog`, and call `setToolbarLayout(newSettings.toolbarLayout)` in
      `handleApplySettings`
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Let dropdown menus open to the right of their button

**Files:**
- Modify: `src/components/menu/DropdownMenu.tsx`
- Modify: `src/components/AudioTabsDropdown.tsx`

- [x] `DropdownMenu.Content`: add `side?: 'bottom' | 'right'` (default `'bottom'`); for `'right'` compute the
      position with `placeSubmenu` from the full `scrollHeight` and cap `maxHeight` at the room below the placed
      `y`, as in Technical Details; keep the `'bottom'` path as is;
      add `side` to the effect's dependencies; update the file's header comment
- [x] `AudioTabsDropdown`: add an optional `side` prop and pass it to its `DropdownMenu.Content`
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Move the search/filter rows into FilterBar

**Files:**
- Create: `src/components/FilterBar.tsx`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [x] create `src/components/FilterBar.tsx` with the filter rows moved from `Toolbar.tsx`: input with
      saved/recent dropdown, clear button, Save, syntax help popover, "With open tabs" checkbox, their state,
      handlers, outside-click/Escape effects, the debounce cleanup and the `focus-filter-input` command
      listener. Props: `filterText`, `onFilterTextChange`, `savedFilters`, `recentFilters`, `onSaveFilter`,
      `onDeleteSavedFilter`, `onApplyFilter`, `onUpdateRecent`, `onShowToast`, `filterLiveTabsActive`,
      `onFilterLiveTabsToggle`. Root: `arc-toolbar flex flex-col border-b` (see Technical Details)
- [x] two intended behaviour changes, since FilterBar mounts only while the search bar is shown: the
      session's recent entry (`sessionRecentEntry`) resets when the bar is hidden and shown again, and a
      pending 300 ms debounce is cancelled on hide (today it can set `filterText` again after the bar is
      hidden). Everything else works as before
- [x] `Toolbar.tsx`: remove the moved code and props; the root becomes the button row itself
      (`arc-toolbar arc-toolbar-row flex items-center justify-between`), with `border-b` only while
      `showFilterArea` is false
- [x] `App.tsx`: render `<FilterBar>` right after the toolbar block when `showFilterArea` is true, with the
      props Toolbar used to get
- [x] `index.css`: replace `.arc-toolbar > div:first-child` (min-height 44px, padding 7px 10px) with
      `.arc-toolbar-row`; the other `.arc-toolbar` rules stay and now also style FilterBar, so the horizontal
      layout looks as before with the search bar shown and hidden
      (done as `box-sizing: content-box; min-height: 30px; padding: 7px 10px`: the row now carries its own
      bottom border, and content-box keeps that 1px below the 44px row as before instead of inside it)
- [x] run `make lint && make test && make build` - must pass before task 4

### Task 4: Vertical toolbar strip and the two-column layout

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [x] `Toolbar.tsx`: add `orientation: ToolbarLayout`. Vertical: root `arc-toolbar arc-toolbar-vertical flex
      flex-col items-center border-r` (no `arc-toolbar-row`), the button group a column in the same order,
      separators horizontal, gear wrapper `mt-auto`; Prev / Next `DropdownMenu.Content` get `side="right"`.
      Horizontal unchanged
- [x] `App.tsx`: wrap Toolbar and the content in the structure from Solution Overview (outer `flex-1 min-h-0`
      div, `flex-col` or `flex-row` by `toolbarLayout`; inner column `flex flex-col flex-1 min-h-0 min-w-0`
      holding FilterBar, PinnedBar, SpaceTitleWrapper, SwipeableContainer and PageAgentDrawer); SpaceDialogs,
      SpaceBar, Toast and UnifiedDragOverlay stay after the outer div; the same structure in both layouts
- [x] `App.tsx`: remove the unused `toolbarRef` and its `<div className="relative">` wrapper, so the Toolbar
      root is a direct child of the layout div (it must stretch to the full height for `mt-auto` and the
      strip's background and border); the gear `DropdownMenu.Root` stays next to Toolbar (it renders no DOM of
      its own; `Content` portals to `document.body`)
- [x] `App.tsx`: pass `orientation={toolbarLayout}` to Toolbar and FilterBar, `side="right"` to the gear menu's
      `DropdownMenu.Content` and to `AudioTabsDropdown` when vertical
- [x] `FilterBar.tsx`: add `orientation`; in vertical layout the root gets top padding (about `pt-1.5`), since
      nothing sits above it in the right column; horizontal unchanged
- [x] `index.css`: `.arc-toolbar-vertical` gets narrow padding (about 8px 4px) and
      `border-right-color: var(--arc-hairline)`
- [x] run `make lint && make test && make build` - must pass before task 5

### Task 5: Verify acceptance criteria

- [x] verify every Overview requirement against the code: setting key, default, Settings select, button order
      in both layouts, Space bar at the bottom full width, Prev / Next / audio / gear menus open right in
      vertical, switching applies without reopening (App state + `chrome.storage.onChanged`)
      (key `toolbarLayout`, default `'horizontal'`, raw string; select on the Appearance tab after Pinned Icon
      Size; one button JSX for both layouts, vertical only switches the group to `flex-col` and the gear to
      `mt-auto`; SpaceBar is a child of `AppContainer` after the layout div; Prev / Next get `menuSide`, audio and
      gear get `toolbarMenuSide`; `handleApplySettings` sets App state and `useChromeLocalStorage`'s
      `onChanged` listener updates other windows)
- [x] verify the horizontal layout's DOM classes and CSS give the same look as before (border under the
      filter rows or under the buttons, toolbar background over both)
      (button row: padding 7px 10px and 44px tall as before, `border-b` only with the search bar hidden, 45px
      with its border as the old wrapper; FilterBar: `arc-toolbar` background, hairline `border-b`, `pb-1.5` rows
      and the 10px button radius as before; the two boxes sit edge to edge, so the shared translucent background
      reads as one band; `.arc-toolbar` has no other users)
- [x] run the full checks: `make lint && make test && make build`

### Task 6: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/state-reference.md`

- [x] `README.md` § Settings: add a **Toolbar** bullet: Horizontal (default) or Vertical, a column of the
      toolbar buttons at the left edge; its menus open to the right
- [x] `docs/changelog.md` → "Latest Version": a "New:" entry describing the setting, where it is, what moves
      where, and that menus open to the right
- [x] `src/data/changelog.ts` → `'2.0.388'`: a short What's New line for the setting
- [x] `docs/state-reference.md`: a `### \`toolbarLayout\`` section next to `attentionMarkStyle` (type, raw
      string, default, owner `src/App.tsx` set from SettingsDialog Appearance tab, consumers, parser,
      not read by background, 1 per extension), and a `toolbarLayout   (toolbar layout)` line in the "State
      Architecture" diagram's `chrome.storage.local` list, after `attentionMarkStyle`
- [x] move this plan to `docs/plans/completed/` (skipped - the make-task harness moves the plan after all phases)

## Known limitations

- [known-limitation] While the setting loads (async `chrome.storage.local`), a panel set to Vertical may show the
  horizontal toolbar for a moment on open, as other appearance settings briefly show their default.

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (user, in Chrome):
- this branch lives in a linked worktree: run `make test-build` (builds into the main checkout's `dist/`), then
  reload the extension
- Settings → Appearance → Toolbar: Vertical → Apply: the strip appears at the left without reopening the panel;
  another window's panel follows
- vertical: buttons top to bottom in the same order, gear at the bottom of the strip; search row (with some
  space above it), Favorites, Space title, tree and Page agent drawer to the right; Space bar at the bottom,
  full width
- hold Previous / Next, hold the audio button (with audio quick jump on) or click it, click the gear: each list
  opens to the right of the button; a long history list scrolls inside the viewport. In a panel too narrow for
  a list beside the strip, it opens below (or above) the button instead, never on top of it
- back to Horizontal: the toolbar looks as before, with the search bar shown and hidden, light and dark theme
