# Folder peek search button in the Space header

## Overview
- Folder rows in `arc` open mode show a hover search button ("Search recent pages") that opens
  `FolderRecentPopover`: the folder's recently used pages with a search field. The Space header has none.
- Add the same button to the Space header (`SpaceTitle` in `src/App.tsx`, rendered by `SectionHeader`),
  right before its `...` button. It opens the same popover for the Space's root folder.
- Issue #32. Design: brainstorm design.md (summarised below).

## Context (from discovery)
- `src/components/FolderRecentPopover.tsx` - `useFolderPeek(enabled)` (hover/click state, anchor rect),
  `FolderRecentPopover` (portal; lists `collectFolderBookmarks(folder)`)
- `src/utils/folderRecentItems.ts` - `collectFolderBookmarks` already skips `isSystemFolder` folders at any
  depth below the folder; covered by `tests/folderRecentItems.test.mjs`
- `src/components/BookmarkTree.tsx` - folder row: `canPeek`, `folderPeek`, `handlePeekOpen` (Cmd/Ctrl new
  tab, Shift new window, else `onOpenBookmark`), the search button markup, the popover render
- `src/components/SectionHeader.tsx` - header row (`group` class), `trailing` slot, `...` button
- `src/App.tsx` - `SpaceTitle`, `SpaceTitleWrapper` (computes `spaceRoot` via `findFolderBySegments`; sits
  inside `UnifiedDndProvider`, `BookmarkTabsProvider`)
- `src/stores/bookmarkRecencyStore.ts` - `BookmarkRecency`, `BOOKMARK_RECENCY_KEY` (`bookmarkLastActiveAt`)

## Development Approach
- **testing approach**: Regular
- complete each task fully before moving to the next; small, focused changes
- no new unit tests: the only data decision (skip `asd_Archive` / `asd_Favorites` at any depth) is already
  tested in `tests/folderRecentItems.test.mjs`; the rest is UI wiring, which CLAUDE.md says not to test
- run `make lint && make test` after each task, `make build` at the end

## Testing Strategy
- unit tests: existing `tests/folderRecentItems.test.mjs` must keep passing
- no e2e suite in the project; manual check listed in Post-Completion

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix, blockers with ⚠️ prefix

## Solution Overview
- Reuse `useFolderPeek` / `FolderRecentPopover` unchanged except for the anchor lookup.
- `SectionHeader` gets an `actions` slot before `...`; the row carries `data-peek-anchor` so the popover
  anchors to the whole header row, like it anchors to the folder row.
- The picked-page open logic moves out of `BookmarkTree`'s `handlePeekOpen` into one exported helper used
  by both the folder row and the Space header.
- `SpaceTitleWrapper` owns the peek state (it already has `spaceRoot`), reads recency read-only and the
  drag state from `useUnifiedDndOptional()`, and passes the button and popover down.

## Technical Details
- `SectionHeader` prop: `actions?: ReactNode` - rendered in `renderHeaderRow` after `trailing` and before
  `menuButton`. The row `div` gets `data-peek-anchor` only when `actions` is passed.
- `useFolderPeek.anchorOf`: `trigger.closest<HTMLElement>('[data-bookmark-id], [data-peek-anchor]') ?? trigger`.
  The folder row is matched first because its `[data-bookmark-id]` element is closer than any header.
- Shared helper in `FolderRecentPopover.tsx`:
  ```typescript
  export function openPeekBookmark(
    bookmark: chrome.bookmarks.BookmarkTreeNode,
    e: React.MouseEvent | React.KeyboardEvent,
    windowId: number | null | undefined,
    openInArc: (bookmarkId: string, url: string) => void
  ): void
  ```
  Cmd/Ctrl → `chrome.tabs.create({ url, active: true, windowId: windowId ?? undefined })`; Shift →
  `chrome.windows.create({ url })`; else `openInArc(bookmark.id, bookmark.url!)`. Callers call
  `peek.close()` first. It touches `chrome.*` only when called, never at import time.
- Space header peek in `SpaceTitleWrapper`:
  - new prop `bookmarkOpenMode: BookmarkOpenMode`, passed from `App` (`bookmarkOpenMode` state)
  - `const [recencyRecord] = useChromeLocalStorage<BookmarkRecencyRecord>(BOOKMARK_RECENCY_KEY, {})`,
    `const recency = useMemo(() => new BookmarkRecency(recencyRecord), [recencyRecord])` - read-only,
    background stays the only writer
  - `const dragActive = !!useUnifiedDndOptional()?.activeId`
  - `canPeek = !!spaceRoot && bookmarkOpenMode === 'arc' && !dragActive` (`recency` is a memoised object,
    never undefined, so the folder row's `!!bookmarkRecency` check has no counterpart here)
  - `const peek = useFolderPeek(canPeek)`
  - button: same behaviour as the folder row's (`onPointerDown` stopPropagation, `{...peek.triggerHandlers}`,
    title/aria-label "Search recent pages"), styled like the neighbouring `...` button
    (`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400`, icon
    `<Search size={iconSize} />` matching the `...` icon size), `aria-expanded={!!peek.anchorRect}`;
    rendered only when `canPeek`; passed to `SpaceTitle` as `peekButton` and on to `SectionHeader.actions`
  - visibility: `src/index.css` already hides `.arc-space-title button` (opacity 0) and shows them on
    `:hover` / `:focus-within`. That rule beats Tailwind opacity utilities, and the popover is portaled to
    `document.body`, so the header loses `:hover` when the pointer moves into it. Add
    `.arc-space-title button[aria-expanded="true"] { opacity: 1; }` next to that rule, so the button stays
    visible while its popover is open; no Tailwind opacity classes on the button
  - popover: rendered by the wrapper when `peek.anchorRect && spaceRoot`, keyed by `spaceRoot.id`,
    `folder={spaceRoot}`, `recency={recency}`, `onOpenBookmark` = close + `openPeekBookmark(..., windowId,
    (id, url) => openBookmarkTab(id, url, activeSpace.id))` (`openBookmarkTab` from `useBookmarkTabsContext`)
  - the trigger's click already stops propagation, so it does not toggle the Bookmarks section; the
    popover stops click/pointerdown propagation for its portal events
