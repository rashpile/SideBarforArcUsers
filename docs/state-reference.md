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
- User data that must persist (spaces, pinned sites)
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
Tab → bookmark/pinned site mapping (Record: tabId → itemKey, `bookmark-{id}` / `pinned-{id}`)
- Owner: `src/contexts/BookmarkTabsContext.tsx`
- Consumers: `src/components/PinnedBar.tsx`, `src/components/TabList.tsx`, `src/services/tabAutoArchiver.ts` (tells bookmark and Favorite tabs from regular tabs)
- Restore at worker start: `restoreTabAssociationBackup` (`src/utils/tabAssociations.ts`) rebuilds it from the local backup (`matchBackupWindows`). On a worker restart within the browser session (`tabRestoreSessionStarted` present) a backup keeps its window by window ID and each entry keeps the tab with its stored ID, whatever page it shows now; entries whose tab is gone are dropped. After a browser restart or an extension reload/update (marker absent) a backup window keeps its old window ID only when every entry's stored tab ID is still in it on the entry's site (`isSameSite`); otherwise it is matched by tab index + domain, then by domain overlap, so IDs reused after a browser restart are not taken. ID matches of a window where the other entries' tabs are gone are kept when index + domain matching finds nothing. Within the window a backup was matched to, an entry placed by reused ID, index or domain prefers the free tab showing its exact page (backup URL), and domain overlap otherwise takes the tab on the entry's domain nearest its stored index
- Backup indices: refreshed on tab create, move, remove, attach and detach, so index + domain matching finds the tabs after a browser restart
- Instances: 1 per window

### `bookmarkExpandedState_${windowId}`
Folder expand/collapse state (Record: folderId → boolean)
- Owner: `src/components/BookmarkTree.tsx`
- Consumers: `src/components/BookmarkTree.tsx`
- Instances: 1 per window

### `tabActivityActiveTabs`
Active tab of each window, as last seen by the background (feature 035, auto-archive)
```typescript
Record<windowId, tabId>
```
- Owner: `src/stores/tabActivityTracker.ts` (`TabActivityTracker`, background, the only writer)
- Consumers: `TabActivityTracker.markActivated` - on `chrome.tabs.onActivated` it stamps the tab stored for the window as last used in `tabLastUsedAt`, then stores the new one
- Why session storage: the service worker often wakes up on the `onActivated` event itself, when neither memory nor a fresh query shows which tab was active before
- Seeding: at worker start (`load`) and when auto-archive is switched on, windows with no entry take their active tab from the live tabs; known windows keep their entry
- Not written while `autoArchiveAfter` is `'never'`; removed when it changes to `'never'`. Entries of closed windows stay until the browser session ends
- Instances: 1 per extension (one map for all windows)

### `tabActivitySessionStarted`
Marker that `tabLastUsedAt` was matched to this browser session's tab IDs (feature 035)
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
- Consumers: `TabSpaceRegistry.load` (`tabSpaceAssignments`) and `restoreTabAssociationBackup` (`tabAssociations_${windowId}`) - present: worker restart, stored tab and window IDs are exact, records match by tab ID and window only (a stored URL may lag a navigation made while the worker slept); absent (browser restart, extension reload or update): ID matches also need the record's site, see the two keys
- Separate from `tabActivitySessionStarted`, which `TabActivityTracker` writes for its own records
- Instances: 1 per extension

### `autoArchiveLastRunAt`
Moment the last auto-archive run started (feature 035)
```typescript
number  // epoch millis
```
- Owner: `src/services/tabAutoArchiver.ts` (written at the start of each run)
- Consumers: `TabAutoArchiver.start` skips the worker-start run when a run started less than one alarm period ago (tab events wake the worker often); `TabAutoArchiver.run` skips an alarm run within half a period (the worker-start run of the worker that alarm woke)
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
- Recovery: `matchStoredTabs` (`src/utils/storedTabMatcher.ts`): every record first tries its stored tab ID in the same window. On a worker restart within the browser session (`tabRestoreSessionStarted` present) that tab is the record's tab whatever page it shows now; after a browser restart or an extension reload/update it counts only on the record's site (an ID reused by another page is not taken). Then the remaining records take the tab on the same URL with the nearest index
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

### `pinnedSites`
Pinned sites list
```typescript
Array<{
  id: string,
  url: string,
  title: string,
  favicon: string,
  customIconName?: string,
  iconColor?: string
}>
```
- Owner: `src/hooks/usePinnedSites.ts`
- Consumers: `src/components/PinnedBar.tsx`
- Instances: 1 per extension (shared across windows)

### `bookmarkLastActiveAt`
Last time each bookmark's Arc-style tab was active (feature 034, folder recent popover)
```typescript
string  // JSON of Record<bookmarkId, epochMillis>
```
- Owner: `src/background.ts` (via `BookmarkRecencyStore`, the only writer)
- Consumers: `src/components/BookmarkTree.tsx` (via `useChromeLocalStorage`, read-only)
- Instances: 1 per extension (shared across windows)

