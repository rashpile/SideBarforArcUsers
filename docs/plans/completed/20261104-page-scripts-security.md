# Page scripts: security review fixes

## Overview

Security review of the page agent's JavaScript (`docs/plans/completed/20261104-page-agent-scripts.md`)
with prompt injection in mind. The page agent has host access to every http(s) site, and a script can
navigate the tab, so an answer the user gives on one site must not let scripts run unseen on another.
The approval stays once per request (the user's choice in the review), now bound to the site it was
asked on.

## Findings and changes

- [x] **Approval bound to the site.** `PageAgentRun` reads the tab's origin before the first script and
  asks `onScriptApproval({ kind, code, origin })`; every later script, and the first one after the user
  answers, checks the tab's origin again. On another site (a script navigated the tab, or the user went
  there while the card waited) the script is refused without asking for the rest of the request; on a
  page that isn't http(s) it is refused before the approval. Tests in `tests/pageAgentRun.test.mjs`.
- [x] **Apply saved only on the saved site.** `PageAgentChats.applySaved` rejects when the tab's page isn't
  on the saved style's origin (a bookmark's tab can wander to other sites); the strip's Apply is off there
  with "Saved for <site>". The background applier already checked `appliesTo`.
- [x] **Re-apply only on the same site.** `PageAgentChats.reapply` rejects on another origin than
  `appliedUrl`; before, only the hidden button guarded it.
- [x] **Approval card** names the site and says that Allow runs the request's other scripts on it
  without showing them, and what to deny.
- [x] **Warning when turning Page scripts on** (`PageScriptsWarning`): Chrome grants `userScripts`
  without a prompt, so ticking the switch shows the risks first; Turn on requests the permission.
- [x] **Save** hints that a saved script runs on every load without asking.
- [x] **Prompt**: a script must not navigate, open windows or frames, submit forms or send page data
  unless the request asks for exactly that.
- [x] **Docs** no longer present the world CSP as a barrier: it blocks the script's own fetch / XHR to
  other sites; navigation, windows, frames, forms and styles set on page elements are not covered.

Verified as fine, no change: the USER_SCRIPT world has no `messaging`, so a script can't reach
`chrome.runtime` (save itself, change settings); the extension's injected functions forward nothing from
the page; `unsafe-eval` exists only in the extension's world; the origin written into the CSP is checked
by `CSP_SAFE_ORIGIN`; the card shows code as React text; markdown answers load no images.

## Known limitations

- [known-limitation] Same-site prompt injection after Allow: the agent reads the page between scripts,
  and later scripts of the request run on that site without being shown first. The warning, the card
  and the README say so; the user can Stop.
- [known-limitation] The origin is checked a few milliseconds before `userScripts.execute`; a navigation
  that commits in between runs the script on the new page.
- [known-limitation] The card shows the code as text; invisible or bidi control characters could make
  it read differently from what runs.
- [known-limitation] Whether the world CSP covers loads started through styles set on page elements
  (`el.style.backgroundImage = 'url(…)'`) is not verified; the docs don't claim it.
