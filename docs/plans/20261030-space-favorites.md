# Per-Space Favorites in asd_Favorites folders (#22)

## Overview

- Favorites (the icon grid at the top) are one global list today: `pinnedSites` in
  `chrome.storage.local`, the same in every Space. After this change each Space has its own
  Favorites and switching Space switches the grid.
- A Space's Favorites are the bookmarks in a system folder `asd_Favorites`, a direct child of the
  Space's bookmark folder, next to `asd_Archive`. They sync with Chrome bookmarks and survive an
  extension reinstall.
- A bookmark holds url, title and position only. Custom icon, emoji, icon color and the cached
  favicon live in a side store keyed by bookmark id, owned by a background manager.
- Existing Favorites are copied once into every Space that has a bookmark folder.

## Context (from discovery)

- Favorites today: `src/hooks/usePinnedSites.ts` (hook), `src/managers/impl/pinnedSitesManager.ts`
  (background owner of `pinnedSites`), `src/managers/proxies/pinnedSitesManagerProxy.ts` (mirror),
  `src/managers/shared/pinnedSitesApi.ts` (type, wire contract, pure transforms),
  `src/components/PinnedBar.tsx`, `src/components/PinnedIcon.tsx`,
  `src/actions/deletePinnedSiteAction.ts` (undo), `src/background.ts` (favicon update on
  `favIconUrl`, manager registration, `getPinnedSites` for the archiver).
- Tab side: `src/contexts/BookmarkTabsContext.tsx` (owner of `tabAssociations_${windowId}`, keys
  `pinned-<id>`; reads `pinnedSites` straight from storage for URL recovery),
  `src/utils/parkedTabAssociation.ts` (`buildPersistentItemUrlIndex`).
- Auto-archive: `src/services/tabAutoArchiver.ts` (`getPinnedSites`),
  `src/utils/autoArchivePolicy.ts` (`SavedPages.fromTree(roots, favorites)`).
- Archive folder pattern: `src/utils/archiveFolder.ts` (`ARCHIVE_FOLDER_TITLE`, `isArchiveFolder`,
  `findArchiveFolder`, `SpaceArchive` with an injected bookmarks API), tested in
  `tests/archiveFolder.test.mjs` with `tests/fakeArchiveBookmarks.mjs`.
- `isArchiveFolder` walk sites: `bookmarkTreeVisibility.ts`, `BookmarkTree.tsx`,
  `FolderPickerDialog.tsx`, `folderRecentItems.ts`, `bookmarkOperations.ts`, `useBookmarks.ts`,
  `parkedTabAssociation.ts`. Archive-only: `ArchiveSection.tsx`, `clearArchiveAction.ts`.
- Import/export: `src/utils/backupRestore.ts`, `ImportDialog.tsx`, `ExportDialog.tsx`,
  `src/utils/arcImport.ts`, `ArcImportDialog.tsx` ("Top Apps as Pinned Sites").
- Search: PinnedBar filters its own list with `matchesFilter`, so it covers the active Space's
  Favorites once the list is per Space.
- Space resolution: `findFolderBySegments(space.bookmarkFolderSegments, space.bookmarkFolderInAccount)`
  and `spaceFolderId(roots, spaces, spaceId)` (archiver); `src/utils/bookmarkFolderLookup.ts`.

## Development Approach

- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- make small, focused changes
- tests follow CLAUDE.md "Test decisions, not coverage": write tests for behaviour that loses data
  or acts on the wrong tab, bookmark or Space when it breaks. Skip tests for trivial helpers,
  wording and UI wiring; a task whose checklist has no test item has nothing of that kind
- tested modules follow CLAUDE.md "Testing": `.ts` sibling imports, chrome/storage APIs injected,
  no `chrome.*` at import time, no `import.meta.env` (pass `import.meta.env.DEV` in), no enums or
  parameter properties
- **CRITICAL: all tests must pass before starting next task** - `make test`
- **CRITICAL: update this plan file when scope changes during implementation**
- Allman braces, comments say why, classes over raw records (CLAUDE.md "Code rules")

