# Development

How to build, test and change the extension. For what it does, see the [README](../README.md).

## Setup

Node.js 18+ and npm.

```bash
make install   # npm ci
make build     # type-check and build into dist/
```

Load `dist/` in Chrome: `chrome://extensions` → Developer mode → Load unpacked. After a rebuild, press reload on the extension card.

## Make targets

| Target | What it does |
| --- | --- |
| `make install` | `npm ci` |
| `make dev` | Vite dev server |
| `make build` | `tsc` + production build into `dist/` |
| `make build-debug` | Same with `--mode development`: `import.meta.env.DEV` is true, debug logging and the DEV menu items are on |
| `make test` | Unit tests (`node --test tests/*.test.mjs`) |
| `make lint` | ESLint (`.eslintrc.cjs`), fails on any warning |
| `make chrome` | Chrome with a fresh test profile (`tools/start-test-chrome.sh`) |
| `make screenshot` | Retake `asset/sidebar.png` from a fresh profile with the fake data in `tools/screenshot/fake-data.mjs`. Needs the network; installs Playwright into `tmp/screenshot/`, not `package.json` |
| `make version` | Bump the version in `package.json` and `manifest.json` |
| `make release` | Build and zip into `releases/` |
| `make tag` | Local `release-{version}` git tag |
| `make clean` | Remove `dist/` and `releases/` |

## Tests

