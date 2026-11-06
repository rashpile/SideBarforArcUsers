# Search popup over the page: open tabs, bookmarks, archive, recently closed (#78)

## Overview

- A new shortcut (`search-popup`, no default key) opens a search popup over the page, placed like the Tab
  Switcher list. One search field finds pages in four scopes: open tabs, bookmarks, the archive and
  recently closed tabs.
- Each scope has its own colour. The list shows at most 20 results, newest last access first. An empty field
  shows the 20 most recently accessed items.
- A row of scope buttons under the field (All · Open tabs · Bookmarks · Archive · Recently closed) narrows the
  search. A toggle at the end of the row switches between This Space (the default on every open) and All
  Spaces (user's decision).
- Bookmarks are those of the Space folders the sidebar shows. `asd_Archive` and `asd_Favorites` are skipped
  at any depth, and Favorites are not included (user's decision).
- Picking a result: an open tab is focused; a bookmark opens as a click on it in the sidebar does; an archive
  item opens as a new tab in its Space and leaves the archive, as the Archive section does; a recently closed
  tab is reopened in its Space. A result from another Space switches the window to that Space.
- Keyboard, as in the Tab Switcher: the first press opens the popup with the search field focused. Another
  press while the popup is open moves the selection down one row, and releasing the modifier after such a
  press opens the selected row. Releasing it with no extra press keeps the popup open for typing. Arrows +
  Enter or a click pick a row, and Esc closes the popup.

## Context (from discovery)

- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-search-popup-over-the-page-78-20261106-1132/design.md`
  (approach, components, decisions, known limitations; read it before every task).
- Tab Switcher, the model for the flow:
  - `src/services/keyboardSwitcher.ts` (background session: host overlay/window, pending steps, `#showOverlay`
    with `executeScript` + `SHOW`, `#openWindow` sizing, `#closeWindow`)
  - `src/switcherOverlay.ts` (classic script, shadow root, dispose of an older copy, `document.hasFocus()`
    check)
  - `src/services/switcherLists.ts` (`TabWithLastAccess`, `WindowSpaces`)
  - `src/utils/switcherMessages.ts`, `public/switcher.html`
  - `vite.config.ts`: fixed-name entries for `background` and `switcherOverlay`; `note.html` is an HTML input
- background.ts wiring:
  - `keyboardSwitcher` construction near line 721
  - `setActiveTabAndSpace` (line 111: activates and switches the Space via `getSpaceForActivatedTab`)
  - `openSpace`, `readWindowSpaces`
  - `onCommand` (line 1473, chained on `stateReady`)
  - `runtime.onMessage` switcher actions (line 1380)
  - `tabs.onRemoved` / `windows.onRemoved` → switcher (line 775)
  - `bookmarkSpaceResolver`, `bookmarkRecencyStore`, `recentlyClosedManager`, `tabSpaceRegistry`
- Data sources:
  - `RecentlyClosedManager.forSpace` / `reopen` (`src/managers/impl/recentlyClosedManager.ts`; `reopen` returns
    void today; interface in `src/managers/shared/recentlyClosedApi.ts`, proxy in
    `src/managers/proxies/recentlyClosedProxy.ts`)
  - `BookmarkRecency` / `BookmarkRecencyStore.read()` (`src/stores/bookmarkRecencyStore.ts`)
  - `findArchiveFolder` / `isSystemFolder` (`src/utils/archiveFolder.ts`)
  - `ArchiveItems.fromFolder` (`src/utils/archiveItems.ts`)
  - `collectFolderBookmarks` (`src/utils/folderRecentItems.ts`, skips system folders at any depth)
  - `findFolderBySegments` (`src/utils/bookmarkFolderLookup.ts`)
  - `matchesFilter` (`src/utils/searchParser.ts`)
  - `getTabAssociations` / `storeTabAssociation` / `saveTabAssociationBackup` / `BOOKMARK_ITEM_KEY_PREFIX`
    (`src/utils/tabAssociations.ts`)
- Sidebar behaviour to match:
  - `BookmarkTabsContext.openItemTab` (reuse the associated tab, or create it, associate it, back it up and
    register it in the Space)
  - `BookmarkTree.handleRowClick` modes `arc` / `newTab` / `activeTab` (`sidebar-bookmark-open-mode`, a raw
    string, `'true'`/`'false'` migrated in `App.tsx:868`)
  - `ArchiveSection.handleRestore` (create the tab, then remove the bookmark)
- Tests: `tests/*.test.mjs` with `node --test`. The style to follow is `tests/switcherLists.test.mjs` and
  `tests/recentlyClosedManager.test.mjs` (the latter fakes `globalThis.chrome`).

## Development Approach

- **testing approach**: Regular (code first, then tests). Tests only for the modules that decide which tab,
  bookmark, record or Space is acted on: `searchResults.ts`, `searchPick.ts` and `searchKeyboard.ts`
  (CLAUDE.md "Test decisions, not coverage"). There are no tests for the DOM page, the frame script, the
  manifest/vite wiring or background.ts glue.
- Complete each task fully before moving to the next. Make small, focused changes.
- Follow CLAUDE.md code rules: Allman braces, comments say why, classes over raw structures, no new npm
  packages, and debug logging only under `import.meta.env.DEV`.
- Modules under test take their chrome APIs as arguments, import siblings with `.ts` extensions, never read
  `import.meta.env` (callers pass a `debug` flag), and use no enums, parameter properties or namespaces.
- **CRITICAL: `make lint && make test && make build` must pass at the end of every task.**
- **CRITICAL: update this plan file when scope changes during implementation.**

## Testing Strategy

- **unit tests** (`node --test`):
  - `tests/searchResults.test.mjs`: scopes, This Space / All Spaces, system folders, the shared or nested
    folder rule (bookmarks and archive), the current tab and its bookmark excluded, ordering, the cap, the
    dedupe
  - `tests/searchPick.test.mjs`: each kind acts on the right tab, window, bookmark, record and Space; archive
    removal only after a successful open; no association-based reuse or Space switch when the startup restore
    failed
  - `tests/searchKeyboard.test.mjs`: a release picks only after a shortcut press; typing never picks, also
    after a missed release; the shortcut key parse
  - the existing `tests/recentlyClosedManager.test.mjs` is updated for `reopen` returning the tab id
- **e2e**: the project has none. Manual checks are listed in Post-Completion.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with the ➕ prefix.
- Document issues/blockers with the ⚠️ prefix.
- Keep the plan in sync with the work actually done.

## Solution Overview

- **Host.** The popup UI is an extension page, `search.html`, shown in an iframe that a tiny classic content
  script (`searchPopupFrame.js`) puts over the page in a closed shadow root. Keys and typed text stay in the
  extension frame: the page can't read the query and its shortcuts don't fire. Pages that can't be scripted
  or have no focus get the same page in a popup window, as the Tab Switcher falls back.
- **Search in background.** When the popup opens, background takes one snapshot of the candidates from the
  tabs, the associations, the bookmark tree, `BookmarkRecency` and the Recently Closed lists
  (`SearchCandidates`). Each `query` from the page is filtered against it and answered with at most 20 rows.
  Row ids are opaque and map back to snapshot items, so the page never sends a tab id, URL or record that
  background acts on blindly.
- **Picking** (`SearchPicker`) reuses background's own `setActiveTabAndSpace`, the association helpers,
  `tabSpaceRegistry`, `bookmarkSpaceResolver` and `recentlyClosedManager.reopen`. That gives the same outcome
  as the sidebar's click on each kind of item.
- **Session lifetime.** The session (host, port, snapshot) lives in worker memory. The page pings over its
  port every 20 s, so the worker stays up while the popup is open. A page whose port drops closes itself.
  Only the port whose name carries the session's random id, and whose sender is the host, is accepted.
- **Keyboard state** (`SearchKeyboard`) lives in the page. Chrome turns repeated shortcut presses into
  commands, and background forwards them as `move`. A keyup with no Cmd/Ctrl/Alt picks only after such a
  press.

## Technical Details

### Messages (`src/utils/searchPopupMessages.ts`)

```ts
// The page connects with port name `${SEARCH_POPUP_PORT_PREFIX}${sessionId}`; sessionId comes from search.html?session=
export const SEARCH_POPUP_PORT_PREFIX = 'search-popup:';
export const SEARCH_POPUP_PING_MS = 20_000;
export type SearchScope = 'all' | 'tabs' | 'bookmarks' | 'archive' | 'closed';
export type SearchItemKind = 'tab' | 'bookmark' | 'archive' | 'closed';
export const SEARCH_SCOPES: readonly SearchScope[] = ['all', 'tabs', 'bookmarks', 'archive', 'closed'];

export interface SearchRow { id: string; kind: SearchItemKind; title: string; subtitle: string; faviconPageUrl: string }
export interface SearchQuery { text: string; scope: SearchScope; allSpaces: boolean }

// page -> background (port)
{ type: 'query', query: SearchQuery }
{ type: 'pick', rowId: string }
{ type: 'close', reason: 'esc' | 'blur' | string }
{ type: 'ping' }                      // keeps the service worker alive while the popup is open
// background -> page (port)
{ type: 'init', rows: SearchRow[], steps: number, shortcut: string | undefined, hasSpaces: boolean }
{ type: 'results', rows: SearchRow[] }
{ type: 'move', steps: number }

// background <-> frame content script (tabs.sendMessage / runtime.sendMessage)
export const SearchFrameAction = { SHOW: 'search-frame-show', REMOVE: 'search-frame-remove', CLOSED: 'search-frame-closed' } as const;
// popup page in the iframe -> frame content script (window.postMessage to parent), when its port dropped
export const SEARCH_FRAME_CLOSE_REQUEST = 'search-frame-close-request';
```

`searchPopupFrame.ts` repeats the `SearchFrameAction` strings and `SEARCH_FRAME_CLOSE_REQUEST` (classic
script). A comment in both files says to change them together. Port messages arrive in order, and background
answers each `query` synchronously from the snapshot, so `results` need no sequence number.

### Candidates (`src/services/searchResults.ts`)

```ts
interface SearchCandidatesInput {
  originWindowId: number;
  originActiveTabId: number | undefined;
  originIncognito: boolean;
  activeSpaceId: string | undefined;          // undefined: no Spaces set up
  spaces: readonly Space[];                   // sidebar order
  tabs: readonly TabWithLastAccess[];         // tabs of normal windows (each has windowId)
  spaceOf(windowId: number, tabId: number): string | undefined;
  associations: ReadonlyMap<number, Record<number, string>>;  // windowId -> tabId -> itemKey
  bookmarkRoots: BookmarkNode[];              // getTree()[0].children
  recency: BookmarkRecency;
  closedRecords(spaceId: string): readonly ClosedTabRecord[];
}
```

`SearchItem`, a class or a discriminated union with a `lastAccess` getter, holds:
- `id`: `t:<windowId>:<tabId>` / `b:<bookmarkId>` / `a:<bookmarkId>` / `c:<spaceId>:<recordId>`
- `kind`, `title`, `url`, `spaceId?`, `lastAccess?`
- kind-specific fields: tab → `windowId`, `tabId`, `bookmarkId?`; bookmark / archive → `bookmarkId`;
  closed → `recordId`

Rules:
- Tabs:
  - skip the origin's active tab and tabs whose `incognito` differs from the origin's
  - `inThisSpace` holds when `windowId === originWindowId` and either there are no Spaces or
    `spaceOf(...) === activeSpaceId`
  - `bookmarkId` comes from an association value starting with `BOOKMARK_ITEM_KEY_PREFIX`
- Bookmarks:
  - for each Space in order: `findFolderBySegments(roots, space.bookmarkFolderSegments ?? [],
    space.bookmarkFolderInAccount)`, then `collectFolderBookmarks(folder)`
  - an id already claimed by an earlier Space is skipped, so a shared or nested folder resolves to the first
    matching Space
  - `inThisSpace` holds when `spaceId === activeSpaceId`
  - `lastAccess = recency.lastActiveAt(id) ?? node.dateLastUsed` (`dateLastUsed` is read through a cast;
    @types/chrome lacks it)
- Archive: `findArchiveFolder(folder.children ?? [])`, then `ArchiveItems.fromFolder(...)`, with
  `lastAccess = dateAdded`. Archive item ids go through the same claimed-id check as bookmarks. When two
  Spaces share one folder they find the same `asd_Archive`, and its items belong to the first Space.
- Closed: `closedRecords(space.id)`, with `lastAccess = closedAt`.
- `search(query)`:
  - scope filter, then the Space filter (`allSpaces` or `inThisSpace`), then the text filter. The text filter
    parses the query once with `parseSearchQuery`, then runs `matchesSearch(title, url, ast)` per item.
    Without an AST (a parse failure) it falls back to the literal substring match, exactly as `matchesFilter`
    does. A blank text matches everything
  - in every scope, the bookmark whose Arc tab is the origin's active tab is dropped: picking it would do
    nothing, like the current tab itself
  - in `all`, a bookmark row is dropped when its `bookmarkId` is the `bookmarkId` of a tab row kept by the
    same query
  - stable sort by `lastAccess`, newest first; undefined goes last
  - `.slice(0, SEARCH_RESULT_LIMIT = 20)`
- `item(rowId)` looks an item up for a pick.
- `toRow(item, allSpaces)`:
  - title is `title || url`
  - subtitle is the host; in All Spaces mode it is prefixed with the Space name: `"<Space> · host"`
  - `faviconPageUrl` is the URL

### Pick (`src/services/searchPick.ts`)

```ts
interface SearchPickerDeps {
  activateTab(tabId: number): Promise<void>;             // background's setActiveTabAndSpace; throws when it returns success: false
  activateTabOnly(tabId: number): Promise<void>;         // tabs.update(tabId, {active: true}), no Space switch
  focusWindow(windowId: number): Promise<void>;
  createTab(windowId: number, url: string): Promise<{ id?: number; index: number; url?: string }>;
  updateTabUrl(tabId: number, url: string): Promise<void>;
  activeTabId(windowId: number): Promise<number | undefined>;
  tabExists(tabId: number): Promise<boolean>;
  associatedTabIds(windowId: number, itemKey: string): Promise<number[]>;  // tabs of the window whose association is itemKey
  storeAssociation(windowId: number, tabId: number, itemKey: string, url: string, index: number): Promise<void>;
  registerTab(windowId: number, tabId: number, spaceId: string): Promise<void>;
  bookmarkSpaceId(bookmarkId: string): Promise<string | undefined>;
  removeBookmark(bookmarkId: string): Promise<void>;
  reopenClosed(windowId: number, spaceId: string, recordId: string): Promise<number | undefined>;
  bookmarkOpenMode(): Promise<'arc' | 'newTab' | 'activeTab'>;
}
```

`pick(item, originWindowId, restored)`. `restored` is the value `stateReady` resolved to. CLAUDE.md:
background code that changes tabs based on associations must check it.
- `restored === false`, as `openSpace` handles a failed restore:
  - a `tab` result is activated with `activateTabOnly` (and its window focused), with no Space switch
  - an `arc` bookmark never reuses a tab found through the associations; it always gets a new tab
  - new tabs this pick creates are still associated, registered and activated as below, because their
    association is the one just written
- `tab`: `activateTab(tabId)`, then `focusWindow(windowId)` when `windowId !== originWindowId`.
- `bookmark`, mode `arc`:
  - the item key is `bookmark-<id>`; take the first of `associatedTabIds(origin, itemKey)` for which
    `tabExists` holds, and `activateTab` it
  - otherwise `createTab`, then `storeAssociation`, then
    `registerTab(origin, id, await bookmarkSpaceId(id) ?? item.spaceId)`, then `activateTab`
  - a failed `storeAssociation` / `registerTab` is logged by the caller's error path; the tab stays
- `bookmark`, mode `newTab`: `createTab`, `registerTab` to the bookmark's Space, `activateTab`.
- `bookmark`, mode `activeTab`: `updateTabUrl(activeTabId(origin), url)`.
- `archive`: `createTab`, `registerTab(item.spaceId)`, `activateTab`, and only then
  `removeBookmark(bookmarkId)`. A failed create rejects before the removal.
- `closed`: `reopenClosed(origin, spaceId, recordId)`, then `activateTab(newTabId)` when an id came back.
- `parseBookmarkOpenMode(raw: unknown)`:
  - `'true'` → `arc`, `'false'` → `newTab`
  - `'arc'`, `'newTab'` and `'activeTab'` map to themselves
  - anything else → `arc`
  - background wires `bookmarkOpenMode` with `chrome.storage.local.get('sidebar-bookmark-open-mode')`

### Keyboard (`src/searchPopup/searchKeyboard.ts`)

`SearchKeyboard` (pure; constructed with the shortcut string from `chrome.commands`, e.g. `"⌥E"` or `"Alt+E"`):
- `shortcutMove(steps)`: the background `move`. It arms pick-on-release and returns the steps to apply.
- `keydown(event)`: returns one of `{ kind: 'move', steps }`, `{ kind: 'pick' }`, `{ kind: 'close' }`,
  `{ kind: 'scope', step }`, `{ kind: 'toggleSpaces' }` or `{ kind: 'none' }`.
  - ArrowDown / ArrowUp → move ±1
  - Enter → pick; Esc → close
  - Tab / Shift+Tab → scope ±1
  - Alt + `KeyA` → toggleSpaces
  - the shortcut's key code with one of Cmd/Ctrl/Alt held (Chrome let the press through) → move +1 and arm
  - anything else → none (the input types it)
  - any keydown with none of Cmd/Ctrl/Alt held disarms first: it shows the modifier is already up, so a
    release the page missed (the known limitation) can never turn the next typed letter into a pick
- `keyup(event)`: returns `pick` when armed and none of Cmd/Ctrl/Alt is held; otherwise none. It disarms
  after a pick.
- The page applies moves with wrap-around: `(selected + steps) mod rowCount`, as the Tab Switcher does.
- The shortcut's key code comes from `keyCodeOf`. It moves from `keyboardSwitcher.ts` to
  `src/utils/shortcutKey.ts`, and both import it from there. The move fixes its parse: strip the modifiers
  (the glyphs `⌘⌥⇧⌃` and the `Ctrl+` / `Alt+` / `Shift+` / `Command+` / `MacCtrl+` prefixes), and map only
  a single letter, a digit, `,` or `.` (also spelled `Comma` / `Period`, as Chrome writes them on some
  platforms) to a code. Anything else (`Space`, arrows, `Home`, …) gives undefined, so `"⌥Space"` no longer
  reads as `KeyE`.

### Background flow (`src/services/searchPopup.ts`)

`SearchPopup` (deps: `buildCandidates(win)`, `picker`, `newSessionId()` (`crypto.randomUUID`), `debug`)
holds one session:
- `id`: random per open
- `host`: overlay with `tabId`, or a window with `windowId`
- `port`, `originWindowId`, `restored` (the `stateReady` value the command handler passes in),
  `candidates`, `pendingSteps` (starts at 0: the first press only opens; unlike `KeyboardSwitcher.#open`,
  it does not count as a move), `opening`, and a connect deadline timer

The session lives in worker memory. The page's `ping` every `SEARCH_POPUP_PING_MS` keeps the worker running
while the popup is open: since Chrome 114 an open port alone does not, only messages over it do.

Flow:
- `handleShortcut(restored)`:
  - while opening, or while the host is up and the port not yet connected → `pendingSteps++`
  - port connected → `port.postMessage({type: 'move', steps: 1})`; a dead port (postMessage throws)
    clears the session and opens a fresh popup
  - else open:
    - `windows.getLastFocused({populate: true, windowTypes: ['normal']})`, `commands.getAll()` (the shortcut
      string of `search-popup`), `buildCandidates`
    - then the overlay: `executeScript` files `searchPopupFrame.js`, then
      `tabs.sendMessage(SHOW, {url: search.html?session=<id>})` → `{shown}`
    - falling back to a popup window (`search.html?session=<id>&host=window`, about 640×560, centered on
      the origin)
  - an overlay whose page hasn't connected within 2 s (a frame the page or the profile blocked) → send
    `REMOVE` and fall back to the popup window
- `handleConnect(port)`, from `runtime.onConnect` for names starting with `SEARCH_POPUP_PORT_PREFIX`:
  - accept the port only when all of these hold:
    - its name carries the current session's id
    - the session has no port yet
    - `port.sender.url` is the extension's `search.html`
    - for an overlay host, `port.sender.tab.id` is the host tab; for a window host, once its id is
      known, `sender.tab.windowId` is that window
  - the session may still be `opening` (the page can connect before the SHOW reply or `windows.create`
    resolves); its id is set before the host is made
  - any other port is disconnected at once
  - the handlers are bound to that port object and do nothing when it is no longer the session's port
  - post `init` (empty-query rows, This Space, pending steps, shortcut, `hasSpaces`) and clear the deadline
  - `query` → `results`; `ping` → nothing
  - `pick` → close the host (refocusing the origin), then `picker.pick(item, origin, restored)` (errors
    logged)
  - `close` → close the host; refocus the origin window only when `reason` is not `blur`
  - `onDisconnect` → clear the session
- Closing the host:
  - overlay → `tabs.sendMessage(tabId, {action: REMOVE})`, errors ignored
  - window → `windows.update(origin, {focused: true})` (pick and Esc only), then `windows.remove(windowId)`
- Clearing the session disconnects its port and clears the deadline.
- `handleFrameClosed(tabId)`, `handleTabRemoved(tabId)` and `handleWindowRemoved(windowId)` clear the
  matching session.

### Page (`search.html`, `src/searchPopup/main.ts`, `src/searchPopup/searchPopup.css`)

- Plain DOM, no React.
- Layout:
  - the input (placeholder "Search tabs, bookmarks, archive, recently closed")
  - the scope row with the five buttons in their colours (All neutral, Open tabs `#0a84ff`, Bookmarks
    `#30a14e`, Archive `#e8890c`, Recently closed `#a259d9`; tuned for dark mode) and, when `hasSpaces`,
    the toggle "This Space" / "All Spaces" with an `⌥A` / `Alt+A` hint
  - the list: rows 44px, about 10 visible, scrolls; each row has a colour stripe, a `_favicon` image
    (`chrome.runtime.getURL('_favicon/?pageUrl=…&size=32')`, first letter until it loads), title,
    subtitle and a kind label
  - an empty state reads "No matches"
- Behaviour:
  - connect `chrome.runtime.connect({name: SEARCH_POPUP_PORT_PREFIX + session})`, with `session` taken from
    `location.search`
  - post `ping` every `SEARCH_POPUP_PING_MS` while open
  - focus the input on load and on window `focus`
  - window `blur` → `close` with reason `blur`; Esc → `close` with reason `esc`
  - `input`, a scope change or the toggle → `query`; the selection resets to row 0 and is kept in view
  - a click on a row → `pick`
  - the scope buttons and the toggle take `tabindex="-1"` and `preventDefault` their `mousedown`, so a click
    keeps the focus (and the typing) in the input
  - port `onDisconnect` (the worker stopped, or background dropped the session) → the page closes itself.
    In `?host=window` it calls `window.close()`. In the iframe it sends
    `parent.postMessage({type: SEARCH_FRAME_CLOSE_REQUEST}, '*')`; the frame script removes the frame
- In `?host=window` the panel fills the window. In the iframe it fills the iframe; the frame script gives the
  iframe its rounded corners and shadow.
- Do not set `color-scheme` on the page. Use `prefers-color-scheme` media queries only, so the iframe never
  paints an opaque canvas that doesn't match.

### Frame script (`src/searchPopupFrame.ts`)

- A classic IIFE with no imports. It disposes an older copy (`__sidebarSearchFrameDispose`).
- `SHOW`: `!document.hasFocus()` → `{shown: false}`. Otherwise:
  - attach a host element on `documentElement` with a closed shadow root holding a fixed backdrop
    (`rgba(0,0,0,0.25)`, z-index max) and the iframe
  - the iframe: width `min(640px, 100vw - 32px)`, height `min(560px, 88vh - 32px)` (so top 12vh + height
    never passes the viewport's bottom), top 12vh, centered,
    `border: 0; border-radius: 14px; box-shadow`, `allow=""`, with `src` set to the `url` the message
    carries, but only when it starts with `chrome.runtime.getURL('search.html')`; a URL that doesn't →
    `{shown: false}`
  - `:host { all: initial }`, so the page's inherited styles (above all `color-scheme`) don't reach the iframe
  - remember `document.activeElement` (kept from the first frame when a SHOW replaces a frame still up)
  - focus the iframe element at once, so keys typed while `search.html` loads don't reach the page; on the
    iframe's `load`, call `iframe.contentWindow?.focus()`
  - reply `{shown: true}`
- A backdrop `mousedown` outside the iframe, or `visibilitychange` to hidden → remove the frame, give focus
  back to the remembered element and `chrome.runtime.sendMessage({action: CLOSED})`, catching the rejection.
- `REMOVE` → remove the frame and give focus back to the remembered element.
- A window `message` that `isTrusted`, whose `event.source` is the iframe's `contentWindow`, whose
  `event.origin` is the extension's origin and whose data is `{type: SEARCH_FRAME_CLOSE_REQUEST}` → remove
  the frame, restore focus and send `CLOSED`. Messages from anything else are ignored.
- Disposal by a newer copy removes the frame (focus restored) without sending `CLOSED`: background is about
  to show the new session's frame in the same tab.
- Do not close on the page window's `blur`: focus moving into the iframe blurs the page.

## What Goes Where

- **Implementation Steps** (`[ ]`): the code, tests and docs in this repo.
- **Post-Completion**: the user's manual checks in Chrome.

## Implementation Steps

### Task 1: Shared types, manifest command, build entries

**Files:**
- Create: `src/utils/searchPopupMessages.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`
- Create: `search.html`
- Create: `src/searchPopup/main.ts` (an empty placeholder; filled in Task 6)
- Create: `src/searchPopupFrame.ts` (a placeholder IIFE; filled in Task 5)

- [x] create `src/utils/searchPopupMessages.ts` with `SEARCH_POPUP_PORT_PREFIX`, `SEARCH_POPUP_PING_MS`,
      `SearchScope`, `SEARCH_SCOPES`, `SearchItemKind`, `SearchRow`, `SearchQuery`, the port message types
      (page → background incl. `ping`, background → page), `SearchFrameAction` and
      `SEARCH_FRAME_CLOSE_REQUEST` (see Technical Details)
- [x] `public/manifest.json`: add the command `"search-popup": { "description": "Search popup: open tabs,
      bookmarks, archive and recently closed tabs" }` (no `suggested_key`) after `space-switcher-next`;
      add `"web_accessible_resources": [{ "resources": ["search.html"], "matches": ["<all_urls>"] }]`
- [x] `vite.config.ts`: add the `search: 'search.html'` input and the
      `searchPopupFrame: resolve(__dirname, 'src/searchPopupFrame.ts')` input; give `searchPopupFrame` a
      fixed `searchPopupFrame.js` name next to `background` and `switcherOverlay`
- [x] create `search.html` (like `note.html`, with `<script type="module" src="/src/searchPopup/main.ts">`,
      title "Search") and minimal placeholder `main.ts` / `searchPopupFrame.ts` so the build passes
- [x] no tests (wiring); run `make lint && make test && make build` and check that `dist/` has
      `search.html` and `searchPopupFrame.js` - must pass before Task 2

### Task 2: Search candidates and ranking

**Files:**
- Create: `src/services/searchResults.ts`
- Create: `tests/searchResults.test.mjs`

- [x] create `SearchCandidates` (static `build(input)`, `search(query)`, `item(rowId)`, `toRow(item, allSpaces)`)
      and the `SearchItem` model with the collection rules in Technical Details: tabs (origin active tab and
      other-incognito tabs skipped; `inThisSpace`; `bookmarkId` from associations), bookmarks per Space folder
      via `findFolderBySegments` + `collectFolderBookmarks`, archive via `findArchiveFolder` +
      `ArchiveItems.fromFolder`, both with the first-Space-wins claimed-id check, closed records per Space;
      `lastAccess` per kind
- [x] implement `search`: scope filter, Space filter, the text filter (`parseSearchQuery` once per query, then
      `matchesSearch` per item, with `matchesFilter`'s literal fallback when parsing fails), the current Arc
      tab's bookmark dropped in every scope, the `all`-scope bookmark/tab dedupe, stable sort by `lastAccess`
      (undefined last), cap `SEARCH_RESULT_LIMIT = 20`
- [x] implement `toRow`: title fallback to the URL, subtitle host (with `"<Space> · "` in All Spaces mode);
      import siblings with `.ts` extensions, nothing from `chrome.*` at import time
- [x] write tests: This Space lists only the origin window's tabs of the active Space, the active Space's
      bookmarks / archive / closed records; All Spaces adds the other Spaces and other windows' tabs; the
      origin's active tab never appears, and neither does the bookmark whose Arc tab it is
- [x] write tests: bookmarks inside `asd_Archive` / `asd_Favorites` at any depth are not bookmark results;
      archive items come only from the Space's `asd_Archive` (subfolders included); a bookmark in a folder
      nested under two Spaces' folders belongs to the first Space in the list; an `asd_Archive` in a folder
      two Spaces share belongs to the first Space (one row, the first Space's id); fixtures use root ids other
      than '1'/'2'/'3'
- [x] write tests: newest `lastAccess` first across kinds, items without a time last in collection order,
      at most 20 rows, the query matched against title and URL (search syntax and the literal fallback), a
      bookmark whose Arc tab is a listed tab row is dropped only in `all`, no Spaces → all origin-window tabs
      and no bookmarks
- [x] run `make lint && make test && make build` - must pass before Task 3

### Task 3: Picking a result

**Files:**
- Create: `src/services/searchPick.ts`
- Modify: `src/managers/impl/recentlyClosedManager.ts`
- Modify: `src/managers/shared/recentlyClosedApi.ts`
- Modify: `src/managers/proxies/recentlyClosedProxy.ts`
- Modify: `tests/recentlyClosedManager.test.mjs`
- Create: `tests/searchPick.test.mjs`

- [x] change `RecentlyClosedManager.reopen` to return `Promise<number | undefined>` (the new tab's id;
      undefined when the record is gone), and update `RecentlyClosedApi.reopen` and the proxy's type; the
      sidebar caller ignores the value
- [x] create `SearchPicker` with `SearchPickerDeps` and `pick(item, originWindowId, restored)` per Technical
      Details (tab, bookmark in `arc` / `newTab` / `activeTab`, archive, closed, the `restored === false`
      rules) and `parseBookmarkOpenMode(raw)`
- [x] write tests: a tab result activates that tab id and focuses its window only when it is another window;
      a closed record reopens with the record's Space and id in the origin window and activates the returned
      tab
- [x] write tests: an `arc` bookmark with an existing associated tab in the origin window activates it and
      creates nothing; a stale association (tab gone) or none creates a tab, stores `bookmark-<id>` for it in
      the origin window and registers it in the Space `bookmarkSpaceId` returns (falling back to the item's);
      `newTab` and `activeTab` modes; `parseBookmarkOpenMode` for `'true'`, `'false'`, the three values and junk
- [x] write tests: an archive item opens in its Space and is removed after; a rejected `createTab` leaves the
      archive bookmark in place
- [x] write tests: with `restored === false` a tab result is activated without a Space switch
      (`activateTabOnly`) and an `arc` bookmark with an associated tab gets a new tab instead of reusing it
- [x] update `tests/recentlyClosedManager.test.mjs` for the returned id; run
      `make lint && make test && make build` - must pass before Task 4

### Task 4: Keyboard decisions of the popup

**Files:**
- Create: `src/utils/shortcutKey.ts`
- Modify: `src/services/keyboardSwitcher.ts`
- Create: `src/searchPopup/searchKeyboard.ts`
- Create: `tests/searchKeyboard.test.mjs`

- [x] move `keyCodeOf` from `keyboardSwitcher.ts` to `src/utils/shortcutKey.ts` with the fixed parse
      (modifiers stripped; only a single letter, digit, `,` or `.` maps to a code) and import it in
      `keyboardSwitcher.ts`
- [x] create `SearchKeyboard` per Technical Details (`shortcutMove`, `keydown`, `keyup`), taking the shortcut
      string; a modifier-free keydown disarms
- [x] write tests: a keyup without modifiers after open (no shortcut press) returns none; after
      `shortcutMove(1)` a keyup with Alt still held returns none and the release returns pick, once; after
      `shortcutMove(1)`, a keydown `KeyG` with no modifiers then its keyup return none
- [x] write tests: plain letters return none (typing never picks or moves); arrows, Enter, Esc, Tab /
      Shift+Tab, Alt+KeyA map to their actions; the shortcut's key with its modifier held moves and arms;
      `keyCodeOf` for `"⌥E"`, `"Alt+E"`, `"⇧⌘K"`, `"Ctrl+Shift+Comma"`-style strings and `"⌥Space"` (undefined)
- [x] run `make lint && make test && make build` - must pass before Task 5

### Task 5: Frame content script over the page

**Files:**
- Modify: `src/searchPopupFrame.ts`

- [x] implement the classic IIFE per Technical Details: dispose of an older copy, `SHOW` with the
      `document.hasFocus()` check, closed shadow root with backdrop + iframe (`src` from the message's `url`,
      accepted only under `chrome.runtime.getURL('search.html')`), focus into the iframe on `load`
- [x] closing: backdrop mousedown / page hidden → remove + `CLOSED`; `REMOVE` → remove and restore focus;
      the close request posted by the iframe (source and origin checked) → remove, restore focus, `CLOSED`;
      repeat the message strings with a "change both" comment
- [x] no tests (DOM wiring); run `make lint && make test && make build` - must pass before Task 6

### Task 6: The popup page

**Files:**
- Modify: `search.html`
- Modify: `src/searchPopup/main.ts`
- Create: `src/searchPopup/searchPopup.css`

- [x] build the view per Technical Details: input, scope row with colours and the This Space / All Spaces
      toggle (hidden without Spaces; buttons `tabindex="-1"` with `mousedown` `preventDefault`), result rows
      (stripe, `_favicon` image with letter fallback, title, subtitle, kind label), "No matches", about 10
      visible rows with scroll, light and dark via `prefers-color-scheme` only
- [x] connect the port (`SEARCH_POPUP_PORT_PREFIX` + the `session` URL parameter), `ping` every
      `SEARCH_POPUP_PING_MS`; render `init` (rows, apply `steps` as shortcut moves); send `query` on input /
      scope / toggle changes and reset the selection to row 0; apply `move` through
      `SearchKeyboard.shortcutMove`, wrapping around the list
- [x] wire `keydown` / `keyup` through `SearchKeyboard` (preventDefault for handled keys), row click → `pick`,
      window `blur` → `close` (reason `blur`), Esc → `close` (reason `esc`), focus the input on load and on
      window `focus`; `?host=window` fills the window
- [x] port `onDisconnect` → close itself: `window.close()` in `?host=window`, the
      `SEARCH_FRAME_CLOSE_REQUEST` post to the parent in the iframe
- [x] no tests (DOM); run `make lint && make test && make build` - must pass before Task 7

### Task 7: Background session class

**Files:**
- Create: `src/services/searchPopup.ts`

- [ ] create `SearchPopup` per Technical Details: the session (random id, `restored`, `pendingSteps` from 0),
      `handleShortcut(restored)` with pending steps and the `move` over a live port, opening via
      `executeScript` + `SHOW` (`url` with the session id) with the popup-window fallback and the 2 s connect
      deadline
- [ ] `handleConnect(port)`: accept only the session's port (name id, sender URL, sender tab / window, no
      port yet), handlers bound to that port; `init` / `query` / `ping` / `pick` (close host, then
      `picker.pick(item, origin, restored)`) / `close` (no origin refocus for reason `blur`) / disconnect
- [ ] host closing, session clearing (disconnects the port, clears the deadline), `handleFrameClosed` /
      `handleTabRemoved` / `handleWindowRemoved`; debug logs behind a `debug` flag passed in
- [ ] no new tests (session flow is wiring around tested decisions); run `make lint && make test && make build`
      - must pass before Task 8

### Task 8: Background wiring

**Files:**
- Modify: `src/background.ts`

- [ ] build candidates: `chrome.tabs.query({})` filtered to normal windows, `getTabAssociations` per window,
      `chrome.bookmarks.getTree()`, `bookmarkRecencyStore.read()`, `recentlyClosedManager.forSpace`,
      `spaceManager.getSpaces()`, the origin window's active Space via `resolveActiveSpaceId`,
      `tabSpaceRegistry.getSpace`
- [ ] a `SearchPicker` with the real deps: `setActiveTabAndSpace` (throws on `success: false`),
      `chrome.tabs.update` for `activateTabOnly`, `chrome.tabs.create` with `windowId`, `associatedTabIds`
      over `getTabAssociations`, `storeTabAssociation` + `saveTabAssociationBackup`, `tabSpaceRegistry.register`,
      `bookmarkSpaceResolver.findSpaceId`, `chrome.bookmarks.remove`, `recentlyClosedManager.reopen`,
      `sidebar-bookmark-open-mode` read raw
- [ ] `onCommand` `search-popup` as `stateReady.then(restored => searchPopup.handleShortcut(restored))`
      (like the switchers); `chrome.runtime.onConnect` for `SEARCH_POPUP_PORT_PREFIX` names;
      `SearchFrameAction.CLOSED` in `runtime.onMessage` (sender tab id); `tabs.onRemoved` /
      `windows.onRemoved` → the popup
- [ ] no new tests (glue; the decisions are tested in Tasks 2-4); run `make lint && make test && make build` -
      must pass before Task 9

### Task 9: Verify acceptance criteria

- [ ] verify every Overview point maps to code: scopes and colours, the 20 cap and the ordering, the empty
      query, the scope row and the toggle, the pick behaviour per kind, Space switching, the keyboard flow
      (open + focus, press-to-move, release-to-pick only after a press, arrows / Enter / click, Esc)
- [ ] verify the CLAUDE.md invariants in the new code: `isSystemFolder` skipping (through
      `collectFolderBookmarks`), no hard-coded bookmark roots, first-Space-wins for a shared folder (bookmarks
      and archive), the `stateReady` result checked before acting on tabs through associations, no tab id kept
      across sessions (the session lives in worker memory, kept alive by the page's ping, and clears with the
      port)
- [ ] run the full suite: `make lint && make test && make build`

### Task 10: [Final] Update documentation

- [ ] `README.md`: a "Search popup" feature section (what it searches, scopes and colours, This Space / All
      Spaces, what a pick does, keys), a shortcuts table row (`not set | Search popup: …`), and the
      `activeTab` permission row (it also draws the search popup over the page)
- [ ] `docs/changelog.md`: a `New:` bullet under `## Latest Version`; `src/data/changelog.ts`: a What's New
      line in `'2.0.388'`
- [ ] `docs/development.md`: the search popup in the project layout / services lines and a short architecture
      note (iframe of `search.html` over the page via `searchPopupFrame.js`, popup window fallback, search in
      background, `web_accessible_resources`, the ping that keeps the worker alive)
- [ ] `docs/state-reference.md`: no new keys; add the search popup as a reader where the reader lists exist
      (`sidebar-bookmark-open-mode`, `bookmarkLastActiveAt`, `recentlyClosedTabs`) and as a writer of
      `tabAssociations_${windowId}` (arc bookmark open)
- [ ] `docs/chrome-web-store-info.md`: the activeTab justification mentions the search popup
- [ ] move this plan to `docs/plans/completed/` (the orchestrator does it at the end; mark only)

## Post-Completion

*Manual checks by the user in Chrome (no checkboxes)*

- Set a shortcut for "Search popup" in `chrome://extensions/shortcuts` (e.g. Option+E) and reload `dist/`.
- On a normal page: the popup opens over the page with the field focused. Typing filters; the page's own
  shortcuts don't fire (e.g. on GitHub type `s` / `t`). Esc and a click outside close it.
- Empty field: the most recent items of This Space. The All Spaces toggle (click and Option+A) adds the other
  Spaces with their names in the subtitle. The scope buttons and Tab / Shift+Tab narrow it, and each colour
  matches its scope.
- Hold the modifier, press twice, release: the second row opens. Press once and release: the popup stays.
- Pick each kind: an open tab in another window focuses that window; a bookmark opens or reuses its Arc tab
  and the sidebar shows it under the bookmark; an archive item opens and leaves the Archive; a recently
  closed tab reopens and leaves Recently Closed; a result from another Space switches the Space.
- On `chrome://extensions` and the New Tab page the popup comes up as a small window. Switching to another
  app closes it without pulling Chrome back to the front.
- Leave the popup open for 60 s, then type and press Esc: results still come, and Esc closes it.
- Click a scope button, then type: the text goes into the search field.

**Known limitations** (from the design):
- `[known-limitation]` If the modifier is released before the popup page has keyboard focus (a double press
  within ~100 ms), the popup stays open with the moved selection.
- `[known-limitation]` The results are a snapshot taken when the popup opens.
- `[known-limitation]` Background and sidebar both write `tabAssociations_{windowId}`. A bookmark opened from
  the popup at the same moment as a sidebar association write can lose one entry.
