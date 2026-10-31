# "Invalid URL." no longer sticks under the Bookmarks tree (#37)

## Overview
- Creating a bookmark with an invalid URL in the New Bookmark dialog shows Chrome's "Invalid URL." twice: in the dialog and under the Bookmarks tree. The copy under the tree stays after the dialog closes, until another bookmark operation succeeds.
- After the fix the error shows only in the dialog; closing or fixing the dialog leaves nothing under the tree.

## Context (from discovery)
- `src/hooks/useBookmarks.ts` `createBookmark`: on `chrome.runtime.lastError` it calls `handleError('create bookmark')` (from `createChromeErrorHandler`, `src/utils/chromeError.ts`), which sets the hook's `error` state, and also resolves `{ node: null, error }`.
- `src/components/BookmarkTree.tsx`: renders the hook's `error` under the tree; `BookmarkEditModal`'s `onCreate` already returns the error from `createBookmark` to the modal, which shows it and clears it when the URL changes.
- Other `createBookmark` callers ignore `error`: `TabList.tsx` add-to-bookmark (single and multi), `BookmarkTree.tsx` drag & drop of tabs/URLs, `useBookmarks.duplicateBookmark`, `useBookmarks.createBookmarksBatch`. `useExternalLinkDrop` does not call `createBookmark`.

## Development Approach
- **testing approach**: Regular
- No new unit tests: the change is UI wiring inside a chrome-bound hook (CLAUDE.md "Test decisions, not coverage").
- `make lint && make test && make build` must pass.

## Solution Overview
`createBookmark` stops touching the hook's error state. On failure it logs with `console.error` (same text as `createChromeErrorHandler` logs today) and resolves `{ node: null, error }`. On success it resolves `{ node, error: null }` without clearing the state. The modal stays the only place a create error is shown; other callers keep the console log.

## Technical Details
- `console.error('Bookmark create bookmark error:', message)` - matches the existing `${context} ${operation} error:` format with the context `Bookmark` that `useBookmarks` passes to `createChromeErrorHandler`.
- [known-limitation] A successful create no longer clears an older error under the tree from another operation (move, URL edit); the next such operation clears it. Intended: `createBookmark` no longer owns that state.
- [known-limitation] A URL Chrome rejects from tree drag & drop or TabList add-to-bookmark is logged to the console only; those URLs come from tabs or bookmarks Chrome already accepted.
- Drop `handleError` from `createBookmark`'s `useCallback` dependency list.
- No change to `BookmarkTree.tsx`'s error line: other operations (edit URL, move, sort) still report there.

## Implementation Steps

### Task 1: createBookmark returns its error without setting hook state

**Files:**
- Modify: `src/hooks/useBookmarks.ts`

- [ ] in `createBookmark`, replace `handleError('create bookmark')` with a `console.error` in the same format and keep resolving `{ node: null, error: lastError.message || 'Unknown error' }`
- [ ] update the comment above the call to say why the hook state is not set (the caller shows the error; the tree line would stick)
- [ ] remove `handleError` from the `useCallback` dependencies
- [ ] run `make lint && make test` - must pass

### Task 2: Verify acceptance criteria
- [ ] confirm by reading the code that no path from `BookmarkEditModal`'s create sets the `error` rendered under the tree
- [ ] confirm the other `createBookmark` callers still compile and don't depend on the hook's `error`
- [ ] run `make lint && make test && make build`

### Task 3: [Final] Update documentation
- [ ] add a "Fixed:" line to `docs/changelog.md` under "Latest Version": an invalid URL in New Bookmark shows its error only in the dialog, no longer under the Bookmarks tree
- [ ] README.md, `docs/state-reference.md`, `src/data/changelog.ts`: no change (no feature, no storage key, too small for What's New)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
**Manual verification**:
- New Bookmark with URL `http://` (or another value Chrome rejects): the dialog shows "Invalid URL."; nothing under the tree; Cancel leaves nothing under the tree; fixing the URL and saving creates the bookmark.
