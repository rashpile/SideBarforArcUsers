# Page agent code editor: paste and edit CSS and JavaScript

## Overview

The user can put CSS and JavaScript on the page through the page agent drawer: code an AI wrote (in this
chat or elsewhere) or code the user wrote. Show code → Copy already takes code out; this adds the way back
in: a code editor with Apply (GitHub issue #72). The applied code becomes the chat's applied set, so Undo,
Show code, Re-apply, Save to bookmark and Auto-apply work on it as on the agent's code.

Design: decided in brainstorm (design doc kept by the make-task run). Decisions:

- **Entry points (user's choice):** a **Code** button beside Send, always there (also after Undo or in a
  chat of answers), and **Edit code** next to Show code when something is applied. Both open one editor,
  prefilled with what is applied, empty otherwise.
- **CSS from the editor is trusted fully (user's choice).** It skips the sanitizer's construct checks
  (`@import`, non-`data:` `url()`, `image-set()`, `var()`, …) on Apply, Save / Update saved style, restore
  (Undo of a bookmark delete) and in the background applier's re-check, and keeps the 20 KB size cap. The
  applied set and the saved style carry a flag, `cssByUser`, that only the editor's Apply sets. The agent's
  `apply_css` is always sanitized and clears it.
- **Scripts from the editor** need only the `userScripts` permission and Chrome's Allow User Scripts, not
  the Page scripts switch (it stops only the agent writing scripts; saved scripts already run without it),
  and show no approval card: the user's Apply is the consent.
- The editor works without AI settings: it needs an http(s) tab and page access, no model.
- Apply puts exactly the editor's code on the page in place of the applied set, and runs the script again
  even when only the CSS changed (the runtime undoes the previous registrations first, as Re-apply does).
  Both fields empty → Undo. A script that doesn't compile changes nothing and the editor shows the error.
- Editor drafts are kept per tab for the panel's lifetime (also while the drawer is closed), so the user
  can switch to another tab to copy code and come back. A draft is bound to the site it was opened on:
  Apply refuses when the tab is on another site now, and the editor offers to move the draft to the tab's
  current site with an explicit click (a script must not run unseen on another site with the user's
  login, as `reapply` and the approval binding of #71 already ensure).
- The editor refuses CSS whose unclosed block or comment would swallow the marker rule appended after it.

## Context (from discovery)

- Applied set: `PageAgentApplied` and `#replaceApplied` in `src/services/pageAgent/pageAgentRun.ts` (one
  marker id for CSS and script; `ChatHistory.firstUserMessage` tells the model the current CSS and script);
  `PageAgentChatData` / `recordApplied` / `clearApplied` / `fromStored` in `pageAgentChat.ts`;
  `PageAgentChats` (`undo`, `reapply`, `applySaved`, `checkMarker`, `#undoScript`, `#applyScript`,
  `savedAsApplied`) in `pageAgentChats.ts`; `PageAgentRunStart` → `PageAgentRuntime.createRun`
  (`pageAgentRuntime.ts`).
- Checks: `PageAgentCssSanitizer.check` (size 20 KB + constructs) and `withMarker` in
  `src/utils/pageAgentCss.ts`; `PageAgentScriptCheck` (64 KB) and `NoUserScriptWorldError` in
  `src/utils/pageAgentScript.ts`. The runner rejects with a plain Error when Chrome doesn't allow user
  scripts (`userScriptRunner.ts`).
- Saved styles: `SavedPageStyle` / `SavedPageStyles.withSaved` in `src/stores/savedPageStyles.ts`;
  `PageStyleManager.save` / `restore` / `checkSavable` in `src/managers/impl/pageStyleManager.ts`; API
  `src/managers/shared/pageStyleApi.ts`, proxy `src/managers/proxies/pageStyleProxy.ts`, hook
  `src/hooks/usePageStyles.ts`; background re-check in `PageStyleApplier.#styleForTab`
  (`src/services/pageStyleApplier.ts`). Undo of a bookmark delete sends the stored record back to
  `restore` unchanged (`src/actions/pageStyleUndoSnapshot.ts`).
- UI: `src/components/pageAgent/PageAgentDrawer.tsx` (input row, `saveStyle`, `inputBlock`),
  `PageAgentMessages.tsx` (`AppliedActions`, empty-chat hint), `UserScriptsNotice.tsx` (wording assumes the
  Page scripts switch), `src/hooks/usePageAgentChat.ts`.
- Tests: `tests/pageAgentChats.test.mjs`, `pageAgentRun.test.mjs`, `savedPageStyles.test.mjs`,
  `pageStyleManager.test.mjs`, `pageStyleApplier.test.mjs` (fakes for the page, the runner and storage are
  already there).

## Development Approach

- **testing approach**: Regular (code first, then tests in the same task)
- complete each task fully before moving to the next; every task leaves `make lint && make test && make
  build` passing (`make build` runs `tsc`)
- make small, focused changes
- tests follow the repo rule "test decisions, not coverage" (`CLAUDE.md`): tests for behaviour that puts
  unchecked CSS or a script on a page it shouldn't reach, loses the user's applied or saved code, or acts
  on the wrong tab. No tests for wording, labels or UI wiring; such tasks say so instead of a test item
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- code style: Allman braces, classes over raw structures, comments say why, debug logs only behind a
  debug flag (`import.meta.env.DEV` in non-tested modules, passed in as a flag to tested ones)
- modules imported by tests: `.ts` sibling imports, chrome APIs passed in, no `import.meta.env`, no
  enums / parameter properties / namespaces

## Testing Strategy

- **unit tests**: `node --test` over `tests/*.test.mjs`: saved styles with the flag, the manager's save /
  restore (which cover the CSS check by author), the applier's re-check, the run's flag rules, the chats'
  `applyCode` with its site binding.
- **e2e tests**: the project has none; manual checks are listed under Post-Completion.

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

1. **`cssByUser` flag** on the applied set (run, chat) and on saved styles; one helper picks the CSS check
   by it (size only for the user's CSS, the full sanitizer otherwise).
2. **`PageAgentChats.applyCode(tabId, css, script)`**: checks, runs the script first (a compile error
   changes nothing), replaces the marker sheet, records the set with `cssByUser: true`.
3. **Editor UI**: `PageAgentCodeEditor` in place of the messages and the input row while open, per-tab
   drafts, the marker guard, the user-scripts notice in the editor's wording, Code and Edit code buttons.

## Technical Details

### CSS check by author (`src/utils/pageAgentCss.ts`)

- `PageAgentCssSanitizer.checkSize(css)`: the 20 KB cap alone (`check` keeps calling it first).
- `checkPageAgentCss(css: string, cssByUser: boolean): PageAgentCssCheck`: `checkSize` when `cssByUser`,
  else `PageAgentCssSanitizer.check`. Used by the chats' `applyCode` (with `true`), `checkSavable` in the
  manager and `PageStyleApplier.#styleForTab` (with the record's flag). The run's `apply_css` keeps
  calling `PageAgentCssSanitizer.check`.

### Saved styles

- `SavedPageStyle.cssByUser: boolean`, the **last** constructor parameter with default `false`, so
  positional calls in code and tests keep working. `withAutoApply` and `equals` carry it; `toStored`
  writes `cssByUser: true` only when it is set (records of the agent's CSS keep their stored shape, and
  the `entry()` helpers in the tests stay valid); `fromStoredEntry` reads `entry.cssByUser === true`
  (missing or not a boolean → `false`, as entries saved before this change). `holds(css, script)` stays text-only: equal text is the same look whoever wrote it.
- `StoredPageStyle.cssByUser?: boolean`.
- `SavedPageStyles.withSaved(bookmarkId, css, script, origin, rev, cssByUser)`.
- `PageStyleManager.save(bookmarkId, css, script, pageUrl, cssByUser, originId)`; `dispatch` passes
  `message.cssByUser === true`. `checkSavable(css, script, cssByUser, verb)` uses `checkPageAgentCss`;
  `restore` passes the record's flag. API, proxy (`{ bookmarkId, css, script, pageUrl, cssByUser }`) and
  hook gain the parameter.
- `PageStyleApplier.#styleForTab`: `checkPageAgentCss(style.css, style.cssByUser)`.

### Applied set

- `PageAgentApplied.cssByUser: boolean`. `PageAgentChatData.appliedCssByUser: boolean`; `empty` and
  `clearApplied` set `false`, `recordApplied` copies it, `fromStored` reads `value.appliedCssByUser === true`.
  Getter `appliedCssByUser`.
- Run: `PageAgentRunOptions.currentCssByUser?: boolean`, `PageAgentRunStart.currentCssByUser`, passed by
  `PageAgentChats.send` (`chat.appliedCssByUser`) and `PageAgentRuntime.createRun`. `#replaceApplied`:
  `cssByUser = change.css !== undefined ? false : this.#currentCssByUser`; stored back and sent in
  `onApplied`. `apply_script` keeps the user's CSS and its flag.
- `firstUserMessage(request, currentCss, currentScript, scripts, cssByUser)`: the labels no longer say
  "applied by the last apply_css / apply_script" (the user may have written them): "Current stylesheet
  (on the page now; a new apply_css replaces it as a whole)" and the same for the script. With
  `cssByUser`: "Current stylesheet (written by the user; it may use url(), @import, image-set() or var(),
  which apply_css refuses, so a new apply_css replaces it as a whole without them)".
- `savedAsApplied` carries `style.cssByUser`; `reapply` records `chat.appliedCssByUser`.
- The drawer's Save passes `chat.appliedCssByUser`.

### `PageAgentChats.applyCode(tabId, css, script, origin): Promise<void>`

Puts the editor's code on the page as the chat's applied set. `origin` is the http(s) origin the draft is
bound to. Rejects with an `Error` whose message the editor shows; "nothing changed" below means neither
the page nor the chat.

1. The tab has a run → reject "wait until the agent has finished"; nothing changed.
2. Whitespace-only `css` / `script` become `''`. Both empty → `await this.undo(tabId)` and return.
3. `checkPageAgentCss(css, true)` and `PageAgentScriptCheck.check(script)`; a failure rejects with its
   reason; nothing changed.
4. `url = await page.pageUrl(tabId)`; `httpOriginOf(url) === null` → reject "code can be applied only on
   http and https pages"; `httpOriginOf(url) !== origin` → reject "the code was opened for <site>; this
   tab is on another site now" (`siteName`, as `reapply` words it); nothing changed.
5. Script non-empty → `page.runUserScript(tabId, { kind: 'apply', code: script })`. It throws (user
   scripts unavailable, page refused) → reject with its message; `compiled: false` → reject
   `script error: <error>`; nothing changed in both cases (the runtime keeps the running script on a
   compile error). `ok: false` with `compiled: true` → remember the error. Script empty and the chat has
   one → `#undoScript(tabId)`; remember its error.
6. Remove the chat's `appliedInsertedText` (when set), insert `withMarker(css, newId)`, then record
   `{ css, script, insertedText, appliedId, url, cssByUser: true }` (when the chat is still owned). When
   step 5 ran or undid a script, the page's script has changed, so the set is recorded even if the sheet
   calls throw (`try` / `finally`), and Undo can still stop the script; the sheet error is rethrown after
   recording. For a CSS-only Apply that touched no script, a sheet error throws before recording, as
   `reapply` does, so the chat keeps the text of a sheet that may still be on the page.
7. After recording: a remembered script error rejects `script error: …`; an undo error rejects "the
   earlier script couldn't be stopped (…); reload the page to remove it".

Hook: `usePageAgentChat` exposes `applyCode(css, script, origin): Promise<void>` (rejects; no
`actionError`: the editor shows the error itself).

### Editor UI

- `src/components/pageAgent/PageAgentCodeEditor.tsx`: title "Code for <site>" (the draft's site);
  **CSS** and **Script** monospace textareas sharing the height; hints: the CSS isn't checked for loads
  from the network; a script runs with your login on the site, so run only code you trust; it runs in the
  extension's own world (the page's DOM, not the page's JavaScript variables; network only to the page's
  own site; no `import`), and listeners, timers, observers and added elements registered through
  `agent.on`, `agent.setInterval`, `agent.setTimeout`, `agent.observe`, `agent.add` and `agent.onUndo` are
  removed by Undo, anything else stays until a reload; `UserScriptsNotice` (editor wording) while the
  Script field isn't blank; a Grant page access prompt while the extension has no access to http(s)
  pages (the drawer's `BlockNotice` shows only the settings notice when AI settings are missing too); the
  drawer's `actionError` (failures of the strip's Apply, Remove and Auto-apply, which `PageAgentMessages`
  shows when the editor is closed); the draft's error line; **Apply** (disabled while the tab runs or
  while the draft is applying, label shows progress) and **Cancel** (disabled while applying, so the
  input can't start a run on the old set before `applyCode` records).
- Site binding: when the tab's current origin (`tabUrl`) differs from the draft's, the editor says
  "This tab is on <other site> now; the code was opened for <site>" with **Use on <other site>**, which
  rebinds the draft (`CodeDrafts.rebind`); Apply is disabled until then (and `applyCode` checks again).
- Marker guard (side panel only, no test): `cssKeepsMarker(css)` parses `withMarker(css, 'check')` with
  `new CSSStyleSheet().replaceSync` and requires the last top-level rule to be a `CSSStyleRule` for
  `:root` with `PAGE_AGENT_MARKER_PROPERTY` set; otherwise Apply shows "the CSS has an unclosed { or
  comment" and calls nothing. (`replaceSync` drops `@import` rules without throwing; that is fine for the
  check.)
- Drafts: `CodeDrafts` class in `src/components/pageAgent/codeDrafts.ts` (no React, no chrome), created
  once in `src/App.tsx` (`useState(() => new CodeDrafts())`, next to `pageAgentChats`) and passed to the
  drawer, so a draft outlives a closed drawer. Per tab an immutable draft `{ css, script, origin,
  applying, error }`: `draftFor(tabId)`, `open(tabId, css, script, origin)`, `update(tabId, css,
  script)`, `rebind(tabId, origin)`, `setApplying(tabId, on)`, `setError(tabId, message)`,
  `close(tabId)`, `subscribe`; the drawer reads it with `useSyncExternalStore`. App's tab-close handler
  (where it calls `pageAgentChats.tabClosed`) also closes the tab's draft. The editor shows for the
  drawer's tab while that tab has a draft; switching tabs shows the other tab's chat or draft. Apply
  captures the tab id at the click: when `applyCode` settles it closes that tab's draft on success or
  sets that tab's error, whichever tab the drawer shows by then. Cancel closes the draft.
- Drawer: a **Code** button left of Send, enabled when there is a tab, its page is scriptable
  (`unscriptablePageReason` is null) and page access isn't known to be missing (`hasPageAccess !== false`),
  whatever the AI settings, and the tab doesn't run; it opens the tab's draft, or a new one from the chat's
  applied CSS and script bound to the tab's origin. While the editor shows, it replaces
  `PageAgentMessages` and the input area; the style strip stays.
- `PageAgentMessages` / `AppliedActions`: **Edit code** after Show code (both rows: the last turn and the
  adopted-saved-style row), disabled while running, calls the same open. The no-turns row also gets the
  `SaveButton` (the editor's main use is a fresh chat, whose code must be savable; for an adopted saved
  style it shows the disabled Saved). Empty-chat hint mentions Code for pasting your own CSS or
  JavaScript. Undo's title: "Remove the applied CSS and script".
- `UserScriptsNotice` gets a `context: 'page-scripts' | 'editor'` prop (default `'page-scripts'`): the
  editor's texts say "Chrome doesn't allow this extension's scripts yet: …" instead of "Page scripts are
  on, but …".

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): code, tests and docs in this repo.
- **Post-Completion** (no checkboxes): manual checks in Chrome.

## Implementation Steps

### Task 1: CSS check by author and `cssByUser` on saved styles

**Files:**
- Modify: `src/utils/pageAgentCss.ts`
- Modify: `src/stores/savedPageStyles.ts`
- Modify: `src/managers/impl/pageStyleManager.ts`
- Modify: `src/managers/shared/pageStyleApi.ts`
- Modify: `src/managers/proxies/pageStyleProxy.ts`
- Modify: `src/hooks/usePageStyles.ts`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx` (Save passes `false` until Task 3)
- Modify: `tests/savedPageStyles.test.mjs`
- Modify: `tests/pageStyleManager.test.mjs`

- [x] `PageAgentCssSanitizer.checkSize` and `checkPageAgentCss(css, cssByUser)` as in Technical Details
- [x] `SavedPageStyle.cssByUser` (last constructor parameter, default `false`), `withAutoApply`, `equals`,
  `toStored`, `fromStoredEntry`; `StoredPageStyle.cssByUser?`; `withSaved(..., cssByUser)`
- [x] `PageStyleManager.save(..., cssByUser, originId)`, `dispatch`, `checkSavable` by the flag, `restore`
  by the record's flag; API, proxy and hook carry `cssByUser`
- [x] write tests: a stored entry without `cssByUser` loads with `false`; the flag survives `toStored` /
  `fromStoredEntry` and `withAutoApply`; `save` accepts CSS with a remote `url()` / `var()` / `@import`
  only with `cssByUser` true and refuses it without; both are refused over 20 KB; `restore` of a flagged
  record with `url()` is accepted and of an unflagged one refused
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 2: Background applier honours `cssByUser`

**Files:**
- Modify: `src/services/pageStyleApplier.ts`
- Modify: `tests/pageStyleApplier.test.mjs`

- [x] `#styleForTab` checks the CSS with `checkPageAgentCss(style.css, style.cssByUser)`
- [x] write tests: a flagged saved style with a remote `url()` is inserted in the bookmark's tab; the same
  CSS unflagged is not inserted
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 3: Applied set carries `cssByUser`

**Files:**
- Modify: `src/services/pageAgent/pageAgentRun.ts`
- Modify: `src/services/pageAgent/pageAgentChat.ts`
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/services/pageAgent/pageAgentRuntime.ts`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `tests/pageAgentRun.test.mjs`
- Modify: `tests/pageAgentChats.test.mjs`

- [x] `PageAgentApplied.cssByUser`; chat data `appliedCssByUser` (`empty`, `fromStored`, `recordApplied`,
  `clearApplied`, getter)
- [x] run option `currentCssByUser`, `PageAgentRunStart.currentCssByUser` from `send`, `createRun` passes
  it; `#replaceApplied` clears it on a CSS change and keeps it on a script-only change
- [x] `firstUserMessage` neutral labels and the user-CSS label
- [x] `savedAsApplied` and `reapply` carry the flag; the drawer's Save passes `chat.appliedCssByUser`
- [x] write tests: a run started with user CSS reports `cssByUser: false` after `apply_css` and `true`
  after an `apply_script` that keeps the CSS; the first message names user-written CSS; `applySaved` of a
  flagged saved style records the flag; a stored chat without the field loads `false`
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 4: `PageAgentChats.applyCode`

**Files:**
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/hooks/usePageAgentChat.ts`
- Modify: `tests/pageAgentChats.test.mjs`

- [x] `applyCode(tabId, css, script, origin)` as in Technical Details (steps 1–7)
- [x] `usePageAgentChat` exposes `applyCode(css, script, origin): Promise<void>`
- [x] write tests: success replaces the chat's sheet by its exact text, inserts `withMarker(css, newId)`,
  runs the script with `apply` on the chat's own tab and records `cssByUser: true`; CSS with a remote
  `url()` is applied; a script that doesn't compile rejects and leaves the page and the chat unchanged
  (no `removeCss` / `insertCss`); a compiled script that throws is recorded and the call rejects; an
  empty script with an applied script undoes it; both fields blank behave as Undo; rejected while the tab
  runs, on a page that isn't http(s) and when the tab's origin isn't the draft's, with nothing run; CSS
  over 20 KB and a script over 64 KB are rejected before the page is touched; unavailable user scripts
  reject with nothing changed; a CSS-only Apply whose insert fails keeps the chat's earlier set
- [x] run `make test`, `make lint` and `make build` - must pass before next task

### Task 5: Code editor in the drawer

**Files:**
- Create: `src/components/pageAgent/codeDrafts.ts`
- Create: `src/components/pageAgent/PageAgentCodeEditor.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `src/components/pageAgent/PageAgentMessages.tsx`
- Modify: `src/components/pageAgent/UserScriptsNotice.tsx`

- [ ] `CodeDrafts` (per-tab drafts with site, applying and error) created in `App.tsx` and closed with
  the tab
- [ ] `PageAgentCodeEditor` with the fields, hints, notices (user scripts, page access, `actionError`),
  site binding with Use on <site>, error line, Apply and Cancel; `cssKeepsMarker` guard
- [ ] drawer: Code button beside Send (gated on tab, scriptable page and page access), editor in place of
  the messages and the input area while the tab has a draft, Apply through `applyCode` settling on the
  tab it was clicked for
- [ ] `AppliedActions`: Edit code; Save in the no-turns row; empty-chat hint; Undo title
- [ ] `UserScriptsNotice` `context` prop with the editor wording
- [ ] no tests: UI wiring (CLAUDE.md)
- [ ] run `make test`, `make lint` and `make build` - must pass before next task

### Task 6: Verify acceptance criteria

- [ ] verify all requirements from Overview are implemented (entry points, trust of user CSS end to end,
  scripts without the switch or a card, compile error changes nothing, drafts per tab bound to their
  site, Save in a chat with no turns, marker guard)
- [ ] verify the agent's `apply_css` still goes through `PageAgentCssSanitizer.check` and clears the flag
- [ ] run full test suite: `make lint && make test && make build`

### Task 7: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`
- Modify: `docs/state-reference.md`
- Modify: `docs/chrome-web-store-info.md`
- Modify: `PRIVACY.md`

- [ ] README: page agent section (the code editor, Code and Edit code, Apply, scripts without the switch,
  the world a pasted script runs in, user CSS not checked for network loads and saved as is), the
  security notes, the `userScripts` row of the permissions table
- [ ] `docs/changelog.md` and a What's New entry in `src/data/changelog.ts`
- [ ] `docs/state-reference.md`: `appliedCssByUser` in `pageAgentChat:${tabId}`, `cssByUser` in
  `bookmarkPageStyles` (save, restore and applier checks by the flag), and the Page scripts switch line
  (editor scripts run without it, like saved ones)
- [ ] `docs/chrome-web-store-info.md`: `userScripts` is also requested from the code editor for a script
  the user pastes; the user's own CSS isn't sanitized
- [ ] `PRIVACY.md`: CSS the user applies from the code editor isn't checked and loads what it names (also
  with Auto-apply); the user's own scripts run with the `userScripts` permission and Allow User Scripts,
  without the Page scripts plugin or an approval card; the stored chat and saved style may hold the
  user's code
- [ ] move this plan to `docs/plans/completed/`

## Known limitations

- [known-limitation] Code from the editor that doesn't register through `agent` (plain
  `addEventListener`, `setInterval`) keeps running after Undo until a reload; the editor says so.
