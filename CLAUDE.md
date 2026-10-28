# CLAUDE.md

Project-specific instructions for coding agent

## Project Overview

Read `READEME.md` for more details about the extension.

## Development Workflow

<Important>
1. **Always discuss first** - Before editing any file or executing any command, explain what you plan to do and get explicit approval. This applies in ALL modes, not just plan mode.
</Important>
2. **Minimize dependencies** - Avoid adding new npm packages unless necessary; prefer native browser APIs and existing libraries


## Design Assumptions

- A bookmark folder belongs to at most one Space. Not enforced in the UI, but code that resolves a bookmark to its Space (e.g. tab/space association logic) assumes this and picks the first matching Space if a folder is somehow shared by more than one.
- A Space's archive is a folder titled `asd_Archive` inside the Space folder (feature 035). Any code that walks a Space folder's descendants (tree visibility, filters, Expand All, Open All / Open as Tab Group, folder pickers, URL-based association recovery) must skip it with `isArchiveFolder` (`src/utils/archiveFolder.ts`), at any depth. Only the Archive section reads its items.

## Testing

`make test` runs `node --test tests/*.test.mjs` with Node's TypeScript type stripping. Modules imported by tests must:
- import sibling modules with `.ts` extensions
- take chrome/storage/clock APIs as constructor or function arguments, and never touch `chrome.*` at import time
- never read `import.meta.env` (it is undefined under Node); callers pass `import.meta.env.DEV` in as a flag
- avoid TS-only runtime syntax (enums, parameter properties, namespaces)

## Code Style

- Prefer classes with descriptive methods over raw data structures (Records, Maps, plain objects). If code skips a high-level concept and directly manipulates low-level primitives (e.g. `Object.entries(x).filter(...)`, `map.get(key)!.field`), wrap it in a class that expresses the intent

## Shared Utilities

### Chrome API Error Handling

Use `createChromeErrorHandler` from `src/utils/chromeError.ts` for handling Chrome API errors in hooks:

```typescript
import { createChromeErrorHandler } from '../utils/chromeError';

const [error, setError] = useState<string | null>(null);
const handleError = useCallback(
  createChromeErrorHandler('YourContext', setError),
  []
);
```

This provides consistent error logging and state management across all Chrome API calls.

### Local Storage

Use `chrome.storage.local` (via `useChromeLocalStorage` hook) for new persistent state. Legacy code uses `localStorage` (`useLocalStorage` hook) — don't migrate existing keys, but all new keys should use `chrome.storage.local` for consistency and cross-window sync.

A setting that `background.ts` also reads must be stored as a raw string: pass `{ parse, serialize: v => v }` to `useChromeLocalStorage`, whose default is `JSON.stringify` (see `sidebar-follow-active-tab` and `autoArchiveAfter`).

### Tab identity across restarts

- Tab and window IDs are exact only within a browser session; after a browser restart Chrome reuses low IDs. `chrome.storage.session` survives service-worker restarts but is cleared on browser restart and on extension reload/update.
- `BrowserSessionMarker` (`src/stores/browserSessionMarker.ts`) tells a worker restart (marker present) from a new session (marker absent).
- Re-attach stored per-tab records with `matchStoredTabs` / `isSameSite` (`src/utils/storedTabMatcher.ts`) instead of writing another matcher.
- `stateReady` / `TabAssociationReadiness.wait()` resolve to `false` when the startup restore failed. Background code that closes or changes tabs based on associations must check that result.

### debug log with console.log

Only enable logging in debug build:
```typescript
  if (import.meta.env.DEV)
  {
      console.log(...);
  }
```

## Documentation

- `docs/chrome-web-store-info.md` - Chrome Web Store listing (summary, description, key features, change logs)
- `docs/features/` - Feature specs
- `docs/plans/` - Implementation plans; finished ones move to `docs/plans/completed/`
- `docs/state-reference.md` - Extension state reference


