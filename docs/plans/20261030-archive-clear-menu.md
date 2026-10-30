# Archive "..." menu with Clear by age (#24)

## Overview

The Archive only grows: items are deleted one at a time (right-click > Delete from Archive). This adds a
`...` button to the Archive section header with a **Clear** submenu: Clear All, Older than 24 Hours,
Older than 7 Days, Older than 30 Days.

- Scope: the active Space's `asd_Archive` folder only; every page in it, regardless of the header search
  and the toolbar filter.
- One Undo restores everything one command removed.
- Options that would remove nothing are grayed out; every option shows its count.
- Clear All asks for confirmation; the age options run at once with Undo.

## Context (from discovery)

- `src/components/ArchiveSection.tsx`: `SectionHeader` gets `menuContent={null}` / `showMenuButton={false}`;
  `handleDelete` runs `DeleteBookmarkAction` through `onPerformAction` (Undo toast in `App.tsx`
  `performAction`).
- `src/components/SectionHeader.tsx`: renders the `MoreHorizontal` button and a `ContextMenu` when
  `showMenuButton` is true.
- `src/utils/archiveItems.ts`: `ArchiveItems.fromFolder` collects the archive's pages (subfolders included,
  nested `asd_Archive` skipped), newest `dateAdded` first. Tested in `tests/archiveItems.test.mjs`.
- `src/utils/archiveFolder.ts`: `isArchiveFolder`, `findArchiveFolder`.
- `src/actions/archiveTabsAction.ts`: pattern for an action that keeps `chrome.*` out of the module
  (injected API), tested under Node.
- `src/components/menu/MenuBase.tsx` / `ContextMenu.tsx`: `Item` has no `disabled` prop yet;
  `ContextMenu.Sub` / `SubTrigger` / `SubContent` exist (used in `BookmarkTree.tsx` Edit submenu).
- `src/hooks/useBookmarks.ts`: `runBatchOperation` refreshes the tree once after a batch.
- `src/components/Dialog.tsx`, `ConfirmDeleteDialog.tsx`: dialog pattern for the Clear All confirmation.

## Development Approach

- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next
- tests only for decisions that lose data when wrong (CLAUDE.md "Test decisions, not coverage"): the
  selection by cutoff and the scope of the clear action. No tests for menu wiring, labels, the dialog
- all tests must pass before the next task: `make test`; also `make lint` and `make build` at the end

## Testing Strategy

- **unit tests**: `node --test` (`make test`) for the selection by cutoff (Task 1) and the clear action's
  scope, re-read and undo (Task 2), with an in-memory bookmarks fake
- **e2e tests**: the project has none; manual check in Post-Completion

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix, blockers with ⚠️ prefix
- update the plan if implementation deviates from it

## Solution Overview

A dedicated `ClearArchiveAction` instead of `DeleteBookmarkAction`:
- it re-reads the archive folder with `getSubTree` when it runs and selects there, so a page moved out of
  `asd_Archive` since the last render is never deleted (scope checked at action time);
- it removes pages only, with no per-id parent-chain walk (`DeleteBookmarkAction` calls
  `chrome.bookmarks.get` per ancestor per id: thousands of calls for a big archive);
- its Undo recreates pages oldest-original first at index 0 of their parent, so the Archive lists them in
  their original relative order (Chrome can't set `dateAdded`: restored items get a fresh archive time,
  as with single-delete Undo).

## Technical Details

### Clear options (`src/utils/archiveItems.ts`)

- `ArchiveClearOption` class with `label` and `maxAgeMs` (`null` = all), and the four options as statics:
  `ALL` ("Clear All"), `OLDER_THAN_24_HOURS` ("Older than 24 Hours", 24 h), `OLDER_THAN_7_DAYS`
  ("Older than 7 Days"), `OLDER_THAN_30_DAYS` ("Older than 30 Days"); a static ordered list for the menu.
- `ArchiveItems.clearable(option, now)`: `ALL` → every page (also those without `dateAdded`); an age
  option → pages with a defined `dateAdded <= now - maxAgeMs`. Pages without `dateAdded` are never picked
  by an age option (unknown age).

