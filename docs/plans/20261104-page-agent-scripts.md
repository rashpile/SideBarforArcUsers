# Page agent scripts (JavaScript)

## Overview

The page agent changes a page only with CSS. Some changes need behaviour, such as keys or player buttons
on YouTube that seek to the previous / next subtitle line. This plan lets the agent write JavaScript and
run it on the tab with the same flow as CSS: it applies the script during a run and checks the result;
Undo, Show code with Copy; Re-apply after a reload or a move to another page of the same site; Save to
bookmark, Auto-apply on load, the strip in the drawer and the bookmark's Page style submenu (GitHub
issue #63).

Design: decided in brainstorm (design doc kept by the make-task run). Decisions:

- Scripts run with `chrome.userScripts.execute` in a USER_SCRIPT world of the extension's own, one
  world per page origin (`worldId` `page-agent:<origin>`). The world's CSP keeps fetch / XHR and the
  images, media, scripts and stylesheets the script loads on the page's own origin, and allows `eval`
  (only the agent's code runs there).
- `userScripts` is an optional permission; the user also turns on **Allow User Scripts** on the
  extension's Details page.
- A **Page scripts** plugin in Settings > AI, off by default. **Approval once per request** (the user's
  choice): the first script of a request pauses the run and shows the code with Allow / Deny; Allow
  covers the rest of that request, Deny refuses every script of the request. Saved scripts run without
  asking (Auto-apply, Apply, Re-apply). The switch stops only the agent writing scripts; Chrome's Allow
  User Scripts toggle stops every script, saved ones included.
- Undo works through a cleanup registry: the script registers listeners, timers, observers and added
  nodes through an `agent` helper, and Undo or the next `apply_script` undoes them.
- CSS and script form one applied set with one marker id; the marker stylesheet (marker-only when the
  CSS is empty) tells whether both are on the page.

## Context (from discovery)

Verified in brainstorm with a throwaway extension on youtube.com (Playwright Chromium; the user's Chrome
is 156):

- USER_SCRIPT world: a code string runs, `innerHTML` works (Trusted Types don't apply), globals persist
  between `execute()` calls with the same `worldId`, `keydown` listeners fire, `video.currentTime` can be
  set, a returned promise is awaited. The default world CSP blocks `eval`.
- `execute()` returns `null` for a script that throws or doesn't parse, with no `error`, so the extension
  wraps the code and returns its own `{ ok, … }` result.
- MAIN world: YouTube's Trusted Types block `innerHTML`. `chrome.scripting.executeScript` with `eval` /
  `new Function` is blocked in both worlds.
- `"optional_permissions": ["userScripts"]` works and `chrome.permissions.request({ permissions:
  ['userScripts'] })` grants it without a prompt. `chrome.userScripts` is undefined until **Allow User
  Scripts** is on; the service worker sees it right after the toggle (the side panel wasn't checked).
- `configureWorld({ worldId, csp })` with `connect-src https://www.youtube.com`: `fetch` / XHR to
  youtube.com work, other origins fail; `'self'` means the extension origin, so the page origin must be
  written into the CSP. `default-src 'none'` blocks remote images, scripts and stylesheets started from
  the world, also `src` set on an existing page element. Navigation, `window.open` and iframes are not
  blocked. With `'unsafe-eval'` in the world CSP, `new Function` works and reports the `SyntaxError`.
- `worldId` `page-agent:https://www.youtube.com` is accepted.
- `execute()` needs Chrome 135+, `configureWorld` with `worldId` 133+.
- YouTube pages carry the player response with `captionTracks` in an inline `<script>`, readable from the
  DOM; the timedtext file is on youtube.com, so the example script can fetch it.

Code:

- Run loop: `src/services/pageAgent/pageAgentRun.ts` (`PageAgentRun`, `PageAgentPageAdapter`,
  `PageAgentRunListener`, `PageAgentAppliedCss`, `StylesheetMeasurement`, `ChatHistory`, `#untilStopped`),
  tools and prompt in `pageAgentTools.ts`, plugins metadata in `pageAgentPlugins.ts`, runtime and plugin
  factories in `pageAgentRuntime.ts`.
- Chats: `pageAgentChat.ts` (data, `recordApplied`, `fromStored`), `pageAgentChats.ts` (runs,
  `#runListener`, Undo, Re-apply, `applySaved`, `checkMarker`), `panelPageAgent.ts` (`LazyChatPage`,
  `DeferredRun`).
- Page access: `chromePageAdapter.ts` (already exports `type PageScriptWorld = 'MAIN' | 'ISOLATED'` for
  `scripting`); self-contained injected functions in `pageScripts.ts` and `videoPageScripts.ts` (the
  pattern for the in-page runtime).
- CSS: `src/utils/pageAgentCss.ts` (`PageAgentCssSanitizer`, `withMarker`, marker property).
- Saved styles: `src/stores/savedPageStyles.ts` (`SavedPageStyle`, `SavedPageStyles`),
  `src/managers/impl/pageStyleManager.ts`, `src/managers/shared/pageStyleApi.ts`,
  `src/managers/proxies/pageStyleProxy.ts`, `src/hooks/usePageStyles.ts`,
  `src/actions/pageStyleUndoSnapshot.ts`, `src/services/pageStyleApplier.ts`, wiring in
  `src/background.ts` (~line 645).
- UI: `src/components/pageAgent/PageAgentDrawer.tsx` (StyleStrip, notices), `PageAgentMessages.tsx`
  (`StylesheetActions`, `CssBlock`, `SaveButton`, `saveState`; Undo / Show CSS / Save / Re-apply are
  gated on `chat.appliedCss` at lines ~132, ~139, ~152, ~261), `src/hooks/usePageAgentChat.ts`,
  `src/components/SettingsDialog.tsx` (Page agent plugins), `src/components/PageStyleMenu.tsx` (brush and
  submenu, unchanged).
- Types: `@types/chrome` 0.0.260 has no `chrome.userScripts`; add local typings, no new package.
- Tests: `tests/pageAgentRun.test.mjs`, `pageAgentChats.test.mjs` (builds `new SavedPageStyle(css, true,
  origin, rev)` positionally), `savedPageStyles.test.mjs`, `pageStyleManager.test.mjs`,
  `pageStyleApplier.test.mjs`, `pageAgentPlugins.test.mjs`.

## Development Approach

- **testing approach**: Regular (code first, then tests in the same task)
- complete each task fully before moving to the next; every task leaves `make lint && make test && make
  build` passing (`make build` runs `tsc`)
- make small, focused changes
- tests follow the repo rule "test decisions, not coverage" (`CLAUDE.md`): write tests for behaviour that
  runs a script without approval, acts on the wrong tab or bookmark, or loses the user's saved style when
  it breaks. No tests for wording, labels or UI wiring; such tasks say so instead of listing a test item
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- code style: Allman braces, classes over raw structures, comments say why, debug logs only behind a
  debug flag (`import.meta.env.DEV` in non-tested modules, passed in as a flag to tested ones)
- modules imported by tests: `.ts` sibling imports, chrome APIs passed in, no `import.meta.env`, no
  enums / parameter properties / namespaces

## Testing Strategy

- **unit tests**: `node --test` over `tests/*.test.mjs`: the in-page runtime's cleanup registry and
  timeout, the world CSP, the run's approval, refusal and measurement rules, the chats' Undo / Re-apply /
  Apply with scripts, saved style records with scripts, the applier.
- **e2e tests**: the project has none; manual checks are listed under Post-Completion.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

1. **In-page runtime** (`userScriptRuntime.ts`): one self-contained function the extension serializes
   with `toString()` into the code string. It keeps the registry in a world global, compiles the agent's
   code with `new Function`, runs it with the `agent` helper under a time limit, and returns a JSON-safe
   result.
2. **Runner** (`userScriptRunner.ts`): the page origin's world and CSP, the availability check, and
   `configureWorld` + `execute` for one command. Used by the side panel (through `ChromePageAdapter`) and
   by the background (`PageStyleApplier`).
3. **Run loop**: the applied set carries the script; `apply_script` and `run_check` tools and a prompt
   section, offered and accepted only when the Page scripts plugin is on and Chrome allows user scripts;
   approval once per run; the measurement rule covers both kinds of change.
4. **Chats**: the applied set holds the script; Undo, Re-apply and Apply saved handle it; the pending
   approval lives in the running turn.
5. **Saved styles**: the record gains `script`; the applier runs it after inserting the sheet.
6. **UI**: approval card, controls for CSS or script, Show code, scripts-blocked notice, Save with the
   script, Settings entry.

## Technical Details

### In-page runtime (`src/services/pageAgent/userScriptRuntime.ts`)

```ts
export type UserScriptCommand =
  | { kind: 'apply'; code: string }
  | { kind: 'check'; code: string }
  | { kind: 'undo' };

/** `value` is the JSON text of what the code returned, capped; `errors` are errors thrown since the
 *  last command by listeners and timers the script registered through `agent`. */
export type UserScriptResult =
  | { ok: true; compiled: true; value: string; errors: string[] }
  | { ok: false; compiled: boolean; error: string; errors: string[] };

export interface UserScriptLimits { maxValueChars: number; maxErrors: number; timeoutMs: number; }

export async function runUserScriptCommand(command: UserScriptCommand, limits: UserScriptLimits): Promise<UserScriptResult>
```

- Self-contained (no imports, no module constants or helpers), like `pageScripts.ts`; Node tests call it
  directly.
- State in `globalThis.__sidebarPageAgent` (created on first use): the cleanups of the applied script
  and the pending errors. The global lives in the extension's world, not the page's.
- Compile: `new Function('agent', '"use strict";\nreturn (async () => {\n' + code + '\n})();')`. A
  `SyntaxError` returns `{ ok: false, compiled: false, error }` and changes nothing: the running script
  keeps running.
- Time limit: the code's promise is raced against `limits.timeoutMs` (10 s). On timeout: `{ ok: false,
  compiled: true, error: 'still running after 10 s; what it registered stays, Undo removes it' }`. The run
  and the applier never wait longer for a script. A synchronous endless loop can't be bounded
  (known limitation).
- `apply`: after a successful compile, run the current cleanups in reverse order (each in try/catch),
  empty the registry, then run the code with an `agent` that registers into the registry. A thrown,
  rejected or timed-out run returns `{ ok: false, compiled: true, error }` and keeps what it registered,
  so Undo still cleans it.
- `check`: compile and run with an `agent` that registers into a registry of its own; when the check
  returns (or times out) its own registrations are undone at once: a check only measures, and never
  changes the script's registry.
- `undo`: run the cleanups, empty the registry, return `{ ok: true, compiled: true, value: 'null' }`.
- `agent`: `on(target, type, listener, options)`, `setInterval(fn, ms)`, `setTimeout(fn, ms)`,
  `observe(target, options, callback)` (MutationObserver), `add(node)` (returns the node; Undo removes
  it), `onUndo(fn)`. Callbacks it wraps catch errors into the pending errors (at most `maxErrors`).
  `setInterval` / `setTimeout` return the timer id and `observe` the observer; a fired `setTimeout`
  leaves the registry.
- ➕ An undone registry stays retired: what a timed-out script (or a check after it returned) still
  registers through `agent` is undone at once, so a script that wakes up after Undo or the next `apply`
  can't leave a listener behind. A check that times out says "what it registered was removed".
- Value: `JSON.stringify(value)` in try/catch (`undefined` → `'undefined'`, unserializable → its
  `String()`), cut at `maxValueChars` with a note.
- Error text: `name: message` (no stack). Line numbers in a `SyntaxError` are offset by the wrapper; the
  prompt says so.

### Runner (`src/services/pageAgent/userScriptRunner.ts`)

```ts
export class UserScriptWorld
{
  static forUrl(url: string): UserScriptWorld | null;   // null unless http(s)
  readonly worldId: string;   // `page-agent:${origin}`
  readonly csp: string;
}

export class UserScriptRunner
{
  constructor(api: () => UserScriptsApi | undefined);
  available(): boolean;
  /** Rejects with a plain Error when user scripts are unavailable or the URL has no world. */
  run(tabId: number, url: string, command: UserScriptCommand): Promise<UserScriptResult>;
}
```

- The name avoids `PageScriptWorld` (`chromePageAdapter.ts`) and `pageScripts.ts`, which mean the
  `scripting` injections.
- CSP for origin `O`: `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src O; img-src O
  data: blob:; media-src O data: blob:; font-src O data:; style-src O 'unsafe-inline'`.
- `available()`: the API exists, `typeof api.execute === 'function'` (Chrome 135+), and
  `api.getScripts()` doesn't throw (the docs' check for the Allow User Scripts toggle); the promise it
  returns is caught so a rejection isn't left unhandled.
- `run`: rejects when unavailable or no world; then `configureWorld({ worldId, csp })` every time
  (cheap, and the config may have been reset), then `execute({ target: { tabId }, js: [{ code }],
  worldId, injectImmediately: false })` with `code = (${runUserScriptCommand})(${JSON.stringify(command)},
  ${JSON.stringify(limits)})`. Top frame only. A missing or non-object result becomes `{ ok: false,
  compiled: false, error: 'the script did not run; the page may still be loading or not allow scripts' }`.
- Limits: value 12,000 characters, 5 errors, 10 s.
- ➕ `forUrl` also returns `null` for an http(s) origin that isn't a plain CSP host source: `URL`
  accepts hosts such as `a;b.com`, whose `;` would end the CSP directive. A missing result keeps
  `execute()`'s `error` text, when Chrome gives one, in brackets after the "did not run" error.
- `src/types/chromeUserScripts.d.ts`: the `UserScriptsApi` shape the runner uses (`configureWorld`,
  `execute`, `getScripts`) and an optional `chrome.userScripts` declaration.
- `src/utils/pageAgentScript.ts`: `PAGE_AGENT_SCRIPT_MAX_BYTES = 64 * 1024` and
  `PageAgentScriptCheck.check(code)` (`{ ok: true } | { ok: false; reason }`: too large). Used by the run,
  the manager and the applier.
- `public/manifest.json`: `"optional_permissions": ["userScripts"]`.

### Run loop

- Options: `scripts: boolean`, `currentScript?: string` (next to `currentCss` / `insertedText`).
  `PageAgentRunStart` gains `currentScript`.
- Rename `PageAgentAppliedCss` → `PageAgentApplied` (gains `script`) and `onCssApplied` → `onApplied`.
  The run tracks the current CSS and script; every change mints a new applied id and replaces the marker
  sheet with `withMarker(currentCss, id)` (marker-only when the CSS is empty).
- `PageAgentPageAdapter` gains `runUserScript(tabId, command): Promise<UserScriptResult>` (the adapter
  reads the tab's URL to pick the world).
- Tools (only with `scripts`): `apply_script { code }` ("Replace the page script as a whole: the previous
  one is undone first…") and `run_check { code }` ("Run a short script that returns a value, to check
  behaviour…").
- Refusal: with `scripts` false, `#runTool` refuses `apply_script` and `run_check` like `screenshot`
  ("refused: scripts are off; change the page with CSS"); nothing reaches the adapter or the approval
  listener.
- Prompt: the core text says "CSS and, when the tools are offered, JavaScript"; a scripts section after
  the core text explains the world (the page's DOM, not its JS objects; network only to the page's own
  site), the `agent` helpers and that everything a script adds must go through them, idempotence, the
  10 s limit, behavioural conditions ("pressing ] sets video.currentTime to the next cue start ±0.3 s"),
  checks that dispatch events and read values, prefer CSS for looks, and that the user approves the first
  script of a request and may decline.
- `apply_script`: refused before `set_conditions`; size check; approval; `pageUrl`; `runUserScript`
  (`apply`). Not compiled → tool result with the error, the applied set unchanged. Compiled → new applied
  id, marker sheet replaced, `onApplied({ css, script, insertedText, appliedId, url })`, result
  `{ ok, value | error, errors }` as JSON text.
- `apply_css`: unchanged, but the applied set keeps the current script (`onApplied` carries it).
- `run_check`: approval; `runUserScript` (`check`); a compiled check counts as a measurement.
- Approval: `listener.onScriptApproval({ kind: 'apply' | 'check', code }): Promise<boolean>`, awaited
  raced against Stop (`#untilStopped`), once per run; the answer is kept for the run. Denied → tool
  result "refused: the user declined to run scripts for this request; continue without scripts".
- `StylesheetMeasurement` → `ChangeMeasurement`: `changed()` on `apply_css` / `apply_script`,
  `measured(round)` on `inspect` / compiled `run_check`. Report refusal texts name both.
- `PageAgentStep` gains `script?: string`: the code of `apply_script` / `run_check`, cut at 8,000
  characters with a note (the full applied script is in the chat).
- `ChatHistory.firstUserMessage`: with `scripts`, "Current script (applied by the last apply_script; a
  new apply_script replaces it as a whole)" or "No script is applied now."; without `scripts`, a chat
  that holds a script says "A script is applied on the page; scripts are off for this request, so leave
  it as it is", without the code.

### Chats

- `PageAgentChatData.appliedScript: string`; `fromStored` reads it (missing → `''`).
- `PageAgentTurn.pendingScript?: { kind, code }` while the run waits; `fromStored` drops it.
- `PageAgentChatPage` picks `runUserScript` from the adapter; `LazyChatPage` implements it.
- `PageAgentChats.approveScripts(tabId, allow)`: resolves the waiting approval of the tab's run and
  clears `pendingScript`. A run that ends with an approval still pending resolves it `false`.
- `undo`: remove the sheet; when the chat has a script, `runUserScript(tabId, { kind: 'undo' })`. The
  chat clears either way. When the tab's URL has no world (it moved to a non-http page) there is nothing
  to stop. Any other failure rejects with "the script couldn't be stopped (…); reload the page to remove
  it" after the clear.
- `reapply`: available with CSS or a script; inserts `withMarker(css, newId)` and runs `apply` with the
  script.
- `applySaved`: unless the marker shows the saved id, remove the chat's sheet, undo the chat's script,
  insert the saved sheet and `apply` the saved script. Records it with the script.
- `reapply` / `applySaved` with a script result `ok: false` (runtime error, timeout, blocked): the set is
  recorded (the sheet is on the page, the script's registrations are in the world) and the action rejects
  with the script's error.
- `savedAsApplied` carries `style.script`. `checkMarker` is unchanged.

### Saved styles

- `SavedPageStyle` gains `script` as the **last** constructor parameter with default `''` (existing
  positional calls keep working); stored entries without it load as `''`. `withSaved(bookmarkId, css,
  script, origin, rev)`. `equals` compares it. `toStored` writes it.
- `PageStyleManager.save(bookmarkId, css, script, pageUrl)`: refuses when both are empty; CSS check as
  now; `PageAgentScriptCheck`. `dispatch` treats a non-string `message.script` as `''`. `restore` checks
  the script too. API, proxy and hook carry `script`.
- `PageStyleApplier` deps gain `scriptsAvailable(): boolean` and `runScript(tabId, url, code):
  Promise<void>`; `#insert` inserts the sheet, then runs the script when the style has one and scripts
  are available (a failure is logged, the sheet stays). `#styleForTab` also skips a style whose script
  fails `PageAgentScriptCheck`. `background.ts` builds one `UserScriptRunner(() => chrome.userScripts)`.
  The runtime's 10 s limit keeps a stalled script from holding the tab's queue.

### UI

- Approval card in the running turn (`pendingScript`): "The agent wants to run JavaScript on this
  page", the code (scrollable), **Allow** and **Deny**; Stop still works.
- Undo, Show code, Save and Re-apply show when CSS **or** a script is applied (the adopted-saved-style
  row with no turns, the last turn's actions, Re-apply after a reload); `StylesheetActions` and
  `TurnView` take both instead of one stylesheet string.
- "Show CSS" → "Show code": a CSS block and a Script block, each with Copy; only the parts that exist.
- Steps: a step with `script` shows its code like a step with `css`.
- Save: `pageStyles.save(bookmarkId, appliedCss, appliedScript, appliedUrl)`; `saveState` and the strip's
  Apply compare CSS and script.
- Notice under the input when the Page scripts plugin is on and Chrome blocks user scripts: "Page scripts
  are on, but Chrome doesn't allow them yet" with **Allow scripts** (permission missing,
  `chrome.permissions.request`) or **Open extension details** (`chrome.tabs.create({ windowId, url:
  'chrome://extensions/?id=' + chrome.runtime.id })` with the panel's window). Availability is read on
  render and on window focus.
- Settings > AI > Page agent plugins: `page-scripts` entry ("Page scripts", off by default, description
  with the risk in one line); ticking it requests the `userScripts` permission and stays off when it is
  refused; a status line says whether Chrome allows user scripts, with the same button.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code, tests and docs in this repo.
- **Post-Completion** (no checkboxes): manual checks in Chrome.

## Implementation Steps

### Task 1: In-page script runtime with the cleanup registry

**Files:**
- Create: `src/services/pageAgent/userScriptRuntime.ts`
- Create: `tests/userScriptRuntime.test.mjs`

- [x] add `UserScriptCommand`, `UserScriptResult`, `UserScriptLimits` and the self-contained
  `runUserScriptCommand` as in Technical Details (registry in `globalThis.__sidebarPageAgent`, compile
  before touching the running script, `agent` helpers, pending errors, capped JSON value, time limit,
  check registrations undone when the check returns)
- [x] header comment: the self-contained rule and why the code is compiled with `new Function` (the
  world's CSP allows it; `execute()` reports no errors)
- [x] write tests: `apply` runs the previous script's cleanups before the new code; a `SyntaxError`
  keeps the running script and its listeners; `undo` removes listeners (Node `EventTarget`), clears
  timers, disconnects observers (stub `MutationObserver`) and removes added nodes (fake node with
  `remove()`); a script that never settles returns the timeout error and keeps its registrations; a
  check's listener is gone after the check returns and the script's registry is untouched; errors thrown
  in a registered listener come back with the next command
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 2: Script runner, world CSP and permission

**Files:**
- Create: `src/services/pageAgent/userScriptRunner.ts`
- Create: `src/types/chromeUserScripts.d.ts`
- Create: `src/utils/pageAgentScript.ts`
- Modify: `public/manifest.json`
- Create: `tests/userScriptRunner.test.mjs`

- [x] add `UserScriptWorld.forUrl` and `UserScriptRunner` (`available`, `run`) with the API passed in,
  as in Technical Details
- [x] add the local `chrome.userScripts` typings and `PageAgentScriptCheck` with
  `PAGE_AGENT_SCRIPT_MAX_BYTES`
- [x] add `"optional_permissions": ["userScripts"]` to the manifest
- [x] write tests: the CSP names exactly the page origin in every fetch directive and nothing else
  remote; `chrome://`, `file:` and malformed URLs get no world and `run` rejects; `configureWorld` runs
  before `execute` with the same `worldId`; a `null` result becomes the "did not run" error;
  `available()` is false when the API is missing, has no `execute`, or `getScripts` throws
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 3: Saved page styles keep a script

**Files:**
- Modify: `src/stores/savedPageStyles.ts`
- Modify: `src/managers/impl/pageStyleManager.ts`
- Modify: `src/managers/shared/pageStyleApi.ts`
- Modify: `src/managers/proxies/pageStyleProxy.ts`
- Modify: `src/hooks/usePageStyles.ts`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx` (pass `''` for the script until Task 9)
- Modify: `tests/savedPageStyles.test.mjs`
- Modify: `tests/pageStyleManager.test.mjs`

- [x] `SavedPageStyle.script` (last constructor parameter, default `''`), `withSaved(bookmarkId, css,
  script, origin, rev)`, stored entries without `script` load as `''`, `equals` / `toStored` include it
- [x] `PageStyleManager.save(bookmarkId, css, script, pageUrl)` refuses when both are empty, checks the
  script with `PageAgentScriptCheck`; `dispatch` reads a non-string script as `''`; `restore` checks it
  too; API, proxy and hook carry `script`
- [x] write tests: an old entry without `script` loads with its CSS; a script-only save is accepted; empty
  CSS and script are refused; an oversized script is refused; restore keeps the script and its rev
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 4: Applied set carries the script; adapter runs user scripts

**Files:**
- Modify: `src/services/pageAgent/pageAgentRun.ts`
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/services/pageAgent/pageAgentChat.ts`
- Modify: `src/services/pageAgent/chromePageAdapter.ts`
- Modify: `src/services/pageAgent/pageAgentRuntime.ts`
- Modify: `src/services/pageAgent/panelPageAgent.ts`
- Modify: `tests/pageAgentRun.test.mjs`
- Modify: `tests/pageAgentChats.test.mjs`

- [ ] rename `PageAgentAppliedCss` → `PageAgentApplied` (with `script`) and `onCssApplied` → `onApplied`
  across the page agent and its tests
- [ ] the run tracks current CSS and script (`currentScript` option; `PageAgentRunStart.currentScript`,
  which `PageAgentChats.send` passes as `''` until Task 6); `apply_css` reports the kept script
- [ ] `PageAgentPageAdapter.runUserScript`; `ChromePageAdapter` implements it with a
  `UserScriptRunner(() => chrome.userScripts)` and the tab's URL; `PageAgentRuntime.createRun` passes
  `currentScript`
- [ ] write tests: `apply_css` after a run started with a current script reports that script in
  `onApplied`; the marker sheet text is `withMarker(css, id)` as before for CSS-only runs
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 5: Script tools, refusal when off, approval and the measurement rule

**Files:**
- Modify: `src/services/pageAgent/pageAgentRun.ts`
- Modify: `src/services/pageAgent/pageAgentTools.ts`
- Modify: `src/services/pageAgent/pageAgentChats.ts` (`#runListener.onScriptApproval` resolves `false`
  until Task 6)
- Modify: `src/services/pageAgent/pageAgentRuntime.ts` (`scripts: false` until Task 7)
- Modify: `tests/pageAgentRun.test.mjs`

- [ ] `scripts` option; `apply_script` and `run_check` tools and the prompt section, offered only with
  `scripts`; the refusal of both with `scripts` false; the current-script wording of the first message
- [ ] `apply_script` (conditions first, size check, compile result, new applied id and marker sheet) and
  `run_check`; `step.script` capped
- [ ] approval once per run through `listener.onScriptApproval`, raced against Stop; `ChangeMeasurement`
- [ ] write tests: with `scripts` false a model call to `apply_script` or `run_check` is refused and
  nothing reaches the adapter or the approval listener; `apply_script` refused before `set_conditions`;
  approval asked once for several scripts; Deny refuses later scripts without asking again and nothing
  reaches the adapter; Stop while approval waits ends `stopped`; report refused until a `run_check` in an
  earlier response after the last `apply_script`; a script that doesn't compile keeps the applied set and
  id
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 6: Chats: applied script, approval, Undo, Re-apply and Apply saved

**Files:**
- Modify: `src/services/pageAgent/pageAgentChat.ts`
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/services/pageAgent/panelPageAgent.ts`
- Modify: `tests/pageAgentChats.test.mjs`

- [ ] `appliedScript`, `pendingScript`, `currentScript` passed to the run, `approveScripts`, the real
  `onScriptApproval`, pending approval resolved `false` when the run ends
- [ ] `PageAgentChatPage.runUserScript` and `LazyChatPage.runUserScript`
- [ ] Undo, Re-apply and `applySaved` with the script as in Technical Details; `savedAsApplied` carries
  the script
- [ ] write tests: Undo removes the sheet and undoes the script on the chat's tab, clears the chat even
  when the script undo fails (rejecting with the reload hint), and doesn't reject when the tab has no
  world; Re-apply inserts the marker sheet and applies the script with a new id; Apply saved undoes the
  chat's script before applying the saved one, and does nothing to the page when the marker already shows
  the saved id; `approveScripts` on tab A doesn't resolve tab B's approval; a stored chat with
  `pendingScript` loads without it
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 7: Page scripts plugin switch

**Files:**
- Modify: `src/services/pageAgent/pageAgentPlugins.ts`
- Modify: `src/services/pageAgent/pageAgentRuntime.ts`
- Modify: `src/services/pageAgent/chromePageAdapter.ts`
- Modify: `tests/pageAgentPlugins.test.mjs`

- [ ] `page-scripts` plugin metadata (off by default, no tool factory)
- [ ] `ChromePageAdapter.userScriptsAvailable()`; `createRun` sets `scripts` from the switch and
  availability
- [ ] write tests: `page-scripts` is off unless the user switched it on (the security default)
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 8: Background applier runs saved scripts

**Files:**
- Modify: `src/services/pageStyleApplier.ts`
- Modify: `src/background.ts`
- Modify: `tests/pageStyleApplier.test.mjs`

- [ ] deps `scriptsAvailable` and `runScript`; `#insert` runs the script after the sheet; a style whose
  script fails the check gets nothing
- [ ] `background.ts`: one `UserScriptRunner`, `runScript` maps a non-ok result to a logged error
- [ ] write tests: a style with a script runs it in the bookmark's tab after the sheet; with scripts
  unavailable only the sheet goes in; a page that already has the marker gets neither again; a
  hand-opened tab of the same site gets nothing
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 9: Drawer and Settings UI

**Files:**
- Modify: `src/hooks/usePageAgentChat.ts`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `src/components/pageAgent/PageAgentMessages.tsx`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] approval card with Allow / Deny wired to `approveScripts`
- [ ] Undo, Show code, Save and Re-apply gated on CSS or script; Show code with CSS and Script blocks and
  Copy; script steps show their code
- [ ] Save passes `appliedScript`; `saveState` and the strip's Apply compare CSS and script
- [ ] scripts-blocked notice with Allow scripts / Open extension details (in the panel's window);
  Settings entry requests the permission and shows the status
- [ ] no tests: UI wiring (CLAUDE.md)
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 10: Verify acceptance criteria

- [ ] verify every point of the Overview against the code: approval once per request, Deny, refusal
  with the switch off, Undo, Show code, Re-apply, Save, Auto-apply, strip, submenu, a script-only change
- [ ] verify the CSS-only flow is unchanged with the plugin off (prompt, tools, Undo, Save)
- [ ] run `make lint && make test && make build`

### Task 11: [Final] Update documentation

- [ ] README § Page agent: scripts (turning them on, Allow User Scripts, approval, the `agent` helpers'
  Undo, Show code, Save and Auto-apply with scripts; the switch stops only the agent writing scripts,
  Allow User Scripts stops saved ones too), drop "It never writes JavaScript", known limitations below;
  Permissions table (optional `userScripts`); Settings line (Page scripts plugin). Network wording: fetch
  / XHR and the images, media, scripts and stylesheets a script loads reach only the page's own site;
  navigation, new windows and frames are not restricted
- [ ] PRIVACY.md: scripts run in the page, what they can reach (same wording), saved scripts in
  `bookmarkPageStyles`
- [ ] `docs/chrome-web-store-info.md`: `userScripts` justification, saying the user turns the feature on,
  sees the code and approves it before it runs
- [ ] `docs/state-reference.md`: `bookmarkPageStyles` `script`; `pageAgentChat:${tabId}`
  `appliedScript` and `pendingScript`; the `page-scripts` plugin switch in the AI settings
- [ ] `docs/changelog.md` and a `src/data/changelog.ts` What's New entry
- [ ] move this plan to `docs/plans/completed/`

## Known limitations

- [known-limitation] A script can still navigate the page, open a window or load a frame, so a
  prompt-injected page could leak data that way; fetch / XHR and the images, media, scripts and
  stylesheets it loads reach only the page's own site.
- [known-limitation] Effects a script didn't register through `agent` (a changed attribute, a seeked
  video) stay after Undo until a reload.
- [known-limitation] A synchronous endless loop in a script freezes the page; the 10 s limit covers only
  scripts that wait.
- [known-limitation] Scripts run in the top frame and in the extension's own world: they see the DOM but
  not the page's JavaScript objects, and not iframes.
- [known-limitation] Turning off Allow User Scripts while a script runs leaves it on the page until a
  reload; Undo then clears the chat and asks for a reload.
- [known-limitation] Allow User Scripts is a Chrome setting the extension can't turn on; before Chrome 138
  it is Developer mode, and before Chrome 135 scripts are unavailable.
- [known-limitation] `read_video_transcript` has no YouTube source; the YouTube example script reads the
  subtitle list from the page and fetches the subtitles from youtube.com itself.

## Post-Completion

**Manual verification**:

- turn on Page scripts in Settings > AI, see the notice, turn on Allow User Scripts; check the open side
  panel sees it without reopening (else the notice says to reopen it)
- ask on a YouTube video for keys that seek to the previous / next subtitle line; approve once; check
  the keys
- Deny on a second request: the agent goes on without scripts
- Undo, Show code + Copy, reload → Re-apply, next video, Save to bookmark, reload in the bookmark's tab
  (Auto-apply), browser restart, strip Apply / Remove, bookmark submenu
- a question ("summarize this page") with the plugin on asks for no script
- loads a script starts through CSS (`el.style.backgroundImage = 'url(https://…)'`, a `<style>` with
  `@import`): check whether the world CSP blocks them and adjust the README / PRIVACY wording to the result
