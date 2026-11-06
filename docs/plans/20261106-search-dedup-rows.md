# Collapse duplicate rows of the same page in the search popup (#83)

## Overview

- The search popup can list the same page several times: an open tab "Finance - Google Sheets" plus
  archived copies whose URLs differ only in the sheet's `gid` (query and/or hash). They take result slots,
  and picking an archived copy opens a duplicate of a tab that is already open (and takes the copy out of
  the Archive).
- After this change results with the **same title** and the **same scheme, host and path** (query and hash
  ignored) show as one row. The row kept is the open tab, else the bookmark, else the archived copy, else
  the recently closed one; within one kind the most recently used.
- The rule applies in every scope (All and each scope button) and before the 20-result cap.
- Display only: nothing is removed from the Archive, bookmarks or Recently Closed.
- A checkbox in Settings > Behaviour turns it off; on by default. Background reads it each time the popup
  opens, so a change applies on the next open.

## Context (from discovery)

- `src/services/searchResults.ts`:
  - `SearchCandidatesInput` (line 22) is what background hands `SearchCandidates.build`.
  - `SearchItem` (line 76): `TabSearchItem | BookmarkSearchItem | ArchiveSearchItem | ClosedSearchItem`, each
    with `kind`, `title`, `url`, `lastAccess` (epoch ms or undefined).
  - `withoutBookmarksOfListedTabs` (line 242) hides a bookmark whose Arc tab is a listed tab row.
  - `SearchCandidates.search` (line 279): filters by scope, This Space, current-tab bookmark and text, then
    `withoutBookmarksOfListedTabs` in the All scope only, then `sort(newestFirst).slice(0, 20)`. The stable
    sort keeps collection order for equal times.
- `src/background.ts` `buildSearchCandidates` (line 788): `Promise.all` of tabs, bookmark tree and recency,
  then `SearchCandidates.build({...})`. Called on every popup open (`SearchPopup.#open`).
- Raw-string on/off setting pattern: `src/utils/unvisitedTabMarker.ts` (`UNVISITED_TAB_MARKER_KEY`,
  `'on' | 'off'`, `parseUnvisitedTabMarker`); wired in `src/App.tsx:928` (`useChromeLocalStorage` with
  `serialize: v => v`), `src/App.tsx:1138` (`onApply`), `src/App.tsx:1545` (settings object),
  `src/components/SettingsDialog.tsx` (`SettingsValues`, temp state, checkbox at line 422).
- Settings > Behaviour tab: `src/components/SettingsDialog.tsx:438` onwards.
- Tests: `tests/searchResults.test.mjs`; helper `candidates(overrides)` builds the input with defaults.
- Archive writes replace an item only on an exact URL match (`SpaceArchive`, `src/utils/archiveFolder.ts`);
  not touched.
- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-search-popup-collapse-duplicate-rows-83-20261106-1400/design.md`.

## Development Approach

- **testing approach**: Regular (code first, then tests). Tests only for the collapse decisions in
  `SearchCandidates.search` (which row survives, what stays apart, setting off): a mistake there opens a
  duplicate tab or takes the wrong copy out of the Archive. No tests for the parse helper, background
  wiring or the Settings checkbox (CLAUDE.md "Test decisions, not coverage": trivial helpers, UI wiring).
- complete each task fully before moving to the next
- make small, focused changes
- follow CLAUDE.md code rules: Allman braces, classes over raw structures, comments say why, no new npm
  packages
- modules imported by tests: `.ts` extensions on sibling imports, no `chrome.*` or `import.meta.env` at
  import time, no enums / parameter properties / namespaces
- **CRITICAL: `make lint`, `make test` and `make build` must pass at the end of every task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: `tests/searchResults.test.mjs`, Task 1 (see Development Approach).
- **build and lint**: `make build` (tsc + vite) and `make lint`.
- **e2e tests**: the project has none. The user checks the popup by hand (Post-Completion).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- The collapse runs in `SearchCandidates.search`, after the existing filters and before the sort and the
  cap, so duplicates never take one of the 20 slots and the popup page needs no change.
- The setting rides into the snapshot as `collapseSamePage: boolean` on `SearchCandidatesInput`. Background
  reads the raw string in `buildSearchCandidates`, which runs on every open.
- `withoutBookmarksOfListedTabs` stays and runs first, with the setting on or off: an Arc tab may have
  navigated away from its bookmark's URL, which the title + path key would miss. Running it first also
  means a bookmark hidden by its Arc tab doesn't hide an archived copy of the bookmark's page.
- The current tab is not a result and takes no part in grouping (issue's rule covers results only).
- The collapse runs after the This Space filter, so it groups only the results listed. `[known-limitation]`
  in This Space mode an open tab of the page in another window or Space is not listed, so the page's
  archived copy still shows and picking it opens a second tab. The other order would hide the page from
  This Space altogether.

## Technical Details

- Same-page key: `title` (exact string) + `protocol + '//' + host + pathname` of
  `getEffectiveTabUrl(item.url)` (`src/utils/parkedTabAssociation.ts`): a tab parked by a tab suspender has a
  `park.html?url=<original>` URL, and the rest of the project (archive, Recently Closed, auto-archive)
  stores and compares the original URL, so the key must too; without it a parked tab never groups with its
  own archived copies, and different parked pages with one title would merge. Not `URL.origin`:
  it is `"null"` for non-special schemes such as `chrome://` or `chrome-extension://`, which would merge
  unrelated pages. A URL that `new URL` rejects (or an empty one) keys on the whole URL string. Join title
  and path so that no two different pairs give the same key, e.g. `JSON.stringify([title, path])`.
