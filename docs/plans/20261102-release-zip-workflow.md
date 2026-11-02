# Release zip built in GitHub Actions (#57)

## Overview

- Pushing a `release-X.Y.Z` tag runs a GitHub Actions workflow that checks the tag against `public/manifest.json`, runs lint and tests, builds `releases/sidebar-for-arc-users-X.Y.Z.zip` with `make release` and publishes GitHub release `release-X.Y.Z` with the zip attached.
- People who don't want to build from source download that zip, unzip it into a folder they keep and load it with **Load unpacked**.
- The README gets the download path and an update procedure that keeps the folder path, because the manifest has no `key` and Chrome derives an unpacked extension's ID from its folder path.
- Developer docs say that pushing the tag publishes the release, and the Node.js requirement is corrected from 18+ to 22.18+.

## Context (from discovery)

- `tools/build-release.sh` (`make release`): reads the version from `public/manifest.json`, runs `npm run build`, zips the contents of `dist/` into `releases/sidebar-for-arc-users-{version}.zip` (manifest at the zip root).
- `tools/create-release-tag.sh` (`make tag`, `--push` also pushes): tag `release-{version}` from `package.json`.
- `tools/update-version.sh` (`make version`): writes the same version into `package.json` and `public/manifest.json`. Current version 1.0.351; `src/data/changelog.ts` already has a `1.0.352` entry waiting for the bump.
- No `.github/` directory, no tags, no releases. `origin` is `github.com/rashpile/SideBarforArcUsers`.
- `README.md` § Install: "Build it from source (Node.js 18+)", Load unpacked of `dist/`, update with `git pull && make build`.
- `docs/development.md`: § Setup ("Node.js 18+ and npm"), § Make targets table (`make release`, `make tag` rows), § Release (one paragraph).
- `tools/prepare-release-instructions.md` step 7 reminds to run `tools/build-release.sh`; `tools/tools-readme.md` describes each script.
- `docs/state-reference.md`: `spaces` (Space definitions), `favoriteIcons`, `attentionMarkedTabs`, `bookmarkPageStyles` and settings live in `chrome.storage.local` / `localStorage`, so a second unpacked copy starts without them; Space folders, pinned pages, `asd_Favorites` and `asd_Archive` are Chrome bookmarks and stay.
- Latest first-party action majors (gh api, 2026-11-02): `actions/checkout` v7, `actions/setup-node` v7.
- Local tools: no `actionlint`, no PyYAML; `uv` is available for a throwaway `uvx`.

## Development Approach

- **testing approach**: Regular. The change is a workflow file and documentation; there is no code that unit tests could exercise. CLAUDE.md "Test decisions, not coverage": no tests for wording or wiring.
- Verification replaces unit tests: actionlint on the workflow, a local run of the version-check step's script with a matching and a mismatching tag, and `make release` producing the expected zip.
- Complete each task fully before moving to the next; run `make lint && make test && make build` after each task.
- Update this plan file when scope changes during implementation.

## Testing Strategy

- **unit tests**: none (no code changes; see Development Approach).
- **workflow checks**: `uvx --from actionlint-py actionlint .github/workflows/release.yml`; when it can't be fetched (no network or blocked), parse the YAML offline with the system Ruby: `ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/release.yml`.
- **version check**: run the step's `run:` script locally with `TAG=release-<manifest version>` (exit 0, writes `version=<v>` to the file in `GITHUB_OUTPUT`) and `TAG=release-0.0.0` (exit 1, prints the `::error::` line, writes nothing).
- **build**: `make release` creates `releases/sidebar-for-arc-users-<v>.zip`; `unzip -l` shows `manifest.json` at the root.
- **e2e**: none in the project; pushing a real tag is post-completion (user).

## Progress Tracking

- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview

- Trigger: tag push `release-*` (the user's choice over a rolling `latest` pre-release on `main`). Each release has its own version, so What's New works and builds can be told apart.
- One job, steps in order: checkout → setup-node 24 → version check → `npm ci` → `make lint` → `make test` → `make release` → `gh release create`. A failed step stops the job, so a release exists only when everything before it passed.
- No third-party actions: `actions/checkout` and `actions/setup-node` are GitHub's own; the release is made with the `gh` CLI preinstalled on `ubuntu-latest`.
- The tag name is user input: it reaches `run:` scripts only through `env:` (`TAG: ${{ github.ref_name }}`), never as `${{ }}` inside a script.

## Technical Details

### `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'release-*'

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
    steps:
      # The write token is for `gh` only, which gets it through GH_TOKEN; npm ci runs install scripts.
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      # No `cache: npm`: a tag run can restore caches only from its own tag or main, and every
      # release is a new tag with no workflow on main, so the cache would never be hit.
      - uses: actions/setup-node@v7
        with:
          node-version: 24

      # Fails before anything is built when the tag was made before the version bump was committed
      # (`make version` only stages the bump, `make tag` reads the working-tree package.json).
      - name: Check tag version against manifest.json
        id: version
        env:
          TAG: ${{ github.ref_name }}
        run: |
          tag_version="${TAG#release-}"
          manifest_version=$(node -p "require('./public/manifest.json').version")
          if [ "$tag_version" != "$manifest_version" ]; then
            echo "::error::Tag $TAG is version $tag_version, but public/manifest.json has $manifest_version. Commit the version bump, push main, delete the tag (git push origin :refs/tags/$TAG && git tag -d $TAG) and tag again."
            exit 1
          fi
          echo "version=$manifest_version" >> "$GITHUB_OUTPUT"

      - run: npm ci
      - run: make lint
      - run: make test
      - run: make release

      - name: Publish GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.ref_name }}
          VERSION: ${{ steps.version.outputs.version }}
        run: gh release create "$TAG" "releases/sidebar-for-arc-users-$VERSION.zip" --verify-tag --generate-notes