## Testing Strategy

- unit tests: `node --test tests/*.test.mjs` (`make test`), for the decisions listed per task
- no e2e suite in the project; UI behaviour goes to Post-Completion manual checks
- checks that gate the branch: `make lint && make test && make build`

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- keep plan in sync with actual work done

## Solution Overview

- **Folder**: `asd_Favorites`, direct child of the Space folder. The grid shows its direct URL
  children in bookmark order; subfolders inside it are ignored. Several `asd_Favorites` (after a
  sync): the one with the lowest index is used, as with the archive.
- **System folders**: `isSystemFolder` = archive or favorites. Every site that walks a Space
  folder's descendants and skips the archive today skips both; the Bookmarks tree never shows
  `asd_Favorites`, Open All never opens it, pickers never offer it, URL recovery never turns a
  Favorite into a `bookmark-<id>` tab.
- **Ids and tabs**: a Favorite's id is its bookmark id. Tab keys stay `pinned-<id>`, so Favorite
  tabs keep Favorite behaviour (grid dot, hidden from the Tab list). A Favorite opens its tab in the
  active Space, as today.
- **Icon side store**: `PinnedSitesManager` is reshaped into `FavoriteIconsManager`, single writer
  of a new key `favoriteIcons` (bookmark id → `{ favicon?, customIconName?, iconColor?, emoji? }`),
  keeping the per-operation write API, the proxy mirror and the stale-patch rule of `setFavicons`.
  Entries are dropped when `chrome.bookmarks.onRemoved` reports the bookmark or a folder holding it.
- **Writes**: list operations (add, remove, rename/url edit, reorder, duplicate, move to Space,
  undo) are `chrome.bookmarks` calls from the sidebar, as the pinned-page bookmark operations are
  today; icon fields go through the manager proxy.
- **Space without a bookmark folder**: no Favorites; the grid shows a short hint and pinning
  (context menu "Pin", dropping on the grid) does nothing for that Space. The internal ALL_SPACE
  ("no Space yet") shows an empty grid without the hint.
- **A Favorite tab belongs to its registered Space** like any other tab: the keyboard switcher
  (`switcherLists.ts`, `background.ts` `readWindowSpaces` / `pick`) stops treating Favorite tabs as
  members of every Space. URL recovery and re-keying pick the copy in the tab's own Space, because
  after the migration every Space holds the same URLs.
- **Move to Space** moves the bookmark and registers its open tab (if any) in the target Space, so
  the tab follows its Favorite.
- **Deleting a Space** changes nothing for Favorites: Space delete keeps the bookmark folder, so
  undo needs nothing.
- **Migration**: once, in background, behind a stored flag; details below.
- **Auto-archiver**: a tab on the page of any Space's Favorite is never closed.
- **Export/import JSON**: the active Space's Favorites in the existing `pinnedSites` format with
  icons. Import: when the backup's bookmarks are not imported, `pinnedSites` replaces/appends into
  the active Space's `asd_Favorites`. When bookmarks are imported too, they run first (they carry
  every `asd_Favorites` folder) and the `pinnedSites` part only restores icons by URL onto the
  active Space's restored Favorites, adding nothing, so nothing is duplicated. Other Spaces'
  Favorites come back without custom icons ([known-limitation]; site favicons resolve lazily).
- **Arc import**: Arc's Favorites (Top Apps) go into every Space the import creates; with no Space
  created, into the active Space.

## Technical Details

### Storage

| key | owner | content |
|---|---|---|
| `favoriteIcons` (new, `chrome.storage.local`) | `FavoriteIconsManager` (background) | `{ [bookmarkId]: { favicon?, customIconName?, iconColor?, emoji? } }` |
| `favoritesMigration` (new, `chrome.storage.local`) | `FavoritesMigration` (background) | `{ done: boolean, rekey: { [oldPinId]: { [spaceId]: bookmarkId } } }` |
| `pinnedSites` (legacy) | none after migration | left as it was: read once by the migration, never written again |

