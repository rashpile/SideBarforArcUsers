# AI Rename: same-origin derived fetches and HTTPS Base URL (#48)

## Overview
- **Derived fetches.** `PageContentReader.read()` fetches the page's Markdown alternate link and a page link found in `llms.txt` with no origin check and with `redirect: 'follow'`. With page access granted (`http://*/*`, `https://*/*`) extension fetches bypass CORS, so a page the user pins or bookmarks can make the extension GET `http://192.168.1.1/...` or `http://localhost:8080/...` and put up to 12,000 characters of the answer into the prompt for the AI provider.
  - Fix: fetch those two URLs only when they are `http:`/`https:` on the same origin as the pin/bookmark URL (`input.url`), with `redirect: 'manual'`; a redirect is a miss. Otherwise fall back to the cleaned page text, as when the link is missing.
  - The page URL itself and the `llms.txt` candidates (built from the page's own origin) stay as they are.
- **HTTPS Base URL.** `parseSafeHttpUrl` accepts `http:` for any host, so with a remote `http://` Base URL the `Authorization: Bearer <key>` header and the page text travel unencrypted.
  - Fix: `http:` only for loopback hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`), otherwise the error `Base URL must use HTTPS (HTTP is allowed only for localhost)`. A stored remote `http://` Base URL fails on the next Validate or rename with that error; no silent rewrite.

## Context (from discovery)
- `src/services/aiRenameService.ts` (touches `chrome.scripting` and `window`, not loadable by Node tests):
  - `read()` ~line 80: `snapshot.markdownUrl` fetched through `#fetchText`;
  - ~lines 96-111: `llms.txt` candidates fetched in parallel, then `#findMatchingPageLink(llmsText, input.url, llmsUrl)` returns any link resolved against the `llms.txt` URL;
  - `#readLiveTab`: `markdownLink?.href` from the live page (resolved by the page itself, correct);
  - `#readUrl` (Markdown link at ~line 181): `new URL(markdownLink.href, url)` on a `DOMParser` document. Such a document's URL is the extension page's, so `link.href` of a relative link is `chrome-extension://<id>/...` and the base `url` is ignored;
  - `#fetchText` ~line 214: `credentials: 'omit'`, `redirect: 'follow'`, `!response.ok` throws, body sliced to 12,000.
- `src/utils/aiConfig.ts`: no imports, no `chrome.*`; holds `parseSafeHttpUrl` (~line 143), used by `normalizeAiEndpoint`, `resolveAiEndpointCandidates` and `getHostPermissionPattern`; `buildLlmsTxtCandidates` (~line 362).
- `getHostPermissionPattern` runs first in Settings Validate (`src/components/SettingsDialog.tsx` ~line 141, shows `error.message` in the validation line) and in every rename (`src/App.tsx` `hasApiAccess` ~line 1154, inside the `try` whose `catch` toasts the message; automatic renames toast "Automatic AI rename failed: …"). The new error therefore reaches the user with no UI code change.
- Settings › AI Base URL hint (`SettingsDialog.tsx` ~line 522): "Accepts a service root, /v1 base, or a complete /responses or /chat/completions URL."
- No `aiConfig` tests exist yet. Test style: `tests/*.test.mjs`, `node:test` + `node:assert/strict`, imports with `.ts` extension.
- Docs: `README.md` Settings list line "**AI naming**: …" (~line 175); `PRIVACY.md` AI Naming section (~line 33); `docs/changelog.md` "Latest Version".

## Development Approach
- **testing approach**: Regular (code first, then tests)
- Tests only for the decisions (CLAUDE.md "Test decisions, not coverage"): which derived URLs may be fetched, which `llms.txt` link is picked, which Base URLs may use HTTP. No tests for the service wiring or wording.
- Allman braces, comments say why, English comments.
- `make lint && make test && make build` must pass after each task.

## Testing Strategy
- unit tests in a new `tests/aiConfig.test.mjs` importing `../src/utils/aiConfig.ts`.
- no e2e tests in this project.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix

## Solution Overview
- Pure helpers in `aiConfig.ts` carry the decisions; `aiRenameService.ts` only wires them in.
- Derived URLs use `redirect: 'manual'`. The alternative (follow, then compare `response.url`'s origin) would still send the GET to the other origin, which is what the fix must stop. A same-origin redirect of a Markdown link is lost as well; it is rare and falls back to the page text.
- `#findMatchingPageLink` moves to `aiConfig.ts` as `findMatchingLlmsLink`, so the `llms.txt` decision is testable in Node. A cross-origin candidate is skipped and the loop goes on, so a cross-origin match listed first does not hide a later same-origin one.
- `#readUrl` reads the Markdown link with `getAttribute('href')` and resolves it against the page URL, so relative links pass the origin check instead of turning into `chrome-extension://` URLs.

## Technical Details
- `isSameOriginHttpUrl(url: string, pageUrl: string): boolean`
  - `new URL(url)` and `new URL(pageUrl)` without a base; a parse error → `false` (a relative string is not accepted: callers pass resolved URLs);
  - both protocols must be `http:` or `https:`, checked explicitly: every `file:` URL has origin `"null"`, so comparing origins alone would accept a `file:` link on a `file:` page;
  - then `link.origin === page.origin` (scheme, host, port).
- `findMatchingLlmsLink(llmsText: string, pageUrl: string, llmsUrl: string): string | undefined`
  - same matching rules as today: links from `[text](href)`, resolved against `llmsUrl`; path without trailing `/` and `.html`/`.htm`/`.md` equals the page's, or ends with `/<page's last segment>`;
  - a candidate that fails `isSameOriginHttpUrl(candidate, pageUrl)` is skipped; invalid links are skipped as today.
- `parseSafeHttpUrl`, after the existing `http:`/`https:` check and before the credentials check:
  - `url.protocol === 'http:' && !isLoopbackHost(url.hostname)` → `throw new Error('Base URL must use HTTPS (HTTP is allowed only for localhost)')`;
  - `isLoopbackHost(hostname)` (not exported): `hostname === 'localhost'`, `hostname.endsWith('.localhost')`, `/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/` (the URL parser rewrites every IPv4 form such as `127.1` or `0x7f.0.0.1` to dotted decimal, and `127.0.0.1.example.com` is a domain that fails the regex), `hostname === '[::1]'`.
  - `[known-limitation]` `0.0.0.0`, `localhost.` (trailing dot) and `[::ffff:127.0.0.1]` are rejected; `localhost` or `127.0.0.1` work for the same server.
- `[known-limitation]` the origin comes from the stored pin/bookmark URL (`input.url`). A saved URL that redirects to another origin (`http://` → `https://`, `example.com` → `www.example.com`) loses its Markdown / `llms.txt` page link and uses the page text; re-saving the final URL fixes it.
- `[known-limitation]` in `#readUrl` a document-relative Markdown href is resolved against `input.url`, not the URL after the page fetch's redirects, and `<base href>` is ignored; after a path-changing redirect it can point to another page of the same origin.
- `PageContentReader`:
  - `read()`: `snapshot.markdownUrl && isSameOriginHttpUrl(snapshot.markdownUrl, input.url) ? await this.#fetchText(snapshot.markdownUrl, 'manual').catch(() => undefined) : undefined`;
  - `llms.txt` link: `findMatchingLlmsLink(llmsResult.text, input.url, llmsResult.llmsUrl)`, fetched with `'manual'`;
  - `#fetchText(url: string, redirect: RequestRedirect = 'follow')`: with `'manual'` a redirect comes back as an `opaqueredirect` response with status 0, `!response.ok` throws, the caller's `.catch` turns it into a miss;
  - `#readUrl` and the `llms.txt` candidates keep the default `'follow'`;
  - `#readUrl`: `markdownLink?.getAttribute('href')` resolved with `new URL(href, url)` in a `try`/`catch`; a missing, empty (`''` would resolve to the page URL itself and feed its HTML in as Markdown) or invalid href → `markdownUrl: undefined` (must not make `#readUrl` throw).
- No new storage keys, no settings migration.

## Out of scope
- Redirects of the API POST itself (Chrome drops `Authorization` on cross-origin redirects).
- Redirects of the page fetch (`#readUrl(input.url)`) and of the `llms.txt` candidate fetches: they keep `'follow'` as the issue says, so a server-side redirect there can still reach another host (`[known-limitation]`).
- Migrating stored settings: no silent rewrite of `http://` to `https://`.

## What Goes Where
- Implementation Steps: code, tests and docs in this repo.
- Post-Completion: manual checks in the browser.

## Implementation Steps

### Task 1: Same-origin check and `llms.txt` link matching in `aiConfig.ts`

**Files:**
- Modify: `src/utils/aiConfig.ts`
- Create: `tests/aiConfig.test.mjs`

- [x] add exported `isSameOriginHttpUrl(url, pageUrl)` to `src/utils/aiConfig.ts` per Technical Details, with a short doc comment saying why (a page must not choose where the extension sends requests; `file:` origins are all `"null"`)
- [x] add exported `findMatchingLlmsLink(llmsText, pageUrl, llmsUrl)` to `src/utils/aiConfig.ts`: the body of `PageContentReader#findMatchingPageLink`, plus skipping candidates that fail `isSameOriginHttpUrl(candidate, pageUrl)` and continuing the loop
- [x] test `isSameOriginHttpUrl`: same origin accepted for https and http with different paths/queries; rejected for another host, another port (`https://a.test` vs `https://a.test:8443`), another scheme (`http://a.test` vs `https://a.test`), `javascript:alert(1)`, `data:text/markdown,x`, `file:///etc/passwd` on an https page, a `file:` link on a `file:` page, a relative string (`/page.md`) and an invalid string; an invalid page URL → `false`
- [x] test `findMatchingLlmsLink`: a relative and an absolute same-origin matching link are returned resolved; a matching link on another host, on `localhost` or on another port is skipped (`undefined`); a cross-origin match listed before a same-origin match returns the same-origin one; a non-matching same-origin link → `undefined`
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: HTTPS required for non-loopback Base URLs

**Files:**
- Modify: `src/utils/aiConfig.ts`
- Modify: `tests/aiConfig.test.mjs`
- Modify: `src/components/SettingsDialog.tsx`

- [x] add module-private `isLoopbackHost(hostname)` and the `http:` rule to `parseSafeHttpUrl` per Technical Details; update its doc comment (why: the key and page text must not cross the network unencrypted; local Ollama / LM Studio need HTTP)
- [x] Settings › AI Base URL hint in `SettingsDialog.tsx`: add that HTTPS is required and HTTP is allowed only for localhost
- [x] test `parseSafeHttpUrl`: `https` accepted for a public host and for a LAN IP; `http` accepted for `localhost`, `localhost:11434`, `ollama.localhost`, `127.0.0.1`, `127.1.2.3`, `[::1]`; `http` rejected with exactly `Base URL must use HTTPS (HTTP is allowed only for localhost)` for `api.example.com`, `192.168.1.1`, `10.0.0.1`, `0.0.0.0`, `localhost.example.com`, `127.0.0.1.example.com`; `ftp://localhost` still gets `Base URL must use HTTP or HTTPS`
- [x] test that `getHostPermissionPattern('http://192.168.1.1:8080/v1')` throws the HTTPS error (the check every Validate and rename runs first) and `getHostPermissionPattern('http://localhost:11434/v1')` returns `http://localhost:11434/*`
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Wire the origin gate and no-redirect fetch into `PageContentReader`

**Files:**
- Modify: `src/services/aiRenameService.ts`

- [x] `#fetchText(url, redirect: RequestRedirect = 'follow')`; pass `redirect` to `fetch`; comment why derived URLs use `'manual'` (a redirect would choose another origin; following and checking afterwards still sends the request)
- [x] `read()`: fetch `snapshot.markdownUrl` only when `isSameOriginHttpUrl(snapshot.markdownUrl, input.url)`, with `'manual'`; otherwise behave as when the link is missing
- [x] `read()`: use `findMatchingLlmsLink(llmsResult.text, input.url, llmsResult.llmsUrl)` and fetch the result with `'manual'`; delete `#findMatchingPageLink`
- [x] `#readUrl`: resolve `markdownLink?.getAttribute('href')` against `url` in a `try`/`catch` (missing, empty or invalid → `undefined`); comment why (`DOMParser` documents resolve `href` against the extension page)
- [x] keep `#readUrl(input.url)` and the `llms.txt` candidate fetches on `'follow'`
- [x] no new tests: the decisions are covered in tasks 1-2; this task is wiring (CLAUDE.md)
- [x] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria
- [x] verify both parts of the Overview are implemented: Markdown link and `llms.txt` link gated by origin and fetched without redirects; page URL and `llms.txt` candidates unchanged; `http:` Base URL only for loopback with the exact error text, no rewrite of stored settings
- [x] verify `#readUrl` cannot throw on an invalid Markdown href and ignores an empty one
- [x] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation
- [ ] `README.md`: in the Settings list's **AI naming** line, add that the endpoint must use HTTPS (HTTP only for localhost, e.g. Ollama or LM Studio) and that a page's Markdown version and `llms.txt` page links are read only from the page's own site
- [ ] `PRIVACY.md` AI Naming: "It may also fetch the page, its Markdown version and the site's `llms.txt` without cookies; the Markdown version and pages listed in `llms.txt` only from the page's own site, without following redirects." Add that the endpoint must use HTTPS unless it runs on this computer
- [ ] `docs/changelog.md`, top of Latest Version: a `Fixed:` line for derived fetches (same origin, no redirects; relative Markdown links of bookmarks read without a tab now resolve against the page) and a `Changed:` line for the HTTPS requirement (a saved remote `http://` Base URL now fails Validate and rename with the new error)
- [ ] no `src/data/changelog.ts` entry (a fix, not a feature) and no `docs/state-reference.md` change (no new keys)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
**Manual verification**:
- Settings › AI: `http://api.example.com/v1` → Validate shows "Base URL must use HTTPS (HTTP is allowed only for localhost)"; `http://localhost:11434/v1` (Ollama) validates; `https://api.openai.com/v1` validates
- a stored remote `http://` Base URL: AI rename from a pin's menu toasts the HTTPS error
- a page whose `<link rel="alternate" type="text/markdown">` points to another host: the rename uses the page text (DevTools Network of the side panel shows no request to that host)
- a page with a same-origin relative Markdown link, renamed as a bookmark without an open tab: the Markdown version is fetched from the page's origin