### `ClearArchiveAction` (`src/actions/clearArchiveAction.ts`)

```ts
export interface ClearArchiveBookmarksApi
{
  getSubTree: (id: string) => Promise<BookmarkNode[]>;
  remove: (id: string) => Promise<void>;
  create: (bookmark: { parentId: string; title: string; url: string; index: number }) => Promise<unknown>;
}
constructor(api, archiveFolderId: string, option: ArchiveClearOption, now: () => number,
            batch: <T>(fn: () => Promise<T>) => Promise<T> = fn => fn())
```

- `do()`: `getSubTree(archiveFolderId)`; a deleted folder makes Chrome's `getSubTree` reject: the error
  propagates, `performAction` shows the error toast and nothing is removed. A node that `isArchiveFolder`
  rejects (renamed) → remove nothing. Otherwise select with `ArchiveItems.fromFolder(node).clearable(option, now())`; inside `batch`,
  `remove` each; a failed remove is skipped. Snapshot `{ parentId, title, url, dateAdded }` of every page
  actually removed. `description` = `Cleared N archived pages` / `Cleared 1 archived page`.
- `undo()`: inside `batch`, recreate the snapshots sorted by original `dateAdded` ascending (missing
  `dateAdded` first), each with `index: 0` in its `parentId`. A failed create is logged
  (`console.error`) and skipped.
- No `chrome.*` and no `import.meta.env` in the module; sibling imports with `.ts`.

### UI (`src/components/ArchiveSection.tsx`)

- `SectionHeader`: `showMenuButton` (default), `menuTitle="Archive options"`, menu content always (also
  collapsed; header buttons show on hover through `.arc-space-title`).
