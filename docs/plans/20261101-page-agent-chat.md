# Page agent chat (experimental POC)

## Overview

A chat in a bottom drawer of the side panel where the user asks an AI agent to change the current page.
The agent runs a tool-call loop: reads the page outline (and a screenshot when the model accepts images),
turns the request into measurable conditions, applies CSS with `chrome.scripting.insertCSS`, inspects the
result with real numbers, fixes it, and reports per condition whether it was met. The user can undo
everything the agent applied, see the CSS, and re-apply it after a reload.

It is a proof of concept for a later agent that acts on pages: the same loop will take more tools
(click, fill). CSS only; no model-written JavaScript.

Design: `docs/plans/20261101-page-agent-design.md` (committed with this plan). Its "Decided with the
user", "Design", "Tests" and "Known limitations" sections are binding; this plan adds the decisions below
and splits the work into tasks. Lives only on the local branch `experimental/page-agent`.

### Deviations from the design

- **USER vs AUTHOR origin**: the design has the builder try both on the fixtures. Task agents can't load
  the extension in Chrome, so the code uses `USER` (by the cascade it beats author `!important` and inline
  styles, so it holds for both fixture variants) and the fixture comparison moves to Post-Completion.
- **`<all_urls>`**: the design has the builder check first whether `captureVisibleTab` works with only the
  http/https origins. That needs a running Chrome, so `<all_urls>` is added to `optional_host_permissions`
  up front and requested only for screenshots; Post-Completion checks whether it can be dropped.
