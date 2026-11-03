# Switch to Space 1–9 shortcuts (#66)

## Overview

- Nine keyboard commands, `space-1` … `space-9`, switch the focused window to the N-th Space of the
  Space bar and bring its tabs forward as a click on that Space does: the Space's most recently used
  tab comes forward, an empty Space gets a New Tab.
- The commands ship without suggested keys (Chrome takes at most 4 per extension and 3 are used). The
  user binds them, for example Control+1 … Control+9 on macOS, in `chrome://extensions/shortcuts`.
- N past the last Space, and the window's active Space, do nothing.

## Context (from discovery)

- `public/manifest.json` `commands`: `_execute_side_panel`, `prev-used-tab`, `next-used-tab` have
  suggested keys; `tab-switcher-next`, `tab-switcher-prev`, `space-switcher-next` have none.
- `src/background.ts`:
  - `openSpace(windowId, spaceId)` (around line 730) brings a Space forward: `stateReady`, then
    `spaceStateManager.setActiveSpace`, then `findLastUsedTab` → `setActiveTabAndSpace`, or
    `chrome.tabs.create` for an empty Space. When the restore failed it only sets the active Space.
  - `chrome.commands.onCommand` (around line 1442) handles the switcher commands via
    `parseSwitcherCommand` and the history commands after `await stateReady`.
  - The Space Switcher finds its window with `chrome.windows.getLastFocused({ windowTypes: ['normal'] })`
    (`src/services/keyboardSwitcher.ts`).
- `src/components/SpaceBar.tsx` renders `spaces.map(...)`, the order of `spaceManager.getSpaces()`.
  `switchToSpace` in `src/contexts/SpacesContext.tsx` sends no `OPEN_SPACE` when the Space is already
  active.
- `src/utils/spaceSelection.ts` `resolveActiveSpaceId(spaces, requestedId)` resolves a stored active
  Space id (deleted or legacy `all` → the first Space).
- Tests: `tests/*.test.mjs`, `node --test`, modules imported with `.ts` extensions (see
  `tests/spaceSelection.test.mjs`).

## Development Approach

- **testing approach**: Regular (code first, then tests)
- Per CLAUDE.md "Test decisions, not coverage": only the decision that picks the Space gets tests
  (an off-by-one or a misparsed command acts on the wrong Space). The manifest entries, the
  background wiring and the docs get no tests.
- complete each task fully before moving to the next
- run `make test` after each code change; `make lint && make test && make build` must pass at the end
- follow CLAUDE.md code rules: Allman braces, comments say why, classes over raw structures

## Testing Strategy

- **unit tests**: `tests/spaceNumberCommand.test.mjs` for `SpaceNumberCommand` (parse + the Space to
  open). No e2e tests in this project.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

A small class `SpaceNumberCommand` in `src/utils/spaceNumberCommand.ts` turns a command name into a
Space position and picks the Space to open. `background.ts` wires it into `chrome.commands.onCommand`:
wait for `stateReady`, find the focused normal window, pick the Space, call the existing `openSpace`.
The decision lives outside `background.ts` because `background.ts` touches `chrome.*` at import time
and can't be imported by tests.

## Technical Details

### `SpaceNumberCommand` (`src/utils/spaceNumberCommand.ts`)

```ts
export class SpaceNumberCommand
{
  #position: number;   // 1-based position in the Space bar

  static parse(command: string): SpaceNumberCommand | undefined

  // Undefined for the window's active Space: the Space bar does nothing for a click on it
  spaceToOpen<T extends SpaceIdentity>(spaces: readonly T[], activeSpaceId: string | null): T | undefined
}
```

- Parse with `/^space-([1-9])$/` (not `space-switcher-next`, not `space-0` or `space-10`).
- `SpaceIdentity` is the `{ id: string }` interface from `src/utils/spaceSelection.ts` (import it
  with the `.ts` extension, as a type import).
- No `position` getter: nothing reads it.
- Comments say why only (CLAUDE.md); no comments that restate the method names.
- No `chrome.*`, no `import.meta.env`, no parameter properties, enums or namespaces (Node type
  stripping); private state in `#` fields set in the constructor.

### `background.ts` wiring

```ts
const spaceNumberCommand = SpaceNumberCommand.parse(command);
if (spaceNumberCommand)
{
  void openSpaceAtPosition(spaceNumberCommand)
    .catch((error) => console.error('[SpaceNumberCommand] failed to switch Space:', error));
  return;
}
```

```ts
async function openSpaceAtPosition(command: SpaceNumberCommand): Promise<void>
{
  await stateReady;
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (win.id === undefined) return;
  const spaces = spaceManager.getSpaces();
  const activeSpaceId = resolveActiveSpaceId(spaces, spaceStateManager.getActiveSpace(win.id));
  const space = command.spaceToOpen(spaces, activeSpaceId);
  if (!space) return;
  await openSpace(win.id, space.id);
}
```

`getLastFocused` rejects when no normal window exists; the `.catch` logs it and nothing happens.

