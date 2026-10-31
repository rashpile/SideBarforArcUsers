# Extension State Reference

Quick reference for all states managed by the extension.

## Overview

| Storage | Lifespan | Instances |
|---------|----------|-----------|
| Chrome Local Storage (`chrome.storage.local`) | Persistent | 1 per extension |
| Chrome Session Storage (`chrome.storage.session`) | Per browser session | 1 per window |
| Browser localStorage | Persistent | 1 per extension |
| In-Memory | Per page load | 1 per context |

---

## Choosing a Storage

### Decision Tree

```
Need to persist across browser restart?
├─ Yes → Need service worker access?
│        ├─ Yes → chrome.storage.local
│        └─ No  → Need real-time cross-window sync?
│                 ├─ Yes → chrome.storage.local
│                 └─ No  → browser localStorage (simpler API)
└─ No  → Need to survive service worker restart?
         ├─ Yes → chrome.storage.session
         └─ No  → In-memory state
```

### Comparison

| Criteria | chrome.storage.local | chrome.storage.session | browser localStorage |
|----------|---------------------|------------------------|---------------------|
| **Lifespan** | Persistent | Browser session | Persistent |
| **Service worker access** | Yes | Yes | No |
| **Cross-window sync** | Yes (onChanged fires in all contexts) | Yes | Partial (event fires in OTHER windows only) |
| **Sidebar-only data** | Yes | Yes | Yes |
| **API complexity** | Async | Async | Sync |
| **Size limit** | ~5MB | ~1MB | ~5MB |

### When to Use Each

**chrome.storage.local** - Use for:
- User data that must persist (spaces, Favorite icons)
- Settings that need real-time sync across all windows
- Data the service worker needs to access

**chrome.storage.session** - Use for:
- Per-window state (active space, tab history)
- Data that should reset on browser restart
- State shared between service worker and sidebar

