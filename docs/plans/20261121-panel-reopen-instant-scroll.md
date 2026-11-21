# Instant scroll to the active tab when the side panel reopens

## Overview
- With the sidebar list scrolled and the active tab near the bottom, hiding the side panel and showing it
  again makes the list visibly scroll from the top down to the active tab.
- Chrome unloads the side panel page on hide and loads it again on show, so the list renders from the top.
  `useFollowActiveTab` then runs its one-time scroll to the active tab, which goes through
  `scrollToDataElement` in `src/utils/scrollHelpers.ts`: it waits `DEFAULT_DELAY` (100 ms) and calls
  `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`. The delay shows the top of the list, the
  smooth behaviour animates the jump.
- Fix: the one-time open scroll starts at once and jumps without animation. Every other scroll (tab
  activation, "show active tab" button, new bookmarks) stays smooth.

## Context (from discovery)
- `src/utils/scrollHelpers.ts`: `scrollToDataElement(dataAttribute, id, delay, onMissing)`,
  `scrollToBookmark(bookmarkId, delay = DEFAULT_DELAY)`, `scrollToTab(tabId, delay = DEFAULT_DELAY)`;
  retries every 100 ms up to 2 s while the row is missing; `scrollToBookmark` dispatches
  `REVEAL_BOOKMARK_EVENT` on each miss.
- `src/hooks/useFollowActiveTab.ts`: `useScrollToTabItem` routes a tab id to `scrollToBookmark` or
  `scrollToTab`; `useScrollToActiveTab` is used only for the one-time scroll on open (`didInitialScrollRef`
  effect in `useFollowActiveTab`).
- Other callers: `src/components/BookmarkTree.tsx` (`scrollToBookmark(newNode.id)` at three sites) keep
  the defaults.
- Code rules (CLAUDE.md): Allman braces, comments say why, no new dependencies.

## Development Approach
- **testing approach**: Regular. No new automated tests: CLAUDE.md says to skip tests for UI wiring, and
  this change only changes scroll timing and animation. `make test` and `make build` must still pass.
- complete each task fully before moving to the next; small, focused changes.

## Solution Overview
- Add an options object to the scroll helpers: `{ behavior?: ScrollBehavior; delay?: number }`, defaults
  `'smooth'` and `DEFAULT_DELAY`. Existing call sites do not change.
- `useScrollToTabItem` returns `(tabId: number, options?: ScrollRequestOptions) => void` and passes the
  options on. The type is named `ScrollRequestOptions`, not `ScrollOptions`, which is a global DOM type.
- `useScrollToActiveTab` calls it with `{ behavior: 'instant', delay: 0 }`; its existing header comment
  gets the reason (Chrome reloads the panel page on every show, so a smooth scroll from the top shows).

## Technical Details
- Replace the positional `delay` parameter of `scrollToBookmark` / `scrollToTab` with the options object;
  check with grep that no caller passes a positional delay (none do today).
- `scrollToDataElement` uses `options.behavior` in `scrollIntoView` and `options.delay` for the first
  `setTimeout`. `setTimeout(attempt, 0)` is fine for the immediate start; the retry loop stays as it is.
- Export the options type from `scrollHelpers.ts` so the hook can name it.

## What Goes Where
- Implementation Steps: code change in two files, changelog line.
- Post-Completion: manual check in Chrome by the user.

## Implementation Steps

### Task 1: Instant, immediate one-time scroll on panel open

**Files:**
- Modify: `src/utils/scrollHelpers.ts`
- Modify: `src/hooks/useFollowActiveTab.ts`

- [ ] add an exported `ScrollRequestOptions` type (`behavior`, `delay`) to `src/utils/scrollHelpers.ts` and make `scrollToDataElement`, `scrollToBookmark` and `scrollToTab` take it, defaults `'smooth'` and `DEFAULT_DELAY`
- [ ] in `src/hooks/useFollowActiveTab.ts`, let `useScrollToTabItem`'s callback take the options and pass them to `scrollToBookmark` / `scrollToTab`
- [ ] make `useScrollToActiveTab` scroll with `{ behavior: 'instant', delay: 0 }`, extending its existing header comment with the reason
- [ ] code check: grep shows `'instant'` / `delay: 0` passed only from `useScrollToActiveTab`; every other caller of `scrollToBookmark`, `scrollToTab` and `useScrollToTabItem` uses the defaults
- [ ] run `make lint`, `make build` and `make test` - must pass

### Task 2: [Final] Update documentation
- [ ] add `## Latest Version` above `## 2.0.407` in `docs/changelog.md` with one line `- Fixed: ...` (the side panel opens at the active tab without a visible scroll animation)
- [ ] mark this plan's checkboxes done; do not move the plan file

## Post-Completion

**Manual verification:**
- Scroll the list so the active tab is near the bottom, hide and show the side panel: the list should
  appear at the active tab without an animated scroll.
- Known limitation: before the bookmark-tab associations load, the list may show its top for a moment and
  then jump (without animation) to the active tab.