The doc comment on `openSpace` lists its callers ("Used by the Space bar, swipes (OPEN_SPACE) and the
Space Switcher."); add the Switch to Space shortcuts to it.

### Known limitations

- [known-limitation] A Space bar click restores the sidebar's saved scroll position for the Space
  (`applyActiveSpace(spaceId, 'user')`, `src/App.tsx`); a switch started in the background arrives as
  `'navigation'` and doesn't. The Space Switcher behaves the same today; no change.
- [known-limitation] Two quick presses of different numbers each run `openSpace`, and the two runs can
  interleave so the earlier press wins. `OPEN_SPACE` and the Space Switcher have the same window of
  tens of milliseconds; no change.

### Manifest

Nine entries after `space-switcher-next`, no `suggested_key`:

```json
"space-1": { "description": "Switch to Space 1" },
…
"space-9": { "description": "Switch to Space 9" }
```

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code, tests, docs in this repo
- **Post-Completion** (no checkboxes): binding the keys and trying them in Chrome

## Implementation Steps

### Task 1: SpaceNumberCommand: parse a command and pick the Space to open

**Files:**
- Create: `src/utils/spaceNumberCommand.ts`
- Create: `tests/spaceNumberCommand.test.mjs`

- [ ] create `src/utils/spaceNumberCommand.ts` with the `SpaceNumberCommand` class: `static parse(command)` (`/^space-([1-9])$/`) and `spaceToOpen(spaces, activeSpaceId)` as in Technical Details
- [ ] write tests: `space-1` picks the first Space, `space-3` the third; `space-4` with three Spaces → undefined; the active Space's own command → undefined, another position with an active Space → that Space; `activeSpaceId` null → the Space at the position
- [ ] write tests: `parse` returns undefined for `space-0`, `space-10`, `space-switcher-next`, `prev-used-tab`, `Space-1`
- [ ] run `make test` - must pass before task 2

### Task 2: Register space-1 … space-9 and switch Space on the command

**Files:**
- Modify: `public/manifest.json`
- Modify: `src/background.ts`

- [ ] add the nine commands `space-1` … `space-9` ("Switch to Space N", no `suggested_key`) to `public/manifest.json` after `space-switcher-next`
- [ ] add `openSpaceAtPosition(command)` to `src/background.ts` next to `openSpace`, as in Technical Details (import `SpaceNumberCommand`; `resolveActiveSpaceId` is already imported)
- [ ] extend the caller list in `openSpace`'s doc comment with the Switch to Space shortcuts
- [ ] in `chrome.commands.onCommand`, handle `SpaceNumberCommand.parse(command)` before the `(async () => …)()` block: call `openSpaceAtPosition` with a `.catch` that logs, then return
- [ ] run `make lint && make test && make build` - must pass before task 3

### Task 3: Verify acceptance criteria

- [ ] verify all requirements from Overview are implemented: nine commands without suggested keys, N = Space bar position, focused normal window, N past the last Space and the active Space do nothing, `openSpace` used for the switch
- [ ] verify `SpaceNumberCommand.parse` can't match `space-switcher-next` or any other existing command name in `public/manifest.json`
- [ ] run full checks: `make lint && make test && make build`

### Task 4: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`

- [ ] `README.md` § Keyboard: add a row `| not set | Switch to Space 1 … 9: the Space at that position in the Space bar, opened as by a click on it |` after the Space Switcher row
- [ ] `README.md` § Keyboard: under the table, after "Set or change shortcuts in `chrome://extensions/shortcuts`.", add a note in the README's text style (`Control+1`, no manifest key names, no glyphs): `Cmd+1` … `Cmd+9` on macOS and `Ctrl+1` … `Ctrl+9` on Windows and Linux are Chrome's own shortcuts for its tabs, so on macOS use `Control+1` … `Control+9`; macOS takes `Control+1` … `Control+9` for "Switch to Desktop N" when that is on in System Settings > Keyboard > Keyboard Shortcuts > Mission Control, so turn those off first
- [ ] `README.md` § Spaces: extend "Switch with the icons at the bottom or a two-finger swipe." with "or a Switch to Space shortcut (see Keyboard)"
- [ ] `docs/changelog.md` "Latest Version": add a `New:` line for the nine Switch to Space shortcuts (no keys by default, set in `chrome://extensions/shortcuts`, N past the last Space does nothing, the macOS Desktop N note)
- [ ] `src/data/changelog.ts` `'2.0.388'`: add a `New:` What's New line for Switch to Space 1–9 shortcuts set in chrome://extensions/shortcuts
- [ ] `docs/state-reference.md`: no change (no new storage key) - confirm nothing to add
- [ ] run `make lint && make test && make build` - must pass (`src/data/changelog.ts` is code)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- bind Control+1 … Control+3 in `chrome://extensions/shortcuts` (macOS: turn off "Switch to Desktop N" first if it is on); press each: the window switches to that Space, its last used tab comes forward; an empty Space gets a New Tab
- press the shortcut of the active Space: nothing changes
- press a number past the last Space: nothing changes
- with two windows, the shortcut switches the focused window only