`tests/*.test.mjs` run under Node with TypeScript type stripping, no bundler. A module that a test imports has to follow the rules in [CLAUDE.md](../CLAUDE.md#testing): `.ts` import extensions, no `chrome.*` at import time, no `import.meta.env`, no enums or other TS-only runtime syntax. So pure logic lives in `src/utils/`, `src/stores/` and `src/services/` and takes Chrome APIs as arguments.

`src/tests/*Test.ts` are older in-browser checks (search parser, undo of delete and close actions). A debug build runs them from the sidebar menu ("Unit Test ...").

Tests cover decisions that are easy to get wrong: which tabs auto-archive closes, how stored tabs match live ones after a restart, tree visibility. Trivial helpers and wiring don't get tests.

## Project layout

```
public/          manifest.json, icons, static pages
src/
  background.ts  service worker: tab events, Space ownership, auto-archive, keyboard switchers
  main.tsx       side panel entry; App.tsx is the root component
  components/    React UI
  contexts/      React contexts (bookmark-tab associations, Spaces, selection, font size)
  hooks/         hooks over Chrome APIs and shared state
  managers/      background-owned state and its sidebar proxies (see below)
  stores/        storage-backed classes without React (tab activity, session marker, ...)
  services/      longer flows: auto-archive, AI naming, keyboard switchers
  actions/       undoable user actions (close tabs, delete bookmark, archive tabs, ...)
  utils/         pure helpers, most of them covered by tests/
  data/          What's New entries (changelog.ts)
tests/           Node unit tests
tools/           release and version scripts
docs/            changelog, store listing, state reference, plans
```

[docs/state-reference.md](state-reference.md) lists every storage key, its owner and its lifespan.

## Shared state

There is one background service worker and one sidebar per window. All of them can read and write `chrome.storage.local` and `chrome.storage.session`. Two writers on one key race. Each does read-modify-write of the whole value, and a write landing between the other's read and write is lost.

The fix is one owner per key. The owner is a manager in `background.ts`. The sidebar talks to it through a proxy.

```
sidebar                                  background.ts
  component                                routeMessage(action)
    | calls                                  | split on "_msg_"
  proxy.method(...)  ------- message ------> manager.dispatch(method)
    | reads, synchronous                     | memory + chrome.storage
  mirror store  <---------- broadcast ------ +
```

| Manager | Storage key |
| --- | --- |
| `SpaceWindowStateManager` | `spaceWindowState_{windowId}` (session) |
| `SpaceManager` | `spaces` (local) |
| `TabHistoryManager` | `bg_windowTabHistory` (session) |
| `TabSpaceRegistry` | `bg_tabSpaces` (session) |
| `LastAudibleTracker` | `bg_lastAudibleTabIds` (session) |
| `FavoriteIconsManager` | `favoriteIcons` (local) |
| `AttentionMarkManager` | `attentionMarkedTabs`, `attentionMarkedBookmarks` (local) |

Code lives in `src/managers/`: `impl/` has the managers (background only), `proxies/` the sidebar clients, `shared/` the API interfaces both sides import. A manager implements `XApi`, its proxy implements `Remote<XApi>`, the same methods returning promises. Adding a method to one side and forgetting the other fails the type check.

### Message routing

An action string is `<managerId>_msg_<method>`, e.g. `TabSpaceRegistry_msg_register`. `background.ts` splits on `_msg_` and looks up the manager by exact match. Prefix matching would misroute when one id is a prefix of another. `registerManager` throws on a duplicate manager id. The router awaits `stateReady` once, so manager methods don't have to. `src/managers/proxies/messageRouting.ts` holds the vocabulary for both sides.

A few messages coordinate several managers and stay as plain handlers in `background.ts`: `set-active-tab-and-space`, `queue-tab-for-grouping`, `tab-activated`, `deassociate-tab`. `tab-reopened-by-undo` is one too: it hands each tab the sidebar's Undo re-created to `TabActivityTracker`, the writer of `tabLastUsedAt`.

### Mirror store

Reads never leave the sidebar. Components call things like `isBookmarkLoaded(id)` during render, and render can't wait for a message. Each proxy keeps a mirror of the manager's state in an `ExternalStore` (`src/stores/externalStore.ts`), and components read it with `useSyncExternalStore`.

The mirror is a plain object, not React state, because a mutation has to be visible to the next line of code. `setState(next)` only schedules a render, and the running function still holds the old value.

A mutation goes like this:

1. The proxy writes the mirror right away (optimistic write). The caller's next read sees it.
2. The proxy sends the message with `senderId: CONTEXT_ID`, a random id per extension context.
3. The manager writes storage, responds, and broadcasts the new state with the same `senderId`.
4. The proxy does not apply the response to its mirror. The mirror is already right, and applying a late response for an older call would overwrite a newer optimistic write.
5. Every proxy skips broadcasts carrying its own `CONTEXT_ID`. Other windows apply them.

A failed write re-reads the state from background instead of rolling back, since a rollback could undo a later write that did succeed.

`getSnapshot` must return the same object until the value changes. Returning a fresh array per call makes React re-render forever.

### Per-operation writes

Spaces are written as a whole list (`updateSpaces(spaces)`). That is safe only because the sidebars are the only writers.

Favorite icons also have a background writer that nobody asked for, the favicon patcher. A whole-store write built from a mirror that hasn't received the favicon yet would drop it. So `FavoriteIconsApi` names the change: `setIcons(id, fields)`, `setFavicons(patches)`, `removeIcons(ids)` and so on. The manager applies it to its own store, and two writers collide only when they touch the same Favorite. Each operation is a method of the immutable `FavoriteIcons` class in `managers/shared/favoriteIconsApi.ts`, used by the manager for the real store and by the proxy for the optimistic write.

The Favorites list itself (which bookmarks, their order, url and title) is the Space's `asd_Favorites` bookmark folder. The sidebar changes it with `chrome.bookmarks` calls, like any other bookmark; only the icon fields go through the manager.

A favicon patch records what it was resolved for: the site icon or one `customIconName`. The manager drops a patch whose Favorite has changed icons since.

### Broadcasts that arrive mid-write

The `senderId` check only skips a context's own echo. A broadcast from another writer that arrives while this context has a write in flight can bring back something the user just removed. `favoriteIconsManagerProxy` counts in-flight writes, drops foreign broadcasts while the count is above zero, and re-reads the store when the last write returns.

`spaceManagerProxy` has the same gap and no counter yet. Hitting it takes two windows editing Spaces within milliseconds, and the next edit repairs it.

### Not behind a manager yet

Tab ↔ bookmark/Favorite associations (`tabAssociations_{windowId}` in session, `tabAssociationsBackup_*` in local) are still written from both `background.ts` and `BookmarkTabsContext.tsx` through `src/utils/tabAssociations.ts`. `TabAssociationSessionStore` serializes writes within one context, not across contexts. Moving them behind a `TabAssociationManager` is the remaining step.

`BookmarkTabsContext.tsx` also keeps `itemToTab` and `tabToItem` as two separate `Map`s that every write updates by hand. A class that owns both directions would stop them from drifting apart.

## Favicon loading

`PinnedSite.favicon` is a base64 data URL, fetched once and stored in `favoriteIcons` under the Favorite's bookmark id. Chrome's `_favicon` API returns a grey globe for pages it hasn't cached. `favicon.ts` detects that and discards it.

1. Pin an open tab. Chrome has the icon cached, so the fetch succeeds. The caller's `faviconUrl` is the fallback.
2. Import our own backup. It already carries `favicon`. Old backups without it go through scenario 4.
3. Import from Arc. Only `url`, `title`, `emoji` and `customIconName` come over, so scenario 4 fills in icons.
4. Lazy resolve in `usePinnedSites.ts` when the list changes. A `customIconName` without `favicon` is fetched from Iconify. A pin with no icon at all retries Chrome's cache on every change until the page has been visited.
5. A tab reports a new `favIconUrl` (`tabs.onUpdated` in `background.ts`). Favorites of every Space (all `asd_Favorites` folders) on the same hostname without `favicon`, `customIconName` or `emoji` get it. This runs in background because `tabs.onUpdated` doesn't fire reliably in the side panel.
6. "Reset to site icon" in Edit Pin re-fetches from Chrome's cache.

## Chrome API rules

These caused real bugs before:

- Pass `windowId` to `chrome.tabs.create()` from the sidebar. Without it Chrome creates the tab in the focused window, not the sidebar's window. Calls on one tab id (`remove`, `update`, `get`) don't need it.
- Filter `chrome.tabGroups.query()` by `windowId`. Groups belong to one window.
- Pass `createProperties: { windowId }` when `chrome.tabs.group()` creates a new group. Otherwise Chrome creates it in the focused window and moves the tabs there.
- Background state has to live in `chrome.storage.session`. Chrome stops an idle service worker after about 30 seconds and drops everything in memory.
- Batch tab and group calls. Several concurrent `chrome.tabs.group()` calls can produce wrong groups. Pass all ids in one call or queue the operations.
- Listen to `chrome.tabs.onDetached` as well as `onRemoved`. A tab moved to another window only fires `onDetached`.
- Tab and window ids are only unique within one browser session. See "Tab identity across restarts" in [CLAUDE.md](../CLAUDE.md).
- Bookmark root ids `'1'`, `'2'`, `'3'` are not guaranteed. Chrome profiles with account-only bookmarks have different roots.

UI rules:

- A dropdown that closes on an outside click puts a transparent overlay under itself, so the click doesn't also hit the row below.
- Hovering a folder during drag and drop expands it and never collapses it.

## What's New and changelog

- `src/data/changelog.ts` maps a version to user-facing lines. After an upgrade the sidebar shows the lines for every version newer than the one the user last saw. A version without an entry upgrades silently, so leave bug-fix-only releases out. The menu's "What's New" shows the last three entries.
- [docs/changelog.md](changelog.md) is the full changelog. New items go under `## Latest Version` until a release names it.

## Release

Not published to the Chrome Web Store yet. [tools/prepare-release-instructions.md](../tools/prepare-release-instructions.md) has the steps (version bump, changelog, What's New, store listing). [docs/chrome-web-store-info.md](chrome-web-store-info.md) holds the listing text and permission justifications. `make release` builds `releases/sidebar-for-arc-users-{version}.zip`.

## Workflow

1. Plan the change in `docs/plans/YYYYMMDD-<name>.md`, including what was decided with the user. A finished plan moves to `docs/plans/completed/`.
2. Implement on a branch, with tests for the decisions that matter.
3. Review with revmux. The project profile is `.revmux/profile.md`; run data under `.revmux/` stays untracked.
4. Open a PR against `main` of this repo. This fork does not send changes upstream.

When behaviour changes, update the README for users, [docs/state-reference.md](state-reference.md) for new storage keys, `docs/changelog.md` and, for features worth announcing, `src/data/changelog.ts`.