- Menu: `ContextMenu.Sub` "Clear" (Trash icon) → four `ContextMenu.Item`s `"<label> (<count>)"`; count 0 →
  `disabled`. The submenu is its own small component (`ArchiveClearMenu({ items, onClear })`) rendered
  inside `menuContent`, so it mounts when the menu opens and reads `Date.now()` then (an element built at
  `ArchiveSection`'s last render would show stale counts after the sidebar sat idle). Counts come from
  `items` (the whole archive), never `filteredItems` / `visibleItems`.
- Age option → `ClearArchiveAction` through `onPerformAction` (fallback `action.do()` as `handleDelete`).
- Clear All → confirmation `Dialog` "Clear Archive" (N taken when the dialog opens): "Remove all N archived pages from this Space's
  Archive? You can undo this." Cancel / Clear (danger). Confirm → the action.
- Chrome adapter object for `ClearArchiveBookmarksApi` (promise-based `chrome.bookmarks`) and
  `runBatchOperation` as `batch`, both defined in the component module.

### Menu `disabled` items (`src/components/menu/MenuBase.tsx`, `ContextMenu.tsx`)

- `MenuBase.Item` `disabled?: boolean`: gray text, `cursor-default`, no hover background,
  `aria-disabled`, click does not call `onSelect`.
- `ContextMenu.Item` passes `disabled` through; since `BaseItem` skips `onSelect` when disabled, its
  `close()` never runs, so no separate guard is needed.

## What Goes Where

- Implementation Steps: code, tests, docs in this repo.
- Post-Completion: manual check in Chrome.

## Implementation Steps

### Task 1: Clear options and age selection in ArchiveItems

**Files:**
- Modify: `src/utils/archiveItems.ts`
- Modify: `tests/archiveItems.test.mjs`

- [x] add `ArchiveClearOption` (label, `maxAgeMs`, four statics, ordered list) to `src/utils/archiveItems.ts`
- [x] add `ArchiveItems.clearable(option, now)`: all pages for `ALL`; `dateAdded <= now - maxAgeMs` for age options; pages without `dateAdded` only for `ALL`
- [x] write tests: cutoff boundary (exactly at the cutoff, just newer, older), pages without `dateAdded`, subfolder pages included, a nested `asd_Archive` folder's pages excluded
- [x] run `make test` - must pass before task 2

### Task 2: ClearArchiveAction

**Files:**
- Create: `src/actions/clearArchiveAction.ts`
- Create: `tests/clearArchiveAction.test.mjs`

- [x] create `ClearArchiveAction` with the injected `ClearArchiveBookmarksApi`, archive folder id, option, clock and batch runner (Technical Details)
- [x] `do()`: re-read with `getSubTree`, refuse a node that is not an archive folder, remove the selected pages, snapshot the removed ones, set the description
- [x] `undo()`: recreate snapshots oldest-original first at index 0 of their parent; skip and log failed creates
- [x] write tests with an in-memory bookmarks fake: a Space folder with regular bookmarks, the archive (with a user subfolder) and another Space's archive → only this archive's pages older than the cutoff are removed; regular bookmarks, the other archive and the user subfolder stay
- [x] write tests: a page moved out of the archive after the menu rendered is not removed; folder id that is not an archive folder (renamed) → nothing removed; a missing folder (fake `getSubTree` rejects, as Chrome does) → `do()` rejects and nothing is removed; a failed remove is skipped and not restored by undo; undo puts pages back into their parents with the original relative order (newest-original at index 0)
- [x] run `make test` - must pass before task 3

### Task 3: Disabled menu items

**Files:**
- Modify: `src/components/menu/MenuBase.tsx`
- Modify: `src/components/menu/ContextMenu.tsx`

- [x] add `disabled` to `MenuBase.Item` (gray, no hover, `cursor-default`, `aria-disabled`, no `onSelect`)
- [x] pass `disabled` through `ContextMenu.Item` (a disabled item then never reaches `close()`)
- [x] run `make lint` and `make test` - must pass before task 4

### Task 4: Archive header menu and Clear All confirmation

**Files:**
- Modify: `src/components/ArchiveSection.tsx`

- [x] declare every new hook (dialog state, `handleClear`) above the `if (isHidden) return null` early return, so hook order stays the same when the section hides after a clear
- [x] add the chrome adapter for `ClearArchiveBookmarksApi` and a `handleClear(option)` that builds `ClearArchiveAction` (archive folder id from `archiveFolder`, `Date.now`, `runBatchOperation`) and runs it through `onPerformAction` (fallback `action.do()`)
- [x] add `ArchiveClearMenu({ items, onClear })` (counts from `items` with `Date.now()` read when it mounts) and pass it as `menuContent` (Clear submenu with four counted items, 0 → disabled) and `showMenuButton`, `menuTitle="Archive options"` to `SectionHeader`, also while collapsed
- [x] add the Clear All confirmation dialog (Cancel / Clear) built on `Dialog`
- [x] run `make lint && make test && make build` - must pass before task 5

### Task 5: Verify acceptance criteria

- [ ] verify: scope is the active Space's archive only; clearing ignores the header search and toolbar filter; one Undo restores all removed items; a cutoff with nothing to remove is disabled and runs nothing
- [ ] verify the invariants in CLAUDE.md: no hard-coded bookmark roots, archive folder resolved through `findArchiveFolder`
- [ ] run `make lint && make test && make build`

### Task 6: [Final] Update documentation

- [ ] `README.md` Archive section: the `...` menu with Clear (All / older than 24 hours / 7 days / 30 days), Clear All confirmation, Undo; keep "Archived items are never deleted automatically"
- [ ] `docs/changelog.md` Latest Version: a "New:" line for the Archive Clear menu
- [ ] `src/data/changelog.ts`: a What's New line under `'1.0.352'`
- [ ] `docs/state-reference.md`: no change (no storage key added) - confirm
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

**Manual verification:**
- load the extension, archive some tabs, open Archive `...` > Clear: counts match, 0-options gray, Clear All asks first, age options run at once, Undo brings the items back in their order
- check another Space's archive and regular bookmarks are untouched
- `[known-limitation]` Undo gives restored items a fresh archive time (Chrome can't set `dateAdded`), so an
  age option right after Undo won't pick them again until they age
- `[known-limitation]` the archive folder renamed between opening the menu and clicking an option gives a
  "Cleared 0 archived pages" toast (deleted: the error toast); nothing is removed either way
