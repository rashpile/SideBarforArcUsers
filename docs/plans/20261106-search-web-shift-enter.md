# Search the web from the search popup with Shift+Enter (#86)

## Overview

- When the search popup's field has text, Shift+Enter opens a new tab that searches the web for that
  text with the user's default search engine, and the popup closes. It is the way out when the tabs,
  bookmarks, Archive and Recently Closed don't hold what the user wants.
- Enter still opens the selected result. Shift+Enter with an empty or whitespace-only field does
  nothing.
- A footer hint "Search the web ⇧↵" (`Shift+Enter` off macOS) shows while the field has text; a click
  on it runs the same search.
- The new tab opens in the window the popup was opened from and joins that window's active Space, like
  any new tab.
- URL-like text is searched too; it is never opened as an address.

## Context (from discovery)

- `src/searchPopup/searchKeyboard.ts`: `SearchKeyboard.keydown(event)` maps keys to `SearchKeyAction`;
  `Enter` always returns `{ kind: 'pick' }` (line 66), Shift is not checked.
- `src/searchPopup/main.ts`: `SearchPopupView` (DOM; the Spaces toggle is a button with a `<kbd>` hint,
  `spacesHint` picks `⌥A` / `Alt+A` by `navigator.userAgent`), `SearchPopupPage` (port, query,
  selection; `#finished` keeps a second pick or close from following the first; `#pick`, `#close`,
  `#send`). `keepFocusOnPress` keeps the focus in the field on clicks.
- `search.html`: `.panel` holds `.query`, `.scopes`, `.list`, `.empty`. `src/searchPopup/searchPopup.css`
  styles them; `.spaces` / `.spaces-hint` are the pill-with-key-hint precedent.
- `src/utils/searchPopupMessages.ts`: `SearchPageMessage` (page → background over the port).
- `src/services/searchPopup.ts`: `SearchPopup.#handleMessage` routes page messages; `#pick` calls
  `#finish(session, true)` (removes the overlay, or refocuses the origin window and removes the popup
  window), then the picker with `session.originWindowId`. `SearchPopupDeps` holds `buildCandidates`,
  `picker`, `newSessionId`, `debug`.
- `src/background.ts:858`: `new SearchPopup({...})`. `tabs.onCreated` (line 1383) registers every new
  tab to the window's active Space after `stateReady` (`resolveActiveSpaceId` +
  `tabSpaceRegistry.register`); `openSpace` and the Tab Switcher's `openNewTab` rely on it for
  `chrome.tabs.create({ windowId, active: true })`.
- `@types/chrome` has `chrome.search.query({ text, tabId? , disposition? })`; `tabId` and
  `disposition` can't be combined. Chrome's docs don't say which window `NEW_TAB` uses.
- `public/manifest.json` `permissions` has no `search` yet. Chrome's permission list shows no install
  warning for `search`.
- Tests: `tests/searchKeyboard.test.mjs` (`key()` helper builds key events), `tests/searchPopup.test.mjs`
  (`harness(t, { showsOverlay })` fakes chrome and builds `SearchPopup`; `FakePort.send` delivers a
  page message; `flush()` lets promise chains finish; `sent` records `tabs.sendMessage` calls).
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-search-the-web-from-the-search-popup-wit-20261106-1908/design.md`.

## Development Approach

- **testing approach**: Regular (code first, then tests). Tests only for the decisions: which key does
  what (`SearchKeyboard`, including Enter with the shortcut's modifiers held staying a pick), and that
  background searches from the origin window (`SearchPopup`), since a search instead of the picked row
  or in the wrong window is the failure that matters. No tests for the hint, CSS, `background.ts` wiring or docs (CLAUDE.md "Test decisions, not
  coverage").
- complete each task fully before moving to the next
- make small, focused changes
- follow CLAUDE.md code rules: Allman braces, classes over raw structures, comments say why, no new npm
  packages, debug logging only behind the existing `debug` flag
- modules imported by tests: `.ts` extensions on sibling imports, no `chrome.*` or `import.meta.env` at
  import time, no enums / parameter properties / namespaces
- **CRITICAL: `make lint`, `make test` and `make build` must pass at the end of every task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: `tests/searchKeyboard.test.mjs` (Task 1), `tests/searchPopup.test.mjs` (Task 2).
- **build and lint**: `make build` (tsc + vite) and `make lint`.
- **e2e tests**: the project has none. The user checks the popup by hand (Post-Completion).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

- The page decides the key: `SearchKeyboard.keydown(event, text)` returns a new
  `{ kind: 'searchWeb' }` for Shift+Enter (Shift alone, no Cmd, Ctrl or Alt) when `text.trim()` is
  non-empty, `none` for that key with a blank field, and `pick` for every other Enter, as now. Enter
  with the shortcut's modifiers still held (`Ctrl+Shift+K` cycles rows, then Enter before letting go)
  stays a pick of the row the user moved to.
- The page sends `{ type: 'searchWeb', text }` over its port, once (`#finished`).
- Background's `SearchPopup` closes the popup as a pick does (`#finish(session, true)`), then calls a
  new dependency `searchWeb(originWindowId, text)`.
