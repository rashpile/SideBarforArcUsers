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

Stored via `chrome.storage.session`. Survives service worker restarts, cleared on browser close.

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
Bookmark/pinned site → tab ID mapping (Record: itemKey → tabId)
- Owner: `src/contexts/BookmarkTabsContext.tsx`
- Consumers: `src/components/PinnedBar.tsx`, `src/components/TabList.tsx`
- Instances: 1 per window

### `bookmarkExpandedState_${windowId}`
Folder expand/collapse state (Record: folderId → boolean)
- Owner: `src/components/BookmarkTree.tsx`
- Consumers: `src/components/BookmarkTree.tsx`
- Instances: 1 per window

---

## Chrome Local Storage

Stored via `chrome.storage.local`. Persistent across browser sessions.

### `tabSpaceAssignments`
Authoritative real Tab → Space identity across extension and browser restarts.
```typescript
Array<{ windowId, tabId, spaceId, url, index }>
```
- Owner: `src/managers/impl/tabSpaceRegistry.ts`
- Consumers: background tab activation/new-tab handling, `useTabSpaceAssignments`, Space move/delete actions
- Recovery: exact live tab ID first; after browser restoration, URL plus nearest tab index is used as a fallback
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
  bookmarkFolderPath: string
}>
```
- Owner: `src/hooks/useSpaces.ts`
- Consumers: `src/contexts/SpacesContext.tsx`, `src/background.ts` (debug)
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
│  └─ tabSpaceAssignments             (real Tab → Space)          │
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
│  └─ bookmarkExpandedState_{winId}   (per window)                │
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