- **Sanitizer**: stricter than the design: `image-set(` / `-webkit-image-set(` and `src(` are rejected
  outright (they can take a URL through `var()`, which a text check can't follow).

## Context (from discovery)

- Side panel root: `src/App.tsx`, `Sidebar()` renders a `flex flex-col h-screen` column: `Toolbar`,
  `PinnedBar`, `SpaceTitleWrapper`, `SwipeableContainer` (flex-1, the tab/bookmark list), `SpaceDialogs`,
  `SpaceBar`. The drawer goes between `SwipeableContainer` and `SpaceBar`.
- Toolbar buttons: `src/components/Toolbar.tsx` (lucide-react icons; `Sparkles` is in lucide-react).
- AI settings: `src/utils/aiConfig.ts` (`AiRenameSettings`, `parseAiRenameSettings`,
  `DEFAULT_AI_RENAME_SETTINGS`, `parseSafeHttpUrl`, `normalizeAiEndpoint`), stored under
  `sidebar-ai-rename-settings` via `useChromeLocalStorage` in `App.tsx` (line ~925), edited in
  `src/components/SettingsDialog.tsx` (AI section, reasoning effort select ~line 590, page access
  request ~line 172).
- Existing OpenAI-compatible client: `src/services/aiRenameService.ts` (`OpenAiCompatibleClient`,
  `AiHttpError`, `#statusMessage`) - text only, no tool calls; the agent gets its own client.
- Page access check / request pattern: `App.tsx` `hasPageContentAccess` (~line 1137) and
  `SettingsDialog.tsx` (`chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })`).
- Manifest: `public/manifest.json` already has `scripting`, `activeTab`, optional
  `http://*/*`, `https://*/*`.
- `docs/development.md`: `tabs.onUpdated` doesn't fire reliably in the side panel (so reload detection
  can't rely on it alone).
- Tests: `tests/*.test.mjs`, `node --test`, import `../src/....ts` directly, fakes as small classes
  (see `tests/tabArchiveBatch.test.mjs`, `tests/fakeArchiveBookmarks.mjs`).
- Storage docs: `docs/state-reference.md` (no entry for `sidebar-ai-rename-settings` yet); privacy:
  `PRIVACY.md`; store listing and permission justifications: `docs/chrome-web-store-info.md`.

## Development Approach

- **testing approach**: Regular (code first, then tests).
- **Tests per the repo rule "test decisions, not coverage"** (`CLAUDE.md`), which overrides any
  "tests in every task" habit: write only the tests listed in the tasks below (wrong tab, unsafe CSS,
  loop termination, lost chats). No tests for UI, wiring, prompts, schemas or trivial helpers.
- Complete each task fully before the next; `make test`, `make lint` and `npx tsc --noEmit` pass at the
  end of every task that touches code.
- Repo code rules (`CLAUDE.md`): Allman braces, classes over raw Records/Maps, comments say why, debug
  logs only under `import.meta.env.DEV`, no new npm packages.
- Modules imported by tests (`pageAgentCss.ts`, `pageAgentTools.ts`, `pageAgentRun.ts`,
  `pageAgentChat.ts`, `pageAgentChatStore.ts`, `pageAgentChats.ts`, `activeTabCapture.ts` and whatever
  they import): `.ts` sibling imports, chrome/storage/clock passed in, never touch `chrome.*` at import
  time, never read `import.meta.env` (pass a `debug` flag), no enums / parameter properties / namespaces.
  Type-only imports must use `import type` (`tsc` here doesn't enforce it, but Node's type stripping
  fails on a value import of an interface).
- Update this plan if implementation deviates.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview

```
App (Sidebar)  ── owns, for the panel's lifetime ──>  PageAgentChats
  │  tabs.onRemoved / onUpdated handlers ───────────>   chats by tab id, live runs by tab id,
  │                                                     closed tabs; saves after every change
Toolbar [Sparkles] ──toggles──> PageAgentDrawer             │            │
                                  usePageAgentChat(chats, activeTabId)    │
                                                          ▼            ▼
                                            PageAgentRun (loop)   PageAgentChatStore
                                            tools, conditions,    chrome.storage.session
                                            step limit, report    `pageAgentChat:<tabId>`
                                             │              │
                         ChatCompletionsAgentClient     ChromePageAdapter
                         (fetch, tools, abort)          executeScript (outline, inspect, marker),
                                                        insertCSS/removeCSS (origin USER),
                                                        ActiveTabCapture + downscale
```

- The loop (`PageAgentRun`) is a plain class. It gets the model client, the page adapter, the tab id
  (fixed at construction; every adapter call passes it), the settings it needs, the condensed history,
  the stylesheet currently inserted, and a listener for progress events. No `chrome.*` inside; Node
  tests drive it with fakes.
- `PageAgentChats` is the one owner of chats and runs in a side panel. It lives as long as the panel
  (created once in `App`), not as long as the drawer, so a run on tab A keeps saving while the drawer
  shows tab B or is closed. The hook and the tab lifecycle handlers read and change chats only through it.
- Whole stylesheet per `apply_css`: the run removes the previous inserted text and inserts the new one.
  Undo = remove the current one; Show CSS = the current one; Re-apply = insert it again.

## Technical Details

### CSS (`src/utils/pageAgentCss.ts`)

- `PageAgentCssSanitizer.check(css): { ok: true } | { ok: false, reason }`.
- It checks the text after resolving CSS escapes (`\` + 1-6 hex digits + optional whitespace → that code
  point; `\` + any other character → that character), so `\75 rl(` or `ur\l(` can't hide a token.
  Comments are **not** stripped: a comment ends a token in CSS, so it can't hide `url(` or `@import`, while
  naive stripping would also remove text inside strings (`content:"/*"` … `"*/"`) and with it a real
  `url(` between them. Keeping comments only adds harmless false positives.
- Rejected (case-insensitive): `@import`; any `url(` whose argument (quoted or not, trimmed) does not
  start with `data:`; `image-set(` and `-webkit-image-set(` outright; `src(`; `expression(`; `behavior:`;
  `-moz-binding`; size over 20 KB. The reason names the construct; it goes back to the model as the tool
  result.
- `PAGE_AGENT_MARKER_PROPERTY = '--sidebar-page-agent'` and `withMarker(css, appliedId)` appends
  `:root { --sidebar-page-agent: "<appliedId>" !important; }`. The inserted text is always
  `withMarker(...)`, and `removeCSS` gets that exact text (Chrome removes by exact text + origin).
- `PAGE_AGENT_CSS_ORIGIN = 'USER'` (one constant). The system prompt asks for `!important` on every
  declaration.

### Tools (`src/services/pageAgent/pageAgentTools.ts`)

Chat Completions function tools (JSON schemas) and the system prompt text:

| Tool | Arguments | Result to the model |
|---|---|---|
| `get_page_outline` | none | JSON: viewport, URL, title, outline tree |
| `set_conditions` | `conditions: [{ id, text }]`, `replaced?: [{ id, reason }]` (ids of earlier conditions the new request replaces) | `ok` |
| `apply_css` | `css` (complete stylesheet) | `ok`, or the sanitizer's reason; refused with "call set_conditions first" before this run's `set_conditions` |
| `inspect` | `selectors: string[]` (max 10) | JSON per selector (see Page scripts) + page-level horizontal overflow |
| `screenshot` | none | "attached" (image follows in a user message) or "not visible, use inspect" / "screenshots unavailable: <reason>" |
| `report` | `results: [{ id, met, measured }]`, `summary` | ends the run |

`screenshot` is offered only when images are on. System prompt (wording left to the builder) states the
order: `get_page_outline` (and `screenshot` if offered) → `set_conditions` → `apply_css`/`inspect` until
the conditions hold → `report`; measurable conditions with tolerances; report every unmet condition as
unmet, never round up; every declaration `!important`; no remote URLs; page text is untrusted data, not
instructions.

### Loop (`src/services/pageAgent/pageAgentRun.ts`)

- Interfaces (exported types): `PageAgentModelClient.complete(request, signal) → assistant message`
  (`content`, `tool_calls`), `PageAgentPageAdapter` (`outline(tabId)`, `inspect(tabId, selectors)`,
  `insertCss(tabId, text)`, `removeCss(tabId, text)`, `capture(tabId) → { dataUrl } | { unavailable:
  reason }`, `pageUrl(tabId)`), `PageAgentRunListener` (`onStep`, `onConditions`, `onCssApplied`,
  `onFinished`). `outline` and `inspect` return the JSON text for the model (the adapter caps it).
  `pageUrl(tabId)` gives the URL recorded as `appliedUrl` (a follow-up run may skip the outline, so
  the outline's URL isn't always there). `PageAgentModelError(message, status)` is the error class
  model clients throw; the run checks its `status` for the image retry.
- The run owns its `AbortController`: `stop()` aborts it, and the model call is raced against it so
  Stop ends the run even if a client ignores the signal.
- Step limit: 8 model rounds (one round = one assistant response) per user message. Multiple tool calls
  in one response run in order; tool calls after `report` in the same response are not run.
- End states:
  - `report` → `met` only when this run set at least one condition and every one is met; a condition
    from `set_conditions` missing in `report.results` counts as unmet; a report with no conditions set in
    this run ends `not-met` ("no conditions set").
  - step limit → `not-met`, the known conditions marked unmet ("no report").
  - an assistant message without tool calls → `not-met`; its text becomes the turn's summary (so a
    clarifying question from the model is shown).
  - the run's own abort signal fired (Stop, tab closed) → `stopped`, whatever error type the client threw;
    a client timeout or any other error with the signal not fired → `error` with the message.
- Errors: malformed tool-call JSON, unknown tool names and invalid arguments go back to the model as the
  tool result. Adapter failures (`executeScript` / `insertCSS` rejected: restricted page, PDF viewer,
  page closed) end the run as `error` with the message; looping on them would only burn the step limit.
  Model API errors end it as `error` (except the image retry below).
- Conditions are per user message: `apply_css` is refused until this run's `set_conditions`. `replaced`
  ids are shown as "replaced: <reason>", not failed.
- `apply_css`: sanitize → `removeCss(previous inserted text)` when there is one (a no-op if the sheet is
  already gone) → `insertCss(withMarker(css, newId))` → `onCssApplied({ css, insertedText, appliedId,
  url })` (one object: the chat needs `appliedId` too). It is called right after `insertCss` resolves,
  before any stop check, so a stylesheet that reached the page is always recorded.
- `replaced` entries carry the earlier condition's text, looked up by id in the history (latest turn
  first); the system prompt asks for condition ids not used earlier in the chat.
- Stopped and error results list this run's conditions as unmet with "no report".
- Message assembly: after an assistant message with `tool_calls`, every `role: "tool"` message for its
  `tool_call_id`s comes first; a screenshot goes in one `role: "user"` message after them
  (`[{ type: 'text', ... }, { type: 'image_url', image_url: { url: dataUrl } }]`). When building a
  request, every screenshot but the latest becomes the text "[screenshot omitted]".
- Image rejection: an HTTP 400 on a request that carries an image → retry that request once with all
  images replaced by "[screenshot omitted]", turn screenshots off for the rest of the run (the tool
  answers "screenshots unavailable: the API rejected images"), and the report notes it.
- Follow-up context: the first user message of a run is the new request plus, when the chat has earlier
  turns, a condensed history (each earlier request, its conditions with met/measured/replaced, its
  summary) and the current stylesheet. Earlier tool calls are not resent.
- Debug logging only through a `debug` flag passed in.

### Page scripts and Chrome adapter (`pageScripts.ts`, `chromePageAdapter.ts`, `activeTabCapture.ts` in `src/services/pageAgent/`)

- Injected functions are self-contained (no imports, no closures over module scope), run with
  `chrome.scripting.executeScript({ target: { tabId }, func, args })`, top frame only.
- Outline: landmarks (`header`, `nav`, `aside`, `main`, `footer`, `[role]`, `iframe`, `video`) or elements
  covering at least ~2% of the viewport and visible; per node tag, id, up to 3 classes, role, rect
  (rounded), first ~40 chars of own text, a suggested selector (`#id`, else a short `tag.class` path);
  depth ≤ 12, nodes ≤ 250, JSON capped at ~12k chars (truncate with a note). Iframes are boxes.
- Inspect: per selector match count (invalid selector → error string for that selector) and for the
  first 3 matches tag/id/classes, rect, computed `display`, `visibility`, `position`, `width`, `max-width`,
  `height`, `font-size`, `color`, `background-color`, `overflow`; page-level
  `scrollWidth > clientWidth`; viewport size.
- Marker check: reads `getComputedStyle(document.documentElement).getPropertyValue('--sidebar-page-agent')`
  and returns the applied id (quotes trimmed) or empty.
- CSS: `chrome.scripting.insertCSS` / `removeCSS` with `{ target: { tabId }, css, origin: 'USER' }`.
- `ActiveTabCapture(tabsApi)` (testable, tabs API passed in): `tabs.get(tabId)` must be `active` → else
  "not visible, use inspect" without capturing; `tabs.captureVisibleTab(windowId, { format: 'jpeg',
  quality: 80 })`; `tabs.get(tabId)` again → still active in the same window, else discard the image and
  return "not visible". A capture error returns "screenshots unavailable: <message>".
- The adapter downscales a captured image to max 1280 px wide with `createImageBitmap` +
  `OffscreenCanvas` (`convertToBlob({ type: 'image/jpeg' })`) → data URL.

### Model client (`src/services/pageAgent/chatCompletionsAgentClient.ts`)

- Endpoint `normalizeAiEndpoint(settings.baseUrl, 'chat-completions')` regardless of the protocol setting.
- Body: `model`, `messages`, `tools`, `tool_choice: 'auto'`, `max_completion_tokens: 16000`,
  `reasoning_effort` unless `off` (same rule as `buildAiRequestBody`).
- `fetch` with `credentials: 'omit'`, the run's `AbortSignal` combined with a 120 s timeout. Errors carry
  the HTTP status (400 is needed for the image retry) and a short message; the API key never appears in
  messages.
- Status wording is shared with AI Rename (`aiHttpStatusMessage` in `aiConfig.ts`). Except for 401/403,
  the provider's `error.message` (JSON only, key redacted, ~300 chars) is appended, so "model does not
  support tools/images" reaches the user (the design's "show the API error"). 405 says the endpoint
  lacks Chat Completions; an empty answer cut off by `finish_reason: 'length'` is an error.

### Chat state (`pageAgentChat.ts`, `pageAgentChatStore.ts`, `pageAgentChats.ts` in `src/services/pageAgent/`)

- `PageAgentChat` (class, JSON-serializable data inside): tab id, turns `[{ request, status: running |
  met | not-met | stopped | error, conditions, replaced, steps (tool name, short args summary, short
  result; CSS text for `apply_css`), summary, error, screenshotsNote }]`, `appliedCss` (sanitized text
  without marker), `appliedInsertedText` (exact text inserted, for `removeCSS`), `appliedId`,
  `appliedUrl`, `notice` (`reloaded` | `navigated` | none).
- `appliedInsertedText` stays until it has been removed: Undo and the next `apply_css` / Re-apply always
  call `removeCss` with it (a no-op if the page lost it). Undo then clears `appliedCss`,
  `appliedInsertedText` and the notice.
- Screenshots are not persisted; steps keep a "screenshot" entry, the image lives in side panel memory
  for the open panel only.
- `PageAgentChatStore(storageArea)`: `load(tabId)`, `save(chat)`, `delete(tabId)`, `sweep(existingTabIds)`
  deletes `pageAgentChat:<id>` keys whose id is not in the set. Key prefix `pageAgentChat:`.
- `PageAgentChats({ store, runFactory, page, createId?, debug? })` - the panel's single owner. `page`
  (`insertCss`, `removeCss`, `pageUrl`, `readMarker`; `ChromePageAdapter` fits) serves Undo, Re-apply
  and the marker check; `runFactory` gets `{ tabId, request, history, currentCss, insertedText,
  listener, settings }` and returns `{ run(), stop() }`. `peek(tabId)` and `isRunning(tabId)` are
  synchronous reads for the hook; `chat.data` keeps its identity until the chat changes.
  - `get(tabId)` loads once and caches; a turn persisted as `running` with no live run in this panel
    becomes `stopped` ("side panel closed during the run").
  - `send(tabId, text, settings)` starts a `PageAgentRun` (one live run per tab; runs on different tabs
    may overlap) through `runFactory` (tests pass fakes), applies every listener event to that tab's
    chat and saves after each event (in particular `onCssApplied` and `onFinished`), whichever tab is
    shown.
  - `stop(tabId)`, `undo(tabId)`, `reapply(tabId)`, `checkMarker(tabId)` (only for chats this panel
    has loaded, so a panel never writes another window's chat; the hook calls `get` first),
    `tabClosed(tabId)` (aborts the run, marks the tab closed so later events of the aborted run don't
    write the key back, deletes the key), `sweep(existingTabIds)`.
  - `subscribe(listener)` so the hook re-renders on changes.
- Reload / navigation detection (`checkMarker`): for a chat with `appliedInsertedText`, read the marker.
  It equals `appliedId` → clear any notice (the page still has the CSS, e.g. restored from the
  back/forward cache). Empty → `notice = reloaded` if the tab URL equals `appliedUrl`, else `navigated`.
  Runs on `tabs.onUpdated` `status: 'complete'` and whenever a chat with applied CSS is shown (drawer
  mount, tab switch), because `tabs.onUpdated` isn't reliable in the side panel and reloads while the
  panel is closed are missed.

### UI

- `Sparkles` toolbar button toggles the drawer; open state kept in memory (not persisted).
- `PageAgentDrawer` at the bottom, above `SpaceBar`; drag handle on its top edge resizes; height in
  `chrome.storage.local` key `pageAgentDrawerHeight` via `useChromeLocalStorage` (default ~45% of the
  panel; clamped to [160 px, panel height − 160 px]).
- Chip with the chat's tab host + path. Messages: user requests; per agent turn the conditions with final
  numbers (met ✓ / unmet ✗ / replaced ↷) or the summary text, "N steps · show steps" expanding to the step
  log (tool calls, CSS, in-memory screenshots). Report block colored by outcome with **Undo** and
  **Show CSS** (copy button).
- Send button becomes **Stop** while this tab's run is running.
- Input disabled with the reason when: the URL isn't `http:`/`https:` or is the Chrome Web Store
  (`chromewebstore.google.com`, `chrome.google.com/webstore`); AI settings are incomplete (link to
  Settings); `http://*/*` / `https://*/*` aren't granted → **Grant page access** requests them. An adapter
  failure on other pages the extension can't script (PDF viewer, other extension pages) shows as the
  run's error.
- With "Model accepts images" on and `<all_urls>` not granted: a non-blocking **Grant screenshot access**
  button (requests `<all_urls>`); runs still work on numbers alone.
- Notice `reloaded`: "Page reloaded, changes removed" with **Re-apply**; `navigated`: "Page changed,
  changes removed" without it. Show CSS still shows the stylesheet. Re-apply removes the old inserted
  text, inserts `withMarker(appliedCss, newId)` and clears the notice; a successful `apply_css` clears it
  too. Undo and Re-apply are disabled while the tab's run is running.

## What Goes Where

- **Implementation Steps** (`[ ]`): code, tests, fixtures, docs in this repo.
- **Post-Completion** (no checkboxes): the user's manual acceptance check in Chrome.

## Implementation Steps

### Task 1: CSS sanitizer and marker

**Files:**
- Create: `src/utils/pageAgentCss.ts`
- Create: `tests/pageAgentCss.test.mjs`

- [x] implement `PageAgentCssSanitizer` with escape resolution, no comment stripping, the rejection list and the 20 KB cap (Technical Details → CSS)
- [x] add `PAGE_AGENT_MARKER_PROPERTY`, `withMarker(css, appliedId)` and `PAGE_AGENT_CSS_ORIGIN = 'USER'`
- [x] test: rejects `@import`, remote `url(` (quoted, unquoted, `http:`, `https:`, protocol-relative `//`), a `url(` hidden by a CSS escape, a remote `url(` between two strings that look like a comment (`content:"/*"` … `content:"*/"`, also with the `/*` written as escapes), `image-set(` / `-webkit-image-set(` (including `image-set(var(--x) 1x)`), `src(`, `expression(`, `behavior:`, `-moz-binding`, a stylesheet over 20 KB
- [x] test: accepts plain declarations with `!important` and `data:` URLs in `url(`
- [x] run `make test`, `make lint`, `npx tsc --noEmit` - must pass before task 2

### Task 2: Agent loop and tool definitions

**Files:**
- Create: `src/services/pageAgent/pageAgentTools.ts`
- Create: `src/services/pageAgent/pageAgentRun.ts`
- Create: `tests/pageAgentRun.test.mjs`

- [x] define tool schemas and the system prompt in `pageAgentTools.ts` (Technical Details → Tools); `screenshot` only when images are on
- [x] implement `PageAgentRun` with the interfaces, tool dispatch, per-run conditions, sanitizer check before insert, previous-text removal, marker, step limit 8, end states, error classification, abort handling by the run's own signal (Technical Details → Loop)
- [x] implement message assembly: tool messages first, screenshot user message after them, older screenshots replaced by "[screenshot omitted]", condensed follow-up context
- [x] implement the HTTP 400 image retry and the screenshots-off note
- [x] test (fake client + fake adapter recording tab ids): a run started on tab A sends every adapter call to tab A, also after the fake's active tab switches to B mid-run
- [x] test: ends on `report` (met / not-met by results; a condition missing from results is unmet; a report with no conditions set is not-met); ends at the step limit as not-met; ends on an answer without tool calls as not-met with its text as summary; `apply_css` before `set_conditions` is refused and nothing is inserted; a sanitizer rejection is returned to the model and nothing is inserted
- [x] run `make test`, `make lint`, `npx tsc --noEmit` - must pass before task 3

### Task 3: Page scripts, screenshot guard and Chrome page adapter

**Files:**
- Create: `src/services/pageAgent/pageScripts.ts`
- Create: `src/services/pageAgent/activeTabCapture.ts`
- Create: `src/services/pageAgent/chromePageAdapter.ts`
- Create: `tests/activeTabCapture.test.mjs`

- [x] write the injected outline, inspect and marker-check functions (self-contained) per Technical Details → Page scripts
- [x] implement `ActiveTabCapture(tabsApi)` with the active-before-and-after guard
- [x] implement `ChromePageAdapter` (implements `PageAgentPageAdapter`): executeScript wrappers, insertCSS/removeCSS with `PAGE_AGENT_CSS_ORIGIN`, `readMarker(tabId)`, `pageUrl(tabId)` (`tabs.get(tabId).url`), capture through `ActiveTabCapture` plus the 1280 px downscale
- [x] test (fake tabs API): tab not active → no capture call, "not visible"; tab stops being active during the capture → image discarded; active before and after → image returned
- [x] run `make test`, `make lint`, `npx tsc --noEmit` - must pass before task 4

### Task 4: Chat Completions agent client

**Files:**
- Create: `src/services/pageAgent/chatCompletionsAgentClient.ts`

- [x] implement the client (implements `PageAgentModelClient`) per Technical Details → Model client: endpoint, body, abort + 120 s timeout, errors as `PageAgentModelError` with HTTP status and safe messages (reuse the wording of `aiRenameService.ts` `#statusMessage` by extracting it to a shared function if that keeps both simple, else copy)
- [x] `npx tsc --noEmit` and `make lint` pass (no tests: HTTP wiring)

### Task 5: Chat model, session store and the panel's chat owner

**Files:**
- Create: `src/services/pageAgent/pageAgentChat.ts`
- Create: `src/services/pageAgent/pageAgentChatStore.ts`
- Create: `src/services/pageAgent/pageAgentChats.ts`
- Create: `tests/pageAgentChats.test.mjs`

- [x] implement `PageAgentChat` (turns, steps, conditions, summary, applied stylesheet with `appliedInsertedText` kept until removed, notice; condensed history for follow-ups; `running` → `stopped` on load)
- [x] implement `PageAgentChatStore(storageArea)` with `load`, `save`, `delete`, `sweep(existingTabIds)`; screenshots never written
- [x] implement `PageAgentChats(store, runFactory)` per Technical Details → Chat state: one live run per tab, events applied and saved for any tab, `stop`, `undo`, `reapply`, `checkMarker`, `tabClosed`, `sweep`, `subscribe`
- [x] test (fake storage area, fake run factory): a run on tab A that finishes while only tab B's chat is read saves A's final status and `appliedCss`; `tabClosed(A)` during a run leaves no `pageAgentChat:A` key after the aborted run's last events; `sweep` deletes only chats whose tab id is not in the set and leaves other keys alone; a saved chat is stored without image data
- [x] test: `checkMarker` - marker equal to `appliedId` clears the notice; empty marker on the same URL sets `reloaded`, on another URL `navigated`; `undo` calls `removeCss` with `appliedInsertedText` even when a notice is set
- [x] run `make test`, `make lint`, `npx tsc --noEmit` - must pass before task 6

### Task 6: "Model accepts images" setting and screenshot permission

**Files:**
- Modify: `src/utils/aiConfig.ts`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `public/manifest.json`

- [x] add `acceptsImages: boolean` to `AiRenameSettings`, default `false` in `DEFAULT_AI_RENAME_SETTINGS`, `parsed.acceptsImages === true` in `parseAiRenameSettings`
- [x] add the "Model accepts images" checkbox to the AI section of Settings (near reasoning effort), with a one-line hint that it enables screenshots for the page agent
- [x] add `<all_urls>` to `optional_host_permissions`
- [x] `npx tsc --noEmit`, `make test`, `make lint` pass

### Task 7: Drawer UI and chat hook

**Files:**
- Create: `src/hooks/usePageAgentChat.ts`
- Create: `src/components/pageAgent/PageAgentDrawer.tsx`
- Create: `src/components/pageAgent/PageAgentMessages.tsx`

- [x] `usePageAgentChat(chats, tabId)`: reads the tab's chat from `PageAgentChats`, re-renders through `subscribe`, exposes `send(text)`, `stop()`, `undo()`, `reapply()`; runs `checkMarker` when a chat with applied CSS is shown (built as `send(text, settings)`: the drawer passes the AI settings at send time)
- [x] drawer: resize handle with `pageAgentDrawerHeight` in `chrome.storage.local`, tab chip, message list, input with Send/Stop, disabled states with reasons, **Grant page access**, **Grant screenshot access** (Technical Details → UI)
- [x] messages: conditions with numbers or the summary text, "N steps · show steps" with the expandable step log (CSS, in-memory screenshots), report block colored by outcome with **Undo** and **Show CSS** (copy), notice with **Re-apply**; Undo and Re-apply disabled while a run is running
- [x] `npx tsc --noEmit` and `make lint` pass (no tests: UI)

### Task 8: Wire the drawer into the side panel and the tab lifecycle

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`
- ➕ Create: `src/services/pageAgent/panelPageAgent.ts` (the panel's `PageAgentChats`; loads the runtime on first use)
- ➕ Create: `src/services/pageAgent/pageAgentRuntime.ts` (run factory with `ChatCompletionsAgentClient` and `ChromePageAdapter`, a lazy chunk)

- [x] create one `PageAgentChats` for the panel in `App` (over `chrome.storage.session`, a run factory with `ChatCompletionsAgentClient` and `ChromePageAdapter`, `import.meta.env.DEV` as the debug flag); it outlives the drawer (built by `createPanelPageAgentChats`; the run loop, client and page scripts load on first use and the drawer is `React.lazy`, so the panel's main chunk grows ~10 kB instead of ~49 kB)
- [x] `Sparkles` button in `Toolbar` toggles the drawer (title "Page agent (experimental)")
- [x] render `PageAgentDrawer` between `SwipeableContainer` and `SpaceBar`, bound to this window's active tab id (follows tab switches); pass the AI settings and a callback that opens Settings
- [x] lifecycle in `App` (runs whether the drawer is open or not): `tabs.onRemoved` → `chats.tabClosed`; `tabs.onUpdated` with `status: 'complete'` → `chats.checkMarker`; once at panel start, `chats.sweep` with the ids from `chrome.tabs.query({})`
- [x] `npx tsc --noEmit`, `make test`, `make lint`, `make build` pass

### Task 9: Fixture pages for manual testing

**Files:**
- Create: `tests/fixtures/page-agent/video-plain.html`
- Create: `tests/fixtures/page-agent/video-js-sizing.html`
- Create: `tests/fixtures/page-agent/README.md`

- [x] plain variant: left icon rail (~56 px), content column with `max-width: 1260px`, a 16:9 iframe (`srcdoc` dark box, works offline) sized by CSS, a row of playback buttons and toggles under it
- [x] JS variant: same layout, a script writes inline `width`/`height` on the iframe on load and on `resize`
- [x] README: serve with `python3 -m http.server` from that directory and open `http://localhost:8000/<file>` (http origin, covered by page access); what to type (the design's demo steps 1-6)
- [x] confirm `make build` does not copy `tests/fixtures/` into `dist/`

### Task 10: Verify acceptance criteria

- [x] every Goal and Anti-goal of the design is implemented (per-tab chat in a drawer, tool-call loop, conditions first and measured, screenshots when on, Undo; no success claim on unmet or missing conditions, no remote loads, no other tab)
- [x] the design's Tests list is covered by `tests/pageAgentCss.test.mjs`, `tests/pageAgentRun.test.mjs`, `tests/activeTabCapture.test.mjs`, `tests/pageAgentChats.test.mjs`
- [x] run `make test`, `make lint`, `npx tsc --noEmit`, `make build` - all pass

### Task 11: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/state-reference.md`
- Modify: `PRIVACY.md`
- Modify: `docs/changelog.md`
- Modify: `docs/chrome-web-store-info.md`

- [ ] `README.md`: section "Page agent (experimental)" - what it does, the drawer, Undo / Show CSS / Re-apply, "Model accepts images", the known limitations from the design and this plan
- [ ] `docs/state-reference.md`: `pageAgentChat:<tabId>` (session; written by the side panel of the tab's window, deleted by any panel on tab close and by the sweep for tabs that no longer exist), `pageAgentDrawerHeight` (local), and an entry for `sidebar-ai-rename-settings` (local, written by Settings, read by AI Rename and the page agent) that lists the new `acceptsImages` field
- [ ] `PRIVACY.md`: the page outline, inspect results and screenshots go to the configured AI endpoint when the user runs the page agent
- [ ] `docs/changelog.md`: an entry marked experimental (no `src/data/changelog.ts` What's New entry)
- [ ] `docs/chrome-web-store-info.md`: justification for the optional `<all_urls>` permission (screenshots for the page agent)
- [ ] move this plan to `docs/plans/completed/` (the orchestrator does it at the end; mark only)

## Known limitations

In addition to the design's list:

- [known-limitation] Stop while an `insertCSS` is in flight can leave that stylesheet on the page without
  the chat recording it; a reload clears it.
- [known-limitation] A page reload during a run: the run's later `inspect` calls see the unstyled page and
  the run may re-apply or report unmet; the chat's notice appears only after the run's next CSS check.
- [known-limitation] Closing the side panel between an `insertCSS` and the save that records it leaves
  CSS on the page that the chat doesn't know about (no Undo for it); a reload clears it.
- [known-limitation] Extension reload or update clears `chrome.storage.session`, so all chats are gone
  while CSS stays on the pages until they reload.

## Post-Completion

*Manual, in the user's logged-in Chrome - no checkboxes.*

**Fixture check** (`make test-build` in this worktree, reload the extension, serve
`tests/fixtures/page-agent/`): run the demo request on both fixture variants with origin `USER`; the
iframe must reach the content width on the JS-sizing variant too. If it doesn't, try `AUTHOR` by
changing `PAGE_AGENT_CSS_ORIGIN`.

**Acceptance on the real page** (`https://personal.rashpile.net/videos/u/569f9c21-...`, OpenAI model,
"Model accepts images" on): the design's demo steps 1-6 - conditions shown, CSS applied and inspected,
report with numbers; "fit it into the screen height" edits the current CSS and reports the earlier
width condition as replaced; Undo restores the page.

**Permissions:** whether screenshots work with only `http://*/*` / `https://*/*` granted (then
`<all_urls>` could be dropped from the manifest).
