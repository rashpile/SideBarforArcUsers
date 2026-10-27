---
created: 2026-10-27
after-version: 1.0.348
status: completed
---

# 034 - Folder Recent Popover

## Feature Goal

Match Arc's collapsed-folder peek: hovering a **collapsed** bookmark folder shows a popover listing the bookmark pages inside it (recursively), most recently used first, with a "Search <folder>…" field.

- Without a query, the list shows only bookmarks that have been active at least once, sorted by last-active time (newest first), each with a relative time label ("Just now", "5 min ago", "2 months ago").
- With a query, the list searches **all** bookmarks in the folder by title and URL (same `matchesFilter` syntax as the toolbar search). Previously active bookmarks are listed first by recency, the rest follow in tree order.
- Clicking a row opens the bookmark exactly like clicking it in the tree (Arc-style tab via `onOpenBookmark`). Cmd/Ctrl+click opens a new tab, Shift+click a new window.
- Clicking the folder row itself still expands/collapses the folder.

Arc-style bookmark mode only (`bookmarkOpenMode === 'arc'`): last-active time comes from bookmark ↔ tab associations, which only exist in that mode.

## Behaviour Details

- Opens after hovering the folder row for ~400ms. Not shown while a drag is in progress, for expanded folders, or for special folders.
- Closes when the pointer leaves both the folder row and the popover (short grace delay so the pointer can travel between them), on `Esc`, after opening a bookmark, or when the folder is expanded.
- Rendered through a portal to `document.body`, positioned under the folder row (flipped above when there is no room below). Chrome extensions cannot draw outside the Side Panel, so unlike Arc the popover stays inside the panel.
- The search field is focused when the popover opens, unless another text field in the panel already has focus (so typing in the toolbar search is never hijacked); Up/Down move the highlighted row, Enter opens it.
- No query: at most 10 rows. Query: at most 50 rows.

## Open Pages in Collapsed Folders

Previously a collapsed folder surfaced only its single **active** descendant. It now surfaces **every open** (Arc-style loaded) bookmark in its subtree, in tree order, so e.g. three open pages under `~` all stay visible while `~` is collapsed. The active one keeps the active card styling. `getVisibleBookmarkChildren` (`src/utils/bookmarkTreeVisibility.ts`) takes an `isOpen` predicate and marks these rows `isPeek` (`data-peek`).

On the folder row, `hasPeek` (any open page surfaced) drives the dotted folder icon and the `−` indicator; `hasActivePeek` (the active page is among them) additionally drives the row highlight (`data-has-active-peek`), so only the folder holding the current page looks selected.

## Recency Tracking

Stored in `chrome.storage.local` under `bookmarkLastActiveAt` as a JSON string of `{ [bookmarkId]: epochMillis }` (string format so the sidebar can read it with `useChromeLocalStorage`).

**Single writer: `background.ts`** (see `docs/decisions/2026-07-30-shared-storage-multiple-writers.md`). The sidebar only reads.

- `chrome.tabs.onActivated`: if the activated tab is associated with `bookmark-{id}` in `tabAssociations_{windowId}`, record `id`.
- `chrome.storage.onChanged` (`session`, `tabAssociations_{windowId}`): when a window's associations change, record the window's active tab if it is a bookmark tab. This covers opening a bookmark from the sidebar, where the new tab is activated *before* the sidebar stores the association, so `onActivated` alone would miss it.
- `chrome.bookmarks.onRemoved`: forget the removed bookmark and, for folders, all its descendants.

History starts empty; nothing is imported from Arc.

## Files

- `src/stores/bookmarkRecencyStore.ts` - `BookmarkRecency` (read-only value: last-active lookup) and `BookmarkRecencyStore` (background writer, serialized read-modify-write queue).
- `src/utils/folderRecentItems.ts` - collects a folder's bookmarks and selects/sorts the popover rows; `formatRelativeTime`.
- `src/components/FolderRecentPopover.tsx` - the popover UI.
- `src/components/BookmarkTree.tsx` - hover handling on folder rows, passes `bookmarkRecency` down; collapsed folders surface open descendants.
- `src/utils/bookmarkTreeVisibility.ts` - collapsed-folder visible children (all open descendants).
- `src/background.ts` - recency recording listeners.
- `tests/bookmarkRecencyStore.test.mjs`, `tests/folderRecentItems.test.mjs`, `tests/bookmarkTreeVisibility.test.mjs`.
