# Remove AI Rename and keep the AI settings the page agent uses (#82)

## Overview

- Remove AI naming: the **AI Rename** item in the right-click menus of bookmarks, Favorites and pinned
  pages, and automatic naming of new Favorites, pinned pages and bookmarks. It needs an API key only to
  shorten titles, a manual Edit does the same, and nobody uses it.
- The page agent shares the AI settings and part of the code. After the change it must work exactly as
  now, with the API key and settings the user already has; the connection check (**Validate
  configuration**) in Settings must keep working.
- The storage key `sidebar-ai-rename-settings` keeps its name (renaming it would lose the API key).
  `prompt` and `autoRename` are no longer read; old stored values may stay.
- The `scripting` permission, the optional host permissions and `userScripts` stay: the page agent needs
  them.

## Context (from discovery)

- Design: `/Users/pkoptilin/.local/state/make-task/SideBarforArcUsers-remove-ai-rename-keep-page-agent-ai-sett-20261106-1400/design.md`
  (approach, components, decisions; read it before every task).
- AI naming code:
  - `src/services/aiRenameService.ts`: `PageContentReader` (live tab read, URL fetch, Markdown link,
    `llms.txt`), `OpenAiCompatibleClient.generateTitle`, and `validate` (the connection check, kept)
  - `src/App.tsx` ~1195–1382: `beginAiRequest`, `hasPageContentAccess`, `hasApiAccess`,
    `handleAiRenamePin`, `handleAiRenameBookmark`, the `autoRename` branches in `handleAddPin`,
    `handlePinFromSidebar`, `handleAddPins`, `handleBookmarkCreated`; `aiRequestIdsRef` (line ~1037);
    props `onAiRenameBookmark` / `onBookmarkCreated` of the inner component (lines ~102–133, 244–270),
    `onAiRename={handleAiRenamePin}` (~1785), `onAiRenameBookmark` / `onBookmarkCreated` (~1817–1818)
  - `src/components/BookmarkTree.tsx`: row prop `onAiRename` (148, 249), menu item (829–831), tree prop
    `onAiRename` (1147, 2802–2803), `onBookmarkCreated` (1148, 2595, 2635)
  - `src/components/TabList.tsx`: `onBookmarkCreated` (974, 979, 1291, 1297, 2554, 2570, 2580)
  - `src/components/PinnedBar.tsx` (39, 57, 293–294), `src/components/PinnedIcon.tsx` (73, 102, 395–397)
  - `src/hooks/usePinnedSites.ts`: `renamePinIfUnchanged` (419–448, 661)
  - `src/components/SettingsDialog.tsx`: Prompt textarea (714–727), "Read web page content" block with the
    auto-rename checkbox (729–767), `hasPageAccess` / `handleRequestPageAccess` (80, 116–118, 172–189),
    API key help text (~613), `handleValidateAi` (144–170, kept)
  - `src/utils/aiConfig.ts`: `AiRenameSettings` (`prompt`, `autoRename`), `DEFAULT_AI_PROMPT`,
    `LEGACY_DEFAULT_AI_PROMPT`, `DEFAULT_AI_RENAME_SETTINGS`, `parseAiRenameSettings`,
    `sanitizeGeneratedTitle`, `selectPageContent`, `PageContentCandidates`, `SelectedPageContent`,
    `buildLlmsTxtCandidates`, `findMatchingLlmsLink`
  - `src/utils/readablePage.ts`: `'article-first'` root rule, `description`, `language`, `markdownUrl`
    are read only by AI naming
- Page agent imports that must stay:
  - `resolveAiEndpointCandidates`, `aiEndpointLacksProtocol`, `aiHttpStatusMessage`,
    `AiEndpointCandidate` (`pageAgentModelClient.ts`)
  - `AiReasoningEffort`, `ResolvedAiApiProtocol` (`pageAgentApiFormats.ts`)
  - `isSameOriginHttpUrl` (`pageAgentChats.ts`: same-site check before re-applying changes and for the
    navigation notice)
  - `readReadablePage(max, 'main-first')` → `url`, `title`, `text`, `textLength`
    (`chromePageAdapter.ts`)
  - the settings type (`pageAgentRuntime.ts`, `panelPageAgent.ts`, `PageAgentDrawer.tsx`,
    `pageAgentModelClient.ts`)