### `autoArchiveAfter`
"Archive tabs after" setting (feature 035): how long a tab may stay unused before the background closes it
```typescript
'never' | '12h' | '24h' | '3d' | '7d' | '30d'  // raw string, not JSON; default 'never'. DEV builds also accept '1m'
```
- Owner: `src/App.tsx` (via `useChromeLocalStorage` with `serialize: v => v`), set from `src/components/SettingsDialog.tsx`
- Consumers: `src/services/tabAutoArchiver.ts` (reads it on every run; `chrome.storage.onChanged` → `handleSettingChange`), `src/components/SettingsDialog.tsx`
- Parsing: `parseAutoArchivePeriod` (`src/utils/autoArchive.ts`); absent or unknown values read as `'never'`, and `'1m'` reads as `'never'` in release builds
- Alarm: while the value is not `'never'`, the background keeps a `chrome.alarms` alarm named `auto-archive` (every 5 minutes, 1 minute in DEV builds)
- Instances: 1 per extension (shared across windows)

### `autoArchiveEnabledAt`
Moment auto-archive was switched on from `'never'` (feature 035). No tab closes earlier than one period after it
```typescript
number  // epoch millis
```
- Owner: `src/services/tabAutoArchiver.ts` (background, the only writer)
- Writes: set to now when `autoArchiveAfter` changes from `'never'` to a period; kept when changing between two periods; removed when `autoArchiveAfter` changes to `'never'`. A run that finds a period set but this key missing (the write at switch-on was lost) sets it to now and closes nothing
- Consumers: `src/services/tabAutoArchiver.ts` → `selectTabsToClose` (effective last use = `max(lastUsedAt, autoArchiveEnabledAt)`)
- Instances: 1 per extension

### `tabLastUsedAt`
Last-use time of each open tab (feature 035, auto-archive). Last use is the moment the tab stopped being active
```typescript
Record<tabId, {
  windowId: number,
  url: string,
  index: number,
  lastUsedAt: number  // epoch millis
}>
```
- Owner: `src/stores/tabActivityTracker.ts` (`TabActivityTracker`, background, the only writer; writes serialized)
- Consumers: `src/services/tabAutoArchiver.ts` (via `TabActivityTracker.refresh`)
- Lifecycle: exists only while `autoArchiveAfter` is a period. Removed when it changes to `'never'`, and at a worker start that finds it `'never'`; nothing is written in between
- Updates: `onActivated` stamps the window's previously active tab (from `tabActivityActiveTabs`) and moves its record to the page and position it shows now, creating the record if the tab had none (a closed tab gets none); each archiver run drops closed tabs, updates `url` and `index`, and stamps first-seen tabs and tabs in use (active, in a split view with the active tab, audible, Chrome-pinned) with now; `onRemoved` drops the tab (not when its window closes - the next run cleans those up); worker start (`load`) rewrites the key with the records still matched to open tabs
- Recovery: within a browser session records follow their tab by ID only; after a browser restart (no `tabActivitySessionStarted`) they are re-matched by URL plus nearest tab index (`matchStoredTabs`), and every tab on a URL gets the newest `lastUsedAt` among the records with that URL
- Incognito tabs and tabs in popup/app windows are never recorded
- Unreadable value: logged, ignored (the tracker starts empty) and overwritten on the next load
- Instances: 1 per extension

### `sectionCollapsedState`
Collapse state of the Bookmarks and Archive sections, per Space (feature 035)
```typescript
string  // JSON of Record<spaceId, { bookmarks: boolean, archive: boolean }>
```
- Owner: `src/hooks/useSectionCollapseState.ts` (via `useChromeLocalStorage`; parsed by `SectionCollapseState` in `src/utils/sectionCollapseState.ts`), called once in `src/App.tsx`
- Consumers: `src/App.tsx` (Space title chevron), `src/components/BookmarkTree.tsx`, `src/components/ArchiveSection.tsx` (through props from `App`)
- Defaults: a missing Space or flag means Bookmarks expanded, Archive collapsed
- The toolbar text filter shows both sections expanded without writing this key
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
│  ├─ pinnedSites                                                 │
│  ├─ tabSpaceAssignments             (real Tab → Space)          │
│  ├─ autoArchiveAfter                (auto-archive setting)      │
│  ├─ autoArchiveEnabledAt            (auto-archive switch-on)    │
│  ├─ tabLastUsedAt                   (tab last-use times)        │
│  └─ sectionCollapsedState           (per Space)                 │
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
│  ├─ tabActivityActiveTabs           (active tab per window)     │
│  ├─ tabActivitySessionStarted       (browser session marker)    │
│  ├─ tabRestoreSessionStarted        (browser session marker)    │
│  └─ autoArchiveLastRunAt            (last auto-archive run)     │
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
