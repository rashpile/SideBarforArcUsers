# Tools

## update-version.sh

- Updates version in `package.json` and `manifest.json`. Version format: `{major}.{minor}.{build_number}` where build_number is the git commit count of source-code-only commits. 

## build-release.sh

Builds the extension and packages the contents of `dist/` as `releases/sidebar-for-arc-users-{version}.zip`, with `manifest.json` at the zip root. The Release workflow (`.github/workflows/release.yml`) runs it through `make release` and attaches the zip to the GitHub release. The same zip works for Chrome Web Store submission.

## create-release-tag.sh

Creates a local git tag with format `release-{version}` from `package.json`. With `--push` it also pushes the tag, which starts the Release workflow: it checks the tag against the version in `public/manifest.json`, runs lint and tests, builds the zip and publishes a GitHub release with it. Commit and push the version bump before tagging.

## start-test-chrome.sh

Launches Chrome with a fresh test profile. Useful for testing the extension in isolation.

## screenshot/

`make screenshot` retakes `asset/sidebar.png`, the README image. `take.mjs` loads `dist/` into a fresh headless Chromium profile, seeds the Spaces, bookmarks, Favorites and tabs from `fake-data.mjs`, and screenshots the sidebar in light and dark mode. Headless Chromium has no Side Panel, so the sidebar opens in a popup window pointed at the window with the fake tabs.

## prepare-release-instructions.md

Step-by-step instructions for Claude to follow when preparing a release — version bump, changelog generation, link updates, and verification.