- Connection check needs: `buildAiRequestBody`, `extractAiResponseText`, `resolveAiEndpointCandidates`,
  `aiEndpointLacksProtocol`, `aiHttpStatusMessage`; `SettingsDialog` also uses `getHostPermissionPattern`.
- The page agent drawer asks for page access itself (`useOriginsGranted`, **Grant page access**) and
  follows `chrome.permissions.onAdded/onRemoved`.
- Tests: `tests/aiConfig.test.mjs` (run by `make test`); `tools/tests/ai-config.test.ts` (not run by
  `make test`, but `eslint .` lints it).

## Development Approach

- **testing approach**: Regular. Per CLAUDE.md ("Test decisions, not coverage") only one new test: an old
  stored settings value with `prompt` / `autoRename` still parses to the user's API settings (losing the
  API key is the data-loss case). Tests of removed code are deleted. No tests for menu items, Settings
  fields or wiring.
- complete each task fully before moving to the next
- make small, focused changes
- follow CLAUDE.md code rules: Allman braces for new or rewritten blocks, comments say why, no new npm
  packages; modules imported by tests use `.ts` sibling imports and no `chrome.*` / `import.meta.env` at
  import time
- **CRITICAL: `make lint`, `make test` and `make build` must pass at the end of every task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy

- **unit tests**: `tests/aiConfig.test.mjs` - delete the `findMatchingLlmsLink` tests, rename the settings
  parser tests, add the old-settings test (Task 3). `tools/tests/ai-config.test.ts` - delete the tests of
  removed functions and fix its imports and fixtures, so it still type-strips and lints.
- **build and lint**: `make build` (tsc + vite) and `make lint` must pass.
- **e2e**: none in this project.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

- Delete the naming paths outright; keep everything the page agent or the connection check imports.
- The connection check moves from `aiRenameService.ts` into a new `src/services/aiConnectionCheck.ts`
  (the old `validate` with its request/fallback helpers); `aiRenameService.ts` is deleted.
- The settings identifiers lose "Rename": `AiRenameSettings` → `AiSettings`,
  `DEFAULT_AI_RENAME_SETTINGS` → `DEFAULT_AI_SETTINGS`, `parseAiRenameSettings` → `parseAiSettings`.
  `AI_SETTINGS_STORAGE_KEY` keeps the value `'sidebar-ai-rename-settings'`.
- `parseAiSettings` keeps spreading the stored JSON over the defaults, so every kept field loads as before;
  old `prompt` / `autoRename` ride along unread and may be written back on the next save (allowed).
- Settings loses the Prompt field and the "Read web page content" block (page-access grant, naming help
  text, auto-rename switch, its warning). It existed because automatic naming couldn't ask for permission
  in the background; the page agent's drawer has its own **Grant page access**.

## Technical Details

- `AiSettings` fields after the change: `baseUrl`, `apiKey`, `model`, `protocol`, `reasoningEffort`,
  `acceptsImages`, `agentPlugins`.
- `parseAiSettings(value)`: `{ ...DEFAULT_AI_SETTINGS, ...parsed, protocol, reasoningEffort,
  acceptsImages, agentPlugins }` with the same normalisation as today, minus the `autoRename` and `prompt`
  lines.
- `src/services/aiConnectionCheck.ts`: one exported class (e.g. `AiConnectionCheck`) with
  `async run(settings: AiSettings): Promise<AiConnectionCheckResult>` (`{ protocol, latencyMs }`), the
  private `AiHttpError`, the fallback loop over `resolveAiEndpointCandidates` and the `fetch` with a 20 s
  timeout, `credentials: 'omit'`, exactly as `validate` / `#requestWithFallback` / `#requestCandidate` do
  today. Required fields: Base URL, API key, model. The reply passes when `extractAiResponseText` finds
  text; the single-line / 100-character title rule is gone. Prompt sent: `'Reply with exactly OK and
  nothing else.'`. Allman braces.
- `readReadablePage(maxChars)`: the main-first root rule only (prefer `main, [role="main"]`, else a sole
  `article`, else `body`); returns `{ url, title, text, textLength }`. Still self-contained (Chrome
  serializes it).