```

- The explicit zip name (not `releases/*.zip`) makes the attached asset exactly the one the acceptance criteria name; a missing file fails the step.
- `--verify-tag` stops `gh` from creating a tag if the ref were missing; `--generate-notes` writes the notes from merged PRs and commits since the previous release.

### README.md § Install (structure)

1. Keep the paragraph "The extension is not in the Chrome Web Store…".
2. `### Download a release`:
   - download `sidebar-for-arc-users-<version>.zip` (not the *Source code* archives GitHub adds to every release) from the [latest release](https://github.com/rashpile/SideBarforArcUsers/releases/latest);
   - unzip it into a folder you keep, e.g. `~/Extensions/SideBarforArcUsers`; most unzip tools (double-click on macOS, Extract All on Windows) make a folder named after the zip, so the version is in its name: rename it to the folder you keep, or unzip from a terminal: `unzip sidebar-for-arc-users-<version>.zip -d ~/Extensions/SideBarforArcUsers`;
   - `chrome://extensions` → **Developer mode** → **Load unpacked** → that folder.
   - To update: delete the files in that folder and unzip the new zip into it (with a double-click unzip: delete the old folder and rename the new one to the old name, in the same place), then press reload on the extension's card in `chrome://extensions`. Update only with reload: **Remove** on the card deletes the extension's storage, even if the same folder is loaded again.
   - Keep the folder path: the manifest has no `key`, so Chrome derives an unpacked extension's ID from its folder path. Loading another folder installs a second copy with its own empty storage: settings (including the AI API key), the Spaces list (names, icons, colours, which bookmark folder each Space uses), Favorite icons, attention marks, Recently Closed lists and saved page styles. Bookmarks stay: Space folders with their pinned pages, Favorites and archive are Chrome bookmarks, so a Space set up again on its old folder gets them back. Switching between a source build (`dist/`) and a download is a folder change too. If a second copy got loaded, remove the new, empty one, not the one with your Spaces.
3. `### Build it from source` (Node.js 22.18 or newer): the existing clone/`make install`/`make build` block, Load unpacked of `dist/`, update with `git pull && make build` and reload.
4. After both: open the sidebar with the extension icon or `Cmd+Shift+E` (`Ctrl+Shift+E` on Windows and Linux).
5. The "Coming from Arc?" paragraph stays where it is.

### Node.js requirement

"Node.js 22.18 or newer": Vite 7 needs `^20.19.0 || >=22.12.0`, and `make test` runs `node --test` on TypeScript through type stripping without a flag, which Node has from 22.18. CI uses Node 24.

## What Goes Where

- **Implementation Steps**: the workflow file, README, developer docs, Makefile help text, changelog.
- **Post-Completion**: pushing a real `release-*` tag after merge, loading the downloaded zip in Chrome, the mismatch check on GitHub.

## Implementation Steps

### Task 1: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [x] create `.github/workflows/release.yml` as in Technical Details (tag trigger `release-*`, job permissions `contents: write`, checkout v7 with `persist-credentials: false`, setup-node v7 with Node 24 and no npm cache, version check before `npm ci`, `npm ci`, `make lint`, `make test`, `make release`, `gh release create` with `--verify-tag --generate-notes` and the explicit zip name)
- [x] the tag reaches every `run:` script only through `env:` (`TAG: ${{ github.ref_name }}`); no `${{ }}` expression inside a `run:` body
- [x] run actionlint on the file (`uvx --from actionlint-py actionlint .github/workflows/release.yml`; if it can't be fetched, parse it offline with `ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/release.yml` and log a `[deviation]`); fix what it reports
  - ⚠️ the `uvx` fetch was denied by the agent's permission classifier, so actionlint did not run; the Ruby parse passed and a Ruby check found no `${{` in any `run:` body
- [x] run the version-check step's script locally from the repo root with `TAG=release-$(node -p "require('./public/manifest.json').version")` and `GITHUB_OUTPUT` pointing to a temp file: exit 0, the file holds `version=<v>`
- [x] run it with `TAG=release-0.0.0`: exit 1, prints the `::error::` line naming both versions and the fix (commit the bump, push `main`, delete the tag locally and on origin, tag again), writes nothing to the output file
- [x] run `make release`: `releases/sidebar-for-arc-users-<v>.zip` exists and `unzip -l` lists `manifest.json` at its root (`releases/` is gitignored; commit nothing from it)
- [x] run `make lint && make test && make build` - must pass before task 2

### Task 2: README download and update instructions

**Files:**
- Modify: `README.md`

- [x] restructure § Install as in Technical Details: keep the Web Store paragraph, add `### Download a release` before `### Build it from source`
- [x] Download a release: link to `https://github.com/rashpile/SideBarforArcUsers/releases/latest`, the zip name (not the *Source code* archives), unzip into a folder you keep (most unzip tools make a folder named after the zip, with the version in it; rename it or use `unzip … -d <folder>`), Load unpacked of that folder
- [x] updating a download: delete the folder's files and unzip the new zip into it (double-click form: delete the old folder, rename the new one to the old name in the same place), reload; update only with reload, since Remove deletes the extension's storage; why the path must stay (no `key`, ID from the folder path), what a second copy loses (settings including the AI API key, the Spaces list, Favorite icons, attention marks, Recently Closed lists, saved page styles) and what stays (Space folders, pinned pages, Favorites, archive are bookmarks; a Space set up again on its old folder gets them back); switching between `dist/` and a download is a folder change too; if a second copy got loaded, remove the new, empty one
- [x] Build it from source: "Node.js 22.18 or newer", existing commands, its own update line; the sidebar-opening line (icon, `Cmd+Shift+E` / `Ctrl+Shift+E`) applies to both paths
- [x] check every storage claim against `docs/state-reference.md` (each item named as lost must be a `chrome.storage.local` or `localStorage` key; each item named as kept must be a bookmark)
- [x] run `make lint && make test && make build` - must pass before task 3

### Task 3: Developer docs, Makefile help and changelog

**Files:**
- Modify: `docs/development.md`
- Modify: `tools/prepare-release-instructions.md`
- Modify: `tools/tools-readme.md`
- Modify: `Makefile`
- Modify: `docs/changelog.md`

- [x] `docs/development.md` § Setup: "Node.js 22.18 or newer and npm" with the reason (Vite 7 `^20.19.0 || >=22.12.0`; `make test` needs type stripping without a flag, 22.18+; CI uses Node 24)
- [x] `docs/development.md` § Make targets: the `make tag` row says pushing the tag publishes a GitHub release; § Release: steps (prepare per `tools/prepare-release-instructions.md`, commit the version bump and push `main`, then `./tools/create-release-tag.sh --push`; `make version` only stages the bump, so tagging before the commit puts the new version's tag on the old commit), what `.github/workflows/release.yml` does and in what order, that a failed run creates no release, how to retry (delete the tag on origin and locally, fix, tag again), and that a tag whose release was already published needs `gh release delete <tag> --cleanup-tag` first
- [x] `docs/development.md` § Project layout: add `.github/workflows/` (`release.yml`: tag push → GitHub release)
- [x] `tools/prepare-release-instructions.md` step 7: replace "Run `tools/build-release.sh` to build the release" with pushing `main` and then `./tools/create-release-tag.sh --push`, which starts the Release workflow (version check, lint, tests, zip, GitHub release)
- [x] `tools/tools-readme.md`: `build-release.sh` and `create-release-tag.sh` entries mention the workflow; `Makefile` help text of `release` and `tag` mention the GitHub release (`make help` still lists every target)
- [x] `docs/changelog.md`: one line at the top of `## Latest Version`: ready-to-load zips on the GitHub Releases page, see Install in the README. No `src/data/changelog.ts` entry and no `docs/state-reference.md` change (no new storage keys)
- [x] run `make lint && make test && make build` - must pass before task 4

### Task 4: Verify acceptance criteria

- [x] the workflow creates release `release-X.Y.Z` with `sidebar-for-arc-users-X.Y.Z.zip` only after the version check, lint, tests and build pass (read the step order once more)
- [x] a tag whose version differs from `public/manifest.json` fails at the version check, before `npm ci`, and no later step runs (verified locally in Task 1)
- [x] the zip from `make release` has `manifest.json` at its root, so the unzipped folder is what Load unpacked expects
- [x] README and `docs/development.md` no longer say "Node.js 18+" (`grep -rn "18+" README.md docs/development.md` finds nothing about Node)
- [x] run full checks: `make lint && make test && make build`

### Task 5: [Final] Update documentation

- [x] README.md, `docs/development.md`, `docs/changelog.md` updated (Tasks 2-3); `docs/state-reference.md` unchanged (no new storage keys); no `src/data/changelog.ts` entry
- [x] update CLAUDE.md only if a new pattern came up (not expected) - no new pattern, CLAUDE.md unchanged
- [x] move this plan to `docs/plans/completed/` (left in place - the orchestrator moves it at the end)

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (after merge, by the user; the README links to `releases/latest`, which is empty until the first tag is pushed, so push it right after merge):
- `make version`, commit and push `main`, `./tools/create-release-tag.sh --push`: the Release workflow passes and release `release-X.Y.Z` has `sidebar-for-arc-users-X.Y.Z.zip`.
- Download the zip, unzip into a folder, Load unpacked: the sidebar opens and works.
- Push a tag whose version differs from the manifest (for example `release-0.0.1`): the workflow fails at the version check and no release appears; delete that tag afterwards.

**External system updates**:
- Repository settings: Actions must be enabled for the repo. The job requests `contents: write` itself, so a read-only default `GITHUB_TOKEN` setting doesn't block it.
