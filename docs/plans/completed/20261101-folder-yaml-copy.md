# Copy bookmark folder as YAML, paste YAML into a folder (#44)

## Overview
- Copy a bookmark folder's structure (folders and bookmarks) to the clipboard as YAML; paste YAML to create
  folders and bookmarks inside a folder.
- Useful for sharing a set of links, keeping them in notes, or generating them with an LLM.
- Integrates with the bookmark folder context menu (`BookmarkTree.tsx`), the Space `...` menu
  (`SpaceContextMenuContent.tsx`), the existing undo manager (`onPerformAction` / `UndoableAction`) and the
  sidebar toast.
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-folder-yaml-copy-paste-44-20261101-0010/design.md`.

## Context (from discovery)
- files/components involved: `src/components/BookmarkTree.tsx` (folder menu at the Sort / Open All
  separator, `onPerformAction`, `onShowToast`, `isPermanentRootFolder`), `src/components/SpaceContextMenuContent.tsx`,
  `src/App.tsx` (`SpaceTitle`, `spaceRoot` from `findFolderBySegments`, `handleCreateFolder`),
  `src/actions/createBookmarkFolderAction.ts` (pattern for an undoable bookmark action using `runBatchOperation`),
  `src/components/BookmarkEditModal.tsx` (`normalizeUrl`: adds `https://` when there is no scheme),
  `src/components/Dialog.tsx`, `src/utils/archiveFolder.ts` (`isSystemFolder`, `ARCHIVE_FOLDER_TITLE`),
  `src/utils/favoritesFolder.ts`.
- related patterns: actions implement `UndoableAction { description, do, undo }`; tests are
  `tests/*.test.mjs` importing `.ts` modules with injected Chrome APIs (`tests/fakeArchiveBookmarks.mjs`).
- dependencies: none new (CLAUDE.md: few dependencies).

## Development Approach
- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next; small, focused changes
- tests only for decisions that lose data or act on the wrong bookmark/folder (CLAUDE.md "Test decisions,
  not coverage"): parser/serializer round trip and validation, the paste action's target and undo. No tests
  for menu wiring, dialog text or trivial helpers.
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**
- checks: `make lint && make test && make build`

## Testing Strategy
- **unit tests**: `node --test` via `make test` for `src/utils/bookmarkYaml.ts` and
  `src/actions/pasteBookmarkYamlAction.ts` (both must follow the CLAUDE.md Testing rules: `.ts` sibling
  imports, no `chrome.*` at import time, no `import.meta.env`, no enums/parameter properties).
- **e2e tests**: the project has none.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix; blockers with ⚠️ prefix

## Solution Overview
- A pure module `src/utils/bookmarkYaml.ts` with a serializer and a parser for one YAML subset (no YAML
  library). The parsed tree is a set of small classes with a summary method.
- One undoable action `PasteBookmarkYamlAction` creates the parsed tree at the end of the target folder and
  on undo removes every root it created, so one Undo removes the whole paste.
- One dialog `PasteYamlDialog` parses on every change, shows the summary or the line errors, and runs the
  action on Add.
- Menu items in the folder context menu and the Space `...` menu call a shared copy helper and open the
  dialog.

## Technical Details

### Format
```yaml
- folder: "Tools"
  items:
    - title: "GitHub"
      url: "https://github.com"
    - folder: "Docs"
      items: []
- title: "Inbox"
  url: "https://mail.google.com"
```
- bookmark: `title` (optional on paste; falls back to the normalized URL) and `url`.
- folder: `folder` (required key; an empty name is allowed, since Copy writes unnamed folders as `""`) and `items` (missing or `[]` = empty folder).
- Copy on a folder: a one-item list (the folder itself). Copy on the Space: the Space folder's children.

### Serializer `YamlBookmarkList.fromBookmarkNodes(nodes)` + `list.toYaml()`
- input: bookmark-tree-like nodes (`{ title?, url?, children? }`), as `chrome.bookmarks.getSubTree` returns.
- `fromBookmarkNodes` skips every node for which `isSystemFolder(node)` is true, at any depth, so
  `list.summary()` counts exactly what is copied; `toYaml()` writes the text. Copy and paste share one class.
- `toYaml()` writes titles and URLs as double-quoted scalars, escaping `\`, `"` and control characters (`\n`, `\t`,
  `\r`, others as `\uXXXX`), two-space indentation, `items: []` for an empty folder. Output ends with a
  newline; empty input gives `[]\n`.