- Best item of a group:
  - kind rank: `tab` 0, `bookmark` 1, `archive` 2, `closed` 3; lower wins;
  - same kind: larger `lastAccess` wins; a defined time beats undefined; a tie keeps the item collected
    first.
- Output: the kept items in their collection order (filter the input by the kept set), so the stable
  newest-first sort still breaks ties by collection order. The kept row keeps its own `lastAccess`.
- A small class in `searchResults.ts` names the intent, e.g.:

  ```typescript
  // Results that open the same page: same title, same scheme, host and path (query and hash ignored)
  class SamePageGroups
  {
    static collapse(items: SearchItem[]): SearchItem[] { ... }
  }
  ```

  Shape is up to the implementer; keep it in `searchResults.ts`.
- Setting: `src/utils/searchCollapseDuplicates.ts`:

  ```typescript
  export type SearchCollapseDuplicatesSetting = 'on' | 'off';
  export const SEARCH_COLLAPSE_DUPLICATES_KEY = 'searchCollapseDuplicates';
  export const DEFAULT_SEARCH_COLLAPSE_DUPLICATES: SearchCollapseDuplicatesSetting = 'on';
  export function parseSearchCollapseDuplicates(value: unknown): SearchCollapseDuplicatesSetting
  // 'off' stays 'off'; anything else (absent, unknown) reads as 'on'
  ```

  Stored in `chrome.storage.local` as a raw string; one writer (Settings dialog via `App.tsx`), background
  only reads.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code, tests, docs in this repo.
- **Post-Completion** (no checkboxes): manual checks in Chrome.

## Implementation Steps

### Task 1: Collapse same-page results in SearchCandidates.search

**Files:**
- Modify: `src/services/searchResults.ts`
- Modify: `src/background.ts`
- Modify: `tests/searchResults.test.mjs`

- [x] add `collapseSamePage: boolean` to `SearchCandidatesInput` and keep it in `SearchCandidates` (pass it
      through `build` into the private constructor); in `src/background.ts` `buildSearchCandidates` pass
      `collapseSamePage: true` for now so `tsc` passes (Task 2 replaces it with the stored setting)
- [x] add the same-page key and the group class (Technical Details): kind rank, newest `lastAccess` within a
      kind, ties by collection order, output in collection order
- [x] in `search()`: keep the existing filters and `withoutBookmarksOfListedTabs` as they are, then collapse
      when `collapseSamePage` is on (every scope), then sort and cap; update the doc comment and the file's
      header comment to say results of the same page show once
- [x] in `tests/searchResults.test.mjs` add `collapseSamePage: true` to the `candidates()` defaults; existing
      tests must pass unchanged
- [x] test: an open tab plus archived copies with the same title and path, differing in query and/or hash,
      give one row in the All scope, the tab; the Archive scope gives one row, the newest archived copy;
      with no open tab, a bookmark beats archived and recently closed copies of the same page, and without
      the bookmark the archived copy beats the recently closed one
- [x] test: same path but different titles (e.g. `watch?v=a` / `watch?v=b` with their own titles) stay
      separate rows; same title and path on another host of a non-special scheme stay separate too (two
      tabs titled "Options" at `chrome-extension://aaa/options.html` and `chrome-extension://bbb/options.html`:
      `URL.origin` is `"null"` for both under Node, so the test fails if the key uses `origin`)