**browser localStorage** - Use for:
- Visual-only preferences where delayed sync is OK
- Sidebar-only settings (service worker doesn't need)
- Simple key-value with sync API

**In-memory** - Use for:
- Temporary flags (e.g., `isNavigating`)
- Derived/computed state
- Data from Chrome APIs (tabs, bookmarks)

### Limitations

| Storage | Limitation |
|---------|------------|
| chrome.storage.* | Async only, requires callbacks/promises |
| chrome.storage.session | 1MB limit, cleared on browser close |
| browser localStorage | No service worker access, change event doesn't fire in current window |
| In-memory | Lost on page reload / SW restart |

---

## Chrome Session Storage

Stored via `chrome.storage.session`. Survives service worker restarts, cleared on browser close and when the extension is reloaded or updated.

### `bg_windowTabHistory`
Back/forward navigation stack (Map: windowId → {stack, index})
- Owner: `src/background.ts` (BackgroundState class)
- Consumers: `src/background.ts` (navigateHistory, get-tab-history handler)
- Instances: 1 per window
- Max size: 25 entries per window

### `spaceWindowState_${windowId}`
Active space per window
```typescript
{
  activeSpaceId: string
}
```
- Owner: `src/background.ts` (SpaceWindowStateManager class)
- Consumers: `src/contexts/SpacesContext.tsx` (read-only copy synced via messages)
- Instances: 1 per window
- Note: active Space selection is independent from user-owned Chrome tab groups.

### `tabAssociations_${windowId}`
Tab → bookmark/Favorite mapping (Record: tabId → itemKey, `bookmark-{id}` / `pinned-{id}`; a Favorite's id is its bookmark id in the Space's `asd_Favorites`)
- Owner: `src/contexts/BookmarkTabsContext.tsx`. On rebuild it first re-keys `pinned-<oldPinId>` entries left from global Favorites (`favoritesMigration.rekey`), then binds tabs by URL: a Favorite URL matches only the `asd_Favorites` copy of the tab's own Space, never a `bookmark-{id}`
- Consumers: `src/components/PinnedBar.tsx`, `src/components/TabList.tsx`, `src/services/tabAutoArchiver.ts` (tells bookmark and Favorite tabs from regular tabs), `src/actions/deletePinnedSiteAction.ts` (undo hands the context the tab and the re-created bookmark's key). A Favorite tab belongs to its registered Space like any other tab (keyboard switcher, Move to Space)
- Restore at worker start: `restoreTabAssociationBackup` (`src/utils/tabAssociations.ts`) rebuilds it from the local backup (`matchBackupWindows`). On a worker restart within the browser session (`tabRestoreSessionStarted` present) a backup keeps its window by window ID and each entry keeps the tab with its stored ID, whatever page it shows now; entries whose tab is gone are dropped. After a browser restart or an extension reload/update (marker absent) a backup window keeps its old window ID only when every entry's stored tab ID is still in it on the entry's site (`isSameSite`); otherwise it is matched by tab index + domain, then by domain overlap, so IDs reused after a browser restart are not taken. ID matches of a window where the other entries' tabs are gone are kept when index + domain matching finds nothing. Within the window a backup was matched to, an entry placed by reused ID, index or domain prefers the free tab showing its exact page (backup URL), and domain overlap otherwise takes the tab on the entry's domain nearest its stored index
- Backup indices: refreshed on tab create, move, remove, attach and detach, so index + domain matching finds the tabs after a browser restart
- Instances: 1 per window

### `urlRecoveryDone_${windowId}`
Marker that the sidebar's URL pass, which binds open tabs to bookmarks and Favorites by URL, already ran in this window in this browser session
```typescript
true
```
- Owner: `src/contexts/BookmarkTabsContext.tsx` through `UrlRecoveryGate` (`src/utils/urlRecoveryGate.ts`): `rebuildAssociations` writes it after `recoverFixedTabAssociations` finished; a failed pass leaves it unset, so the next rebuild retries
- Consumers: the same window's sidebar (`UrlRecoveryGate.runOnce`) - present: the pass is skipped, so a tab opened by hand on a bookmarked URL stays a regular tab; absent (browser restart, extension reload or update, or a window whose sidebar hasn't run it yet): the pass runs once. Park pages are matched by URL on every rebuild regardless of the marker
- Never removed: entries of closed windows stay until the browser session ends
- Instances: 1 per window

### `bookmarkExpandedState_${windowId}`
Folder expand/collapse state (Record: folderId → boolean)
- Owner: `src/components/BookmarkTree.tsx`
- Consumers: `src/components/BookmarkTree.tsx`
- Instances: 1 per window

### `tabActivityActiveTabs`
Active tab of each window, as last seen by the background (auto-archive, tab age highlight and unvisited tab marker)
```typescript
Record<windowId, tabId>
```
- Owner: `src/stores/tabActivityTracker.ts` (`TabActivityTracker`, background, the only writer)
- Consumers: `TabActivityTracker.markActivated` - on `chrome.tabs.onActivated` it stamps the tab stored for the window as last used and left (`lastUsedAt`, `leftAt`) in `tabLastUsedAt`, then stores the new one. Clearing the activated tab's `unvisited` doesn't depend on this entry
- Why session storage: the service worker often wakes up on the `onActivated` event itself, when neither memory nor a fresh query shows which tab was active before
- Seeding: at worker start (`load`), when `autoArchiveAfter` switches between `'never'` and a period, and on every `tabAgeHighlight` or `markUnvisitedTabs` change, windows with no entry take their active tab from the live tabs; known windows keep their entry
- Not written while `autoArchiveAfter` is `'never'`, `tabAgeHighlight` is `'off'` and `markUnvisitedTabs` is `'off'`; removed when the last of them is switched off. Entries of closed windows stay until the browser session ends
- Instances: 1 per extension (one map for all windows)

### `tabActivitySessionStarted`
Marker that `tabLastUsedAt` was matched to this browser session's tab IDs (auto-archive)
```typescript
true
```
- Owner: `src/stores/tabActivityTracker.ts` (set by `load` through `BrowserSessionMarker`, `src/stores/browserSessionMarker.ts`)
- Consumers: `TabActivityTracker.load` - present: worker restart, stored tab IDs are still valid; absent (browser restart, extension reload or update): records are re-matched to tabs by URL plus nearest index
- Instances: 1 per extension

### `tabRestoreSessionStarted`
Marker that the startup restore matched the stored tab records to this browser session's tab IDs
```typescript
true
```
- Owner: `src/background.ts` through `BrowserSessionMarker` (`src/stores/browserSessionMarker.ts`): reads it once at worker start and writes it after `restoreTabAssociationBackup` succeeded
- Consumers: `TabSpaceRegistry.load` (`tabSpaceAssignments`), `AttentionMarkManager.load` (`attentionMarkedTabs`) and `restoreTabAssociationBackup` (`tabAssociations_${windowId}`) - present: worker restart, stored tab and window IDs are exact, records match by tab ID and window only (`AttentionMarkManager`: by tab ID alone, with no URL fallback; a stored URL may lag a navigation made while the worker slept); absent (browser restart, extension reload or update): ID matches also need the record's site, see the two keys
- Separate from `tabActivitySessionStarted`, which `TabActivityTracker` writes for its own records
- Instances: 1 per extension

### `autoArchiveLastRunAt`
Moment the last auto-archive run started
```typescript
number  // epoch millis
```
- Owner: `src/services/tabAutoArchiver.ts` (written at the start of each run)
- Consumers: `TabAutoArchiver.start` skips the worker-start run when a run started less than one alarm period ago (tab events wake the worker often); `TabAutoArchiver.run` skips an alarm run within half a period (the worker-start run of the worker that alarm woke)
- Instances: 1 per extension

### `openTabPages`
Page of each open tab, so a close can be recorded in Recently Closed (`tabs.onRemoved` gives no URL or title)
```typescript
Array<{ tabId: number, url: string, title: string, incognito: boolean, spaceId?: string, associated: boolean }>
```
- Owner: `src/background.ts` through `OpenTabPages` (`src/stores/openTabPages.ts`, the only writer; writes serialized, unchanged entries not written)
- Updates: `tabs.onCreated` and `tabs.onUpdated` (URL, title) update the tab's page; `TabSpaceRegistry.register` sets `spaceId` (`onAssigned`); a new `tabAssociations_${windowId}` entry sets `associated`, which is never cleared, so the sidebar removing the association when the tab closes doesn't make it recordable; `tabs.onRemoved` takes the entry out and hands it to `closedTabRecord`
- Seeding at worker start, after `TabSpaceRegistry.load`: live tabs are merged over the stored entries, which keep their `spaceId` and `associated`; entries of tabs that are not live are kept, since one of them may be the tab whose close woke the worker
- Why session storage: a close often wakes the worker, and then the closed tab is gone from both the live tabs and `TabSpaceRegistry`. Session storage survives worker restarts and is cleared with the tab IDs (browser restart, extension reload or update)
- Unreadable value: starts empty
- Instances: 1 per extension

---

## Chrome Local Storage

Stored via `chrome.storage.local`. Persistent across browser sessions.

### `tabSpaceAssignments`
Authoritative real Tab → Space identity across extension and browser restarts.
```typescript
Array<{ windowId, tabId, spaceId, url, index }>
```
- Owner: `src/managers/impl/tabSpaceRegistry.ts`
- Consumers: background tab activation/new-tab handling, `useTabSpaceAssignments`, Space move/delete actions, `src/services/tabAutoArchiver.ts` (the Space whose `asd_Archive` a tab is saved to)
- Recovery: `matchStoredTabs` (`src/utils/storedTabMatcher.ts`): every record first tries its stored tab ID in the same window. On a worker restart within the browser session (`tabRestoreSessionStarted` present) that tab is the record's tab whatever page it shows now; after a browser restart or an extension reload/update the ID's tab is kept first only on the stored URL, then the remaining records take the tab on the same URL with the nearest index, and only then an ID tab on another page of the record's site (Chrome may reuse the ID for another page while the record's page reopened under a new ID; an ID on another site is never taken). On a worker restart the remaining records then take the tab on the same URL with the nearest index
- Migration: legacy session registry and existing Space-named native groups are read once to seed internal assignments
- Invariant: Chrome native groups are user-owned presentation and never determine or mutate Space identity