### Parser `parseBookmarkYaml(text)`
- returns `{ ok: true, list: YamlBookmarkList }` or `{ ok: false, errors: YamlParseError[] }` with
  `{ line, message }` (1-based lines).
- supported: block sequence items `- key: value` with continuation keys indented to the key column; nested
  `items:` sequences indented deeper than their parent key or at the same indent as `items:` (PyYAML
  style); a plain value runs to the end of the line (minus a trailing ` #` comment), so an unquoted
  `title: Foo: bar` gives the title `Foo: bar`; plain, double-quoted (YAML escapes `\\ \" \n \t
  \r \/ \uXXXX`) and single-quoted (`''` escape) scalars; full-line `#` comments, trailing ` #` comments
  outside quotes; blank lines; `items: []`; CRLF line endings; an optional leading UTF-8 BOM.
- errors (each with line and reason): tab indentation; unknown key; duplicate key; an item with both `url`
  and `folder`, or neither; a bookmark with no or empty `url`; a folder with an empty title; bad indentation;
  an unterminated quote; text after a closing quote; a top level that is not a list; nothing to paste
  (empty input or an empty list).
- validation on the parsed tree: a folder titled `asd_Archive` or `asd_Favorites` (the titles
  `isSystemFolder` matches) is an error; every URL is normalized (scheme added when missing, same rule as
  `BookmarkEditModal.normalizeUrl`, moved to a shared util `src/utils/bookmarkUrl.ts` and reused there) and
  checked with `new URL()`; every invalid URL is reported with its line. Parse errors stop at the first
  structural error; validation errors are all collected.

### Classes
- `YamlBookmark { title, url, line }`, `YamlFolder { title, items, line }`,
  `YamlBookmarkList { items; static fromBookmarkNodes(nodes); toYaml(): string; counts(): { folders, bookmarks }; summary(): string }` — `summary()` gives
  e.g. `3 folders, 12 bookmarks` (singular for 1).

### `PasteBookmarkYamlAction(targetFolderId, list, bookmarksApi, batch = fn => fn())`
- `batch` uses the existing `BatchRunner` type (moved from `clearArchiveAction.ts` to `actions/types.ts`,
  re-exported or imported from there by `clearArchiveAction.ts`).
- `do()`: inside `batch`, creates each root item at the end of `targetFolderId` (no `index`: Chrome
  appends), then its children depth first in order; records the id of every node it creates. On a Chrome
  error part way through, removes the nodes already created (newest first, `remove` only), clears the record, stores the message in a `failure` getter and rethrows. `do()` resets `failure` and the
  record at its start.
- `App.tsx`'s `performAction` catches errors from `do()`, toasts them and resolves normally, so callers
  cannot see a failure from its return value. The paste flow reads `action.failure` after
  `await onPerformAction(action)` to keep the dialog open with the message. `performAction` is not changed.
- `undo()`: removes every recorded node newest first with `remove` (never `removeTree`), ignoring nodes
  already gone (removed by the user) and keeping a pasted folder that now holds bookmarks the paste did
  not create, then clears the record.
- `description`: `Pasted 3 folders, 12 bookmarks`.
- `bookmarksApi` is `{ create, remove }`, injected; the call site passes `chrome.bookmarks`
  and `runBatchOperation` from `useBookmarks`.