- `SettingsDialog.handleValidateAi`: unchanged flow (request the API origin permission, run the check,
  show "Configuration works with <protocol> (<n> ms)" or the error).

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation updates in this repo
- **Post-Completion** (no checkboxes): manual checks in Chrome

## Implementation Steps

### Task 1: Remove the AI Rename menu items and automatic naming

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/BookmarkTree.tsx`
- Modify: `src/components/TabList.tsx`
- Modify: `src/components/PinnedBar.tsx`
- Modify: `src/components/PinnedIcon.tsx`
- Modify: `src/hooks/usePinnedSites.ts`

- [x] `PinnedIcon.tsx`: remove the `onAiRename` prop and the **AI Rename** menu item; drop `Sparkles` from
      the import if nothing else uses it. `PinnedBar.tsx`: remove the `onAiRename` prop and what it passes
      to `PinnedIcon`
- [x] `BookmarkTree.tsx`: remove the row prop `onAiRename`, the **AI Rename** menu item, the tree prop
      `onAiRename` and its wiring to rows, and the `onBookmarkCreated` prop and its call; drop `Sparkles`
      from the import if unused. `TabList.tsx`: remove the `onBookmarkCreated` prop and its calls (and
      from `useCallback` dependency lists); in the group loop of `handleAddSelectedToBookmarkFolder`
      (~2569) the `const { node } = await createBookmark(...)` is then unused: call `await createBookmark(...)`
      without the destructuring
- [x] the pin chain: `addPin` (`usePinnedSites.ts`) is `(url, title, faviconUrl?, atIndex?)`, while the outer
      `onPin` type passes a tab id as the 4th argument, so `onPin={addPin}` would compile and turn the tab
      id into the Favorite's grid position (Chrome reuses low tab ids after a restart). Drop `tabId?: number`
      from `SidebarContentProps.onPin` (`App.tsx` ~86) and from the outer `TabListProps.onPin`
      (`TabList.tsx` ~962), and call `onPin(clickedUrl, clickedTitle, clickedFaviconUrl)` at `TabList.tsx`
      ~2517; keep `clickedTabId` there for `associateExistingPinnedTab`. Keep the inner TabItem `onPin`
      type (`TabList.tsx` ~103) and its callers (~351, ~399): `handlePinSelectedTabs` needs the tab id.
      With that, a 4-argument call to `onPin` is a compile error
- [x] `App.tsx`: remove `handleAiRenamePin`, `handleAiRenameBookmark`, `beginAiRequest`, `aiRequestIdsRef`,
      `hasPageContentAccess`, `hasApiAccess`, `handleBookmarkCreated`; after the pin-chain change above,
      pass `addPin` / `addPins` directly in place of `handleAddPin`, `handlePinFromSidebar`, `handleAddPins`;
      remove the `onAiRenameBookmark` / `onBookmarkCreated` props of the inner component and every place
      that passes them, and `onAiRename` to `PinnedBar`; remove the `OpenAiCompatibleClient` and
      `getHostPermissionPattern` imports and `renamePinIfUnchanged` from the `usePinnedSites` destructure.
      Keep the `Sparkles` import (What's New menu item)
- [x] `usePinnedSites.ts`: remove `renamePinIfUnchanged` and its export
- [x] no new tests (UI wiring, see Development Approach)
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: Remove the naming fields from Settings

**Files:**
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`

- [x] remove the Prompt textarea and its help text
- [x] remove the "Read web page content" block (access status, naming help text, **Allow** button, the
      automatic-naming checkbox and its warning) with `hasPageAccess`, `setHasPageAccess`, the
      `chrome.permissions.contains` call on open and `handleRequestPageAccess`
- [x] reword the API key help text "It is never sent to the page being renamed" to describe the page agent
      (e.g. "Stored locally by the extension. It is never sent to the pages the page agent reads.")
- [x] `PageAgentDrawer.tsx`: in the `useOriginsGranted` comment, drop "such as in Settings" if Settings no
      longer grants page access (keep the rest)
- [x] no new tests (UI wiring)
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Move the connection check out and remove the naming code

