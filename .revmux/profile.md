# Project profile: Side Bar for Arc Users (Arc-style fork)

## What it is
- Chrome MV3 extension: React + TypeScript + Vite + Tailwind sidebar in Chrome's Side Panel (one sidebar instance per window) plus a background service worker (`src/background.ts`).
- Personal fork, maintained independently; Arc's behaviour is the reference. No upstream compatibility to keep.
- User data lives in Chrome bookmarks (Space folders, pinned pages, the `asd_Archive` folder), `chrome.storage.local` / `chrome.storage.session`, and legacy `localStorage` keys.

## What a real failure looks like
- Data loss: a bookmark deleted or overwritten, or a tab closed without the saved copy the feature promises (archive item, Undo).
- Undo that doesn't bring back what the action removed, or removes more than it added.
- Acting on the wrong tab, window or Space: tab/window IDs reused after a browser restart, a tab API call without `windowId`, a wrong bookmark-to-Space or tab-to-Space resolution.
- Background code closing or changing tabs without checking that `stateReady` / `TabAssociationReadiness.wait()` resolved `true`.
- Code walking a Space folder's descendants that doesn't skip `asd_Archive` (`isArchiveFolder`).
- Hard-coded bookmark root IDs (`'1'`, `'2'`, `'3'`): the maintainer's Chrome has account-only bookmark roots.
- A setting the background reads stored JSON-encoded instead of as a raw string.
- The sidebar crashing or a core flow breaking: open/close/switch tabs, switch Space, pin, archive/restore.

## Blast radius
- One user's browser profile, no server. Bookmarks sync through Chrome sync, so bookmark damage reaches every synced device.

## Reporting bar
- Major+: the failures above in realistic use.
- Rare scenarios (sub-second coincidences, simultaneous actions in two windows, races needing unusual timing) are known limitations, not findings, unless they lose data in a common flow such as a double-click.
- Tests: coverage is not a goal. A missing test is a finding only when an important decision (data loss, wrong item acted on) is untested. No findings for untested UI wiring, wording or trivial helpers.
- Not findings: naming, comment density, Tailwind class choices, toast wording, `make lint` failing (the repo has no ESLint config).
- Docs: drift is a finding only when it would mislead someone implementing from the doc.

## Deliberate conventions (not defects)
- Classes with descriptive methods instead of raw Records/Maps/plain objects (CLAUDE.md).
- Modules imported by tests: `.ts` import extensions, chrome APIs injected as arguments, no `import.meta.env`, no enums or parameter properties. Tests are `tests/*.test.mjs`, run with `node --test` (`make test`).
- Debug logging only inside `if (import.meta.env.DEV)`.
- New persistent state goes in `chrome.storage.local` (`useChromeLocalStorage`); existing `localStorage` keys stay where they are.
- Chrome API errors in hooks go through `createChromeErrorHandler`.
- Mixed brace styles and some Chinese comments come from upstream; new code matches its surroundings.
- Feature specs (`docs/features/`) mark decisions taken without the user as **(call)**; plans live in `docs/plans/`.