- [x] test: a parked open tab (`chrome-extension://<id>/park.html?tabId=..&url=<original>`, title of the
      original page) and an archived copy of the original URL give one row, the tab
- [x] test: duplicates are collapsed before the 20-result cap: 25 archived copies of one page, every one
      newer (`dateAdded`) than each of a few other pages, so without the collapse they would fill all 20
      slots; with it every other page is listed
- [x] test: with `collapseSamePage: false` every row is listed as before, and a bookmark whose Arc tab is a
      listed tab is still hidden in the All scope
- [x] run `make lint && make test && make build` - must pass before Task 2

### Task 2: Store the setting and read it in background

**Files:**
- Create: `src/utils/searchCollapseDuplicates.ts`
- Modify: `src/background.ts`

- [x] create `src/utils/searchCollapseDuplicates.ts` with the type, key, default and parse function
      (Technical Details), with a header comment saying it is a raw string written by the Settings dialog and
      read by background when the search popup opens
- [x] in `buildSearchCandidates` read `SEARCH_COLLAPSE_DUPLICATES_KEY` with `chrome.storage.local.get` in the
      existing `Promise.all`, parse it, and pass `collapseSamePage: setting === 'on'` to `SearchCandidates.build`
- [x] run `make lint && make test && make build` - must pass before Task 3

### Task 3: Settings checkbox

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] `App.tsx`: `useChromeLocalStorage<SearchCollapseDuplicatesSetting>(SEARCH_COLLAPSE_DUPLICATES_KEY,
      DEFAULT_SEARCH_COLLAPSE_DUPLICATES, { parse: parseSearchCollapseDuplicates, serialize: (v) => v })`, with a
      comment that it is a raw string because background reads it; add it to the settings object passed to
      the dialog and set it in `onApply`, as `markUnvisitedTabs` is
- [ ] `SettingsDialog.tsx`: add `searchCollapseDuplicates` to `SettingsValues`, the temp state, the sync on
      open and `handleApply`
- [ ] Behaviour tab: a checkbox "Search popup: one row per page" with a help line along the lines of
      "Results with the same title and address, ignoring what follows ? or #, show once: the open tab first,
      then the bookmark, the archived page, the recently closed tab"
- [ ] run `make lint && make test && make build` - must pass before Task 4

### Task 4: Verify acceptance criteria

- [ ] verify: one row per page in every scope, preference tab → bookmark → archived → recently closed, newest
      within a kind, collapse before the cap, setting off lists everything as before
- [ ] verify nothing writes to the Archive, bookmarks or Recently Closed in this change, and `SpaceArchive`
      is unchanged
- [ ] verify background reads the setting on each open (no caching across opens)
- [ ] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/state-reference.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`

- [ ] `README.md` § Search popup: a bullet saying results of the same page (same title and address, ignoring
      what follows `?` or `#`) show once among the results listed, which row is kept, that nothing is
      removed, and that Settings turns it off; § Settings: the "Search popup: one row per page" checkbox, on by default
- [ ] `docs/state-reference.md`: a `searchCollapseDuplicates` section next to `markUnvisitedTabs` (raw string
      `'on' | 'off'`, default `'on'`; owner `src/App.tsx` via `useChromeLocalStorage` with `serialize: v => v`,
      set from `SettingsDialog.tsx` Behaviour tab; consumer background `buildSearchCandidates`, read on each
      popup open; parsing `parseSearchCollapseDuplicates`; 1 per extension), and a `searchCollapseDuplicates`
      line in the `chrome.storage.local` box of the State Architecture diagram
- [ ] `docs/changelog.md` "Latest Version": a bullet for #83
- [ ] `src/data/changelog.ts`: the search popup is unreleased (`'2.0.388'`), so extend its existing line with a
      short clause (results of the same page show once) instead of adding a line
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- open a Google Sheets tab, archive a few copies of the same sheet with different `gid`s; the popup shows one
  row, the open tab, in All and Open tabs; Archive shows one row, the newest copy
- two YouTube videos (`watch?v=…`) with different titles still show as two rows
- Settings > Behaviour, untick "Search popup: one row per page", Apply; the next popup open lists every copy
- with an archived copy of the page the current tab shows: the copy is still listed (the current tab takes
  no part in grouping)