**Files:**
- Create: `src/services/aiConnectionCheck.ts`
- Delete: `src/services/aiRenameService.ts`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/utils/aiConfig.ts`
- Modify: `src/utils/readablePage.ts`
- Modify: `src/services/pageAgent/chromePageAdapter.ts`
- Modify: `tests/aiConfig.test.mjs`
- Modify: `tools/tests/ai-config.test.ts`

- [ ] create `src/services/aiConnectionCheck.ts` with the connection check as described in Technical
      Details (no prompt requirement, no title sanitising); switch `SettingsDialog.handleValidateAi` to it;
      delete `src/services/aiRenameService.ts`
- [ ] `aiConfig.ts`: remove `prompt` and `autoRename` from the settings type, the defaults and the parser;
      remove `DEFAULT_AI_PROMPT`, `LEGACY_DEFAULT_AI_PROMPT`, `sanitizeGeneratedTitle`,
      `selectPageContent`, `PageContentCandidates`, `SelectedPageContent`, `buildLlmsTxtCandidates`,
      `findMatchingLlmsLink`. Keep `isSameOriginHttpUrl` and reword its comment for its remaining use (the
      page agent's same-site check), keeping the `file:` origin note
- [ ] `readablePage.ts`: drop the `rootRule` parameter, the `'article-first'` branch, the exported
      `ReadablePageRoot` type and its JSDoc, `description`, `language`, `markdownUrl`; keep the main-first
      behaviour byte for byte; reword the file header ("shared by AI Rename and the page agent's
      read_page_text") and the "which AI Rename still does afterwards" comment; update
      `chromePageAdapter.ts` to call `readReadablePage` with `[PAGE_TEXT_MAX_CHARS]`
- [ ] `tests/aiConfig.test.mjs`: delete the `findMatchingLlmsLink` tests, its import and the `PAGE_URL` /
      `LLMS_URL` constants only those tests use
- [ ] `tools/tests/ai-config.test.ts`: delete the tests of `sanitizeGeneratedTitle`, `selectPageContent`,
      `buildLlmsTxtCandidates` and their imports; drop `prompt` / `autoRename` from the old-settings
      fixture only if the type requires it (a stored old value may still carry them)
- [ ] write a test in `tests/aiConfig.test.mjs`: an old stored value with `prompt` and `autoRename` (plus
      `baseUrl`, `apiKey`, `model`, `protocol`, `reasoningEffort`, `acceptsImages`, `agentPlugins`) parses
      to the same `baseUrl`, `apiKey`, `model`, `protocol`, `reasoningEffort`, `acceptsImages` and
      `agentPlugins`
- [ ] run `make lint && make test && make build` - must pass before task 4

### Task 4: Rename the settings identifiers and reword AI naming comments

**Files:**
- Modify: `src/utils/aiConfig.ts`
- Modify: `src/utils/readablePage.ts` (only if a naming comment is left after Task 3)
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `src/services/pageAgent/pageAgentRuntime.ts`
- Modify: `src/services/pageAgent/panelPageAgent.ts`
- Modify: `src/services/pageAgent/pageAgentModelClient.ts`
- Modify: `src/services/aiConnectionCheck.ts`
- Modify: `tests/aiConfig.test.mjs`
- Modify: `tools/tests/ai-config.test.ts`

- [ ] rename `AiRenameSettings` → `AiSettings`, `DEFAULT_AI_RENAME_SETTINGS` → `DEFAULT_AI_SETTINGS`,
      `parseAiRenameSettings` → `parseAiSettings` everywhere (source, tests, test names);
      `AI_SETTINGS_STORAGE_KEY` keeps `'sidebar-ai-rename-settings'`
- [ ] reword comments that mention AI Rename / AI naming: the `pageAgentModelClient.ts` header ("the same
      way AI Rename picks it" → the connection check), `aiHttpStatusMessage` ("Shared by AI Rename and the
      page agent"), `extractAiResponseText` ("never becomes the title"), any other hit of
      `grep -rniE "ai rename|ai naming|rename" src/utils/aiConfig.ts src/utils/readablePage.ts src/services/pageAgent src/services/aiConnectionCheck.ts`
      that refers to naming
- [ ] reword the `getHostPermissionPattern` test name in `tests/aiConfig.test.mjs` ("Validate and every
      rename run first" → Validate and the page agent)
- [ ] run `make lint && make test && make build` - must pass before task 5

### Task 5: Verify acceptance criteria

- [ ] no **AI Rename** item in any menu: `grep -rn "AI Rename\|onAiRename" src` prints nothing
- [ ] nothing renames new Favorites, pinned pages or bookmarks:
      `grep -rn "autoRename\|generateTitle\|renamePinIfUnchanged\|onBookmarkCreated" src` prints nothing
- [ ] the page agent's imports resolve and the storage key is unchanged:
      `grep -n "sidebar-ai-rename-settings" src/utils/aiConfig.ts`
- [ ] `grep -rnE "llms\.txt|Llms|PageContentReader|sanitizeGeneratedTitle|selectPageContent|DEFAULT_AI_PROMPT" src tests tools`
      prints nothing (a case-insensitive `llms` would match `pollMs` in `videoPageScripts.ts`)
- [ ] Pin to Sidebar on a single tab calls `onPin` with three arguments (`TabList.tsx` ~2517), and the
      outer `onPin` types have no `tabId`
- [ ] `public/manifest.json` still has `scripting`, the optional host permissions and `userScripts`
- [ ] run `make lint && make test && make build`

### Task 6: [Final] Update documentation

- [ ] `README.md`: drop AI Rename from the bookmark right-click menu list (line ~99); line ~57 "except what
      AI naming and the page agent send" → only the page agent; the Settings AI paragraph (line ~342):
      describe the settings as the page agent's (endpoint, model, protocol, reasoning effort, OpenRouter
      hint, HTTPS rule, Model accepts images, plugins, Page scripts, Validate), no prompt, no automatic
      naming, no Markdown / `llms.txt`; "The agent uses the AI settings of AI naming" (line ~289) and
      "Auto works as for AI naming" → the AI settings in Settings > AI; permissions table rows `scripting`
      and optional `http://*/*`, `https://*/*` (lines ~359, ~363) without AI naming
