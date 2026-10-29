# CLAUDE.md

Rules for coding agents in this repo. `AGENTS.md` is a symlink to this file.

Read `README.md` for what the extension does and `docs/development.md` for build, tests and architecture.

## Workflow

<Important>
**Plan first, then do.** Until the user approves a plan, only read: open files, search, run `git log`/`git diff`, build and test. Explain what you will change and wait for an explicit yes. Once a plan is approved, carry it out without asking again for each step. Stop and ask when you have to deviate from the plan or find something that changes its scope. This applies in all modes, not only plan mode.
</Important>

- **Few dependencies.** Don't add npm packages unless there is no reasonable way without them. Prefer browser APIs and the libraries already in `package.json`.
- **Test decisions, not coverage.** Write tests for behaviour that loses data or acts on the wrong tab, bookmark or Space when it breaks. Skip tests for trivial helpers, wording, descriptions and UI wiring, even when a planning skill asks for a test per task.
- **Fix realistic review findings.** In review/fix loops, fix what happens in normal use. Millisecond races and coincidences of several rare conditions go into the plan as `[known-limitation]` instead of more code.

## Invariants

Code that breaks one of these breaks user data or acts on the wrong items.

- **One folder, one Space.** A bookmark folder belongs to at most one Space. The UI doesn't enforce it. Code that resolves a bookmark to its Space picks the first matching Space if a folder is shared.
- **Skip the archive folder.** A Space's archive is a folder titled `asd_Archive` inside the Space folder. Code that walks a Space folder's descendants (tree visibility, filters, Expand All, Open All / Open as Tab Group, folder pickers, URL-based association recovery) must skip it with `isArchiveFolder` (`src/utils/archiveFolder.ts`), at any depth. Only the Archive section reads its items.
- **No hard-coded bookmark roots.** Don't assume root ids `'1'`, `'2'`, `'3'` or unique root titles. Profiles with account bookmarks have other roots. Use `findRootFolder` / `getRootFolderType` (`src/utils/bookmarkFolderLookup.ts`) and the Space's `bookmarkFolderInAccount` flag.
- **Tab ids don't survive a browser restart.** Tab and window ids are exact only within one browser session; after a restart Chrome reuses low ids. `chrome.storage.session` survives service-worker restarts but is cleared on browser restart and on extension reload or update.
  - `BrowserSessionMarker` (`src/stores/browserSessionMarker.ts`) tells a worker restart (marker present) from a new session (marker absent).
  - Re-attach stored per-tab records with `matchStoredTabs` / `isSameSite` (`src/utils/storedTabMatcher.ts`) instead of writing another matcher.
  - `stateReady` / `TabAssociationReadiness.wait()` resolve to `false` when the startup restore failed. Background code that closes or changes tabs based on associations must check that result.
- **One writer per storage key.** State shared by background and sidebar goes through a manager in `background.ts` and its proxy (`src/managers/`). See "Shared state" in `docs/development.md`.
- **Settings that background reads are raw strings.** Pass `{ parse, serialize: v => v }` to `useChromeLocalStorage`, whose default is `JSON.stringify` (see `sidebar-follow-active-tab` and `autoArchiveAfter`).

## Code rules

- **Classes over raw structures.** Prefer classes with descriptive methods over Records, Maps and plain objects. If code skips a concept and manipulates primitives directly (`Object.entries(x).filter(...)`, `map.get(key)!.field`), wrap it in a class that names the intent.
- **Allman braces.** Opening `{` goes on its own line for functions, multi-line arrow function bodies, classes, `if`/`else`, loops and `try`/`catch`. One-line arrows and object literals stay inline.
- **Comments say why, not what.** Write a comment only when the code can't explain itself: a reason, a constraint, a Chrome quirk, a non-obvious consequence. Don't restate what the next lines do. Comments are in English.
- **Storage.** New persistent state uses `chrome.storage.local` via `useChromeLocalStorage`. Legacy keys in `localStorage` (`useLocalStorage`) stay where they are; don't migrate them.
- **Chrome API errors in hooks.** For callback-style Chrome calls in a hook that exposes an error state, use `createChromeErrorHandler` (`src/utils/chromeError.ts`):

  ```typescript
  const [error, setError] = useState<string | null>(null);
  const handleError = useMemo(() => createChromeErrorHandler('YourContext', setError), []);
  ```

- **Debug logging only in debug builds:**

  ```typescript
  if (import.meta.env.DEV)
  {
    console.log(...);
  }
  ```

## Testing

`make test` runs `node --test tests/*.test.mjs` with Node's TypeScript type stripping. Modules imported by tests must:

- import sibling modules with `.ts` extensions
- take chrome/storage/clock APIs as constructor or function arguments, and never touch `chrome.*` at import time
- never read `import.meta.env` (it is undefined under Node); callers pass `import.meta.env.DEV` in as a flag
- avoid TS-only runtime syntax (enums, parameter properties, namespaces)

## Documentation

- `README.md` - user-facing: features, install, permissions
- `docs/development.md` - build, tests, project layout, architecture, Chrome API rules, workflow
- `docs/plans/` - implementation plans, the only place for feature design; finished ones move to `docs/plans/completed/`
- `docs/state-reference.md` - every storage key, its owner and lifespan
- `docs/changelog.md` - full changelog; `src/data/changelog.ts` - What's New entries
- `docs/chrome-web-store-info.md` - Chrome Web Store listing text and permission justifications

When behaviour changes, update `README.md`, `docs/changelog.md`, and `docs/state-reference.md` for new storage keys. Add a `src/data/changelog.ts` entry for features worth a What's New line.