### `spaces`
Space definitions
```typescript
Array<{
  id: string,
  name: string,
  icon: string,
  color: string,
  bookmarkFolderPath: string,          // legacy, may contain '/'
  bookmarkFolderSegments?: string[],   // structured folder path
  bookmarkFolderInAccount?: boolean    // folder in account storage, not device-only
}>
```
- Owner: `src/hooks/useSpaces.ts`
- Consumers: `src/contexts/SpacesContext.tsx`, `src/background.ts` (debug), `src/services/tabAutoArchiver.ts` (finds the Space folder that holds `asd_Archive` from `bookmarkFolderSegments` / `bookmarkFolderInAccount`)
- Instances: 1 per extension (shared across windows)

### `sidebar-follow-active-tab`
"Follow active tab" mode: how the sidebar reacts when Chrome activates a tab
```typescript
'off' | 'space' | 'space-and-scroll'  // default 'space-and-scroll'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage`)
- Consumers: `src/background.ts` (space switching), `src/hooks/useFollowActiveTab.ts` (scrolling), `src/components/SettingsDialog.tsx`
- Instances: 1 per extension (shared across windows)

### `favoriteIcons`
Icon fields of each Favorite, keyed by bookmark id. A Favorite itself is a bookmark in its Space's `asd_Favorites` folder (url, title, position); what a bookmark can't hold lives here
```typescript
Record<bookmarkId, {
  favicon?: string,         // base64 data URL
  customIconName?: string,  // Lucide icon name
  iconColor?: string,       // hex, e.g. "#ef4444"
  emoji?: string
}>
```
- Owner: `src/managers/impl/favoriteIconsManager.ts` (`FavoriteIconsManager`, background, the only writer). Per-operation API (`setIcons`, `setFavicons`, `resetFavicon`, `copyIcons`, `restoreIcons`, `removeIcons`) in `src/managers/shared/favoriteIconsApi.ts`
- Writers through the manager: the sidebar's edits, duplicate, undo of a delete and JSON import (`favoriteIconsManagerProxy`), the lazy icon resolver in `src/hooks/usePinnedSites.ts`, background's favicon update on `favIconUrl`, the favorites migration
- Pruning: `chrome.bookmarks.onRemoved` in `src/background.ts` drops the entry of a removed bookmark and of every bookmark under a removed folder
- Consumers: `src/hooks/usePinnedSites.ts` (merges each bookmark with its entry into a `PinnedSite` via `SpaceFavorites`), `src/actions/deletePinnedSiteAction.ts` (snapshot for undo); JSON export reads the merged list from the hook
- Instances: 1 per extension (shared across windows)

