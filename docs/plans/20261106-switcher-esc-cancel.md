# Cancel the switchers and the search popup with Cmd+. while the modifier is held (#87)

## Overview

- While the Tab Switcher or Space Switcher list is open and the modifier is still held, the user wants
  to close it without switching; releasing the modifier afterwards must do nothing. The search popup
  uses the same hold-and-press gesture and needs the same.
- A real-key repro (System Events key events into Chrome for Testing with a debug build of this branch,
  separate profile, Tab Switcher on Cmd+E) showed that **Cmd+Esc never reaches the page**: no keydown,
  no keyup, the list stays open, and releasing Cmd then picks the selection. Safari didn't see Cmd+Esc
  either, while Cmd+K reached both: macOS (or another app's global hotkey) takes it before any browser.
  Plain Esc, Ctrl+Esc, Option+Esc, Shift+Cmd+Esc and Cmd+. all reach the page, and plain Esc already
  cancels correctly.
- The extension can't see Cmd+Esc by any route, so the fix adds **Cmd+.** (macOS's standard cancel
  shortcut; Ctrl+. too) as a cancel key in both switchers and in the search popup, keeps Esc, and says
  in the README why Cmd+Esc doesn't work.

## Context (from discovery)

- `src/switcherOverlay.ts`: one classic script (no imports) for the page overlay and for
  `public/switcher.html`, the popup window used on pages the extension can't script (chrome://, New Tab).
  Its window keydown listener maps Esc to `SwitcherList.cancel`, which closes the view and sends
  `switcher-cancel`; a later modifier keyup finds no view and picks nothing.
- `src/services/keyboardSwitcher.ts`: `KeyboardSwitcher.cancel` clears the state, switches nothing and
  closes the popup window. Unchanged.
- `src/searchPopup/searchKeyboard.ts`: `SearchKeyboard.keydown` maps keys to actions; `close` is
  handled in `src/searchPopup/main.ts` (`#close('esc')`) for the frame over the page and the popup
  window alike. Tests in `tests/searchKeyboard.test.mjs`.
- `src/utils/shortcutKey.ts`: `ShortcutKey.parse` / `.code` / `.matches`, `keyCodeOf`.
- The existing test "only the shortcut's exact modifiers make its key a move" expects `NONE` for
  `Command+Period` with a modifier flipped, so a Period that is the shortcut's key (by code) must never
  close.

## Development Approach

- **testing approach**: Regular (code first, then tests).
- Per CLAUDE.md "Test decisions, not coverage": test the key decisions that would act on the wrong tab
  when they break (a cancel key that then lets the release pick, or a shortcut press that closes instead
  of moving). No test for wiring, wording or the overlay's inline listener.
- Complete each task fully before moving to the next; `make test` must pass after each task.

## Testing Strategy

- **unit tests**: `tests/searchKeyboard.test.mjs` for the search popup's key decisions.
- The switcher overlay is a classic injected script with no imports and the tests have no DOM, so its
  change has no automated test; the user checks it by hand (Post-Completion).
- No e2e suite in this project.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- keep the plan in sync with the work done

## Solution Overview

- A key cancels when it is Esc (`event.key === 'Escape'`), or when it is the Period key by code
  (`event.code === 'Period'`) with Cmd or Ctrl held and Period is not the shortcut's own key.
- Matched by `code`, not `key`: with Cmd held, other keyboard layouts (the user switches between en, ru,
  uk and ro) can report another character, and Chrome's shortcuts and `ShortcutKey` match by code.
- Option+. doesn't cancel: it types a character in the search field, and Option+Esc already arrives.
- A shortcut whose key is Period (any modifiers) keeps its meaning: it moves the selection, as the
  overlay's `#repeatKeyCode` check and `SearchKeyboard`'s shortcut match do today.

## Technical Details

### Switcher overlay

- `SwitcherList` gets a boolean method next to `stepForKey`, `cancelsOnKey(event)`: true for Escape, and
  for Period by code with Cmd or Ctrl held when `event.code !== this.#repeatKeyCode`.
- The window keydown listener's first branch becomes ``if (list.cancelsOnKey(event))
  list.cancel(`keydown ${describeKey(event)}`)``, so the reason reads `keydown Cmd+Escape` /
  `keydown Cmd+Period` like the other branches' logs; the rest (Enter, modifier-up commit, steps, log)
  stays as it is, and so do `preventDefault` and `stopImmediatePropagation`.
- A short comment says why Period: on macOS Cmd+Esc often doesn't reach the page (the system or another
  app takes it). The overlay can't import, so the rule is written out; the comment points at
  `SearchKeyboard` as the other copy.

### Search popup

- `SearchKeyboard.keydown`: after the shortcut-match branch, return `{ kind: 'close' }` when
  `event.code === 'Period'`, `event.metaKey || event.ctrlKey`, and the shortcut's key code is not
  `Period` (`this.#shortcut?.code !== 'Period'`).
- Every `close` (Esc and the new Period branch) also sets `#armed = false`, so the modifier's release
  after a close never returns `pick`. Today `main.ts`'s `#finished` is what stops that pick; with this
  the decision lives in the class that has tests, and Esc and Cmd+. behave the same.
