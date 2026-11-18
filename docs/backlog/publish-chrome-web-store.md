# Publish to the Chrome Web Store

Status: backlog. Needs a plan in `docs/plans/` before work starts.

## Why

- **Auto-updates.** Today an update means unzipping a release into the same folder and pressing reload; Remove instead of reload wipes the extension's storage (`README.md`, Install).
- **A fixed extension ID.** An unpacked build's ID comes from its folder path, so moving the folder installs a second copy with empty storage, and note links (`chrome-extension://<id>/...`) in synced bookmarks don't open on another computer.
- **Users.** One-click install without Developer mode, search in the store, ratings and reviews, install statistics in the developer dashboard.
- A store build and an unpacked dev build have different IDs, so both can be installed side by side for testing.

## Approach

Publish a build **without the page agent**. Without it the store build needs no host permissions, `webNavigation` or `userScripts`, so the review has much less to object to.

| Permission | Used by | Store build |
|---|---|---|
| `webNavigation` | auto-apply of saved page styles | drop |
| optional `userScripts` | Page scripts plugin | drop |
| optional `http://*/*`, `https://*/*`, `<all_urls>` | page agent, AI endpoint, screenshots | drop |
| `scripting`, `activeTab` | Tab / Space Switcher overlay, search popup (and the agent) | keep |
| the rest (`sidePanel`, `bookmarks`, `tabs`, `tabGroups`, `storage`, `favicon`, `alarms`, `search`) | core features | keep |

The full build with the agent stays on GitHub Releases.

### Stage 1: two builds from one repo

- A build flag (for example `VITE_PAGE_AGENT=false`) that leaves the agent code out of the bundle, and a manifest generated per build.
- Route every use of the agent through one boundary (a `PageAgentHost`-like interface) instead of importing `src/services/pageAgent/` directly. Today about 20 files outside `pageAgent/` reference it: `background.ts`, `App.tsx`, `Toolbar.tsx`, `SettingsDialog.tsx`, `BookmarkTree.tsx`, `PinnedBar.tsx`, `PinnedIcon.tsx`, `PageStyleMenu.tsx`, `NotePage.tsx`, the page-style manager / proxy / store, `deleteBookmarkAction.ts`, `deletePinnedSiteAction.ts` and others.
- In the store build, Settings > AI, the agent drawer and the page-style menu items are hidden. Saved page styles in storage are left alone.

### Stage 2 (optional, later): agent as a companion extension

If store users want the agent, move it into a separate extension that holds the page permissions. The main extension exposes a narrow API through `chrome.runtime.onMessageExternal`, limited to the companion's ID with `externally_connectable.ids`, so the companion can ask things like which bookmark a tab is linked to. The agent UI is the companion's page in an iframe in the side panel (`web_accessible_resources` with `extension_ids`).

A "plugin" that loads code into the main extension is not an option: Manifest V3 forbids remotely hosted code, and the only API for user code is `userScripts`, the permission the store build drops.

## Steps

- [ ] Plan in `docs/plans/` for stage 1.
- [ ] Build flag, agent boundary, per-build manifest, `make` targets for both zips.
- [ ] `make lint && make test && make build` pass for both builds; manual check of the store build: no AI UI, Switchers and search popup work.
- [ ] Register a Chrome Web Store developer account.
- [ ] Privacy policy URL: `PRIVACY.md` on GitHub, rewritten for the store build (no page content leaves the browser).
- [ ] Update `docs/chrome-web-store-info.md`: description without the page agent, permission justifications only for what the store build requests.
- [ ] Store assets: 128 px icon, screenshots (1280×800 or 640×400), small promo tile (440×280).
- [ ] First submission as **Unlisted** to go through review without a public listing; switch to Public afterwards.
- [ ] `README.md`: store install as the main way, GitHub release for the build with the page agent, how to move from an unpacked install (Export, then Import, including Notes).
- [ ] `.tasks-loop/workflow.md`: the "No deploy" line in Ship no longer holds; describe the release step.
- [ ] `docs/changelog.md` and a `src/data/changelog.ts` entry.

## Risks and open questions

- **The name.** "Arc" is The Browser Company's trademark. "Side Bar for Arc Users — Arc Style" may draw a trademark or impersonation complaint in review. Decide whether to rename before submitting.
- **Review time.** Every release goes through review, from hours to days. A hotfix can't ship within minutes.
- **Moving from unpacked to the store.** The store ID differs from the unpacked one, so settings, the Spaces list, Favorite icons, marks and note texts move only through Export / Import. Bookmarks stay.
- **Two builds, one user.** Store and GitHub builds have separate storage; a user picks one. Can the GitHub build use the store's public key (`key` in its manifest) so both share an ID?
- **Support.** Public users bring issues and reviews; storage migrations and backward compatibility matter more.
