# Page agent chat (experimental POC) - design

Status: design, not approved yet. Lives only on the local branch `experimental/page-agent`
(worktree `.worktrees/page-agent`). No GitHub issue.

## Intent

A chat in the side panel where the user asks an AI agent to change the current page, and the agent
does it in a loop: looks at the page, writes CSS, applies it, checks the result, fixes it, and reports.

It is a proof of concept. The user rarely restyles sites; the real target is a later agent that acts
on pages (fills forms, runs page routines). Changing appearance with CSS is the first, low-risk step
that proves the pieces such an agent needs: the model sees the page structure, its actions run in the
tab, it checks its own result, and the user sees and can undo what happened.

## Goals

- Chat per tab in a bottom drawer of the side panel.
- An agent loop built on tool calls (not parsing free text), so later tools (click, fill, ...) plug
  into the same loop.
- The agent turns the request into measurable conditions first, checks them with real numbers after
  each change, and reports per condition whether it was met.
- Screenshots as an extra check when the model accepts images; computed styles and sizes always.
- Undo of everything the agent applied in the chat.

## Non-goals (POC)

- Running model-written JavaScript. CSS only (`chrome.scripting.insertCSS`). JS needs
  `chrome.userScripts` / a `<script>` tag (blocked by many CSPs) / `chrome.debugger`; not now.
- Tools that act on the page (click, type, fill forms, scroll). Next step after the POC.
- Keeping changes per site across reloads or visits (Stylus / Arc Boosts style).
- An "Experimental" switch in Settings. The branch is the experiment.
- ~~Responses API tool calling (see Model and API).~~ Overturned by the user after the first real run:
  the agent follows the AI protocol setting (see Deviations in `20261101-page-agent-chat.md`).

## Anti-goals

- The agent claims success while the result only roughly matches the request (player wider but not
  full width, aspect ratio broken, something nearby broken). Accuracy is checked with numbers and every
  unmet condition is reported as unmet.
- CSS from the model loads anything from the network.
- Changes land on a tab other than the one the chat belongs to.

## Demo scenario (acceptance)

On the user's own site: `https://personal.rashpile.net/videos/u/569f9c21-6b5f-4817-aae2-9df09f28a241`
(behind a login): a YouTube iframe inside a content column with a `max-width` (~1260px), a narrow icon
rail on the left, playback buttons and toggles under the video. Model: OpenAI, with images.

The builder can't open the page, so the steps below are the user's manual acceptance check in their
logged-in browser. For development, the builder makes a local fixture page that reproduces the layout
(icon rail, `max-width` column, 16:9 YouTube-like iframe, a button row and toggles below) in two
variants *(my call)*: plain CSS sizing, and a variant whose JS writes inline `width`/`height` on the
iframe on load and on window resize. How the real page embeds the player (plain iframe or IFrame API,
JS sizing or not) is unknown; the two variants cover both, so the `USER` vs `AUTHOR` origin choice holds
either way.

1. Open the drawer, type "make the video player full page width".
2. The agent reads the page outline (and a screenshot if images are on), shows conditions, e.g.:
   iframe width = content area width (±2px); aspect ratio 16:9 (±1%); controls under the video visible
   and not overlapped.