Wrap the record shapes in classes (`FavoriteIcons`, `FavoriteRekeyMap`) with intent-named methods
(CLAUDE.md "Classes over raw structures").

### Favorite as the UI sees it

`PinnedSite` keeps its shape (`id`, `url`, `title`, `favicon?`, `customIconName?`, `iconColor?`,
`emoji?`), built by merging a bookmark node with its `favoriteIcons` entry. PinnedBar, PinnedIcon
and App keep using it.

### Migration flow (`src/services/favoritesMigration.ts`, injected bookmarks + storage)

1. Read `favoritesMigration`; `done` → stop.
2. Read `pinnedSites`. Empty or missing → write `done: true` and stop.
3. Spaces with a resolvable bookmark folder (no hard-coded roots). None → stop without `done`
   (retry on the next trigger), so the old Favorites never vanish with nowhere to go.
4. For each such Space: its folder already has an `asd_Favorites` → skip (a synced device migrated
   first; this also keeps a retry from duplicating). Else create `asd_Favorites` at the end of the
   Space folder and create one bookmark per pin, in order; record `rekey[oldPinId][spaceId] =
   newBookmarkId` and hand each pin's icon fields to `FavoriteIconsManager` under the new id.
5. After each Space succeeds, merge its `rekey` entries into the stored record at once (a later
   retry skips that Space, so its entries would otherwise never be written). Every Space done →
   set `done: true`. A failure for a Space leaves `done` unset and the rest is retried later.
   [known-limitation]: a folder half filled by a crash mid-copy stays half filled; two devices that
   both migrate before sync delivers, or two adds racing `ensureFavoritesFolder` on a new Space,
   end with two `asd_Favorites` in a Space (lowest index wins, the other stays hidden).
6. Triggers: worker start after the managers loaded, `SPACES_CHANGED`, bookmark created/moved
   events, until `done`. Runs serialized (one at a time).

### Re-keying open Favorite tabs

`BookmarkTabsContext` (owner of `tabAssociations_${windowId}`) reads `favoritesMigration.rekey`
on rebuild and on change of that key. An association `pinned-<oldPinId>` whose `oldPinId` is in the
map becomes `pinned-<bookmarkId>` for the tab's own Space (from `tabSpaceRegistryProxy`); a tab with
no Space or no copy for its Space loses the association and becomes a regular tab. A pure helper
(`rekeyFavoriteAssociations`) does the mapping so it can be tested. The re-key runs in
`rebuildAssociations` before URL recovery (so `claimedItemKeys` sees the new keys) and moves the
local association backup (`TabAssociationBackupStore`) along: the entry is saved under the new key
with the live tab's url and index, and the old key's entry is removed.

## What Goes Where

- **Implementation Steps**: code, tests, docs in this repo
- **Post-Completion**: manual checks in Chrome

## Implementation Steps

### Task 1: favorites folder helpers and isSystemFolder

**Files:**
- Create: `src/utils/favoritesFolder.ts`
- Modify: `src/utils/archiveFolder.ts`
- Create: `tests/favoritesFolder.test.mjs`

- [x] add `FAVORITES_FOLDER_TITLE = 'asd_Favorites'`, `isFavoritesFolder(node)`,
  `findFavoritesFolder(children)` (lowest index wins) and `ensureFavoritesFolder(spaceFolderId)`
  (find or create, injected bookmarks API, the way `SpaceArchive` creates the archive)
- [x] add `isSystemFolder(node)` (archive or favorites) next to `isArchiveFolder`, importable by
  Node tests (`.ts` extensions)
- [x] write tests: a URL bookmark titled `asd_Favorites` is not a system folder; lowest-index
  `asd_Favorites` is picked; `ensureFavoritesFolder` reuses an existing folder instead of creating a
  second
- [x] run `make test` - must pass before next task

### Task 2: skip both system folders at every walk site

