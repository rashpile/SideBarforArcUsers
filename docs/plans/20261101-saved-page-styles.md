# Saved page styles for bookmarks

## Overview

The page agent (experimental) writes CSS that lives only in the tab's chat (`chrome.storage.session`) and
on the page (`chrome.scripting.insertCSS`). A reload drops it (the chat offers Re-apply), a browser
restart deletes the chat, so the generated CSS is lost.

This plan lets the user save the agent's current CSS to the bookmark (or Favorite) the tab was opened
from, and switch on **Auto-apply**, so the background re-applies it whenever a page of the same site
loads in that bookmark's tab, also after a browser restart. The drawer gets a style strip and a **Save to
bookmark** button; bookmark rows with a saved style show a small brush icon; bookmark and Favorite context
menus get a **Page style** submenu.

Design: decided in brainstorm (design doc kept by the make-task run). Scope chosen by the user: the
bookmark's associated tab, any page on the origin the style was saved on; a hand-opened tab of the same
site stays unstyled.

## Context (from discovery)

- Page agent: `src/services/pageAgent/` (`pageAgentChats.ts` owns chats and runs per panel,
  `pageAgentChat.ts` holds `appliedCss` / `appliedInsertedText` / `appliedId` / `appliedUrl` / `notice`,
  `chromePageAdapter.ts` does `insertCSS` / `removeCSS` / `readMarker`, `panelPageAgent.ts` builds the
  panel's `PageAgentChats`), UI in `src/components/pageAgent/PageAgentDrawer.tsx` and
  `PageAgentMessages.tsx`, wired in `src/App.tsx` (~line 1056, `pageAgentChats`, `checkMarker` on tab
  `complete`).
- CSS helpers: `src/utils/pageAgentCss.ts` (`PageAgentCssSanitizer.check`, `withMarker(css, appliedId)`,
  `PAGE_AGENT_MARKER_PROPERTY`, `PAGE_AGENT_CSS_ORIGIN = 'USER'`); `readPageMarker` in
  `src/services/pageAgent/pageScripts.ts` (self-contained, injectable).
- Manager pattern to copy: `AttentionMarkManager` (`src/managers/impl/attentionMarkManager.ts`), its
  API `src/managers/shared/attentionMarkApi.ts`, proxy with mirror `src/managers/proxies/attentionMarkProxy.ts`,
  hook `src/hooks/useAttentionMarks.ts`, ids in `src/managers/proxies/messageRouting.ts` (`ManagerId`),
  `registerManager` in `src/background.ts`, test `tests/attentionMarkManager.test.mjs`.
- Associations: `getTabAssociations(windowId)` in `src/utils/tabAssociations.ts` (item keys
  `bookmark-<id>`, `pinned-<id>`, constants `BOOKMARK_ITEM_KEY_PREFIX`, `FAVORITE_ITEM_KEY_PREFIX`);
  `stateReady = tabAssociationReadiness.wait()` in `background.ts`; `getItemKeyForTab(tabId)` in
  `src/contexts/BookmarkTabsContext.tsx`. A Favorite's id is its bookmark node id.
- UI: bookmark rows and their context menu in `src/components/BookmarkTree.tsx` (hover `actions`,
  `ContextMenu.Sub` / `SubTrigger` / `SubContent` in `src/components/menu/ContextMenu.tsx`), Favorite
  context menu in `src/components/PinnedIcon.tsx`.
- Tests: `make test` = `node --test tests/*.test.mjs`; tested modules use `.ts` sibling imports, take
  chrome APIs as arguments, never read `import.meta.env`, no enums / parameter properties / namespaces.

## Development Approach

- **testing approach**: Regular (code first, then tests in the same task)
- complete each task fully before moving to the next
- make small, focused changes
- tests follow the repo rule "test decisions, not coverage" (`CLAUDE.md`): write tests for behaviour that
  acts on the wrong tab or bookmark or loses data when it breaks. No tests for trivial helpers, wording,
  UI wiring or labels; such tasks say so instead of listing a test item
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run `make test`, `npx tsc --noEmit` (or `make build`) and `make lint` after each task
- code style: Allman braces, classes over raw structures, comments say why, debug logs only behind a
  debug flag (`import.meta.env.DEV` in non-tested modules, passed in as a flag to tested ones)

## Testing Strategy

- **unit tests**: `node --test` over `tests/*.test.mjs` for the store, the manager, the applier and the
  chat adoption
- **e2e tests**: the project has none; UI is checked by hand (Post-Completion)

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

- A saved style is a per-bookmark record in one `chrome.storage.local` key, `bookmarkPageStyles`, owned by
  a new background manager `PageStyleManager` (one writer per key: the background also writes when a
  bookmark is deleted). The sidebar reaches it through a proxy with a mirror, like attention marks.
- A background `PageStyleApplier` inserts the saved CSS when a page commits in a tab associated with the
  bookmark (`bookmark-<id>` or `pinned-<id>`) and the page's origin is the style's origin. A load-complete
  check covers tabs whose association was stored after the commit; in a new browser session a sweep after
  the association restore covers tabs that loaded before it (not on a worker restart, where it would undo
  an Undo). Nothing is applied when the restore failed (`stateReady` false).
- The inserted text is `withMarker(css, 'saved-' + rev)`, so the side panel can recognize and remove the
  sheet the background inserted (`removeCSS` matches by exact text).
- The panel's `PageAgentChats` adopts a saved style it finds on the page (marker `saved-<rev>`) as the
  chat's current stylesheet: follow-ups edit it, Undo removes it, Show CSS shows it, and a run's
  `apply_css` replaces it instead of stacking a second sheet.
- Toggle and Remove change only future loads; the page in front of the user changes only through the
  drawer (Undo, Apply).

## Technical Details

`SavedPageStyle` (one per bookmark id):

| field | type | meaning |
|---|---|---|
| `css` | string | sanitized stylesheet without the marker |
| `autoApply` | boolean | apply on page loads in the bookmark's tab |
| `origin` | string | `new URL(url).origin` of the page it was saved on (http/https only) |
| `rev` | string | random id, new on every save |

Stored value of `bookmarkPageStyles`: `{ [bookmarkId]: SavedPageStyle }`. Parsing drops entries that are
malformed (wrong types, non-http(s) origin); a value that isn't an object at all marks the store as not
loaded (see Task 2).

Derived values (methods on the record class, shared by background and panel):
- `appliedId` = `'saved-' + rev`
- `insertedText` = `withMarker(css, appliedId)`
- `appliesTo(url)` = url is http(s) and its origin equals `origin`

Manager API (`PageStyleApi`), each returning the full state for resync:
- `save(bookmarkId, css, pageUrl)`: sanitizer check (refuse with the reason), origin from `pageUrl`
  (refuse non-http(s)), new `rev`; `autoApply` true for a new record, kept for an update
- `setAutoApply(bookmarkId, on)`, `remove(bookmarkId)`, `getState()`
- background-only: `handleBookmarksRemoved(ids)` with the ids `background.ts` already computes with
  `collectBookmarkIds` in its `chrome.bookmarks.onRemoved` handler (same as AttentionMarkManager and
  FavoriteIconsManager), chained on `stateReady`
- `load()` runs inside `managerLoadPromise` and never rejects (a broken key must not turn `stateReady`
  false and pause auto-archive and the restore)
- broadcast `PAGE_STYLES_CHANGED` with the state and `senderId`

Applier decision for a tab (all must hold): tab not incognito, has an id and an http(s) URL; the tab's
association (`getTabAssociations(tab.windowId)[tabId]`) is `bookmark-<id>` or `pinned-<id>`; a style for
that id exists with `autoApply`; `appliesTo(tab.url)`; `PageAgentCssSanitizer.check(css).ok`.

Applier triggers:
- `chrome.webNavigation.onCommitted` with `frameId === 0`: decide; insert `insertedText` without a marker
  check (fresh document) - except when `transitionQualifiers` includes `forward_back`: a back/forward-cache
  restore brings back a document that still has its sheets, so that commit is left to the load-complete
  path, which reads the marker (inserting the same text twice leaves a copy Undo can't remove, and
  inserting over the chat's own sheet orphans it)
- `chrome.tabs.onUpdated` with `status === 'complete'`: decide; read the marker; insert only when it is
  `''` (another id means the chat owns the page; the same id means it's already there)
- startup sweep (the load-complete check for every open tab) runs only when `stateReady` resolved `true`
  **and** `sameBrowserSession` resolved `false` (a new browser session or an extension reload).
  `stateReady` resolves on every service-worker start; a sweep on a worker restart would put the style
  back on a page where the user just pressed Undo
- when `stateReady` resolves `false`, no trigger acts (events before readiness wait for it)

Chat adoption (`PageAgentChats`), through an injected `savedStyleForTab(tabId)` that returns the tab's
`{ bookmarkId, style }` or null:
- `checkMarker(tabId)`: early return (no page read) when the chat has no applied sheet and the tab has no
  saved style, so an empty chat never gets a "Page reloaded" notice and no `executeScript` runs on every
  load. Marker equals the saved style's `appliedId` and differs from `chat.appliedId` →
  `chat.recordApplied({ css, insertedText, appliedId, url })` (clears the notice). After the await the
  stale guard also checks that the tab's saved style rev is still the one read before
- `usePageAgentChat` runs the show-time check when the chat has an applied sheet **or** the tab has a saved
  style, and again when the tab's saved style rev changes (the proxy mirror may load after the drawer
  opens; a style saved in another window)
- `applySaved(tabId)`: refused during a run; reads the marker first: already the saved `appliedId` → only
  record it; otherwise remove the chat's current sheet if any, insert the saved `insertedText`, record it
- save goes from the drawer straight to the manager proxy with `chat.appliedCss` and `chat.appliedUrl`
- "the saved style is the page's current sheet" is decided by CSS text (`chat.appliedCss === style.css`),
  not by `appliedId`: right after Save the chat's sheet still carries the run's id

## What Goes Where

- **Implementation Steps**: code, tests and docs in this repo
- **Post-Completion**: manual checks in Chrome on the user's site

## Implementation Steps

### Task 1: Saved page style records

**Files:**
- Create: `src/stores/savedPageStyles.ts`
- Create: `tests/savedPageStyles.test.mjs`

- [x] create `SavedPageStyle` (immutable class: `css`, `autoApply`, `origin`, `rev`, getters
  `appliedId`, `insertedText` via `withMarker`, method `appliesTo(url)`) and `SavedPageStyles` (immutable
  collection keyed by bookmark id: `fromStored(value)`, `toStored()`, `styleFor(id)`, `withSaved(id,
  css, origin, rev)` keeping `autoApply` of an existing record and `true` for a new one,
  `withAutoApply(id, on)`, `without(ids)`)
- [x] add `bookmarkIdFromItemKey(itemKey)` in the same file (keeps the tested module free of
  `tabAssociations.ts`'s import chain) for `bookmark-<id>` and `pinned-<id>`, null otherwise; its prefixes
  are covered by the applier tests in Task 4
- [x] `fromStored`: `undefined` → empty; non-object → throw (caller decides); malformed entries and
  non-http(s) origins dropped
- [x] write tests: an update keeps `autoApply` off after the user switched it off; `without` drops only
  the given ids; `appliesTo` refuses another origin and non-http(s) URLs
- [x] run `make test` - must pass before next task

### Task 2: PageStyleManager in the background

**Files:**
- Create: `src/managers/shared/pageStyleApi.ts`
- Create: `src/managers/impl/pageStyleManager.ts`
- Modify: `src/managers/proxies/messageRouting.ts`
- Create: `tests/pageStyleManager.test.mjs`

- [x] add `ManagerId.PAGE_STYLES = 'PageStyleManager'`, the key constant `BOOKMARK_PAGE_STYLES_KEY =
  'bookmarkPageStyles'`, `PageStyleApi`, `PageStylesState` and `PAGE_STYLES_CHANGED`
- [x] implement `PageStyleManager` (`RoutedManager` + `PageStyleApi`) on `SavedPageStyles`: load from
  `chrome.storage.local`, serialized write queue, broadcast with `senderId`, `save` refuses CSS that fails
  `PageAgentCssSanitizer.check` and pages that aren't http(s) (error with the reason), `rev` from an
  injectable id factory
- [x] `load()` never rejects (logs and starts empty on a storage error)
- [x] `handleBookmarksRemoved(ids)`: takes the ids `background.ts` computes with `collectBookmarkIds`
  (removed node plus subtree); drops their styles; no write when nothing matched
- [x] "loaded" guard as in AttentionMarkManager: an unreadable stored value starts empty and background
  events don't write until the user's next save/toggle/remove
- [x] write tests: removing a bookmark's id, and the ids of a folder holding it, drops its style and keeps
  others; save refuses CSS with `@import` / remote `url(` and keeps the stored value unchanged; an
  unreadable stored value isn't overwritten by a bookmark-removed event
- [x] run `make test` - must pass before next task

### Task 3: Sidebar proxy and hook

**Files:**
- Create: `src/managers/proxies/pageStyleProxy.ts`
- Create: `src/hooks/usePageStyles.ts`

- [x] implement the proxy like `attentionMarkProxy.ts`: mirror in an `ExternalStore`, optimistic writes
  through the same `SavedPageStyles` operations for `setAutoApply` and `remove`; `save` is not optimistic
  (the manager makes `rev`, and Save is a rare deliberate click): the mirror takes the manager's response;
  own echo skipped, foreign broadcasts held while writes are in flight
- [x] expose the mirror's current `SavedPageStyles` for non-React readers (`store.getSnapshot()`), which
  Task 6's resolver reads at call time
- [x] hook `usePageStyles()` returning `styleFor(bookmarkId)`, `save`, `setAutoApply`, `remove`
- [x] no tests: wiring over the tested store and manager (repo rule)
- [x] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 4: PageStyleApplier

**Files:**
- Create: `src/services/pageStyleApplier.ts`
- Create: `tests/pageStyleApplier.test.mjs`

- [x] implement `PageStyleApplier` with its dependencies passed in: `ready: Promise<boolean>`,
  `sameBrowserSession: Promise<boolean>`, `associationsOf(windowId)`, `styles()` (current
  `SavedPageStyles`), `getTab(tabId)`, `queryTabs()`, `insertCss(tabId, text)`, `readMarker(tabId)`,
  `debug` flag
- [x] `committed(tabId, frameId, transitionQualifiers)`, `loadComplete(tabId)` and `sweep()` per
  Technical Details; every entry point awaits `ready` and does nothing when it is `false`; a
  `forward_back` commit inserts nothing (left to `loadComplete`); `start()` awaits `ready` and sweeps only
  when `sameBrowserSession` is `false`
- [x] errors (no host permission, unscriptable page, closed tab) are caught and logged only when `debug`
- [x] write tests: inserts for a `bookmark-` and a `pinned-` association on the saved origin; nothing for
  a hand-opened tab on the same site, an unrelated item key, another origin, `autoApply` off, CSS failing
  the sanitizer, an incognito tab; nothing at all when `ready` resolved false; `loadComplete` inserts only
  when the marker is empty; `start()` in a new browser session inserts into an already-loaded associated
  tab; `start()` on a worker restart (same session) inserts nothing into an associated tab whose marker is
  empty; a `forward_back` commit inserts nothing
- [x] run `make test` - must pass before next task

### Task 5: Wire manager and applier into the background

**Files:**
- Modify: `src/background.ts`
- Modify: `public/manifest.json`

- [x] create and `registerManager` the `PageStyleManager`; add `pageStyleManager.load()` to
  `managerLoadPromise`, so `styles()` is loaded by the time `stateReady` resolves (`onCommitted` is often
  the event that wakes the worker)
- [x] in the existing `chrome.bookmarks.onRemoved` handler, call
  `stateReady.then(() => pageStyleManager.handleBookmarksRemoved(ids))` next to the attention-mark and
  favorite-icon calls (after the load, so the load can't bring back a removed style)
- [x] create the applier with `stateReady`, `sameBrowserSession`, `getTabAssociations`, the manager's
  current styles,
  `chrome.scripting.insertCSS` with `PAGE_AGENT_CSS_ORIGIN`, and a marker read through
  `chrome.scripting.executeScript` with `readPageMarker` / `PAGE_AGENT_MARKER_PROPERTY`; debug flag from
  `import.meta.env.DEV`
- [x] listen to `chrome.webNavigation.onCommitted` (top frame, passing `transitionQualifiers`) and
  `chrome.tabs.onUpdated` (`complete`); call `start()` once
- [x] add `"webNavigation"` to `permissions` in `public/manifest.json`
- [x] no tests: wiring (repo rule)
- [x] run `make test`, `make build` and `make lint` - must pass before next task

### Task 6: Chat adopts and applies saved styles

**Files:**
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/services/pageAgent/panelPageAgent.ts`
- Modify: `src/hooks/usePageAgentChat.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx` (➕ passes the active tab's saved style rev to
  the hook; Task 7 reworks these props)
- Modify: `tests/pageAgentChats.test.mjs`

- [x] add an optional `savedStyles` option to `PageAgentChatsOptions`: `styleForTab(tabId)` returning
  `{ bookmarkId, style }` or null
- [x] `checkMarker`: early return without a page read when the chat has no applied sheet and the tab has
  no saved style; adopt the saved style when the marker equals its `appliedId` and differs from the
  chat's (also when the chat had no applied CSS or no turns); keep the existing stale-answer guards and add
  one for the saved style's rev changing during the read
- [x] `applySaved(tabId)`: refused during a run; read the marker; already the saved `appliedId` → only
  record it; otherwise remove the chat's current sheet, insert the saved `insertedText`, record it as
  applied with the page URL
- [x] `usePageAgentChat`: run the show-time `checkMarker` when the chat has an applied sheet or the tab
  has a saved style; re-run it when the tab's saved style rev changes; expose `applySaved`
- [x] in `App.tsx`, build the resolver so it reads `getItemKeyForTab` through a ref updated every render
  (the chats are created once in `useState`, and `getItemKeyForTab` is a `useCallback` over changing
  state) and the proxy's `store.getSnapshot()` at call time; pass it into `createPanelPageAgentChats`
- [x] write tests: adoption on a matching marker into an empty chat (no turns); a following run starts
  with the saved css and inserted text (so the run's first `apply_css` removes it); no adoption for a
  marker of another rev; an empty chat with marker `''` and no saved style gets no notice and no page read;
  `applySaved` records without inserting when the marker already equals the saved id, inserts otherwise,
  and is ignored while a run is live
- [x] run `make test` - must pass before next task

### Task 7: Drawer style strip and Save button

**Files:**
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `src/components/pageAgent/PageAgentMessages.tsx`
- Modify: `src/App.tsx`
- Modify: `src/hooks/usePageAgentChat.ts` (➕ `runAction(label, action)`, so save / toggle / remove
  errors reach `actionError` like Undo's)
- Modify: `src/hooks/usePageStyles.ts` (➕ `PageStyleActions` type; drops callManager's
  "PageStyleManager.<method> failed:" prefix so the drawer shows only the reason)

- [x] drawer props get the active tab's bookmark (id + title) when `getItemKeyForTab` resolves to a
  bookmark or Favorite, and the `usePageStyles` actions (App passes the id, the saved style and the
  actions; the drawer reads the title from the shared bookmark tree while it is open)
- [x] style strip under the header (only with a bookmark): bookmark title (truncated), "style saved" /
  "no saved style", an **Auto-apply** switch, **Apply** when the saved style isn't the chat's current
  sheet (compared by CSS text: `chat.appliedCss !== style.css`), **Remove** (deletes the saved record,
  not the sheet on the page); buttons in the drawer's existing classes; disabled while the tab has a live
  run (Auto-apply, Apply and Remove show only with a saved style; the switch is the repo's checkbox)
- [x] a chat with an applied sheet and no turns (an adopted saved style on a fresh tab or after a browser
  restart) shows **Undo** and **Show CSS** in place of the empty-chat hint (the hint text stays above
  them), so the auto-applied style can be removed from the page and seen
- [x] **Save to bookmark** in the last turn's report block next to Undo / Show CSS, labelled "Save to
  bookmark" / "Update saved style" / "Saved" (disabled, with a check) by comparing the saved css with
  `chat.appliedCss`; disabled with the tooltip "Open this page from a bookmark to save its style" when the
  tab has no bookmark
- [x] save / toggle / remove / apply errors go to the drawer's `actionError`
- [x] strip and Save work without AI settings (only the textarea is blocked by them)
- [x] no tests: UI (repo rule)
- [x] run `make test`, `make build` and `make lint` - must pass before next task

### Task 8: Brush icon and Page style submenu in the tree

**Files:**
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/components/PinnedIcon.tsx`
- Modify: `src/components/PinnedBar.tsx` (if the hook is called there rather than in `PinnedIcon.tsx`)
- Create: `src/components/PageStyleMenu.tsx` (➕ the brush badge and the Page style submenu, shared by
  the tree and the Favorites)
- Modify: `src/hooks/usePageStyles.ts` (➕ `styleStateFor(bookmarkId)` returning the primitive state)

- [x] call `usePageStyles()` in `BookmarkTree.tsx` (as it already calls `useAttentionMarks()`) and in
  `PinnedBar.tsx` or `PinnedIcon.tsx`; pass each row a primitive style state (`'none' | 'on' | 'off'`) so
  memoized rows keep working
- [x] bookmark rows with a saved style show a lucide `Paintbrush` icon (size 12-14) at the right: accent
  (blue) when auto-apply is on, gray when off, `title` "Saved page style · auto-apply on" / "off"; hidden
  while the hover actions show (`group-hover:hidden` or equivalent) so the row doesn't jump
- [x] bookmark context menu (single bookmark, not multi-select): **Page style ▸** submenu when the
  bookmark has a saved style, with "Auto-apply on load" (check mark when on) and "Remove saved style"
- [x] Favorite context menu in `PinnedIcon.tsx`: the same submenu; no badge on the tile
- [x] no tests: UI (repo rule)
- [x] run `make test`, `make build` and `make lint` - must pass before next task

### Task 9: Verify acceptance criteria

Code and test checks (in-browser checks are in Post-Completion):

- [ ] the applier inserts only into the bookmark's / Favorite's associated tab on the saved origin with
  auto-apply on, never into a hand-opened tab or another site (`tests/pageStyleApplier.test.mjs`)
- [ ] the startup sweep runs only in a new browser session; a worker restart doesn't undo an Undo; nothing
  is applied when the association restore failed; `forward_back` commits take the marker path
  (`tests/pageStyleApplier.test.mjs`)
- [ ] the chat adopts an auto-applied sheet, also into an empty chat, and a following run replaces it
  instead of stacking; `applySaved` never inserts twice (`tests/pageAgentChats.test.mjs`)
- [ ] deleting a bookmark or its folder drops its style; unsafe CSS is refused on save
  (`tests/pageStyleManager.test.mjs`)
- [ ] read the drawer, tree and menu code once against Tasks 7-8 (Save label states, Apply by CSS text,
  Undo / Show CSS with no turns, icon states, submenu only with a saved style)
- [ ] run full test suite: `make test`; `make build`; `make lint`

### Task 10: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/state-reference.md`
- Modify: `docs/development.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/chrome-web-store-info.md`
- Modify: `PRIVACY.md`

- [ ] README "Page agent (experimental)": saving to a bookmark, Auto-apply, scope (bookmark's tab, same
  site), the strip, the brush icon, the Page style submenu, known limitations below; Permissions table:
  `webNavigation`
- [ ] `docs/state-reference.md`: `bookmarkPageStyles` (local, owner `PageStyleManager`, lifespan: until
  removed or the bookmark is deleted)
- [ ] `docs/development.md`: manager table row for `PageStyleManager`
- [ ] `docs/changelog.md` entry and a `src/data/changelog.ts` What's New entry
- [ ] `docs/chrome-web-store-info.md`: `webNavigation` justification (apply a saved style when a page
  commits in the bookmark's tab)
- [ ] `PRIVACY.md`: a local-storage entry for `bookmarkPageStyles` (the CSS and the site origin it was
  saved on, per bookmark); in the Page Agent section, say that with a saved style on auto-apply the
  extension reads a marker from and inserts CSS into the bookmark's tab on page loads, without a request,
  and that nothing of this goes to the AI endpoint
- [ ] mark the plan's tasks done (the orchestrator moves the plan to `docs/plans/completed/`)

## Known limitations

- `[known-limitation]` Auto-apply needs a tab associated with the bookmark or Favorite (opened from the
  sidebar in Arc mode); the other open modes don't associate tabs.
- `[known-limitation]` A reload with unsaved follow-up CSS brings back the saved style; the unsaved CSS
  remains only in the turn's steps. The Save button reads "Update saved style" before the reload.
- `[known-limitation]` A page that commits before its association is stored (opening a bookmark on a
  cached page) shows unstyled until load complete.
- `[known-limitation]` Switching auto-apply off or removing the style leaves the current page styled until
  a reload or Undo.
- `[known-limitation]` Saved styles aren't in Backup / Restore (restore creates new bookmark ids).
- `[known-limitation]` Two bookmarks on one site each keep their own style; only the tab's own bookmark
  counts.
- `[known-limitation]` The applier runs the work for one tab one at a time, so a commit's insert lands
  before the load-complete check or the startup sweep reads that tab's marker. A tab that navigates again
  while a commit still waits for the startup restore can rarely get the saved sheet twice (the waiting
  commit inserts into the newer page, which its own commit styles again; Undo then leaves one copy until
  a reload).
- `[known-limitation]` When the background styles a page only at load complete (Back without the
  back/forward cache, a bookmark opened on a cached page), the side panel's own load-complete check can
  read the page just before the sheet is in. The open drawer then misses the adopted style (or shows a
  Re-apply notice) until it shows the tab again. Re-apply there removes the saved sheet first when the
  chat had already adopted it; right after a Save (the chat's sheet still the run's) it leaves a second
  copy until a reload.

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- On the user's site (`personal.rashpile.net/videos/u/...`) with the page agent: make the player full
  width, Save to bookmark, reload, open the next video, go Back, restart the browser - the style is on
  each time. Another site in that tab and a hand-opened tab of the same site stay unstyled.
- After a reload: the drawer shows Undo / Show CSS for the adopted style; Undo removes it and it stays
  removed after a minute of idle (worker restart); a follow-up request replaces it (one sheet, Undo clears
  the page); Save then reads "Update saved style".
- Auto-apply off: the next load stays unstyled; **Apply** in the strip puts it back.
- Switch auto-apply off from the row's context menu in a second window; the first window's icon turns
  gray. Delete the bookmark (and, separately, a folder holding one): the style is gone.
- Check the brush icon in light and dark themes and at the smallest font size; check that it hides on
  hover without shifting the row.

**External system updates**:
- Chrome Web Store listing (not published yet): permission justification text from
  `docs/chrome-web-store-info.md` when it is published.