- `background.ts` implements it with `chrome.tabs.create({ windowId, active: true })` and then
  `chrome.search.query({ text, tabId })`. A tab of our own pins the search to the origin window: Chrome
  doesn't document which window `disposition: 'NEW_TAB'` uses, and with the popup in its own window or
  an incognito origin it could land elsewhere. `tabs.onCreated` puts the tab in the window's active
  Space. If `search.query` fails (no default search provider), the user is left on a New Tab page; the
  error is logged.
- The `search` permission joins the manifest; it has no install warning, so the update doesn't disable
  the extension.

## Technical Details

- `SearchKeyAction` gains `| { kind: 'searchWeb' }`.
- `SearchKeyboard.keydown(event: SearchKeyEvent, text: string): SearchKeyAction` (required, so tsc
  catches a caller that forgets the text): in the switch, `case 'Enter'` →
  `if (event.shiftKey && !holdsShortcutModifier(event)) return text.trim() ? { kind: 'searchWeb' } : NONE;`
  then `return { kind: 'pick' };`. The `isComposing` early return stays first. The text is a parameter,
  not a field of `SearchKeyEvent`, because it comes from the input, not the event. The `.mjs` tests are
  not type-checked; existing calls without text still work for keys other than Shift+Enter.
- `SearchPageMessage` gains `| { type: 'searchWeb'; text: string }`.
- `SearchPopupDeps` gains `searchWeb(windowId: number, text: string): Promise<void>;` with a comment that
  it opens a new tab in that window and searches the web for the text with the default engine.
- `SearchPopup.#handleMessage`: `case 'searchWeb': void this.#searchWeb(session, message.text); break;`.
  `#searchWeb(session, text: string)`: `const query = text.trim();` `if (!query) return;` (session kept;
  the page never sends blank text, the guard is cheap), `this.#log('search the web')`, `await this.#finish(session, true)`,
  then `try { await this.#deps.searchWeb(session.originWindowId, query); } catch (error) { console.error('[SearchPopup] failed to search the web:', error); }`.
- `background.ts`, in the `new SearchPopup({...})` deps:
  ```ts
  searchWeb: async (windowId, text) =>
  {
    // NEW_TAB leaves the window to Chrome; a tab of our own keeps the search in the window the popup
    // was opened from. onCreated puts it in that window's active Space.
    const tab = await chrome.tabs.create({ windowId, active: true });
    if (tab.id === undefined) return;
    await chrome.search.query({ text, tabId: tab.id });
  },
  ```
- `main.ts`:
  - `#handleKeydown`: `this.#keyboard.keydown(event, this.#view.input.value)`; `case 'searchWeb': this.#searchWeb(); break;`.
  - `#searchWeb()`: `const text = this.#view.input.value.trim(); if (!text || this.#finished) return; this.#finished = true; this.#send({ type: 'searchWeb', text });`.
  - `SearchPopupViewHandlers` gains `onSearchWeb(): void`. `SearchPopupView` takes the footer button
    `.web-search` and its `.web-search-hint` (`⇧↵` on Mac, `Shift+Enter` elsewhere, same
    `navigator.userAgent` test as `spacesHint`), `keepFocusOnPress`, click → `handlers.onSearchWeb()`,
    and `renderWebSearch(hasText: boolean)` sets `hidden`.
  - The `input` listener also calls `this.#view.renderWebSearch(input.value.trim() !== '')`; the
    constructor renders it once (hidden).
- `search.html`: after `.empty`, the button alone as a direct child of `.panel` (no wrapper, so
  `hidden` takes it out of the flex layout and leaves no stray gap):
  `<button class="web-search" type="button" tabindex="-1" hidden>Search the web <kbd class="web-search-hint"></kbd></button>`.
- `searchPopup.css`: the button styled like `.spaces` (pill, 26px high, `border: 1px solid var(--border)`,
  `font-size: 12px`, `:hover` background), right-aligned with `align-self: flex-end`, `flex: none`; the
  hint like `.spaces-hint`.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code, tests, docs in this repository.
- **Post-Completion** (no checkboxes): manual checks in Chrome.

## Implementation Steps

### Task 1: Shift+Enter key decision in SearchKeyboard

**Files:**
- Modify: `src/searchPopup/searchKeyboard.ts`
- Modify: `src/searchPopup/main.ts` (the `keydown` call only)
- Modify: `tests/searchKeyboard.test.mjs`

- [ ] add `{ kind: 'searchWeb' }` to `SearchKeyAction` and the required `text: string` parameter to `keydown`; pass `this.#view.input.value` at its one caller in `src/searchPopup/main.ts` (`#handleKeydown`) so the build passes
- [ ] `Enter` with Shift and no Cmd, Ctrl or Alt → `searchWeb` when `text.trim()` is non-empty, else `none`; every other `Enter` → `pick` (unchanged); update the file's header comment if it lists the keys
- [ ] test: Shift+Enter with text → `searchWeb`; Enter with and without text → `pick`; Enter with `{ shiftKey: true, ctrlKey: true }` (and with `metaKey`) and text → `pick`
- [ ] test: Shift+Enter with `''` and with whitespace-only text → `none`; Shift+Enter while composing → `none`
- [ ] run `make lint && make test && make build` - must pass before Task 2

