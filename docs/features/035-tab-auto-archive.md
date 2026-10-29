---
created: 2026-10-28
after-version: 1.0.351
status: completed
---

# 035 - Tab Auto-Archive and Collapsible Sections

## Feature Goal

Match Arc's auto-archive: regular tabs that have not been used for a configurable period close by themselves, and nothing is lost - each one is saved as a bookmark in a dedicated archive folder and can be reopened from a new **Archive** section in the sidebar. Open bookmark pages that have not been used for the same period close too; their bookmark stays, so nothing is archived.

Also make the Bookmarks and Archive sections collapsible.

Why: tabs pile up in the Tab list and have to be closed by hand. Closing them automatically keeps the list short; the archive removes the fear of losing something.

Items marked **(call)** were decided while writing this spec, not by the user. They are listed again at the end for review.

## Scope

- **Archived:** tabs shown in the Tab list - regular tabs with no bookmark or Favorite association (`filterUnmanagedTabs`), in every window and every Space, whether or not the sidebar is open.
- **Closed without archiving:** open bookmark pages (tabs associated with a bookmark, `bookmark-…` key, still showing the bookmark's page). The bookmark stays in the tree and shows as not open. A bookmark tab showing another page is archived first (see Implementation Notes).
- **Never closed:** open Favorites (pinned sites, `pinned-…` key) **(call)**, any tab showing a Favorite's page, incognito tabs.

### Non-goals

- Manually closed tabs (`x`, `Close Tabs`, `Close Tabs Before/After`, Clear) do not go to the archive. Only auto-close archives, plus one exception added later: the Tab list's **Archive** button (see [Archive Button](#archive-button-tab-list)).
- No automatic cleanup of the archive folder. It grows until the user deletes items. **(call)**
- No drag & drop into or out of the Archive section.
- No collapse for the Tabs section (for now).
- No Arc import of archived tabs.

### Anti-goals

- Closing a Tab list tab without a saved archive bookmark (except the empty pages listed below). If the bookmark could not be created, the tab stays open.
- Closing a tab earlier than the configured period. When the last-use time is unknown or doubtful, the tab is kept.
- Archiving a bookmark's or Favorite's tab before the background has restored associations at startup.

## Settings

New option in the Settings dialog, **Archive tabs after**: `Never` / `12 hours` / `24 hours` / `3 days` / `7 days` / `30 days`.

- The option's description says both effects: regular tabs are archived, open bookmark pages are closed. **(call)**
- Default: `Never`, so an update never closes anyone's tabs on its own. **(call)**
- Stored in `chrome.storage.local` (the background reads it): key `autoArchiveAfter`, values `'never' | '12h' | '24h' | '3d' | '7d' | '30d'`.
- One global value for all Spaces. **(call)**
- Switching from `Never` to a period starts every tab's clock at that moment: no tab is closed earlier than one period after the switch, even if it was unused long before. Changing between two periods has no such grace.

## Archive Folder

- **One archive per Space:** a bookmark folder named **`asd_Archive`**, a direct child of the Space's bookmark folder (`findFolderBySegments(space.bookmarkFolderSegments, space.bookmarkFolderInAccount)`). Created by the extension the first time a tab of that Space is archived.
- A tab goes to the archive of the Space it belongs to (`TabSpaceRegistry`). A tab with no Space assignment, or whose Space folder can't be found, is not archived and stays open. **(call)**
- Found by title inside the Space folder; if there are several (e.g. after a bookmark sync), the first by index is used. **(call)** If the user deletes or renames it, a new one is created on the next archive. Renaming or moving the Space folder needs no handling - the archive moves with it.
- Deleting a Space and its folder deletes its archive too.
- **Ignored by the Bookmarks section:** never shown as a folder row, not counted in folder-recent popovers, filter/search results, `Expand All`, "Open as tab group" or other walks over the Space folder's bookmarks, and not offered as a drop target. It is shown only through the Archive section. **(call: also hidden in the folder picker dialogs.)**
- **Ignored by URL-based association recovery:** `recoverFixedTabAssociations` (sidebar init, `src/contexts/BookmarkTabsContext.tsx`) claims tabs whose URL matches any bookmark. Archive bookmarks must not take part, or a tab on an archived URL would turn into a bookmark tab and vanish from the Tab list.
- Chrome's own bookmark UI (bookmark bar, Bookmark Manager) still shows the folder; that is expected.
- Each archive bookmark: title = tab title (URL if empty), URL = the tab's effective URL. For a tab parked by a suspender extension, the original URL from `getEffectiveTabUrl` / `parseParkedTabUrl` is saved, not the `park.html` URL.
- New bookmarks are inserted at index 0, so Chrome's Bookmark Manager also shows newest first.
- Duplicate URL: a new bookmark is created at the top first, then the older one with the same URL is removed, so the item gets the fresh archive time and a failed create loses nothing. **(call)**
- The archive time of an item is the bookmark's `dateAdded`.

## Archiving Rules (background)

Archiving runs in `src/background.ts` (the sidebar may be closed).

### When

- A `chrome.alarms` alarm fires periodically; the exact interval is up to the builder (a few minutes is enough - the shortest period is 12 hours). Also once at service-worker start.
- Every run first awaits `stateReady`, so bookmark/Favorite associations are restored before any tab is judged.
- Runs never overlap.
- New permission: `alarms` (Chrome shows no install warning for it).

### Which tabs

A tab is closed when **all** of these hold:

- it is a regular tab (no entry in `tabAssociations_{windowId}`) or a bookmark tab (`bookmark-…` entry) - not a Favorite tab (`pinned-…` entry);
- it is not incognito;
- it is not the active tab of its window;
- it is not playing audio (`audible`);
- it is not a Chrome-native pinned tab;
- its last-use time is known and `now - lastUse >= period`.

Tabs inside Chrome-native tab groups are archived like any other tab. **(call)**

A `bookmark-…` association whose bookmark no longer exists (deleted while the sidebar was closed) does not make the tab a bookmark tab: it is treated as a regular tab and archived, so the page is not lost. **(call)**

After the startup restore, a tab with no association is judged as a regular tab even if its URL matches a bookmark, and archived like any other; the bookmark itself stays in the tree, so a bookmark tab whose association was lost after a restart is not lost. **(call)** A tab whose URL matches a Favorite is never closed, associated or not.

The sidebar does not always show such tabs in the Tab list: its `rebuildAssociations` runs `recoverFixedTabAssociations` at sidebar start and whenever a window's `tabAssociations_{windowId}` changes, and that claims unassociated tabs on a bookmark's or Favorite's URL (Favorites first). The archiver does not run this recovery, so whether a tab on a bookmarked URL is archived or closed as a bookmark tab depends on whether a sidebar claimed it first; the page is kept either way. Favorites don't depend on it: the archiver keeps every tab on a Favorite's URL. See the Open question below.

### Last-use time

- "Last use" = the moment the tab **stopped** being active (the user switched to another tab in its window), not the moment it became active. A tab left active overnight starts its clock in the morning when the user switches away. **(call)**
- Chrome's `tab.lastAccessed` holds the time the tab *became* active, so it can't be the source on its own. The background records the deactivation time itself (`chrome.tabs.onActivated`: the window's previously active tab).
- The record must survive service-worker and browser restarts. After a browser restart tab IDs change: re-match records the way `TabSpaceRegistry.load` already does (URL + position) - reusing its records/matching is preferred over a second matcher. Storage layout is up to the builder.
- A tab with no record (never seen by the extension, failed re-match) gets its clock started when the archiver first sees it - it is archived later, never earlier.
- Wall-clock time. Time while the computer sleeps or Chrome is closed counts: after a long sleep or a weekend with Chrome closed, overdue tabs are archived on the first run.

### Steps

For each selected **bookmark tab**: close it with `chrome.tabs.remove`. Afterwards the bookmark must show as not open, also when the sidebar was closed at that moment (today the sidebar's `rebuildAssociations` drops associations to closed tabs when it reopens - the builder confirms this covers it).

For each selected **regular tab**:

1. Empty pages (`chrome://newtab/`, `about:blank`, empty URL) are closed without an archive bookmark. **(call)**
2. Otherwise create the archive bookmark. If creation fails, leave the tab open and log the error.
3. Close the tab with `chrome.tabs.remove`. Existing `onRemoved` handling cleans the Space registry and history.

## Archive Button (Tab list)

Added after the feature shipped (plan: `docs/plans/completed/20261028-archive-tabs-button.md`). Clear throws tabs away and auto-archive keeps them only after a period; this button cleans the Tab list now without losing anything. It is the one manual close that archives.

- Hovering "+ New Tab" shows **Archive** (lucide `Archive` icon) left of **Clear**, with the same look. **(call)**
- It archives the tabs Clear would close, then closes them, right away. The "Archive tabs after" setting plays no part and can be `Never`.
- Tab set: the same as Clear - every tab in the Tab list of the active Space, including the active tab and tabs playing audio (auto-archive's exemptions don't apply). With the text filter active, only the matching tabs.
- Hidden when the Tab list is empty or the active Space has no bookmark folder (no Space, the "All" view, or a folder that is gone): there is nowhere to archive to. **(call)**
- Items go into the active Space's `asd_Archive` and are made like auto-archive items: tab title, effective URL (a parked tab's original URL), inserted at the top, an older item with the same URL replaced. Two tabs on the same URL in one press leave one item.
- Empty pages (`chrome://newtab/`, `about:blank`, empty URL) close without an archive item, as in auto-archive. **(call)**
- Tabs are archived one at a time, so a missing `asd_Archive` is created once, not once per tab.
- A tab whose archive item can't be created stays open; the others still archive and close. **(call)** If no tab could be archived, nothing closes and the toast shows "Could not archive tabs", with no Undo.
- Toast: `Archived "<title>"` for one archived tab, `Archived N tabs` for several (empty pages close alongside and are not counted), `Closed N empty tabs` when the list held only empty pages. `, M kept open` is appended when some tab stayed open.
- Undo (from the toast) reopens the tabs where they were - position, Chrome tab group, Space - as Clear's Undo does, then removes the archive items this press created. Tabs come back first, so a failed cleanup loses nothing. An older item with the same URL that the press replaced does not come back; only its archive time differed. **(call)**
- When the tabs are every tab in the window, the existing "close all tabs" confirmation shows, with the details "They are archived first. This will close the window." Confirming archives and closes them without Undo, since the window closes - same as Clear. **(call)** If some tab stays open, the window survives and the Tab list shows the result in its own toast.
- Runs in the sidebar as an `UndoableAction`, not in the background.

Code: `TabArchiveBatch` (`src/utils/tabArchiveBatch.ts`) saves the tabs through `SpaceArchive` and remembers the items it created; `ArchiveTabsAction` (`src/actions/archiveTabsAction.ts`) runs the batch, then closes the closable tabs through a `CloseTabAction` from an injected factory (keeps `chrome.*` out of the Node tests); `isEmptyPage` (`src/utils/autoArchivePolicy.ts`) is shared with auto-archive; wiring is in `src/components/TabList.tsx`. No new storage keys.

Pressing Archive again while a press still runs does nothing (`runArchiveOnce` in `TabList`). Otherwise a double-click would archive the same tabs twice, the second run replacing the first run's items, and its Undo would delete them without reopening any tab.

Known limitation (rare, not fixed):

- If the background archiver and the button both find `asd_Archive` missing at the same moment, two archive folders can appear; only the first one's items show in the Archive section (see Sidebar notes below).

## Archive Section (sidebar)

Placed between the Bookmarks section and the Tabs section, inside the scroll container (`SwipeableContainer` in `src/App.tsx`). It shows the archive of the **active Space** only.

- Header row: chevron + **Archive**. Same look as the Space title row.
- **Collapsed by default.**
- Hidden when the active Space's archive folder is missing or empty. **(call)**

### Collapsed

Behaves like a collapsed bookmark folder (feature 034):

- Hovering the header for ~400ms opens the recent popover (`FolderRecentPopover`) with the archive's newest items and a "Search Archive…" field.
- Without a query: the 10 newest items, sorted by archive time, with relative time labels ("3 hours ago").
- With a query: every item matching title or URL (toolbar `matchesFilter` syntax), newest first, up to 50.
- Reuse: the popover's ordering works from a `BookmarkRecency`; for the archive, build one from each bookmark's `dateAdded`.
- Works in every "Open bookmark" mode (the archive time doesn't depend on bookmark ↔ tab associations), unlike the folder popover, which is Arc-mode only.
- Clicking the header expands the section.

### Expanded

- All archive items, newest first: favicon + title, with the archive time on the right. **(call)**
- Clicking the header collapses it.

### Restoring an item

Clicking an item (in the expanded list or the popover):

1. Opens its URL as a **regular tab** in the current window, assigned to the active Space, active, placed like a tab created with "+ New Tab". It appears in the Tab list, not as an Arc-style bookmark tab.
2. Then removes the bookmark from `asd_Archive`. **(call: open first, remove second, so a failed open loses nothing.)**

Modifier clicks (Cmd/Ctrl, Shift) restore the same way. **(call)**

Right-click menu on an item: **Delete from Archive**. **(call)** The same delete is on an `x` button shown on hover over the item's archive time.

### Toolbar filters

- Text filter: the Archive section shows only matching items, expanded while the filter is active. **(call)**
- "With open tabs" filter: the Archive section is hidden (archived items have no live tab). **(call)**

## Collapsible Sections

The Bookmarks and Archive sections get a chevron that collapses and expands them. The Tabs section is not collapsible (for now).

| Section | Control | Collapsed shows |
| --- | --- | --- |
| Bookmarks | Chevron on the Space title row (`SpaceTitle` in `src/App.tsx`), as in the mockups: `> Home` collapsed, `v Home …` expanded. Clicking the row toggles it; the `…` menu keeps working. | Only the open bookmark pages, the active one as a card - the same rule as a collapsed folder (`getVisibleBookmarkChildren`). **(call)** |
| Archive | Header row (see above). | Nothing; hover popover. |

- Collapse state is remembered per Space, persistent, shared across windows: `chrome.storage.local` key `sectionCollapsedState`, `{ [spaceId]: { bookmarks: boolean; archive: boolean } }`. Missing values: Bookmarks expanded, Archive collapsed. **(call)**
- "Follow active tab" scrolling works because the active page always stays visible in a collapsed section.
- While the toolbar text filter is active, every section is shown expanded; the stored collapse state is not changed. **(call)**
- Drag & drop over a collapsed section header: up to the builder (hover-to-expand like folders is fine).

## State

New keys, both `chrome.storage.local` (CLAUDE.md: new state uses `chrome.storage.local`):

| Key | Writer | Readers |
| --- | --- | --- |
| `autoArchiveAfter` | Settings dialog | background (archiver), Settings dialog |
| `sectionCollapsedState` | sidebar | sidebar |

Plus background-only state, key names and layout up to the builder: the last-use records (see "Last-use time") and the moment auto-archive was switched on from `Never` (for the grace rule in Settings). Changed by feature 036: the sidebar also reads the last-use records, read-only, for the tab age highlight.

Update `docs/state-reference.md`.

## Likely Files

- `public/manifest.json` - `alarms` permission.
- `src/background.ts` - alarm wiring.
- New background class for archiving (built as `src/services/tabAutoArchiver.ts`) - rules, steps, serialization.
- New helper for the archive folder (find/create inside a Space folder, duplicate handling, "is this the archive folder" check used by the Bookmarks section).
- `src/components/FolderPickerDialog.tsx` - hide `asd_Archive`.
- New `src/components/ArchiveSection.tsx`.
- `src/components/FolderRecentPopover.tsx` - search placeholder/label for a non-folder anchor, if needed.
- `src/components/BookmarkTree.tsx` - hide `asd_Archive`; collapsed-section rendering.
- `src/components/SectionHeader.tsx`, `src/App.tsx` - chevron, Archive section placement.
- `src/components/SettingsDialog.tsx` - the new option.
- Tests in `tests/*.test.mjs` for pure logic (tab selection rules, archive folder lookup, duplicate handling).

## Left to the Builder

- Alarm interval.
- Storage layout of the last-use records (within the rules above).
- Class layout, following CLAUDE.md (classes with descriptive methods over raw records/maps).
- Visual details of the Archive header and rows, as long as they match the Arc look of the existing rows.

## Decided by the User

- One archive per Space: `asd_Archive` inside the Space's bookmark folder, ignored by the Bookmarks section.
- Open bookmark pages close after the same period; nothing is archived for them.
- No collapse for the Tabs section for now.
- The clock is wall-clock time and also runs while Chrome is closed.
- Switching from `Never` to a period starts every tab's clock at the switch.

## Calls Made While Writing (for review)

- Default period `Never`; one global setting; its description names both effects.
- Favorites never auto-close.
- Tabs with no Space, or whose Space folder is missing, are not archived; `asd_Archive` is also hidden in folder pickers.
- Grouped tabs are archived; active, audible, Chrome-pinned and incognito tabs are not.
- An unassociated tab on a bookmarked URL is archived like any regular tab; so is a tab whose associated bookmark was deleted.
- A tab on a Favorite's URL is never closed, associated or not.
- The clock starts when the tab stops being active; it survives browser restarts; unknown = clock starts at first sight.
- Several `asd_Archive` folders in one Space folder: the first is used.
- Empty/new-tab pages are closed without a bookmark.
- Duplicate URL replaces the older archive item.
- Restore = open first, then delete the bookmark; modifier clicks behave the same; right-click "Delete from Archive".
- Archive section hidden when empty; text filter shows matches expanded; "With open tabs" filter hides it; popover works in every open mode.
- Text filter shows every section expanded without changing the stored collapse state.
- Collapsed Bookmarks still shows open pages.
- Collapse state per Space in `chrome.storage.local`.
- No archive cleanup; manual closes are not archived (except the Archive button, added later).

## Implementation Notes

What was built where it differs from or adds to the text above. Key names and shapes are in `docs/state-reference.md`.

### Deviations

- `TabActivityTracker.refresh` rejects until `load` has matched the stored records to the live tabs in this worker, so a failed load archives nothing until the next worker start (otherwise old records could land on reused tab IDs).
- If the startup restore of tab associations fails (`TabAssociationReadiness.wait()` resolves `false`), every run in that worker does nothing until the next worker start. If reading any window's associations fails, that run judges nothing.
- A `bookmark-…` tab whose page differs from its bookmark's URL is archived before it closes, not just closed: it navigated or redirected away, or its association was restored to the wrong tab after a restart. The same applies to a tab whose bookmark was deleted. Parked tabs count by their original URL; a trailing slash is ignored, the hash is not, so another hash route of a hash-routed app (Gmail `…/#inbox` vs `…/#inbox/<message>`) is another page. Favorite pages are still compared without the hash, since that comparison only keeps tabs open.
- A tab whose page matches a Favorite's URL is never closed, with or without a `pinned-…` association.
- Tabs shown in a split view (Chrome 140+, `splitViewId`) together with their window's active tab stay open like the active tab.
- After a browser restart Chrome reuses low window and tab IDs, so the startup restore of Space assignments and associations matches stricter then. A marker in `chrome.storage.session` (`tabRestoreSessionStarted`, `BrowserSessionMarker`) tells the two cases apart: `background.ts` reads it once at worker start and writes it after the restore succeeded; session storage is cleared on browser restart and on extension reload/update, so those take the strict path too.
  - Worker restart (marker present): tab and window IDs are exact, and a stored URL may lag a navigation made while the worker slept. `TabSpaceRegistry.load` keeps a record's tab by ID and window whatever page it shows, and the association restore claims a backup's window by its ID and keeps each entry's tab by ID, dropping entries whose tab was closed while the worker slept - as before this feature, so no other tab inherits a closed bookmark's or Favorite's association.
  - Browser restart or extension reload/update (marker absent): `TabSpaceRegistry.load` (`matchStoredTabs`) keeps a stored tab ID only when that tab is in the same window on the same site (`isSameSite`), otherwise it matches the record by URL and nearest index. The association restore (`matchBackupWindows` in `src/utils/tabAssociations.ts`) takes a backup window by its old window ID only when every entry's stored tab ID is still in that window on the entry's site (an extension reload: stored URLs follow navigations). Otherwise the backup and the window are left to index+domain matching, then domain-overlap matching, as for a window whose ID is gone. One exception keeps reloads exact: when some entries matched by ID, the others' tabs are gone (none is on another site) and index+domain matching places the backup nowhere, the ID matches are kept - the backup still listed a tab that was closed or dragged to another window while the extension wasn't running.
  - Within the window a backup was matched to, an entry placed by a reused ID, by index or by domain takes the free tab showing its exact page (the backup URL) before a tab that only shares its site, and domain-overlap matching otherwise takes the tab on the entry's domain nearest its stored index (it used to take the first one). So a Favorite whose tab sits on another page of its site keeps its own tab instead of handing its association to a regular tab of that site, which the archiver would then close as regular.
  - The backup's tab indices are also refreshed when a tab is created, attached or detached (before: move and remove only), so index+domain matching finds the tabs after a restart.
- After a browser restart (or extension reload/update), every tab matched on a URL gets the newest last-use time among all records with that URL, so a copy of a page used recently in another window never inherits an older time.
- `SectionHeader` with no menu renders without a context-menu wrapper; this also removes the empty right-click box on the "Create a Space" placeholder header.

### Storage and scheduling

- Background-only keys: `autoArchiveEnabledAt` and `tabLastUsedAt` (`chrome.storage.local`), `tabActivityActiveTabs`, `tabActivitySessionStarted` and `tabRestoreSessionStarted` (`chrome.storage.session`). Both session markers go through `BrowserSessionMarker`, each under its own key. Changed by feature 036: the background is still the only writer of `tabLastUsedAt`, but the sidebar reads it (`useTabLeftTimes`, through `TabLeftTimes`).
- Code: `TabActivityTracker` is in `src/stores/tabActivityTracker.ts` and `TabAutoArchiver` in `src/services/tabAutoArchiver.ts`, since `src/managers/impl/` holds only `RoutedManager` classes with proxies. The Archive section's item list is `ArchiveItems` (`src/utils/archiveItems.ts`).
- `sectionCollapsedState` is stored as a JSON string of the shape above (`useChromeLocalStorage` serializer), not as a raw object.
- Alarm `auto-archive` runs every 5 minutes (1 in DEV builds) and exists only while the setting is not `Never`; it is created only when missing or set to another interval.
- The worker-start run is skipped when a run started less than one alarm period ago (`autoArchiveLastRunAt` in `chrome.storage.session`), since tab events wake the worker often; an alarm run is skipped within half a period of the last run, so an alarm that wakes the worker doesn't run twice.
- Switching to `Never` removes `autoArchiveEnabledAt`, the last-use records and the active-tab map; nothing is recorded while the setting is `Never`, and a worker start with `Never` drops leftover records. Changed by feature 036: the records and the active-tab map are dropped only when "Highlight tabs by last use" is `Off` too (`isTabActivityRecording`), and switching to `Never` calls `TabActivityTracker.load` (`clear()` is gone). Switching on sets `autoArchiveEnabledAt` to now and lets the tracker learn the open tabs. A run that finds a period set but `autoArchiveEnabledAt` missing (the write at switch-on was lost) sets it to now and closes nothing.
- DEV builds offer a `1 minute` period for testing; a stored `'1m'` reads as `Never` in release builds.

### Archiving

- Within a browser session last-use records follow tab IDs only (no URL fallback), so a new tab on a closed tab's URL does not inherit its time.
- `markActivated` stamps the tab the user left and moves its record to the page and position it shows now, creating it if the tab had none (a closed tab gets none), so after a browser restart a recently used page is matched with a recent time.
- Each run restarts the clock of tabs playing audio, pinned in Chrome or sharing a split view with their window's active tab (`SplitViewsOnScreen`, the same rule the policy keeps them open by), like active tabs, so a tab leaving one of these exemptions gets a full period.
- Incognito tabs are never recorded; tabs in popup and app windows are ignored (`windowType: 'normal'`).
- An association key that is neither `bookmark-…` nor `pinned-…` keeps the tab.
- The archive bookmark is made from the tab as the run saw it; each tab is re-read right before it closes, and one that became active, audible, Chrome-pinned, was accessed, changed URL or joined a split view during the run stays open until the next run (its archive bookmark stays; archiving it again later replaces it).
- Tabs are archived one at a time, then close-only tabs are closed; empty pages close regardless of Space.
- `asd_Archive` is created without an index (appended after the Space folder's items), and archive folders are skipped at any depth, since Space folders can nest.
- If removing an older duplicate fails, the error is logged and the tab still closes (the new bookmark exists).
- A bookmark tab closed while the sidebar is closed shows as not open after reopening: `rebuildAssociations` drops associations to closed tabs (confirmed).

### Sidebar

- While the text filter is active the Space title chevron shows expanded and does not toggle; the "With open tabs" filter does not force Bookmarks open.
- "New Folder" from the Space title menu expands a collapsed Bookmarks section; following the active tab does not expand it (the active page is always visible).
- No hover-to-expand when dragging over the Space title.
- The Archive section is also hidden when the text filter matches no archive item.
- The Archive list and popover include pages in subfolders the user creates inside `asd_Archive`.
- With several `asd_Archive` folders in one Space folder, only the first one's items show in the Archive section; the others are hidden from the Bookmarks section too and are reachable only in Chrome's Bookmark Manager.
- "Delete from Archive" is undoable (toast with Undo); undo creates the bookmark again, so the item comes back on top with a new archive time. Restoring an item removes its bookmark without a toast.
- "Delete from Archive" (context menu and the hover `x`) is available on expanded rows; the popover is a quick peek without a context menu or `x`.
- The Archive section remounts on Space switch, which closes an open popover.

### Open question

- Any regular tab (including a restored archive item) on a URL that is also an unclaimed bookmark or Favorite can be claimed by `recoverFixedTabAssociations` on any `rebuildAssociations`, not only at sidebar start, and then leaves the Tab list. This is existing behaviour, not changed here, and conflicts with ff3adcb's intent that a tab opened by hand on a bookmarked URL stays a regular tab. The archiver keeps tabs on a Favorite's URL either way; for bookmark URLs the outcome (archived, or closed as a bookmark tab) depends on whether a sidebar claimed the tab first. Whether the sidebar should keep claiming tabs by URL is for the user to decide. Archive items themselves never take part.