- [known-limitation] The user's CSS loads what it names (fonts, images, `@import`) from the network on
  every page it goes on, Auto-apply included; that is the choice of trusting it.
- [known-limitation] Code pasted from elsewhere runs in the extension's USER_SCRIPT world: it can't see
  the page's own JavaScript variables, the world's CSP limits its network loads to the page's own site,
  and it is compiled as the body of a strict async function, so `import` / module syntax and console or
  Tampermonkey snippets that rely on page globals or CDN loads fail; the editor hint and the README say so.
- [known-limitation] While the editor's Apply waits for a slow script (up to 10 s), the style strip's
  Apply and Remove stay clickable, as they are during Re-apply today.

## Post-Completion

**Manual verification:**
- on a site, open Code, paste CSS with `var()` and a Google Fonts `@import`, Apply: the page changes;
  Save to bookmark, reload in the bookmark's tab: Auto-apply puts it back
- paste a script with `agent.on(document, 'keydown', …)`, Apply with Allow User Scripts on and the Page
  scripts switch off: it runs with no approval card; Undo removes the listener
- a script with a syntax error: Apply shows the error, the old code stays on the page
- CSS with a missing `}`: Apply refuses it
- Edit code after an agent run: the editor holds the agent's CSS and script; edit and Apply; ask the agent
  for another change: it sees the user's code
- switch to another tab while the editor has a draft, come back: the draft is still there