### Task 2: Background web search from the origin window

**Files:**
- Modify: `src/utils/searchPopupMessages.ts`
- Modify: `src/services/searchPopup.ts`
- Modify: `src/background.ts`
- Modify: `public/manifest.json`
- Modify: `tests/searchPopup.test.mjs`

- [ ] add `{ type: 'searchWeb'; text: string }` to `SearchPageMessage`
- [ ] add `searchWeb(windowId, text)` to `SearchPopupDeps` and the `'searchWeb'` case with `#searchWeb(session, text)` in `SearchPopup` (blank or non-string text ignored with the session kept; otherwise `#finish(session, true)`, then `deps.searchWeb(session.originWindowId, text.trim())`, errors logged); update the file's header comment
- [ ] implement the `searchWeb` dependency in `background.ts` (`tabs.create` in the window, then `search.query` with its `tabId`)
- [ ] add `"search"` to `permissions` in `public/manifest.json`
- [ ] extend the test harness with a recording `searchWeb` dependency and record `windows.remove` calls; test: an overlay popup's `searchWeb` message removes the frame, ends the session (port disconnected) and searches once with `ORIGIN_WINDOW` and the trimmed text
- [ ] test: a popup-window session's `searchWeb` closes `POPUP_WINDOW` and searches in `ORIGIN_WINDOW`, not the popup window
- [ ] run `make lint && make test && make build` - must pass before Task 3

### Task 3: Page wiring and the "Search the web" hint

**Files:**
- Modify: `src/searchPopup/main.ts`
- Modify: `search.html`
- Modify: `src/searchPopup/searchPopup.css`

- [ ] handle the `searchWeb` action in `#handleKeydown` with `#searchWeb()` (trimmed text, once, sets `#finished`, sends the message)
- [ ] add the `.web-search` footer button with its key hint (`⇧↵` on Mac, `Shift+Enter` elsewhere) to `search.html`, wire it in `SearchPopupView` (`keepFocusOnPress`, click → `onSearchWeb`, `renderWebSearch(hasText)`)
- [ ] show the button only while the trimmed field is non-empty (on `input`, and hidden at start)
- [ ] style it in `searchPopup.css` like the Spaces pill, right-aligned, light and dark
- [ ] run `make lint && make test && make build` - must pass before Task 4

### Task 4: Verify acceptance criteria

- [ ] Shift+Enter with text sends one `searchWeb` and closes the popup; Enter still picks; Shift+Enter with a blank field does nothing (by reading the code paths and the tests)
- [ ] the search tab is created in the origin window, never the popup window, and no code registers it to a Space by hand (onCreated does)
- [ ] the hint shows only with text and its click does what Shift+Enter does
- [ ] run the full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation

- [ ] `README.md` § Search popup: Shift+Enter searches the web with the default search engine in a new tab in the current window and Space, the hint, empty field does nothing; permissions table row for `search`
- [ ] `docs/chrome-web-store-info.md`: permission justification for `search` (search the web with the user's default search engine for the text typed in the search popup, only on Shift+Enter or a click on Search the web)
- [ ] `PRIVACY.md` External Services: the text goes to the browser's default search engine, through Chrome, only on Shift+Enter or Search the web, as a search from the address bar does; limit the closing sentence "No user data is sent in these requests beyond standard HTTP headers." to the Iconify and favicon requests so it doesn't contradict the new bullet
- [ ] `docs/development.md` § Search popup: the `searchWeb` message and why the tab is created first (`search.query` with `tabId`)
- [ ] `docs/changelog.md` under `## Latest Version` and a What's New line in `src/data/changelog.ts` under `'2.0.388'`
- [ ] `docs/state-reference.md`: no new storage keys, no change (check)
- [ ] mark this task done; do not move the plan (the orchestrator moves it to `docs/plans/completed/`)

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- permission warning: before and after adding `"search"`, open `chrome://extensions` → the extension's
  Details → Permissions and confirm the warning lines don't change (reloading an unpacked build grants
  new permissions silently, so the reload alone proves nothing); or pack CRXs of the old and new builds
  and install the new one over the old
- popup over a page: type text, Shift+Enter → new tab with the default engine's results, in the same
  window, listed in the active Space's Tab list; the popup is gone
- popup as a window (on a `chrome://` page or the New Tab page): Shift+Enter → the search opens in the
  window the popup was opened from
- Shift+Enter with an empty or blank field: nothing happens; Enter still opens the selected row
- the hint shows only with text, in light and dark, and a click on it searches
- with a non-Google default engine (chrome://settings/search), the search uses that engine
