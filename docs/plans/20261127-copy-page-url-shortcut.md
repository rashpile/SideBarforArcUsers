# Copy the page URL with Cmd+Shift+C

## Overview

- A keyboard shortcut, `Cmd+Shift+C` on macOS and `Ctrl+Shift+C` elsewhere, copies the URL of the
  current tab to the clipboard, as Arc does.
- It works whether keyboard focus is in the page or in the side panel. A short "URL copied" toast on
  the page confirms it on pages the extension can script. Pages that refuse scripts (chrome://, Web
  Store, PDF viewer) still get the copy, without a toast.
- Design: the run's `design.md`. Approach: an offscreen document (`chrome.offscreen`, reason
  `CLIPBOARD`) does the copy, because the service worker has no DOM and an in-page copy fails when the
  page has no focus.

## Context (from discovery)

- `public/manifest.json`: commands. Three have a `suggested_key` (`_execute_side_panel`,
  `prev-used-tab`, `next-used-tab`), and Chrome allows four.
- `src/background.ts:1789`: `chrome.commands.onCommand` listener. The switcher, search popup and
  Space-number commands are handled first, and history navigation waits for `stateReady`.
- `src/services/keyboardSwitcher.ts`, `src/services/searchPopup.ts`: services injecting into the
  active tab with `chrome.scripting.executeScript`. A refused injection is logged only in DEV.
- `src/utils/parkedTabAssociation.ts`: `getEffectiveTabUrl(url)` returns the original URL of a tab
  parked by a tab suspender.
- `vite.config.ts`: HTML entries (`index.html`, `note.html`, `search.html`) and fixed-name script
  entries.
- Many `chrome.runtime.onMessage` listeners in the sidebar (`src/managers/proxies/*`,
  `src/contexts/BookmarkTabsContext.tsx`) receive every runtime message. The offscreen message must not
  be answered by any of them.

## Development Approach

- **testing approach**: Regular. Per CLAUDE.md "Test decisions, not coverage" this is Chrome API wiring
  with no decision that loses data or acts on the wrong item, so no new unit tests. Every task runs
  `make test` and the build (`npm run build`) to make sure nothing broke.
- complete each task fully before moving to the next
- follow CLAUDE.md code rules: Allman braces, classes over raw structures, comments say why,
  debug logs only under `import.meta.env.DEV`

## Solution Overview

1. The manifest gets the `copy-page-url` command and the `offscreen` and `clipboardWrite` permissions.
2. `offscreen.html` + `src/offscreen.ts`: an invisible extension page that copies text it gets in a
   runtime message (textarea + `document.execCommand('copy')`) and answers `{ ok }`.
3. `src/services/pageUrlCopier.ts`: a `PageUrlCopier` class in the background. It finds the active
   tab, takes `getEffectiveTabUrl(tab.url)`, makes sure the offscreen document exists, sends the copy
   message and, on success, injects a toast into the tab.
4. `src/background.ts` routes the `copy-page-url` command to it, outside the `stateReady` wait.

## Technical Details

- Message: `{ target: 'offscreen', action: 'copy-to-clipboard', text: string }` → response
  `{ ok: boolean }`. Constants live in one small module shared by the background and the offscreen
  page (e.g. `src/utils/offscreenClipboardMessage.ts`), with no `chrome.*` at import time.
- Offscreen listener: ignore any message whose `target` isn't `'offscreen'` (return `false`, no
  `sendResponse`). For its own message, answer synchronously with the result of `execCommand`.
- Sidebar listeners: check that none of them calls `sendResponse` for an unknown action. If one does,
  make it ignore messages with `target: 'offscreen'`.