### Shared copy and paste flow
- `src/utils/bookmarkYamlCopy.ts`: `copyBookmarksAsYaml(bookmarksApi, clipboard, folderId, { childrenOnly })`
  reads `getSubTree(folderId)`, builds `YamlBookmarkList.fromBookmarkNodes` from the folder (or its children
  when `childrenOnly`), writes `toYaml()` with `clipboard.writeText` and returns the summary. Injected APIs,
  so it imports cleanly under Node (no test needed: wiring).
- `PasteYamlDialog` takes `targetFolderId`, `onPerformAction` and `onPasted`; it builds
  `PasteBookmarkYamlAction` itself (passing `chrome.bookmarks` and `runBatchOperation`), runs it, reads
  `failure`, and calls `onPasted()` on success. Both the folder menu and the Space menu use it.

### Paste never targets a system folder
- The folder menu items are hidden on system folders (`isSystemFolder`) and permanent root folders
  (`isPermanentRootFolder`). The Space items paste into the Space folder itself (appending after its
  children; the system folders stay where they are).

## What Goes Where
- **Implementation Steps**: code, tests, docs in this repo.
- **Post-Completion**: manual checks in Chrome.

## Implementation Steps

### Task 1: YAML serializer and parser

**Files:**
- Create: `src/utils/bookmarkYaml.ts`
- Create: `src/utils/bookmarkUrl.ts`
- Modify: `src/components/BookmarkEditModal.tsx`
- Create: `tests/bookmarkYaml.test.mjs`