**Files:**
- Modify: `src/utils/bookmarkTreeVisibility.ts`, `src/components/BookmarkTree.tsx`,
  `src/components/FolderPickerDialog.tsx`, `src/utils/folderRecentItems.ts`,
  `src/utils/bookmarkOperations.ts`, `src/hooks/useBookmarks.ts`, `src/utils/parkedTabAssociation.ts`
- Modify: `tests/bookmarkTreeVisibility.test.mjs`, `tests/folderRecentItems.test.mjs`
- Modify: `CLAUDE.md`, `docs/development.md` (if it states the skip rule)

- [x] replace `isArchiveFolder` with `isSystemFolder` at each walk site above (tree visibility,
  BookmarkTree hiding, folder picker, recent items, Open All / tab group, Expand All, URL index);
  keep `isArchiveFolder` in `ArchiveSection.tsx` and `clearArchiveAction.ts`
- [x] grep for other walks of a Space folder's descendants that skip neither (filters, Expand All)
  and cover them too (Expand All in `BookmarkTree.tsx` now skips them too)
- [x] CLAUDE.md invariant "Skip the archive folder" → "Skip the system folders" (`asd_Archive`,
  `asd_Favorites`, `isSystemFolder`); the same in `docs/development.md` where present (it does
  not state the rule, nothing to change)
- [x] write tests: tree visibility hides `asd_Favorites` at the Space root and at depth; recent
  items never list a Favorite
- [x] run `make test` - must pass before next task

### Task 3: FavoriteIconsManager owns the icon side store

**Files:**
- Create: `src/managers/shared/favoriteIconsApi.ts` (from `pinnedSitesApi.ts`)
- Create: `src/managers/impl/favoriteIconsManager.ts` (from `pinnedSitesManager.ts`)
- Create: `src/managers/proxies/favoriteIconsManagerProxy.ts` (from `pinnedSitesManagerProxy.ts`)
- Delete: the three `pinnedSites*` manager files once nothing imports them (keep
  `PINNED_SITES_STORAGE_KEY` and the `PinnedSite` type where the migration and UI need them)
- Modify: `src/managers/proxies/messageRouting.ts`, `src/background.ts`
- Create: `tests/favoriteIcons.test.mjs`

- [x] API: `getIcons`, `setIcons(id, fields)` (an edit: the three icon fields as a set, favicon
  "absent = keep", as `PinnedSiteEdit`), `setFavicons(patches)` (stale-patch rule kept),
  `resetFavicon(id, favicon?)`, `copyIcons(fromId, toId)` (duplicate only),
  `restoreIcons(id, entry)` (writes all four fields; undo, migration, import), `removeIcons(ids)`;
  every method returns the resulting store, the proxy mirrors it
- [x] background: register the manager, load it before `stateReady`, drop entries for the removed
  bookmark and every bookmark under a removed folder from the existing `bookmarks.onRemoved`
  listener (`src/background.ts`, reuse `collectBookmarkIds`; no second listener)
- [x] background favicon update on `favIconUrl`: match Favorites by URL across every
  `asd_Favorites` folder of every Space (bookmark tree, not `pinnedSites`)
- [x] write tests: a favicon patch for a pin whose icon changed meanwhile is dropped; removing a
  folder drops the entries of the bookmarks inside it and keeps the others
- [x] run `make test` - must pass before next task
- ⚠️ the three `pinnedSites*` manager files are kept and `PinnedSitesManager` stays registered:
  `usePinnedSites`, `deletePinnedSiteAction`, the in-browser test and the archiver still use them
  until Tasks 7, 8 and 11; delete them once nothing imports them (checked in Task 13)
- ➕ `collectBookmarkIds` moved to `src/utils/bookmarkFolderLookup.ts` so the folder-removal
  test exercises the same id collection background uses

### Task 4: resolve a Space's Favorites from the bookmark tree

**Files:**
- Create: `src/utils/spaceFavorites.ts`
- Create: `tests/spaceFavorites.test.mjs`