- Offscreen lifecycle in `PageUrlCopier`: the document is created on the first copy and stays open.
  - `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })` to
    check whether the document exists (it survives a service-worker restart, the copier's memory
    doesn't).
  - `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification })`.
  - One in-flight creation promise shared by concurrent calls, so two quick presses don't create it
    twice ("Only a single offscreen document may be created"). Cleared when creation fails, so the
    next press tries again.
  - No `closeDocument`: a CLIPBOARD document doesn't close on its own, and an idle one only ignores
    the background's broadcasts.
- Active tab: `chrome.windows.getLastFocused({ windowTypes: ['normal'] })`, then
  `chrome.tabs.query({ active: true, windowId })`. This skips the switcher and search popup windows.
  No window, no tab or an empty URL means it returns without doing anything.
- Toast: `chrome.scripting.executeScript({ target: { tabId }, func: showCopiedToast })`, no args (the
  label is the fixed "URL copied").
  - `showCopiedToast` is self-contained (no closures, no imports): a host element marked with a data
    attribute, with a closed shadow root, fixed at top center, system font, high `z-index`. It removes
    its own host after ~1.5 s.
  - A repeated press removes any existing host (found by the data attribute) and creates a new one,
    so toasts don't stack. Each timer removes only its own element.
  - Failures (chrome:// page, Web Store, PDF) are caught and logged only when the debug flag is set.
- Dependencies: the class calls `chrome.*` directly inside its methods (never at import time) and
  takes a `debug` flag (`import.meta.env.DEV`) from `background.ts`, as `SearchPopup` does. It has no
  tests, so it doesn't need injected Chrome APIs.

## What Goes Where

- Implementation Steps: code, manifest, docs in this repo.
- Post-Completion: manual checks in Chrome by the user.

## Implementation Steps

### Task 1: Manifest command, permissions and offscreen page

**Files:**
- Modify: `public/manifest.json`
- Create: `offscreen.html`
- Create: `src/offscreen.ts`
- Create: `src/utils/offscreenClipboardMessage.ts`
- Modify: `vite.config.ts`

- [ ] add command `copy-page-url` with description "Copy the current page URL" and `suggested_key` `{ "default": "Ctrl+Shift+C", "mac": "Command+Shift+C" }` to `public/manifest.json`
- [ ] add `offscreen` and `clipboardWrite` to `permissions` in `public/manifest.json`
- [ ] create `src/utils/offscreenClipboardMessage.ts` with the message target/action constants, the request/response types and a type guard for the request
- [ ] create `offscreen.html` (minimal page, loads `/src/offscreen.ts`) and `src/offscreen.ts` (listener that copies via a textarea and `document.execCommand('copy')`, answers `{ ok }`, ignores every other message)
- [ ] add `offscreen: 'offscreen.html'` to the `rollupOptions.input` in `vite.config.ts`, and check that the build emits `dist/offscreen.html`
- [ ] run `make test` and `npm run build` - must pass before task 2

### Task 2: PageUrlCopier service and command wiring

**Files:**
- Create: `src/services/pageUrlCopier.ts`
- Modify: `src/background.ts`

- [ ] create `PageUrlCopier` in `src/services/pageUrlCopier.ts`: `chrome.windows.getLastFocused({ windowTypes: ['normal'] })` + `chrome.tabs.query({ active: true, windowId })`, take `getEffectiveTabUrl(tab.url)`, return early when there is no window, tab or URL
- [ ] add the offscreen lifecycle: `getContexts` check, one shared in-flight creation promise (cleared on failure), the document stays open (no `closeDocument`); send the copy message and check `{ ok }`; errors logged with `console.error('[PageUrlCopier] ...')`
- [ ] add the toast: a self-contained `showCopiedToast` function (no args) injected with `chrome.scripting.executeScript`; it removes any existing toast host found by its data attribute, creates a new one and removes only its own host after ~1.5 s; injection errors logged only when the debug flag is set
- [ ] in `src/background.ts` create the copier with the `debug` flag `import.meta.env.DEV`, and handle `command === 'copy-page-url'` in `chrome.commands.onCommand` before the `stateReady` block
- [ ] confirm the sidebar's `chrome.runtime.onMessage` listeners don't call `sendResponse` (plan review found none do); change nothing if that holds
- [ ] run `make test` and `npm run build` - must pass before task 3

### Task 3: Verify acceptance criteria

- [ ] verify the manifest has the command with both suggested keys and the two permissions, and `dist/manifest.json` after the build has them too
- [ ] verify the `copy-page-url` command path doesn't wait for `stateReady` and doesn't touch Space state
- [ ] verify the offscreen listener ignores messages without `target: 'offscreen'`
- [ ] run full test suite: `make test`
- [ ] run `npm run build` (includes the TypeScript check)

### Task 4: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/development.md`
- Modify: `docs/chrome-web-store-info.md`
- Modify: `PRIVACY.md`

- [ ] README Keyboard table: add `Cmd+Shift+C` / `Ctrl+Shift+C` "Copy the current page's URL; a short toast on the page confirms it". Add a note after the table: on macOS this is also Chrome's DevTools "Inspect element" shortcut (DevTools keeps `Cmd+Option+C`), so Chrome may leave the key unset, on a new install or an update; set it once in `chrome://extensions/shortcuts`
- [ ] README Permissions table: rows for `offscreen` and `clipboardWrite` (copy the page URL to the clipboard when you press the shortcut; say that Chrome may show "Modify data you copy and paste" for `clipboardWrite`), and add the toast to the `activeTab` row
- [ ] `docs/changelog.md`: a "New:" entry under `## Latest Version` (create the heading above `## 2.0.410`) describing the shortcut, the toast, parked tabs copying their original URL, the key that Chrome may leave unset and the two new permissions
- [ ] `src/data/changelog.ts`: a `'2.0.411'` entry with one What's New line for the shortcut (feature PRs add the next version's key, as 38d905b did; the release renames it if needed)
- [ ] `docs/development.md`: an `offscreen.html` line in Project layout, "page URL copier" in the `services/` description, and a short paragraph on `PageUrlCopier` (why an offscreen document, the `target: 'offscreen'` message, the document staying open)
- [ ] `docs/chrome-web-store-info.md`: a Key Features line and permission justifications for `offscreen` and `clipboardWrite`; extend `activeTab` with the toast
- [ ] `PRIVACY.md`: one line saying the copied URL goes only to the local clipboard and is sent nowhere, if the file lists data handling per feature
- [ ] mark this plan's tasks done (the orchestrator moves the plan to `docs/plans/completed/`)

## Post-Completion

**Manual verification** (by the user, in Chrome after loading `dist/`):
- on a fresh load of `dist/`, check whether `chrome://extensions/shortcuts` shows `⇧⌘C` for "Copy the
  current page URL"; Chrome may refuse to auto-assign it because it is DevTools' shortcut, then set it
  by hand and adjust the README note if the result differs from what it says
- press it on a normal page: URL in clipboard, toast shown
- click a tab in the side panel, then press it: URL of the active tab copied
- press it on `chrome://extensions`: URL copied, no toast
- press it twice quickly: one toast, no error in the service worker console
