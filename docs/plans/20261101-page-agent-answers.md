# Page agent answers questions and shows them in a popup (#52)

## Overview

The page agent only restyles pages. Asked "summary page" it asks what to change about the look, and
when it finally writes a summary the turn shows **Not done** with the markdown as raw text. It also
can't read the page: the outline keeps 40 characters of text per element.

This change makes it answer questions about the current page:

- a text reply ends the turn as a new status `answered` (neutral block, title "Answer"), rendered as
  markdown; a turn that called `set_conditions` still needs `report`
- `read_page_text` gives the model the page's readable text
- `show_popup` shows an answer in a popup on the run's tab; **Show on page** does the same for any
  answered turn without a model call
- while a popup is open, each new answer is appended to it under its question; ✕ ends that thread
- follow-ups see earlier answers (up to 4 000 characters each)

It is the first step from "CSS agent" to an agent with tools. The run loop, chat, drawer and page
adapter stay as they are and gain one status, two tools and a popup page function.

## Context (from discovery)

- `src/services/pageAgent/pageAgentTools.ts` — tool definitions, system prompt ("You change how the
  user's current web page looks, using CSS only"), argument parsers
- `src/services/pageAgent/pageAgentRun.ts` — the loop; a reply without tool calls ends as `not-met`
  (`#loop`), `ChatHistory.firstUserMessage` / `describeTurn` build the follow-up message, the
  `PageAgentPageAdapter` interface
- `src/services/pageAgent/pageAgentChat.ts` — turns, `history()` (one-line `summary`)
- `src/services/pageAgent/pageAgentChats.ts` — `send()` runs and saves, `PageAgentChatPage` (Undo,
  Re-apply, marker), every call names the run's tab
- `src/services/pageAgent/chromePageAdapter.ts`, `pageScripts.ts` — injected functions run through
  `runInTab` (top frame, default isolated world; they must be self-contained)
- `src/services/pageAgent/panelPageAgent.ts` — `LazyChatPage` forwards page calls to the lazily loaded
  runtime
- `src/services/aiRenameService.ts:134` — `PageContentReader.#readLiveTab`, the injected function that
  reads `article, main, [role="main"]` or `body` `innerText`
- `src/components/pageAgent/PageAgentMessages.tsx` — `OUTCOME_STYLES` (`Record<PageAgentTurnStatus, …>`),
  `TurnView` renders `summary` as `whitespace-pre-wrap` text, the empty-chat hint; `PageAgentDrawer.tsx` —
  the textarea placeholder; `src/hooks/usePageAgentChat.ts` — `runAction` for drawer actions with an
  error line
- tests: `tests/pageAgentRun.test.mjs` (`ScriptedClient`, `FakePage` with `activeTabId`, tab-target
  test), `tests/pageAgentChats.test.mjs` (`FakeRun`, `FakePage`, `FakeSessionArea`)
- docs: README "Page agent (experimental)", PRIVACY.md "Page Agent (experimental)",
  `docs/state-reference.md` `pageAgentChat:${tabId}`, `docs/chrome-web-store-info.md` (`scripting`),
  `docs/changelog.md`, `src/data/changelog.ts` (`'1.0.352'`, unreleased; `package.json` is 1.0.351)

## Development Approach

- **testing approach**: Regular (code first, then tests)
- complete each task fully before moving to the next; small, focused changes
- tests only for decisions that lose data or act on the wrong tab or show unsafe content when they break
  (CLAUDE.md "Test decisions, not coverage"): no tests for React components, the popup DOM function,
  the injected page-text function, prompt wording or trivial parsers
- **all tests must pass before starting the next task**: `make test`; tasks that touch types also run
  `npx tsc --noEmit` and `make lint`
- Allman braces, comments only for why, `import.meta.env.DEV` never read by tested modules
- tested modules import siblings with `.ts` extensions and never touch `chrome.*`
- update this plan when scope changes

## Testing Strategy

- **unit tests** (`node --test`): markdown parser safety and node tree; run status rules; `read_page_text`
  and `show_popup` tab targeting; history carries answers; popup follow-up after a turn (right tab,
  closed popup stays closed, popup-opening and style turns don't append)
- no e2e suite in this project; the drawer and popup are checked by hand (Post-Completion)

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix, blockers with ⚠️ prefix
- keep the plan in sync with the work

## Solution Overview

- **`answered` status.** A reply without tool calls ends a turn as `answered` unless the turn called
  `set_conditions` (then `not-met`, as today, so a style change can't succeed without numbers).
  Clarifying questions are answered turns. A `report` in a turn that set no conditions also ends as
  `answered` with its summary as the answer (no CSS can have been applied: `apply_css` is refused
  without conditions). The full answer is the turn's `summary`.
- **`show_popup` is terminal**, like `report`: a valid call shows the popup and ends the run as
  `answered` with the popup markdown as the answer and `openedPopup: true`. The chat, history and Show
  on page then hold the same text, and the model never writes the answer twice. It is refused once the
  turn called `set_conditions`: popups hold answers only.
- **Popup state lives in the page.** A custom host element with a closed shadow root, plus a reference
  kept on the extension's isolated-world `window`. Reload or navigation drops it; ✕ removes it. No
  storage key, so no second writer and nothing to go stale. The panel's append is "append if still
  there", one page call.
- **One markdown tree for both renderers.** A pure parser produces plain-JSON nodes; React renders them
  in the chat, and the injected popup function renders the same nodes with `createElement` /
  `textContent`. Nothing is parsed as HTML; links are http(s) only.
- **Shared readable-page function.** AI Rename's live-tab read and `read_page_text` use one injected
  function in `src/utils/readablePage.ts`, cut in the page to a character limit.

## Technical Details

### Markdown tree (`src/utils/markdown.ts`)

```ts
export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'break' };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'codeBlock'; language: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: 'blockquote'; children: MarkdownBlock[] }
  | { type: 'rule' };

export function parseMarkdown(text: string): MarkdownBlock[];
export function safeLinkHref(url: string): string | null; // http/https only, else null
```

- block rules: ATX headings `#`–`######`; fenced code ``` / ~~~ (info string → `language`, text
  verbatim, unclosed fence runs to the end); `-`/`*`/`+` and `1.`/`1)` list items, continuation and
  nested lists by indentation (item content parsed as blocks); `>` blockquotes (contents parsed as
  blocks); `---`/`***`/`___` rules; blank lines end paragraphs; a single newline inside a paragraph is
  a `break`
- inline rules: backslash escapes of ASCII punctuation; code spans by backtick runs; `**`/`__` strong
  and `*`/`_` em (`_` only at word boundaries); `[label](url)` with an optional `"title"` ignored;
  a link whose `safeLinkHref` is null keeps its label as plain inline content; `![alt](src)` stays text
- nesting depth capped (8) for lists and blockquotes and for inline nesting (strong / em / link
  labels); deeper markers stay text, so a persisted answer can't make either renderer recurse without
  bound
- raw HTML has no node type and stays in `text` nodes

### Readable page (`src/utils/readablePage.ts`)

```ts
export interface ReadablePage
{
  url: string; title: string; description: string; language: string; markdownUrl?: string;
  text: string;       // innerText of the preferred root, spaces collapsed, newlines kept, cut at maxChars
  textLength: number; // length before the cut
}
export function readReadablePage(maxChars: number, rootRule: 'article-first' | 'main-first'): ReadablePage; // injected, self-contained
```

- root: `rootRule` argument. `'article-first'` (AI Rename, unchanged): the first match of
  `article, main, [role="main"]`, else `body`. `'main-first'` (page agent): `main, [role="main"]`, else
  the only `article` when there is exactly one, else `body`, so a feed or news front page with many
  articles and no `main` is read whole
- normalization in the page: runs of horizontal whitespace → one space, a newline with surrounding
  whitespace → one `\n`, trimmed; each whitespace run becomes one character, so AI Rename's later
  `\s+ → ' '` gives the same text as today
- AI Rename passes `MAX_CONTENT_LENGTH`, `'article-first'` and keeps its `DocumentSnapshot` shape
- the page agent passes `PAGE_TEXT_MAX_CHARS = 30000`, `'main-first'` and sends
  `{ url, title, text, note? }` as JSON, `note` = `cut at 30000 of N characters; the rest of the page is
  not shown`

### Popup (`src/services/pageAgent/pagePopup.ts`)

```ts
export interface PagePopupEntry { question: string; blocks: MarkdownBlock[] }
export type PagePopupCommand =
  | { kind: 'open'; title: string; entry: PagePopupEntry }
  | { kind: 'append'; entry: PagePopupEntry };
export interface PagePopupResult { shown: boolean }
export function runPagePopupCommand(command: PagePopupCommand): PagePopupResult; // injected
```

- host `<sidebar-page-agent-popup>` on `document.documentElement`, inline styles via
  `style.setProperty(…, 'important')`: `all: initial`, `position: fixed`, top/right 12px,
  `z-index: 2147483647`; closed shadow root; styles from a constructed `CSSStyleSheet` in
  `adoptedStyleSheets` (CSSOM, not blocked by a page CSP), light/dark through `prefers-color-scheme`
- panel: width `min(420px, calc(100vw - 24px))`, max height 70vh, header (title, ✕ button with
  `aria-label="Close"`), scrolling body; each entry: question (muted) then the answer blocks
- state on the isolated world's `window` (`__sidebarPageAgentPopup`: host, body, document URL without
  hash); `open` removes the stored host and any stray host by tag, then builds a new one; `append`
  returns `{ shown: false }` and changes nothing when the stored host is missing or not connected,
  else appends and scrolls the body to the new entry
- ✕ removes the host and clears the state; a Navigation API `currententrychange` whose
  `navigationType` is `push`, `traverse` or `reload` and whose URL differs in path or query does the
  same (`replace` is ignored: search and infinite-scroll pages rewrite `?q=` / `?page=` while the user
  reads). The listener is removed when the popup closes or is replaced
- `open` always returns `{ shown: true }`; `ChromePageAdapter.showPopup` throws when a result says
  `shown: false`, so Show on page reports a refusal
- popup commands run with `injectImmediately: true` (an optional `runInTab` argument), so the
  turn-end append doesn't wait for a navigating tab's `document_idle` while the drawer shows Stop
- links rebuilt only when the href parses as http(s) in the page, `target="_blank"`,
  `rel="noopener noreferrer"`; every text through `textContent`

### Run, chat and chats

- `PageAgentRunStatus = 'met' | 'not-met' | 'answered' | 'stopped' | 'error'`;
  `PageAgentRunResult.openedPopup?: boolean`
- `PageAgentAnswer { question: string; markdown: string }` (in `pageAgentRun.ts`)
- `PageAgentPageAdapter` + `readText(tabId): Promise<string>` and
  `showPopup(tabId, title, answer): Promise<void>`
- `PageAgentChatPage` + `showPopup(tabId, title, answer): Promise<void>` and
  `appendToPopup(tabId, answer): Promise<boolean>`
- tool names `readPageText: 'read_page_text'`, `showPopup: 'show_popup'`;
  `parseShowPopupArgs` → `{ title, markdown }` (both non-empty after trim, title cut to 200)
- round limit without conditions: `not-met`, "No answer after 8 steps."; empty reply text without
  conditions: `not-met`, "The model gave no answer."
- `report` with no conditions set in the run: `answered` with the report's summary (empty summary →
  `not-met`, "The model gave no answer.")
- `read_page_text` step: `step('read_page_text', '', shortText(text))`, as `#outline` does, so the
  persisted step log keeps a preview, never the 30 000 characters
- `describeTurn`: answered turns print `Answer:` and the text instead of `Summary:`
- `PageAgentChat.history()`: answered turns' `summary` cut at `ANSWER_HISTORY_LIMIT = 4000` with
  `\n[answer cut at 4000 characters]`; `answerOf(turnIndex)` returns `{ question, markdown }` of an
  answered turn or null
- `PageAgentChats.send`: after `run.run()` resolves `answered` without `openedPopup` and the chat is
  still owned, `page.appendToPopup(tabId, { question: request, markdown: result.summary })`, errors
  logged; `showOnPage(tabId, turnIndex)` calls `page.showPopup(tabId, 'Page agent', answer)` and
  rejects when the page refused

## What Goes Where

- **Implementation Steps**: code, tests and docs in this repo
- **Post-Completion**: manual checks in Chrome with a real model

## Implementation Steps

### Task 1: Markdown parser

**Files:**
- Create: `src/utils/markdown.ts`
- Create: `tests/markdown.test.mjs`

- [ ] create `src/utils/markdown.ts` with the `MarkdownInline` / `MarkdownBlock` types,
  `parseMarkdown(text)` and `safeLinkHref(url)` per Technical Details; parsing state in a small class
  (block parser over lines, inline parser over a string), the exported function wraps it
- [ ] block rules: headings, paragraphs with `break` for single newlines, fenced code blocks, ordered
  and unordered lists with nesting by indentation, blockquotes, thematic breaks, depth cap
- [ ] inline rules: escapes, code spans, strong, em (`_` at word boundaries only), links with
  `safeLinkHref`, images left as text
- [ ] write tests: `<script>alert(1)</script>` and `<b>x</b>` in a paragraph come out as `text` nodes
  with the literal characters (no node type besides the listed ones anywhere in the tree);
  `[x](javascript:alert(1))`, `[x](data:text/html,…)`, `[x](JaVaScRiPt:…)` and a relative link give no
  `link` node and keep the label
- [ ] write tests: one input with a heading, a paragraph with bold, italic, inline code, an http link
  and a line break, a fenced code block (with HTML inside kept verbatim), an unordered list with a
  nested ordered list, and a blockquote gives the expected tree (deepEqual)
- [ ] run `make test` - must pass before next task

### Task 2: Shared readable-page function

**Files:**
- Create: `src/utils/readablePage.ts`
- Modify: `src/services/aiRenameService.ts`

- [ ] create `src/utils/readablePage.ts` with the `ReadablePage` type and the self-contained injected
  `readReadablePage(maxChars, rootRule)` per Technical Details (comment the self-contained rule as in
  `pageScripts.ts`)
- [ ] switch `PageContentReader.#readLiveTab` to `executeScript({ func: readReadablePage, args:
  [MAX_CONTENT_LENGTH, 'article-first'] })`, then map to `DocumentSnapshot` with `cleanedPage = text.replace(/\s+/g, '
  ').trim()`; the error on a missing result stays
- [ ] no tests: an injected DOM function and wiring (repo rule)
- [ ] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 3: Popup page function and page adapter methods

**Files:**
- Create: `src/services/pageAgent/pagePopup.ts`
- Modify: `src/services/pageAgent/chromePageAdapter.ts`
- Modify: `src/services/pageAgent/pageAgentRun.ts` (only the `PageAgentAnswer` type)

- [ ] create `pagePopup.ts` with `PagePopupEntry`, `PagePopupCommand`, `PagePopupResult` and the
  self-contained injected `runPagePopupCommand(command)` per Technical Details (host, closed shadow
  root, constructed stylesheet, header with ✕, scroll body, entries rendered with `createElement` /
  `textContent`, http(s)-only links re-checked in the page, isolated-world state, `currententrychange`
  close)
- [ ] add `PageAgentAnswer { question, markdown }` to `pageAgentRun.ts`
- [ ] `ChromePageAdapter.readText(tabId)`: `readReadablePage(PAGE_TEXT_MAX_CHARS, 'main-first')` through
  `runInTab`, JSON `{ url, title, text, note? }`
- [ ] `ChromePageAdapter.showPopup(tabId, title, answer)` and `appendToPopup(tabId, answer)`: build the
  entry with `parseMarkdown(answer.markdown)`, run the command through `runInTab` with
  `injectImmediately: true` (new optional argument); `showPopup` throws on `shown: false`,
  `appendToPopup` returns `shown`
- [ ] no tests: injected DOM function and Chrome wiring (repo rule)
- [ ] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 4: Tools, prompt and the answered status in the run

**Files:**
- Modify: `src/services/pageAgent/pageAgentTools.ts`
- Modify: `src/services/pageAgent/pageAgentRun.ts`
- Modify: `src/components/pageAgent/PageAgentMessages.tsx` (only `OUTCOME_STYLES.answered`)
- Modify: `tests/pageAgentRun.test.mjs`

- [ ] add `read_page_text` (no arguments) and `show_popup` (`title`, `markdown`, both required) to the
  tool names and `pageAgentToolDefinitions`, and `parseShowPopupArgs`
- [ ] rewrite `pageAgentSystemPrompt`: the agent helps with the user's current page; questions →
  `read_page_text` (outline when layout matters), markdown answer in the reply, no `set_conditions`,
  `show_popup` instead of a text reply when the user wants it on the page (it ends the request);
  style changes → the existing conditions flow, unchanged; unclear → one short plain-text question;
  the untrusted-data rule names page text
- [ ] `report` tool description: for style changes after `set_conditions`; questions are answered
  with a text reply or `show_popup`
- [ ] `PageAgentRunStatus` + `'answered'`, `PageAgentRunResult.openedPopup`, adapter +
  `readText` / `showPopup`; `#loop`: no tool calls → `answered` with the text when no conditions are
  set (empty text → `not-met` "The model gave no answer."), `not-met` as today when they are
- [ ] `#report` without conditions set in the run → `answered` with the summary (empty → `not-met`)
- [ ] `OUTCOME_STYLES.answered` in `PageAgentMessages.tsx`: neutral gray block, label "Answer" (the
  `Record<PageAgentTurnStatus, …>` needs it for tsc)
- [ ] `#readPageText` (step result `shortText(text)`) and `#showPopup` tool handlers: `show_popup` refused after `set_conditions`,
  invalid arguments back to the model, else `adapter.showPopup(this.tabId, title, { question: request,
  markdown })`, step `show_popup (title) → shown`, run finished `answered` with `openedPopup: true`;
  round limit without conditions → "No answer after 8 steps."
- [ ] `describeTurn` prints `Answer:` for answered turns
- [ ] update tests: `FakePage` gets `readText` and `showPopup` (recording tab id); the old "answer
  without tool calls ends as not-met" test becomes: a text reply with no `set_conditions` ends
  `answered` with the text; new: a text reply after `set_conditions` without `report` ends `not-met`;
  the existing "a report with no conditions set in the run ends as not-met" test becomes: ends
  `answered` with the report's summary
- [ ] write tests: a run on tab A calls `read_page_text`, the user switches to tab B, the run calls
  `show_popup` → every page call went to tab A, the run ends `answered` with the popup markdown and
  `openedPopup`; `show_popup` after `set_conditions` is refused and nothing is shown
- [ ] write test: a follow-up run's first user message contains the previous answered turn's full
  answer text
- [ ] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 5: History of answers and the popup following the chat

**Files:**
- Modify: `src/services/pageAgent/pageAgentChat.ts`
- Modify: `src/services/pageAgent/pageAgentChats.ts`
- Modify: `src/services/pageAgent/panelPageAgent.ts`
- Modify: `tests/pageAgentChats.test.mjs`

- [ ] `PageAgentChat.history()` caps answered turns' summary at `ANSWER_HISTORY_LIMIT` with the cut
  note; add `answerOf(turnIndex)`
- [ ] `PageAgentChatPage` + `showPopup` / `appendToPopup`; `LazyChatPage` forwards both to the
  runtime's `ChromePageAdapter`
- [ ] `PageAgentChats.send`: keep the run's result; when it is `answered` without `openedPopup` and the
  chat is still owned, `appendToPopup` on the run's tab with the request and the answer, before the run
  leaves `#runs`; a rejection is logged and never changes the turn
- [ ] `PageAgentChats.showOnPage(tabId, turnIndex)`: `answerOf` → `page.showPopup(tabId, 'Page agent',
  answer)`; nothing for a turn that isn't answered
- [ ] update `FakePage` in the tests: per-tab popup (`showPopup` opens with one entry, `appendToPopup`
  appends and returns true only while open, `closePopup(tabId)` for the ✕), recording tab ids
- [ ] write tests: the history passed to the second run has the first answer's full text, and an answer
  over 4 000 characters arrives cut with the note
- [ ] write tests: a run on tab A that ends `answered` while the drawer shows tab B appends to A's open
  popup (and nothing goes to B); after `closePopup(A)` the next answered turn appends nothing and opens
  no popup; a turn with `openedPopup` and a `met` turn don't call `appendToPopup`
- [ ] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 6: Answers in the drawer

**Files:**
- Create: `src/components/pageAgent/MarkdownView.tsx`
- Modify: `src/components/pageAgent/PageAgentMessages.tsx`
- Modify: `src/components/pageAgent/PageAgentDrawer.tsx`
- Modify: `src/hooks/usePageAgentChat.ts`

- [ ] `MarkdownView` renders `MarkdownBlock[]` as React elements (Tailwind: heading sizes, `list-disc` /
  `list-decimal` with padding and `start`, blockquote border, `pre` for code blocks, inline `code`,
  links `target="_blank" rel="noopener noreferrer"`), keyed by index
- [ ] answered turns render `parseMarkdown(turn.summary)` with `MarkdownView` (memoized), other
  statuses keep the plain text
- [ ] **Show on page** button on answered turns (not disabled by a run), wired through
  `usePageAgentChat().showOnPage(turnIndex)` = `runAction('Show on page', () => chats.showOnPage(tabId,
  turnIndex))`
- [ ] empty-chat hint (`PageAgentMessages.tsx`) and textarea placeholder (`PageAgentDrawer.tsx`) mention questions ("summarize this page") next to
  changes
- [ ] no tests: UI (repo rule)
- [ ] run `make test`, `npx tsc --noEmit` and `make lint` - must pass before next task

### Task 7: Verify acceptance criteria

- [ ] verify every item of the issue's Change list (1–7) and Tests list is implemented
- [ ] verify edge cases: `show_popup` after `set_conditions`, empty reply, round limit without
  conditions, closed popup stays closed, popup-opening turn not appended twice
- [ ] run `make lint && make test && make build`

### Task 8: [Final] Update documentation

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `docs/chrome-web-store-info.md`
- Modify: `docs/state-reference.md`
- Modify: `docs/changelog.md`
- Modify: `src/data/changelog.ts`

- [ ] README "Page agent (experimental)": questions and markdown answers, `read_page_text`, `show_popup`,
  **Show on page**, the open popup collects later answers, ✕ ends it, reload or navigation removes it;
  reword the intro ("Ask an AI model to change how the current page looks") and the bullet "The agent
  writes CSS only, never JavaScript" (it now also shows a popup the extension builds); the `scripting`
  permission row mentions reading page text and showing the popup
- [ ] PRIVACY.md: page text (up to 30 000 characters of the main content) goes to the AI endpoint, not
  only the outline; earlier answers go with follow-ups; answers are shown in a popup inside the page;
  reword "changes the page only with CSS the extension inserts into that tab";
  `docs/chrome-web-store-info.md` `scripting` justification likewise
- [ ] `docs/state-reference.md` `pageAgentChat:${tabId}`: `'answered'` status, `summary` holds the full
  answer for answered turns; the popup keeps no storage (lives in the page)
- [ ] `docs/changelog.md` Latest Version entry; in `src/data/changelog.ts` extend the unreleased
  `'1.0.352'` page agent line (it can also answer questions about the page and show answers in a popup)
  instead of adding a separate line
- [ ] update CLAUDE.md only if a new pattern came up
- [ ] run `make lint && make test && make build`
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Manual checks in Chrome with a real model*

- "summary page" on an article: answered turn with rendered markdown; **Show on page** opens the popup
  top right; "explain <term>" appends under its question and scrolls; ✕, then another question: chat
  only
- "show a summary of this page in a popup": the popup replaces the old one, the chat shows the same
  answer, no duplicate entry
- a style request still sets conditions and reports; it doesn't touch an open popup
- start a question on tab A, switch to tab B: the popup appears on A only
- a page with strong CSS (dark site, `* { … !important }`) and a strict CSP: the popup looks the same
- reload and SPA navigation (YouTube next video) remove the popup

Known limitations:

- after an extension reload, a popup already on a page loses its ✕ and can't be appended to until the
  page reloads (its isolated world is gone)
- follow-up history grows with every answered turn (≤ 4 000 characters each); no total cap
- markdown tables and bare URLs show as text
- the agent's own CSS and auto-applied saved styles are inserted with origin `USER`, whose `!important`
  beats the popup host's inline styles, so a rule like `* { … !important }` or `html { filter: … }`
  can reach the popup host; a style run's screenshot shows an open popup over the page