- `main.ts` needs no change: `close` already closes the popup in both hosts. The close reason stays
  `'esc'`: `src/services/searchPopup.ts` refocuses the origin window for any reason but `'blur'`, which a
  cancel should do.

## What Goes Where

- **Implementation Steps**: code, tests and docs in this repo.
- **Post-Completion**: manual checks in Chrome with real keys.

## Implementation Steps

### Task 1: Close the search popup with Cmd+. and Ctrl+.

**Files:**
- Modify: `src/searchPopup/searchKeyboard.ts`
- Modify: `tests/searchKeyboard.test.mjs`

- [x] in `SearchKeyboard.keydown`, after the shortcut-match branch, return `{ kind: 'close' }` for
      `code === 'Period'` with Cmd or Ctrl held, unless the shortcut's key code is `Period`; update the
      file's header comment to name Cmd+. as the close key that works with Cmd held
- [x] clear `#armed` on every `close` (Esc and Period), so a release after a close never picks
- [x] test: Cmd+. and Ctrl+. (with the shortcut on `⌥E` and on `⌘E`) return `close`, and after it the
      modifier's release returns `none` even when a shortcut press had armed the pick; the same for
      Cmd+Esc / Esc after an armed press
- [x] test: add `['⌃.', 'Period', { ctrlKey: true }]` to the table of "only the shortcut's exact
      modifiers make its key a move" (it already has `Command+Period`), so a Period shortcut moves and
      Period with any other modifiers neither closes nor moves
- [x] test: plain `.`, Shift+`.` and Option+`.` return `none`
- [x] run `make test` - must pass before Task 2

### Task 2: Cancel the Tab and Space Switcher with Cmd+. and Ctrl+.

**Files:**
- Modify: `src/switcherOverlay.ts`

- [x] add `SwitcherList.cancelsOnKey(event)` next to `stepForKey`: true for Esc, or Period by code with
      Cmd or Ctrl held when Period is not `#repeatKeyCode`
- [x] make the window keydown listener call ``list.cancel(`keydown ${describeKey(event)}`)`` when it is
      true, before the Enter / commit / move branches; keep `preventDefault` and
      `stopImmediatePropagation`
- [x] add the comment on why Period (on macOS Cmd+Esc often doesn't reach the page: the system or another
      app takes it) and that the rule repeats `SearchKeyboard`'s
- [x] no automated test (skipped - classic injected script, no DOM in `node --test`, see Testing Strategy)
- [x] run `make lint && make test` - must pass before Task 3

### Task 3: Verify acceptance criteria

- [x] verify Esc and Cmd+. / Ctrl+. cancel in the overlay code path for both hosts (the page overlay and
      `switcher.html` run the same script) and in the search popup
- [x] verify a shortcut on Period still moves in both
- [x] run `make lint && make test && make build`

### Task 4: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`

- [x] README Keyboard table: the Tab Switcher row says `Esc` or `Cmd+.` closes the list without
      switching; the Space Switcher row says "the same"; add one sentence under the table that on macOS
      Cmd+Esc often doesn't reach Chrome (the system or another app takes it), so with Cmd held use
      `Cmd+.` (`Ctrl+.` with Ctrl)
- [x] README Search popup "Keys" line: `Esc`, `Cmd+.` / `Ctrl+.`, a click outside or switching to another
      app closes it
- [x] `docs/changelog.md` Latest Version: a "Changed" entry for #87 with the repro finding and the new key
- [x] `src/data/changelog.ts` `2.0.388`: one What's New line
- [x] `docs/state-reference.md`: no new storage keys, leave it unchanged
- [x] move this plan to `docs/plans/completed/` (skipped - the harness moves the plan after all phases finish)

## Known limitations

- [known-limitation] Esc or Cmd+. pressed in the few milliseconds between the overlay script's injection
  and the list showing (or before the popup window has loaded) is not seen as a cancel, and the release
  then picks. A millisecond window; CLAUDE.md puts such races here instead of in code.
- [known-limitation] Cmd+. or Ctrl+. bound to a Chrome command (another extension's, the other
  switcher's or the search popup's shortcut, or Next Used Tab on ^. through the user's Karabiner rule)
  runs that command instead of cancelling; with the Space Switcher on ⌘., Cmd+. in the open Tab Switcher
  moves the list.
- [known-limitation] A page whose own capture listener on `window` stops the key before the overlay's
  listener still wins, as for Esc today.

## Post-Completion

**Manual verification** (real keys, Tab Switcher on Cmd+E):
- normal page: Cmd+E, E, Cmd+. → the list closes, the tab stays; releasing Cmd does nothing
- New Tab page and a chrome:// page (popup window): the same, and the window closes
- with Ctrl or Option as the switcher's modifier: hold it, press the key twice, Esc → closes without
  switching (Ctrl+Esc and Option+Esc reach the page)
- Space Switcher: the same gestures
- search popup: open, press the shortcut again, Cmd+. → closes, release does nothing