- [x] class `SpaceFavorites` (pure): given bookmark roots, a Space and the icon store, finds the
  Space folder (segments + `bookmarkFolderInAccount`, existing lookup helpers), its
  `asd_Favorites`, and returns the merged `PinnedSite[]` of its direct URL children in index order;
  `hasFolder` tells "no Space folder" from "no Favorites yet"
- [x] `allFavoriteUrls(roots, spaces)` / `allFavoriteBookmarks(roots, spaces)` for the archiver,
  favicon update and URL recovery (every Space); `allFavoriteBookmarks` returns `{ spaceId, bookmark }`
  so URL recovery (Task 6) can match per Space; a folder shared by Spaces is listed once, under the first
- [x] ➕ replace the local `favoriteBookmarksOfAllSpaces` in `src/background.ts` (favicon update,
  Task 3) with `allFavoriteBookmarks`
- [x] write tests: the right Space's folder when two Spaces have same-titled folders in different
  roots (account vs device); subfolders inside `asd_Favorites` ignored; a Space without folder gives
  `hasFolder: false` (ALL_SPACE gives an empty list; the grid shows no hint for it)
- [x] run `make test` - must pass before next task

### Task 5: one-time migration in background

**Files:**
- Create: `src/services/favoritesMigration.ts`
- Modify: `src/background.ts`
- Create: `tests/favoritesMigration.test.mjs` (reuse `tests/fakeArchiveBookmarks.mjs` or extend it)

- [x] `FavoritesMigration` per "Migration flow" above, injected bookmarks API, storage, icon
  manager and Space list; serialized runs
- [x] wire triggers in background (after managers load, `SPACES_CHANGED`, bookmark
  created/moved) until `done`
- [x] write tests: copies into every Space with a folder, in order, with icons under the new ids;
  skips a Space whose folder already has `asd_Favorites`; rerun after `done` does nothing; no Space
  with a folder → nothing written and `done` stays unset; one Space failing leaves `done` unset, a
  rerun does not duplicate the other Spaces and their `rekey` entries survive the rerun
- [x] run `make test` - must pass before next task
- ➕ the `SPACES_CHANGED` trigger listens to `chrome.storage.onChanged` for `spaces`: background's
  own `runtime.sendMessage` broadcast never reaches its own listeners
- ➕ `FavoriteRekeyMap` / `FAVORITES_MIGRATION_STORAGE_KEY` live in `src/services/favoritesMigration.ts`
  for Task 6 to import; a Space that fails mid-copy still stores the rekey entries it made

### Task 6: Favorite tabs - URL recovery and re-keying

**Files:**
- Modify: `src/utils/parkedTabAssociation.ts`, `src/contexts/BookmarkTabsContext.tsx`
- Create: `src/utils/favoriteRekey.ts`
- Modify: `tests/parkedTabAssociation.test.mjs`
- Create: `tests/favoriteRekey.test.mjs`

- [x] `buildPersistentItemUrlIndex` / `recoverFixedTabAssociations` / `recoverParkedTabAssociations`:
  bookmarks without system folders → `bookmark-<id>`; a Favorite match is Space-aware: the tab's
  Space (passed in from `tabSpaceRegistryProxy`) picks the `pinned-<bookmarkId>` of that Space's
  `asd_Favorites` only; no Space or no copy in it → no Favorite match. BookmarkTabsContext stops
  reading `pinnedSites` from storage
- [x] `rekeyFavoriteAssociations(associations, rekeyMap, spaceOfTab)` per "Re-keying open Favorite
  tabs"; BookmarkTabsContext applies it on rebuild and on `favoritesMigration` change, and writes
  only through its own association store
- [x] re-key runs before URL recovery in `rebuildAssociations` and moves the association backup
  entry to the new key (see "Re-keying open Favorite tabs")
- [x] write tests: a Favorite bookmark's URL maps to `pinned-<id>`, never `bookmark-<id>`; two
  Spaces with the same Favorite URL and a tab in Space B → B's bookmark id; re-key picks the copy of
  the tab's own Space; a tab whose Space has no copy loses the association; keys not in the map are
  untouched