- [ ] `PRIVACY.md`: drop the "AI Naming" section and the AI naming mentions in the intro and in the
      stored-data list (the settings are the page agent's AI settings, with the API key)
- [ ] `docs/state-reference.md` `sidebar-ai-rename-settings`: description "AI settings of the page agent",
      drop `prompt` / `autoRename` from the shape (note that old values may still be stored and are not
      read), consumers (`SettingsDialog` connection check through `src/services/aiConnectionCheck.ts`, the
      page agent), parsing (`parseAiSettings`, no prompt replacement, no `autoRename`); the overview diagram
      label "(AI naming, page agent)" → page agent
- [ ] `docs/development.md`: the `services/` line lists no AI naming; any other AI naming mention
- [ ] `docs/chrome-web-store-info.md`: `scripting` and optional host permission justifications without
      AI-assisted naming
- [ ] `docs/changelog.md` Latest Version: "Removed: AI Rename and automatic naming of new Favorites, pinned
      pages and bookmarks. The AI settings stay for the page agent; the API key is kept."
- [ ] `src/data/changelog.ts` `'2.0.388'`: one "Removed:" line saying AI Rename and automatic naming are
      gone and the AI settings stay for the page agent
- [ ] `grep -rniE "ai rename|ai naming|ai-assisted naming|autoRename" README.md PRIVACY.md docs/*.md src`
      prints only the new changelog lines, older changelog history and the `docs/state-reference.md` note
      that old `prompt` / `autoRename` values may still be stored and are not read
- [ ] run `make lint && make test && make build` - must pass (`src/data/changelog.ts` is TypeScript)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- `make test-build` builds this checkout into the main checkout's `dist/`; reload the extension in Chrome.
- right-click a bookmark, a Favorite and a pinned page: no AI Rename item
- pin a page, add a Favorite, bookmark a tab with old `autoRename: true` stored: titles stay as created
- Settings > AI shows Base URL, API key, model, protocol, reasoning effort, Model accepts images, plugins,
  Page scripts, Validate, Reset; the saved API key and model are still there; Validate configuration
  reports the protocol and latency
- the page agent answers a question and restyles a page with the existing settings; **Grant page access**
  in the drawer still works on a profile without page access