### `favoritesMigration`
State of the one-time copy of the legacy global `pinnedSites` into every Space's `asd_Favorites`
```typescript
{
  done: boolean,
  rekey: Record<oldPinId, Record<spaceId, bookmarkId>>  // where each old pin went in each Space; {} for a pin with no copy
}
```
- Owner: `src/services/favoritesMigration.ts` (`FavoritesMigration`, background, the only writer). Runs at worker start, on a `spaces` change and on bookmark created/moved events until `done`; serialized
- `done` stays unset while a pin failed to copy into a Space with a folder or no Space has a resolvable folder yet, so the next trigger copies the pins still missing from `rekey`. Each Space's `rekey` entries are merged in as soon as that Space is copied, even after a failure
- An existing `asd_Favorites` (synced from a device that migrated first, or this device's own half-filled one): the old pins are matched to its unclaimed bookmarks by URL (this device's icons, `rekey` entries), and the pins with no match are appended to it. `pinnedSites` doesn't sync, so a second device adds the old Favorites the first one didn't have. On `done` every old pin is listed in `rekey`, including pins whose URL doesn't parse, so a tab of a pin with no copy becomes a regular tab
- Consumers: `src/contexts/BookmarkTabsContext.tsx` reads `rekey` on rebuild and on change of the key, and re-keys open `pinned-<oldPinId>` tabs to the copy in their own Space (`rekeyFavoriteAssociations`, `src/utils/favoriteRekey.ts`)
- Instances: 1 per extension

### `pinnedSites` (legacy)
The global Favorites list from before per-Space Favorites
```typescript
Array<{ id, url, title, favicon?, customIconName?, iconColor?, emoji? }>
```
- Owner: none. Left as it was; read once by `src/services/favoritesMigration.ts`, never written again
- The same field name in a JSON backup (`src/utils/backupRestore.ts`) holds the active Space's Favorites; that is the backup format, not this key
- Instances: 1 per extension

### `bookmarkLastActiveAt`
Last time each bookmark's Arc-style tab was active (folder recent popover)
```typescript
string  // JSON of Record<bookmarkId, epochMillis>
```
- Owner: `src/background.ts` (via `BookmarkRecencyStore`, the only writer)
- Consumers: `src/components/BookmarkTree.tsx` (folder rows) and `src/App.tsx` (Space header peek), both via `useChromeLocalStorage`, read-only
- Instances: 1 per extension (shared across windows)

### `autoArchiveAfter`
"Archive tabs after" setting: how long a tab may stay unused before the background closes it
```typescript
'never' | '12h' | '24h' | '3d' | '7d' | '30d'  // raw string, not JSON; default 'never'. DEV builds also accept '1m'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage` with `serialize: v => v`), set from `src/components/SettingsDialog.tsx`
- Consumers: `src/services/tabAutoArchiver.ts` (reads it on every run and in `readTabActivityRecording`, the tracker's recording condition together with `tabAgeHighlight` and `markUnvisitedTabs`; `chrome.storage.onChanged` → `handleSettingChange`), `src/components/SettingsDialog.tsx`
- Parsing: `parseAutoArchivePeriod` (`src/utils/autoArchive.ts`); absent or unknown values read as `'never'`, and `'1m'` reads as `'never'` in release builds
- Alarm: while the value is not `'never'`, the background keeps a `chrome.alarms` alarm named `auto-archive` (every 5 minutes, 1 minute in DEV builds)
- Instances: 1 per extension (shared across windows)

### `autoArchiveEnabledAt`
Moment auto-archive was switched on from `'never'`. No tab closes earlier than one period after it
```typescript
number  // epoch millis
```
- Owner: `src/services/tabAutoArchiver.ts` (background, the only writer)
- Writes: set to now when `autoArchiveAfter` changes from `'never'` to a period; kept when changing between two periods; removed when `autoArchiveAfter` changes to `'never'`. A run that finds a period set but this key missing (the write at switch-on was lost) sets it to now and closes nothing
- Consumers: `src/services/tabAutoArchiver.ts` → `selectTabsToClose` (effective last use = `max(lastUsedAt, autoArchiveEnabledAt)`)
- Instances: 1 per extension

### `tabAgeHighlight`
"Highlight tabs by last use" setting: which look the Tab list's age highlight uses, or off
```typescript
'off' | 'white' | 'accent' | 'cooling' | 'trail'  // raw string, not JSON; default 'white'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage` with `serialize: v => v`), set from `src/components/SettingsDialog.tsx` (Appearance tab)
- Consumers: `src/App.tsx` (sets `data-tab-age-style` on the `.arc-theme` root, left off for `'off'`; `TabList` grades rows only when not `'off'`; both treat the setting as `'off'` until it has loaded, so the default look doesn't flash), `src/services/tabAutoArchiver.ts` → `readTabActivityRecording` (the tracker's `isRecording`, together with `autoArchiveAfter` and `markUnvisitedTabs`), `src/background.ts` (`chrome.storage.onChanged` → `TabActivityTracker.load`, which keeps or drops `tabLastUsedAt`), `src/components/SettingsDialog.tsx`
- Parsing: `parseTabAgeHighlightStyle` (`src/utils/tabAgeHighlight.ts`); absent or unknown values read as `'white'`
- Instances: 1 per extension (shared across windows)