3. It applies CSS, inspects: the column capped the width. It widens the container, inspects again.
4. Report: all conditions met, with numbers ("iframe 1738px, content area 1740px, 16:9").
   "Full page width" means the content area from the icon rail's right edge to the window's right
   edge; the rail stays (assumption the user didn't contradict).
5. Second message in the same chat: "fit it into the screen height". The agent edits its current CSS.
   Pass *(my call)*: the video's bottom edge is within the viewport height, aspect ratio still 16:9,
   width shrinks accordingly, video centred horizontally in the content area. The report says that the
   earlier "full content width" condition was replaced, not that it failed.
6. Undo restores the original page.

## Decided with the user

- CSS first; agent tools for page actions later.
- Agent loop: apply, check, fix itself.
- Check by computed styles always, plus screenshots when the model accepts images.
- Conditions-first, measured, per-condition report (proposal accepted).
- UI: bottom drawer (mockup option B), not a full-panel mode.
- Each tab has its own chat; the drawer switches with the active tab.
- Build in an experimental worktree; the task lives in this local file, not on GitHub.

## Design

Items marked *(my call)* were decided by the designer, not the user.

### UI

- A toolbar button (`Sparkles`) opens/closes the drawer at the bottom of the side panel, over the tab
  list. Favorites, bookmarks and tabs stay usable above it. The drawer sits above the SpaceBar, which
  stays visible *(my call)*.
- Drag handle to resize; height kept in `chrome.storage.local` (`pageAgentDrawerHeight`) via
  `useChromeLocalStorage` *(my call)*.
- A chip above the messages names the tab the chat belongs to (host + path).
- Compact by default: conditions with final numbers, then "N steps · show steps". Expanded: every tool
  call, the applied CSS, screenshots.
- The report block is colored by outcome and has **Undo** and **Show CSS** (current stylesheet, to copy
  into the user's own site).
- While the agent runs, the send button becomes **Stop** (aborts the request and ends the run)
  *(my call)*.
- Input disabled, with the reason, on tabs the extension can't script (`chrome://`, Chrome Web Store,
  PDF viewer, other extensions) and when page access isn't granted; the latter shows a **Grant page
  access** button that requests the `http://*/*`, `https://*/*` optional origins (same as Settings).

### Chat per tab, lifecycle

- One chat per tab id. Switching tabs shows that tab's chat (empty if none).
- Stored in `chrome.storage.session`, one key per tab: `pageAgentChat:<tabId>` *(my call)*. Survives
  side panel close/reopen and worker restarts; gone on browser restart, which matches tab ids being valid
  only within a browser session. Deleted when the tab closes.
- Writer: the side panel of the window that holds the tab (one writer per key). A tab dragged to another
  window mid-chat is a known limitation.
- A run keeps going on its own tab when the user switches tabs: inspect works on background tabs;
  screenshots don't (Chrome captures only the active tab), so the run continues on numbers and logs that
  *(my call)*.
- Reload or navigation to another URL drops CSS inserted with `insertCSS`. The chat stays and shows
  "Page reloaded, changes removed" with **Re-apply** when the URL is the same *(my call)*. Same-document
  (SPA) navigation keeps the CSS; nothing to do.
- A follow-up message is sent with the chat history and the current stylesheet, so "a bit narrower"
  edits the current result.
- Conditions per message *(my call)*: each user message starts a fresh `set_conditions` list. The agent
  carries over earlier conditions that still apply and lists the ones the new request replaces
  (`replaced: [...]` with a short reason), so the report shows them as replaced, not failed.
  `apply_css` is refused in a follow-up until that message's conditions are set.
- The run lives in the side panel's JS context. Closing the side panel mid-run ends the run; the chat
  records it as stopped *(my call; known limitation)*.

### Agent loop and tools

The loop is a plain class with the model client and a page adapter (scripting, tabs, capture) passed in,
so Node tests can drive it with fakes. The tab id is fixed when the run starts and every tool call
targets it.

Tools (OpenAI function tools):

| Tool | Does | Returns |
|---|---|---|
| `get_page_outline` | injected function walks the DOM | viewport size, URL, title, a tree of visible landmark / large elements (see Page outline) |
| `set_conditions` | records the measurable conditions; required before the first `apply_css` | ok |
| `apply_css` | takes the **complete** stylesheet for this tab; sanitizes it, removes the previous one, inserts the new one | ok, or the sanitizer's rejection reason |
| `inspect` | for given selectors: match count and, for the first 3 matches, tag/id/classes, rect, computed `display`, `visibility`, `position`, `width`, `max-width`, `height`, `font-size`, `color`, `background-color`, `overflow`; page-level horizontal overflow (`scrollWidth > clientWidth`) | JSON |
| `screenshot` | only when images are on; captures the tab if it is the active tab of its window | "attached" (image follows in a user message) or "not visible, use inspect" |
| `report` | ends the run: per condition `met` + measured value, and a summary | ends the loop |

- System prompt: start with `get_page_outline` (and `screenshot` if available), then `set_conditions`,
  then apply/inspect until the conditions hold, then `report`. Exact wording left to the builder.
- Step limit: 8 tool rounds per user message *(my call)*. Hitting the limit, or the model answering
  without `report`, ends the run as not met, with whatever conditions are known.
- Whole stylesheet per `apply_css` keeps state simple: Undo = remove the current stylesheet; Show CSS =
  the current stylesheet; Re-apply = insert it again.

### Page outline

Injected function, output capped (~12k characters) *(thresholds my call, tune in the builder)*:
- elements that are landmarks (`header`, `nav`, `aside`, `main`, `footer`, `[role]`, `iframe`, `video`)
  or cover at least ~2% of the viewport;
- per node: tag, id, up to 3 classes, role, rect, first ~40 characters of own text, a suggested selector
  (id, else a short tag.class path);
- depth limit ~12, node limit ~250. Cross-origin iframes appear as boxes; their content isn't read.

### Verification

- Numbers always: `inspect` after each change.
- Screenshot when "Model accepts images" is on: `chrome.tabs.captureVisibleTab` (JPEG), downscaled to
  max 1280px wide in the side panel (`createImageBitmap` + `OffscreenCanvas`) *(my call)*.
- Chat Completions tool messages carry text only, so a screenshot goes into a user message right after
  the tool result.
- Only the latest screenshot is kept in what is sent to the model; older ones become
  "[screenshot omitted]" to bound tokens *(my call)*.
- Viewport only: nothing below the fold is seen; no scrolling in the POC.

### Model and API

- Reuses the AI Rename settings (Base URL, API key, model, reasoning effort) and their URL helpers
  (`parseSafeHttpUrl`, `normalizeAiEndpoint` in `src/utils/aiConfig.ts`). No separate agent settings.
- New setting **Model accepts images** (checkbox in the AI section, field `acceptsImages` in
  `AiRenameSettings`, default `false`, defaulted in `parseAiRenameSettings`) *(my call)*. If the API
  still rejects an image, the run continues without screenshots and says so.
- (Overturned: the agent now follows the protocol setting, see Deviations in
  `20261101-page-agent-chat.md`.) POC uses Chat Completions tool calling (`tools`, `tool_calls`, `role: "tool"`) regardless of the
  protocol setting *(my call)*: widest support across OpenAI-compatible providers (OpenAI, OpenRouter,
  Ollama, LM Studio). The model must support function calling; if it doesn't, show the API error.
  The demo runs on OpenAI (user's answer), which supports tool calling and images in Chat Completions.
- Output limit large enough for CSS (e.g. 4k tokens) instead of AI Rename's 100; request timeout as in
  AI Rename or longer.
- Issue #48 (HTTPS required for non-local Base URLs) isn't on `main` yet; the agent gets it through
  `parseSafeHttpUrl` once merged.

### Applying CSS

- `chrome.scripting.insertCSS({ target: { tabId }, css, origin })`, top frame only; `removeCSS` with the
  same arguments to undo.
- Origin: suggest `USER` with `!important` declarations, which beat author `!important` and inline styles
  in the cascade; this helps when the site's own JS writes inline sizes. Builder verifies on both
  fixture variants and picks; the user confirms on the real page.
- Sanitizer before insert *(my call)*: reject `@import`, any `url(` that isn't `data:`, `image-set(` with
  remote URLs, `expression(`, `behavior:`, `-moz-binding`; cap size (~20 KB). The rejection reason goes
  back to the model as the tool result. Reason: page text reaches the model, so a prompt-injected page
  could make it write CSS that loads remote URLs (attribute-selector tricks can leak input values).

### Permissions

- `scripting` and the optional `http://*/*`, `https://*/*` origins already exist.
- `captureVisibleTab` needs `<all_urls>` or `activeTab` per Chrome docs; whether the optional http/https
  origins are enough is unverified. Builder checks first; if not, add `<all_urls>` to
  `optional_host_permissions` and request it with the page access.

## Constraints (repo rules)

- `CLAUDE.md`: Allman braces, classes over raw structures, comments say why, debug logs only under
  `import.meta.env.DEV`, few dependencies (none needed here), one writer per storage key.
- Modules imported by tests: `.ts` sibling imports, chrome/clock APIs passed in, no `import.meta.env`,
  no enums / parameter properties / namespaces.
- New storage keys in `docs/state-reference.md`.

## Tests

Only decisions that act on the wrong tab or let unsafe CSS through:
- a run started on tab A keeps targeting tab A for every tool call after the user switches to tab B
  (fake page adapter records target tab ids);
- sanitizer: remote `url(`, `@import`, `image-set` with remote URLs rejected; `data:` URLs and plain
  declarations accepted;
- loop termination: ends on `report`; at the step limit; on an answer without `report` (as not met);
  `apply_css` before `set_conditions` is refused.

## Left to the builder

- System prompt wording, tool JSON schemas, outline heuristics and caps.
- Component split (drawer, message list, step log), icon details, default drawer height.
- Token limits and timeouts.
- `USER` vs `AUTHOR` origin after trying both fixture variants.
- Where the fixture page lives (e.g. `tests/fixtures/`, not shipped in `dist/`).

## Known limitations

- Screenshots cover the viewport only; no scrolling.
- Closing the side panel stops a running agent.
- Cross-origin iframe content can't be styled; only the iframe box.
- Site JS can fight the CSS; SPA re-renders can break selectors.
- A tab moved to another window mid-chat.
- Page outline and screenshots go to the configured provider; fine for the POC on the user's own site.

## Docs (on the branch)

`README.md` section "Page agent (experimental)", `docs/state-reference.md` for `pageAgentChat:<tabId>`
and `pageAgentDrawerHeight`, `PRIVACY.md` note that the page outline and screenshots go to the configured
endpoint.