- [x] move `normalizeUrl` from `BookmarkEditModal.tsx` into `src/utils/bookmarkUrl.ts` as `normalizeBookmarkUrl` and use it there
- [x] create `src/utils/bookmarkYaml.ts` with `YamlBookmark`, `YamlFolder`, `YamlBookmarkList` (`fromBookmarkNodes` skipping system folders at any depth, `toYaml()` with always-quoted scalars, `counts()`, `summary()`)
- [x] add `parseBookmarkYaml` for the subset in Technical Details, with line-numbered errors
- [x] add validation: system folder titles rejected, URLs normalized and checked with `new URL()`, all invalid URLs reported, missing title falls back to the URL
- [x] write tests: round trip with titles containing `:`, `#`, `"`, `'`, `\`, leading `-`, unicode, newline; nested and empty folders; system folders skipped at any depth on copy
- [x] write tests: invalid input returns errors with the right line and no list (tab indent, unknown key, both url and folder, bookmark without url, unterminated quote, top-level mapping, empty input); system folder titles rejected; every invalid URL reported; scheme-less URL normalized; missing title falls back to URL; hand-written plain and single-quoted input parses; `items:` followed by a same-indent sequence parses; unquoted `title: Foo: bar` gives `Foo: bar`
- [x] run `make test` - must pass before task 2

### Task 2: Undoable paste action

**Files:**
- Create: `src/actions/pasteBookmarkYamlAction.ts`
- Create: `tests/pasteBookmarkYamlAction.test.mjs`

- [x] move `BatchRunner` from `clearArchiveAction.ts` to `src/actions/types.ts` and import it in both actions
- [x] create `PasteBookmarkYamlAction` implementing `UndoableAction` with injected bookmarks API and `batch: BatchRunner = fn => fn()` (no `chrome.*` at import time; don't import `useBookmarks` from this module, the call site passes `runBatchOperation`)
- [x] `do()` appends roots to the target folder, children depth first, and records created roots; rolls back created roots, sets `failure` and rethrows on a Chrome error
- [x] `undo()` removes each created root, tolerating ones already removed
- [x] write tests with a fake bookmarks API: items land only in the target folder, appended after existing children, order and nesting kept; undo removes everything the paste created and nothing else; a create failure on a nested child of the second root leaves nothing created (the first root and the partly created second root are removed), rethrows and sets `failure`
- [x] run `make test` - must pass before task 3

### Task 3: Paste dialog

**Files:**
- Create: `src/components/PasteYamlDialog.tsx`
- Create: `src/utils/bookmarkYamlCopy.ts`

- [x] create `copyBookmarksAsYaml` in `src/utils/bookmarkYamlCopy.ts` as in Technical Details (returns the summary; throws on clipboard/Chrome error)
- [x] create `PasteYamlDialog` on top of `Dialog`: title `Paste from YAML`, monospace textarea, parse on change, show `Will create <summary>` or the errors as `Line <n>: <reason>`, Add disabled while empty or invalid
- [x] on Add build `PasteBookmarkYamlAction` for `targetFolderId`, run it through `onPerformAction` (or `do()` when absent, catching the error), read `action.failure`: keep the dialog open with the message when set, otherwise call `onPasted()` and close
- [x] run `make lint && make build` - must pass before task 4

### Task 4: Folder context menu items

**Files:**
- Modify: `src/components/BookmarkTree.tsx`

- [x] "Copy as YAML" calls `copyBookmarksAsYaml(chrome.bookmarks, navigator.clipboard, folderId, { childrenOnly: false })`, toasts `Copied <summary> as YAML`, toasts the error on failure
- [x] add "Copy as YAML" and "Paste from YAML..." to the folder single-item menu after Sort, before Open All, hidden for `isPermanentRootFolder` and `isSystemFolder` nodes
- [x] "Paste from YAML..." opens `PasteYamlDialog` for that folder with `onPerformAction`; `onPasted` expands the target folder
- [x] run `make lint && make build` - must pass before task 5

### Task 5: Space menu items

**Files:**
- Modify: `src/components/SpaceContextMenuContent.tsx`
- Modify: `src/App.tsx`

- [x] add optional `onCopyAsYaml` and `onPasteFromYaml` props to `SpaceContextMenuContent` ("Copy Space as YAML", "Paste from YAML..."), shown only when provided
- [x] pass `showToast` into `SpaceTitleWrapper` as `onShowToast` (it has `onPerformAction` but no toast today)
- [x] in `App.tsx` pass the two props from `SpaceTitle` only when `spaceRoot` resolves (same condition as `onCreateFolder`; no hard-coded root ids); copy uses `copyBookmarksAsYaml(..., spaceRoot.id, { childrenOnly: true })` (system folders skipped); paste opens `PasteYamlDialog` for `spaceRoot.id` with the same `onPerformAction`; `onPasted` expands the collapsed Bookmarks section the way `handleSaveFolder` does
- [x] `SpaceIcon.tsx` (Space bar icons) gets no YAML items: it passes no resolved folder and no `onCreateFolder` either (deviation from the design, which named it)
- [x] run `make lint && make build` - must pass before task 6

### Task 6: Verify acceptance criteria
- [x] verify all requirements from Overview and issue #44 Rules are implemented (system folders skipped on copy, never created or targeted on paste; validation before writing; append, no merge; one Undo; summary before Add)
- [x] run full checks: `make lint && make test && make build`

### Task 7: [Final] Update documentation
- [x] update `README.md` (bookmarks section and Space menu)
- [x] add an entry to `docs/changelog.md`
- [x] add a What's New entry to `src/data/changelog.ts`
- [x] confirm `docs/state-reference.md` needs no change (no new storage keys)
- [x] move this plan to `docs/plans/completed/` (left to the orchestrator, which moves it at the end)

## Post-Completion

**Manual verification**:
- copy a folder with nested folders and an `asd_Archive` inside, paste the clipboard into another folder, check the structure and that Archive was skipped
- paste text with an invalid URL and with a bad indent: error with the line, nothing created
- paste, then Undo: everything pasted disappears in one step
- Space `...` menu: Copy Space as YAML and Paste from YAML... on a Space with a bookmark folder; hidden on a Space without one