### `markUnvisitedTabs`
"Mark unvisited tabs" setting: whether a dot marks Tab list rows of tabs opened in the background and not switched to yet
```typescript
'on' | 'off'  // raw string, not JSON; default 'on'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage` with `serialize: v => v`), set from `src/components/SettingsDialog.tsx` (Appearance tab)
- Consumers: `src/App.tsx` (passes it to `TabList`, which shows dots only when `'on'`; treated as `'off'` until it has loaded, so dots don't flash for a user who switched them off), `src/services/tabAutoArchiver.ts` → `readTabActivityRecording` (the tracker's `isRecording`, together with `autoArchiveAfter` and `tabAgeHighlight`), `src/background.ts` (`chrome.storage.onChanged` → `TabActivityTracker.load`, which keeps or drops `tabLastUsedAt`), `src/components/SettingsDialog.tsx`
- Parsing: `parseUnvisitedTabMarker` (`src/utils/unvisitedTabMarker.ts`); absent or unknown values read as `'on'`
- Instances: 1 per extension (shared across windows)

### `attentionMarkStyle`
"Mark for Attention colour" setting: colour and strength of the ring on rows marked for attention
```typescript
// raw string, not JSON; default 'accent-dim'
'<colour>' | '<colour>-dim' | '<colour>-bright'  // colour: 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'yellow' | 'accent'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage` with `serialize: v => v`), set from `src/components/SettingsDialog.tsx` (Appearance tab)
- Consumers: `src/App.tsx` (sets `data-attention-style` on the `.arc-theme` root; `src/index.css` turns it into the `.arc-attention-ring` look in `TabList.tsx` and `BookmarkTree.tsx`; `'accent'` follows the active Space's colour through `--arc-attention-space-rgb`, set for every Space whether or not the sidebar tint is on; theme violet in the All view), `src/components/SettingsDialog.tsx`; not read by background
- Parsing: `parseAttentionMarkStyle` (`src/utils/attentionMarkStyle.ts`); absent or unknown values read as `'accent-dim'`
- Instances: 1 per extension (shared across windows)

### `tabLastUsedAt`
Last-use times of each open tab (auto-archive and tab age highlight), and which tabs were opened in the background and never activated (unvisited tab marker). Last use is the moment the tab stopped being active
```typescript
Record<tabId, {
  windowId: number,
  url: string,
  index: number,
  lastUsedAt: number,  // epoch millis; what auto-archive judges by
  leftAt?: number,     // epoch millis; set only when the user leaves the tab, left out until then
  unvisited?: true     // set while a tab opened in the background has not been activated; left out otherwise
}>
```
- Owner: `src/stores/tabActivityTracker.ts` (`TabActivityTracker`, background, the only writer; writes serialized)
- Consumers: `src/services/tabAutoArchiver.ts` (via `TabActivityTracker.refresh`, reads `lastUsedAt`); `src/hooks/useTabActivityView.ts` (sidebar, read-only through `TabActivityView`, follows `chrome.storage.onChanged`, idle while `tabAgeHighlight` and `markUnvisitedTabs` are both `'off'`; the tab the sidebar sees the user leave counts as left and visited right then, until the background's record of it arrives) → `src/components/TabList.tsx`, which grades a row by `max(leftAt, tab.lastAccessed)` and grades none until the key has been read, and shows the unvisited dot on rows that are not active
- Lifecycle: exists while `autoArchiveAfter` is a period, `tabAgeHighlight` is not `'off'` or `markUnvisitedTabs` is `'on'` (`isTabActivityRecording`, `src/utils/tabActivityRecording.ts`). Removed when the last of them is switched off, and at a worker start that finds all three off; nothing is written in between. `unvisited` is recorded whenever the tracker records, also while `markUnvisitedTabs` is `'off'`; only the sidebar's dot depends on the setting, so switching it on later shows dots only for tabs really never visited
- Updates: `onActivated` stamps `lastUsedAt` and `leftAt` of the window's previously active tab (from `tabActivityActiveTabs`) and moves its record to the page and position it shows now, creating the record if the tab had none (a closed tab gets none) and clearing its `unvisited`, and clears `unvisited` of the activated tab even when the previous tab is unknown; `onCreated` writes a record with `unvisited` and `lastUsedAt` = now (no `leftAt`) for a tab created inactive, unless it is a park page, incognito, or arrives within 2 s of its window's `windows.onCreated` (a restored window, `RecentWindows`), and only after `load` has matched the records to this session's tabs; the sidebar's Undo (closed tabs, deleted Space) sends `tab-reopened-by-undo` for each tab it re-creates, and the background clears that tab's `unvisited` after `onCreated` set it (`markReopened`); `onUpdated` with a new URL on an inactive tab moves an unvisited record to that URL and position (`followUrl`); each archiver run (only while auto-archive is on) drops closed tabs, updates `url` and `index`, and stamps `lastUsedAt` of first-seen tabs and tabs in use (active, in a split view with the active tab, audible, Chrome-pinned) with now, carrying `leftAt` and `unvisited` unchanged; `onRemoved` drops the tab (not when its window closes - the next archiver run or worker start cleans those up); worker start, a switch of `autoArchiveAfter` between `'never'` and a period, and every `tabAgeHighlight` or `markUnvisitedTabs` change (`load`) rewrite the key with the records still matched to open tabs
- Recovery: within a browser session records follow their tab by ID only; after a browser restart (no `tabActivitySessionStarted`) they are re-matched by URL plus nearest tab index (`matchStoredTabs`), and every tab on a URL gets the newest `lastUsedAt` among the records with that URL; `leftAt` and `unvisited` stay with the record matched to the tab
- Records written before the tab age highlight existed have no `leftAt` and load as they are; the highlight then uses Chrome's `lastAccessed`. Records written before the unvisited marker existed have no `unvisited` and load as visited
- A record's `url` is the tab's committed URL, or its `pendingUrl` while a new tab has not committed one yet
- Incognito tabs and tabs in popup/app windows are never recorded
- Unreadable value: the tracker logs it, ignores it (starts empty) and overwrites it on the next load; the sidebar shows no `leftAt` times (logged in DEV builds), grades rows by `lastAccessed` and shows no unvisited dots
- Instances: 1 per extension

### `attentionMarkedTabs`
Tabs marked for attention (Mark for Attention)
```typescript
Array<{ tabId: number, windowId: number, url: string, index: number }>
```
- Owner: `src/managers/impl/attentionMarkManager.ts` (`AttentionMarkManager`, background, the only writer; writes serialized); the model is `TabMarks` in `src/stores/attentionMarks.ts`
- Consumers: `src/managers/proxies/attentionMarkProxy.ts` → `src/hooks/useAttentionMarks.ts` (sidebar mirror; `TabList.tsx` draws the ring and the `-` button and leaves marked tabs out of bulk close; `App.tsx` and `SpaceBar.tsx` leave them out of Close All Tabs In Space); `src/services/tabAutoArchiver.ts` (`isTabMarked`, never closes a marked tab)
- Updates: the user's Mark for Attention / Clear Mark / `-` button (`markTabs` reads each tab with `chrome.tabs.get`; incognito or closed tabs are skipped); `tabs.onRemoved` drops the record unless its window is closing (quitting the browser closes windows); `onUpdated` with a new URL, `onMoved` and `onAttached` move the records of the window's marked tabs to their current URL, index and window
- Recovery: on a worker restart (`tabRestoreSessionStarted` present) a record stays with the live tab of its ID, in whatever window, and records of tabs closed while the worker slept are dropped, never moved to another tab on the same URL (`TabMarks.keptForLiveTabs`). After a browser restart or an extension reload/update the records are re-matched with `matchStoredTabs` (`src/utils/storedTabMatcher.ts`): an ID tab on the stored URL first, then URL plus nearest index, then an ID tab on another page of the record's site; an ID on another site never counts. Incognito tabs are left out, records that match no live tab are dropped, and matched records are rebuilt from their live tab and written back before the session marker is set, so a later worker restart matches against this session's IDs only
- Unreadable value: logged, tab marks start empty, events don't write the key and auto-archive skips its runs until the user's next tab mark change writes it
- Incognito tabs are never stored
- Lifespan: persistent; records of tabs that no longer exist go at the next worker start
- Instances: 1 per extension

### `attentionMarkedBookmarks`
Bookmarks marked for attention
```typescript
string[]  // bookmark ids
```
- Owner: `src/managers/impl/attentionMarkManager.ts` (`AttentionMarkManager`, background, the only writer); the model is `BookmarkMarks` in `src/stores/attentionMarks.ts`
- Consumers: `src/managers/proxies/attentionMarkProxy.ts` → `src/hooks/useAttentionMarks.ts` → `src/components/BookmarkTree.tsx` (ring and menu item); not read by auto-archive
- Updates: the user's Mark for Attention / Clear Mark (bookmarks only, never folders); `bookmarks.onRemoved` drops the removed id and, for a folder, every descendant id; worker start drops ids missing from the bookmark tree
- Unreadable value (or a failed `getTree`): logged, bookmark marks start empty and the key is not written until the user's next bookmark mark change
- Lifespan: persistent
- Instances: 1 per extension

### `sectionCollapsedState`
Collapse state of the Bookmarks and Archive sections, per Space
```typescript
string  // JSON of Record<spaceId, { bookmarks: boolean, archive: boolean }>
```
- Owner: `src/hooks/useSectionCollapseState.ts` (via `useChromeLocalStorage`; parsed by `SectionCollapseState` in `src/utils/sectionCollapseState.ts`), called once in `src/App.tsx`
- Consumers: `src/App.tsx` (Space title chevron), `src/components/BookmarkTree.tsx`, `src/components/ArchiveSection.tsx` (through props from `App`)
- Defaults: a missing Space or flag means Bookmarks expanded, Archive collapsed
- The toolbar text filter shows both sections expanded without writing this key
- Instances: 1 per extension (shared across windows)

### `recentlyClosedTabs`
Recently closed tabs of each Space (Recently Closed button on the Space title)
```typescript
string  // JSON of Record<spaceId, Array<{ id: string, url: string, title: string, closedAt: number }>>, newest first
```
- Owner: `src/managers/impl/recentlyClosedManager.ts` (`RecentlyClosedManager`, background, the only writer; writes serialized); the model is `RecentlyClosedTabs` in `src/stores/recentlyClosedTabs.ts`
- Consumers: `src/App.tsx` (`SpaceTitleWrapper`, via `useChromeLocalStorage` parsed with `RecentlyClosedTabs.fromStored`, read-only) → `src/components/RecentlyClosedPopover.tsx`; reopen and Clear go through `src/managers/proxies/recentlyClosedProxy.ts`
- Updates: `tabs.onRemoved` (window close included) adds a record when `closedTabRecord` (`src/utils/closedTabRecording.ts`) finds the tab's Space and the tab qualifies; the same URL in the same Space replaces the older record; at most 50 per Space, the oldest dropped. Reopen removes the record after `chrome.tabs.create` succeeds and registers the new tab in the record's Space; Clear empties the Space's list; a `spaces` change and the worker start drop the lists of deleted Spaces, and a close handled after its Space was deleted is dropped. Delete Space keeps the Space's records in its Undo snapshot (`spaceRecords`), and Undo puts them back (`restoreSpace`). Undo of a tab close drops the Space's record of that URL (`forgetReopened`). Records hold no icon: the popover takes it from Chrome's favicon cache by URL
- Not recorded: tabs closed by auto-archive or the sidebar's Archive action (`expectArchiveClose` right before closing), tabs with a bookmark or Favorite association (`openTabPages.associated`), tabs replaced by a tab suspender's park page, incognito tabs, internal URLs (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `devtools:`, `view-source:`, `chrome-search:`, empty). A parked tab is recorded by the page it stands for
- Records hold no tab IDs, so they survive a browser restart
- Unreadable value: parsed as empty, malformed records dropped. A failed read leaves the manager not loaded, and it writes nothing until the next worker start
- Instances: 1 per extension (shared across windows)

---

## Browser localStorage

Stored via browser `localStorage` using `useLocalStorage` hook.
All owned by `src/App.tsx`, hook implementation in `src/hooks/useLocalStorage.ts`.

| Key | Default | Type | Purpose |
|-----|---------|------|---------|
| `sidebar-font-size-px` | 14 | number | Font size |
| `sidebar-hide-other-bookmarks` | false | boolean | Hide "Other Bookmarks" folder |
| `sidebar-tab-group-display-order` | "groupsFirst" | TabGroupDisplayOrder | Tab group display order: "groupsFirst", "groupsLast", or "chromeOrder" |
| `sidebar-pinned-icon-size-px` | 22 | number | Pinned icon size |
| `sidebar-bookmark-open-mode` | "arc" | string | How bookmarks open ("arc" or "newTab") |
| `sidebar-use-spaces` | true | boolean | Enable spaces feature |
| `sidebar-show-filter-area` | false | boolean | Show search/filter area |
| `sidebar-has-seen-welcome` | false | boolean | Welcome dialog dismissed |
| `sidebar-saved-filters` | [] | string[] | Saved search queries |
| `sidebar-recent-filters` | [] | string[] | Recent search queries |

---

## In-Memory State

Lost on page reload or service worker restart.

### Service Worker (`src/background.ts`)

| Variable | Type | Purpose |
|----------|------|---------|
| `isNavigating` | boolean | Prevents history duplicates during navigation |
| `recentWindows` | `RecentWindows` | Windows created in the last 2 s (`windows.onCreated`); inactive tabs created in them count as a restored window's and get no unvisited mark |

### React Contexts

**FontSizeContext** (`src/contexts/FontSizeContext.tsx`)
- Provides font size value to components

**BookmarkTabsContext** (`src/contexts/BookmarkTabsContext.tsx`)
- `itemToTab`: Map<itemKey, tabId> - bookmark/pinned → tab mapping
- `tabToItem`: Map<tabId, itemKey> - reverse mapping
- `audibleTabs`: Set<tabId> - tabs playing audio
- `tabTitles`: Map<tabId, string> - live tab titles
- `activeTabId`: number | null - currently active tab

**SpacesContext** (`src/contexts/SpacesContext.tsx`)
- Wraps `useSpaces` + `useSpaceWindowState`
- Provides space CRUD and per-window state

### Custom Hooks (Chrome API sourced)

**useTabs** (`src/hooks/useTabs.ts`)
- `tabs`: chrome.tabs.Tab[] - current window's tabs
- Module flag: `isBatchOperation` - suppresses refetches during batch ops

**useBookmarks** (`src/hooks/useBookmarks.ts`)
- `bookmarks`: chrome.bookmarks.BookmarkTreeNode[] - browser bookmarks
- Module flag: `isBatchOperation` - suppresses refetches during batch ops

---

## State Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PERSISTENT STORAGE                           │
├─────────────────────────────────────────────────────────────────┤
│  chrome.storage.local (survives browser restart)                │
│  ├─ spaces                                                      │
│  ├─ favoriteIcons                   (Favorite icons by bookmark)│
│  ├─ favoritesMigration              (one-time Favorites copy)   │
│  ├─ pinnedSites                     (legacy, read once)         │
│  ├─ tabSpaceAssignments             (real Tab → Space)          │
│  ├─ autoArchiveAfter                (auto-archive setting)      │
│  ├─ autoArchiveEnabledAt            (auto-archive switch-on)    │
│  ├─ tabAgeHighlight                 (tab age highlight look)    │
│  ├─ markUnvisitedTabs               (unvisited tab marker)      │
│  ├─ attentionMarkStyle              (attention ring look)       │
│  ├─ tabLastUsedAt                   (tab last-use times)        │
│  ├─ attentionMarkedTabs             (marked tabs)               │
│  ├─ attentionMarkedBookmarks        (marked bookmarks)          │
│  ├─ sectionCollapsedState           (per Space)                 │
│  └─ recentlyClosedTabs              (closed tabs per Space)     │
├─────────────────────────────────────────────────────────────────┤
│  browser localStorage (survives browser restart)                │
│  └─ sidebar-* settings (10 keys)                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    SESSION STORAGE                              │
├─────────────────────────────────────────────────────────────────┤
│  chrome.storage.session (cleared on browser close)              │
│  ├─ bg_windowTabHistory             (per window)                │
│  ├─ spaceWindowState_{winId}        (per window)                │
│  ├─ tabAssociations_{winId}         (per window)                │
│  ├─ bookmarkExpandedState_{winId}   (per window)                │
│  ├─ urlRecoveryDone_{winId}         (per window)                │
│  ├─ tabActivityActiveTabs           (active tab per window)     │
│  ├─ tabActivitySessionStarted       (browser session marker)    │
│  ├─ tabRestoreSessionStarted        (browser session marker)    │
│  ├─ autoArchiveLastRunAt            (last auto-archive run)     │
│  └─ openTabPages                    (open tab pages)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    IN-MEMORY STATE                              │
├─────────────────────────────────────────────────────────────────┤
│  Service Worker                                                 │
│  └─ isNavigating flag                                           │
├─────────────────────────────────────────────────────────────────┤
│  React Contexts (per sidebar instance)                          │
│  ├─ FontSizeContext                                             │
│  ├─ BookmarkTabsContext                                         │
│  └─ SpacesContext                                               │
├─────────────────────────────────────────────────────────────────┤
│  Hooks (per sidebar instance)                                   │
│  ├─ useTabs → Chrome tabs API                                   │
│  └─ useBookmarks → Chrome bookmarks API                         │
└─────────────────────────────────────────────────────────────────┘
```