- [x] run `make test` - must pass before next task

### Task 7: usePinnedSites and PinnedBar on per-Space bookmarks

**Files:**
- Modify: `src/hooks/usePinnedSites.ts`, `src/components/PinnedBar.tsx`,
  `src/components/PinnedIcon.tsx`, `src/App.tsx`, `src/components/TabList.tsx` (pin action)

- [x] the hook takes the active Space, derives the list with `SpaceFavorites` from the bookmark
  tree (via `useBookmarks()` or `getTree` plus bookmark events; there is no shared tree context, do
  not build one) plus the icon proxy, and keeps its public functions: add/addPins (create in
  `ensureFavoritesFolder`, store icons), remove, update (bookmark title/url + icon edit), rename if
  unchanged, reset favicon, move (`chrome.bookmarks.move` within the folder), duplicate (bookmark
  copy + `copyIcons`), replace/append (import); lazy favicon resolver kept
- [x] Space without folder: grid shows a short hint, add/drop/pin do nothing
- [x] Chrome API errors go to the hook's error state (`createChromeErrorHandler` where the call is
  callback-style; the hook uses only promise-style calls, so `reportFailure` sets the error)
- [x] `make lint && make test && make build` - must pass before next task
- ➕ `App` became a wrapper around `BookmarkTabsProvider` / `SpacesProvider` and the old body moved
  into `Sidebar`, so the hook can read the active Space from the Spaces context
- ➕ the hook reads the shared bookmark tree through `bookmarkTreeStore` (exported from
  `useBookmarks.ts`) and keeps its `SpaceFavorites` snapshot while `sameAs` holds, so the sidebar
  doesn't re-render on unrelated bookmark changes; `needsFolderHint` stays false until the tree is read
- ⚠️ (resolved in Task 8) until Task 8, unpin still goes through `DeletePinnedSiteAction` and the old pinned-sites proxy,
  so it does not remove the bookmark

### Task 8: undo of a Favorite delete on bookmarks

**Files:**
- Modify: `src/actions/deletePinnedSiteAction.ts`, `src/tests/deletePinnedSiteActionTest.ts`

- [x] undo recreates the bookmark at its index in the same `asd_Favorites` and restores the icon
  fields from the action's own snapshot with `restoreIcons(newId, entry)` (the side-store entry is
  already pruned by then, so `copyIcons` would find nothing); the tab association moves to the new id
- [x] update `src/tests/deletePinnedSiteActionTest.ts` (in-browser test) to the bookmark model,
  including "undo brings back custom icon and emoji"
- [x] `make lint && make test && make build` - must pass before next task
- ➕ `do()` now removes the Favorite's bookmark (`chrome.bookmarks.remove`, batched) instead of
  calling the old pinned-sites proxy; the snapshot records the bookmark's folder and bookmark index
  (not the grid position) and undo clamps the index to the folder's current size

### Task 9: Move a Favorite to another Space

**Files:**
- Modify: `src/components/PinnedIcon.tsx` (context menu), `src/hooks/usePinnedSites.ts`

- [x] "Move to Space ▸" submenu listing the other Spaces that have a bookmark folder; moves the
  bookmark into the target's `asd_Favorites` (`ensureFavoritesFolder`), keeping id, icon entry and
  tab association
- [x] an open tab of the moved Favorite is registered in the target Space (`tabSpaceRegistryProxy`),
  so it does not stay hidden in the source Space
- [x] `make lint && make build` - must pass before next task
- ➕ the target list comes from `favoritesMoveTargets` (`src/utils/spaceFavorites.ts`): other Spaces
  whose bookmark folder resolves and differs from the source's; read when the menu opens. The
  Favorite goes to the end of the target's Favorites

### Task 10: keyboard switcher treats Favorite tabs as tabs of their Space

**Files:**
- Modify: `src/services/switcherLists.ts`, `src/background.ts` (`readWindowSpaces`, `pick`)
- Modify: `tests/switcherLists.test.mjs`