- No button for the "Create a Space" placeholder or a Space without a folder (`spaceRoot` null).
- No new storage keys. `docs/state-reference.md`: add `src/App.tsx` (Space header) as a read-only
  consumer of `bookmarkLastActiveAt`.

## What Goes Where
- Implementation Steps: code and docs in this repo
- Post-Completion: manual check in Chrome

## Implementation Steps

### Task 1: Generalise the peek anchor and extract the open helper

**Files:**
- Modify: `src/components/FolderRecentPopover.tsx`
- Modify: `src/components/BookmarkTree.tsx`

- [x] in `useFolderPeek`, make `anchorOf` look for `[data-bookmark-id], [data-peek-anchor]`; update its comment
- [x] add exported `openPeekBookmark(bookmark, e, windowId, openInArc)` to `FolderRecentPopover.tsx` with the Cmd/Ctrl / Shift / default branches now in `handlePeekOpen`
- [x] make `BookmarkTree`'s `handlePeekOpen` call `folderPeek.close()` then `openPeekBookmark(bookmark, e, windowId, (id, url) => onOpenBookmark?.(id, url))`
- [x] run `make lint && make test` - must pass before task 2

### Task 2: Actions slot in SectionHeader

**Files:**
- Modify: `src/components/SectionHeader.tsx`

- [x] add optional `actions?: ReactNode` prop, rendered in `renderHeaderRow` after `trailing` and before the `...` button
- [x] add `data-peek-anchor` to the header row `div` when `actions` is passed
- [x] run `make lint && make test` - must pass before task 3

### Task 3: Search button and popover in the Space header

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [x] pass `bookmarkOpenMode` from `App` to `SpaceTitleWrapper` (new prop)
- [x] in `SpaceTitleWrapper`: read recency read-only (`useChromeLocalStorage` + `BookmarkRecency`), drag state from `useUnifiedDndOptional()`, compute `canPeek`, call `useFolderPeek(canPeek)`, get `openBookmarkTab` from `useBookmarkTabsContext`
- [x] build the search button (folder row's handlers, `...` button's style, `aria-expanded={!!peek.anchorRect}`) and pass it through `SpaceTitle` to `SectionHeader`'s `actions` when `canPeek`
- [x] in `src/index.css`, add `.arc-space-title button[aria-expanded="true"] { opacity: 1; }` beside the `.arc-space-title:hover button` rule
- [x] render `FolderRecentPopover` for `spaceRoot` (keyed by `spaceRoot.id`) while `peek.anchorRect` is set; picking a page closes the peek and calls `openPeekBookmark` with `openBookmarkTab(id, url, activeSpace.id)`
- [x] run `make lint && make test` - must pass before task 4

### Task 4: Verify acceptance criteria
- [ ] code check: the button renders only when `canPeek` (`spaceRoot`, `arc` mode, no drag) and sits in `.arc-space-title`, whose hover rule shows it; the `aria-expanded="true"` rule keeps it visible while the popover is open
- [ ] code check: the popover gets `folder={spaceRoot}`, so `collectFolderBookmarks` lists every subfolder and skips `asd_Archive` / `asd_Favorites`
- [ ] code check: both popovers open picks through `openPeekBookmark`
- [ ] code check: the button's click and pointerdown stop propagation, so it does not toggle the Bookmarks section
- [ ] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation
- [ ] `README.md`: mention the search button on the Space title in the Bookmarks section
- [ ] `docs/changelog.md`: a "New:" line under Latest Version
- [ ] `src/data/changelog.ts`: a What's New line under the current top version
- [ ] `docs/state-reference.md`: add `src/App.tsx` (Space header peek, read-only) to `bookmarkLastActiveAt` consumers
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- load the unpacked build, Arc open mode: hover the Space title, open the peek, search, pick a page with
  plain click, Cmd+click and Shift+click; move the pointer into the popover and check the button stays visible; check pages from nested folders show and Archive/Favorites
  pages don't; start a drag and check the button hides; switch to another open mode and check it's gone