- [x] drop "Favorites belong to every Space" (`WindowSpaces.isFavorite` and its uses): a Favorite
  tab is listed, counted and picked as a tab of its registered Space; picking it switches Space
  like any other tab; update the comments
- [x] write test: in Space B the tab list does not offer Space A's Favorite tab, and A's usage
  count includes it
- [x] run `make test` - must pass before next task

### Task 11: auto-archiver protects every Space's Favorites

**Files:**
- Modify: `src/services/tabAutoArchiver.ts`, `src/background.ts`
- Modify: `tests/autoArchive.test.mjs` or `tests/autoArchivePolicy.test.mjs`

- [x] `getPinnedSites` dep becomes the URLs of every Space's `asd_Favorites` (`allFavoriteUrls`)
- [x] write test: a tab in Space B on the page of a Space A Favorite is not closed
- [x] run `make test` - must pass before next task

### Task 12: JSON import/export and Arc import

**Files:**
- Modify: `src/utils/backupRestore.ts`, `src/components/ExportDialog.tsx`,
  `src/components/ImportDialog.tsx`, `src/components/ArcImportDialog.tsx`, `src/utils/arcImport.ts`

- [ ] export writes the active Space's Favorites under `pinnedSites` (format unchanged, icons
  included); dialogs say "active Space"
- [ ] import order per Solution Overview: bookmarks first; with bookmarks imported, `pinnedSites`
  only restores icons by URL onto the active Space's Favorites (`restoreIcons`), adding nothing;
  without bookmarks, replace/append into the active Space's `asd_Favorites`
- [ ] Arc import: Top Apps go into every Space the import creates, else into the active Space
- [ ] write test (only if the import decision lives in a pure helper): backup with bookmarks and
  `pinnedSites` imported together adds no second copy of the active Space's Favorites
- [ ] `make lint && make test && make build` - must pass before next task

### Task 13: Verify acceptance criteria

- [ ] switching Space switches the grid; existing Favorites appear in every Space after the update
- [ ] no `asd_Favorites` in the Bookmarks tree, filters, Expand All, Open All, folder pickers
- [ ] `grep -rn "PINNED_SITES_STORAGE_KEY\|'pinnedSites'" src` shows only the migration, the backup
  format and the legacy key definition
- [ ] ➕ delete `pinnedSitesManager.ts`, `pinnedSitesManagerProxy.ts` and the manager parts of
  `pinnedSitesApi.ts` (keep `PinnedSite` and `PINNED_SITES_STORAGE_KEY`), drop
  `ManagerId.PINNED_SITES` and its registration in `background.ts` once nothing imports them
- [ ] run `make lint && make test && make build`

### Task 14: [Final] Update documentation

- [ ] README.md: Favorites belong to a Space (replace "They stay the same in every Space"),
  stored as bookmarks in `asd_Favorites`, Move to Space, migration note, export/import and Arc
  import wording, storage sentence ("bookmarks for Spaces, pinned pages, the archive and Favorites")
- [ ] `docs/state-reference.md`: `favoriteIcons`, `favoritesMigration`, `pinnedSites` legacy,
  updated `tabAssociations_${windowId}` consumers, diagram
- [ ] `docs/changelog.md` entry and `src/data/changelog.ts` What's New entry
- [ ] `docs/chrome-web-store-info.md` and `PRIVACY.md` if they say Favorites live in local storage
- [ ] `docs/development.md` manager list / shared state section if it names `PinnedSitesManager`
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

**Manual verification**:
- update from a build with global Favorites: every Space with a folder shows them, with icons and
  emoji; open Favorite tabs keep their dot
- second device with bookmark sync: the second device skips Spaces whose `asd_Favorites` already
  arrived (both migrating before sync delivers is a known limitation)
- add, edit, reorder, duplicate, delete + undo, Move to Space, Space without folder hint
- auto-archive keeps Favorite tabs; Arc import of Top Apps; JSON export/import round trip
