# Tab Age Highlight

## Overview
- Rows in the Tab list get a background that shows how recently each tab was used: the more recently you left a tab, the stronger its highlight. Tabs not used for more than 24 hours look as they do today.
- Why: to find fresh tabs fast. The main moment is "where was I just now"; spotting old tabs is secondary.
- A new setting picks one of four looks, or turns the highlight off.

### Decided with the user
- Eight grades by time since last use: ≤5 min, ≤30 min, ≤1 h, ≤3 h, ≤6 h, ≤12 h, ≤24 h, older (no highlight).
- Four looks, all offered in Settings (prototype v2): **White** (white wash, like a fainter active row), **Accent** (one colour, fading), **Cooling** (orange → yellow → green → cyan → blue), **Trail** (left gradient whose length and strength show freshness).
- Default: **White**, so people discover the feature.
- The first two grades stand out; the rest fade quickly. Dark theme gets more contrast than the first prototype (v2 values below).
- Only regular tabs in the Tab list. Not open bookmarks in the Bookmarks section, not Favorites, not Archive, not the keyboard switchers.
- Time source: the moment the tab **stopped** being active, from the auto-archive tracker (`tabLastUsedAt`), not Chrome's `lastAccessed` (the moment it became active). Approach chosen: extend the existing tracker rather than add a second store.
- The active tab keeps its current look.

### Calls made while planning (for review)
- Setting stored in `chrome.storage.local` as a raw string (the background reads it): key `tabAgeHighlight`, values `'off' | 'white' | 'accent' | 'cooling' | 'trail'`. Settings label "Highlight tabs by last use", in the Appearance tab.
- Records get a separate `leftAt` field, stamped only when the user leaves the tab. The existing `lastUsedAt` stays as is for auto-archive: its refresh stamps first-seen tabs and tabs in use (audible, Chrome-pinned, split view) with "now", which would make those tabs glow as fresh forever.
- A tab's last use for the highlight = `max(leftAt, tab.lastAccessed)`. A tab with no `leftAt` (after the update, before you ever leave it) falls back to Chrome's `lastAccessed`, so the first day after the update doesn't light up every tab. A tab opened in the background counts as fresh from its creation (Chrome sets `lastAccessed` at creation; verify manually).
- The tracker records while **either** auto-archive or the highlight is on. Records are dropped only when both are off. With the highlight on by default, the tracker now runs for everyone; PRIVACY.md says so.
- Auto-archive's grace ("no tab closed earlier than one period after switching on") keeps working: it already uses `max(lastUsedAt, autoArchiveEnabledAt)`, so records that were kept while auto-archive was off can't close a tab early.
- Accent and Trail use the active Space's colour when "Use space colour" is on, otherwise the theme violet.
- Grouped tabs are highlighted too, layered over the group colour. Selected rows and the active row show no age highlight. Hover stays visible over the highlight.
- Grades are recomputed once a minute while the sidebar is open, and whenever the records change.

### Known limitations
- Right after a browser restart, before the background has re-matched the records to the new tab IDs, the sidebar may briefly show grades from old IDs. Cosmetic, fixes itself on the next records write.

## Context (from discovery)
- `src/stores/tabActivityTracker.ts` — `TabActivityTracker` (background is the only writer). `TabUseRecords` keyed by tab ID, stored under `tabLastUsedAt` as `{ [tabId]: { windowId, url, index, lastUsedAt } }`. `markActivated` stamps the tab the user left; `refresh` (`refreshedForLiveTabs`) stamps first-seen and in-use tabs with now; `keptForLiveTabs` / `rematchedByUrl` carry records across worker / browser restarts; `load` drops everything when `isRecording()` is false; `clear()` drops everything. All record writes go through `#put(tab, lastUsedAt)`.
- `src/background.ts` (~230) — tracker built with `isRecording: readAutoArchivePeriod() !== 'never'`; `onActivated` → `markActivated` (~567); `onRemoved` → `forget` (~713); `storage.onChanged` for `AUTO_ARCHIVE_AFTER_KEY` → `tabAutoArchiver.handleSettingChange` (~482).
- `src/services/tabAutoArchiver.ts` — `handleSettingChange`: 'off' removes `autoArchiveEnabledAt` and calls `tracker.clear()`; 'on' sets `autoArchiveEnabledAt` and calls `tracker.load(queryOpenTabs())`. `readAutoArchivePeriod()`, `queryOpenTabs()` live here. Uses `chrome.*` directly, so Node tests can't import it.
- `src/utils/autoArchivePolicy.ts` — `isOverdue` uses `max(lastUsedAt, enabledAt)` (grace).
- `src/utils/autoArchive.ts` — pattern for a raw-string setting shared with the background: key constant, type, default, `parse…` function.
- `src/App.tsx` — settings via `useChromeLocalStorage` (~663–706; raw-string pattern at `autoArchiveAfter`); `applySpaceColor` / `spaceBgColor` (~605) set `--arc-sidebar-bg` on the `.arc-theme` root; `<TabList …>` props (~246).
- `src/components/SettingsDialog.tsx` — `settings` prop + `temp…` state per option, `SettingsTab = 'appearance' | 'behaviour' | …`; Appearance tab at ~229.
- `src/components/TabList.tsx` — `TabRow` (~115) renders `TreeRow` with `isActive`, `isSelected`, group colour classes (`GROUP_COLORS[groupColor].bg`) in `rowClassName`.
- `src/components/TreeRow.tsx` — row root sets `data-active` / `data-selected` / `data-highlighted`.
- `src/index.css` — `.arc-tree-row` states (`--arc-row-overlay`, hover uses the `background` shorthand), dark overrides under `@media (prefers-color-scheme: dark)`.
- `src/utils/groupColors.ts` — `GROUP_COLORS[color].accentDarkHex`, `hexToRgb`, `getSpaceBgColor`.
- `src/services/switcherLists.ts` — `TabWithLastAccess` (`lastAccessed` is missing from `@types/chrome`).
- Docs: `PRIVACY.md` (line 14 — records kept only while auto-archive is on), `docs/state-reference.md` (`tabLastUsedAt` ~242, consumers ~119), `src/data/changelog.ts` (`1.0.352` not released yet), `docs/chrome-web-store-info.md`, `docs/features/next-id.txt` = `036`.
- Tests: `make test` = `node --test tests/*.test.mjs` with type stripping; `tests/tabActivityTracker.test.mjs`, `tests/autoArchive.test.mjs` exist.

## Development Approach
- **testing approach**: Regular — code first, then tests in the same task. Tests only for the decisions listed under Testing Strategy; no tests for CSS, wording, settings plumbing or React wiring.
- complete each task fully before moving to the next
- make small, focused changes
- all tests must pass before starting the next task
- update this plan file when scope changes during implementation
- maintain backward compatibility: stored records without `leftAt` keep loading; auto-archive behaves as before

## Testing Strategy
Decisions worth a test (they would show wrong tabs as fresh, or lose / keep records wrongly):
- grade boundaries (inclusive upper bounds, older than 24 h → none, unknown time → none);
- last use = `max(leftAt, lastAccessed)`, with either missing;
- setting parse (absent or unknown → `'white'`);
- recording condition (records dropped only when auto-archive is Never **and** highlight is Off);
- tracker: `leftAt` set by `markActivated` only; `refresh` keeps `leftAt` and never invents it; `rematchedByUrl` carries the newest `leftAt` per URL; records stored before this change (no `leftAt`) still load.

No e2e suite in the project; the UI is checked manually (Post-Completion).

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope

## Solution Overview
- **Background:** the tracker's records gain `leftAt`. The tracker records while auto-archive or the highlight is on. Changing either setting calls `tracker.load(openTabs)`, which keeps/attaches records when recording and drops them otherwise; this replaces the archiver's `tracker.clear()`.
- **Sidebar:** a hook reads `tabLastUsedAt` and follows `chrome.storage.onChanged`; a minute clock re-renders. `TabList` computes each regular tab's grade from `max(leftAt, lastAccessed)` and passes it to `TabRow` → `TreeRow` as `data-tab-age`. The chosen look is a `data-tab-age-style` attribute on the `.arc-theme` root; CSS does the rest.
- **CSS:** each look × grade sets `background-image` (a solid `linear-gradient(c, c)` for White/Accent/Cooling, a real gradient for Trail). `background-image` paints over `background-color`, so the group colour stays underneath. The age rules must out-rank `.arc-tree-row-hoverable:hover`, whose `background` shorthand resets `background-image`; hover is then shown with an inset overlay so it stays visible.

## Technical Details

### Setting — `src/utils/tabAgeHighlight.ts` (new)
- `export type TabAgeHighlightStyle = 'off' | 'white' | 'accent' | 'cooling' | 'trail'`
- `export const TAB_AGE_HIGHLIGHT_KEY = 'tabAgeHighlight'` (raw string, written by Settings, read by background.ts)
- `export const DEFAULT_TAB_AGE_HIGHLIGHT_STYLE: TabAgeHighlightStyle = 'white'`
- `export function parseTabAgeHighlightStyle(value: unknown): TabAgeHighlightStyle` — unknown/absent → default
- `export function isTabActivityRecording(period: AutoArchivePeriod, style: TabAgeHighlightStyle): boolean` — `period !== 'never' || style !== 'off'`

### Grades — same module
- Upper bounds, inclusive: `[5 min, 30 min, 1 h, 3 h, 6 h, 12 h, 24 h]` → grade `0..6`; above 24 h → `undefined` (no highlight).
- `tabAgeGrade(lastUsedAt: number | undefined, now: number): number | undefined` — `undefined` input → `undefined`; a time in the future (clock skew) → grade 0.
- `tabLastUseForHighlight(leftAt?: number, lastAccessed?: number): number | undefined` — the newer of the two; `undefined` when both missing. (Small enough to be a function; wrap in a class only if more per-tab logic shows up.)

### Records — `src/stores/tabActivityTracker.ts`
- Stored entry: `{ windowId, url, index, lastUsedAt, leftAt? }`. `isStoredTabUse` accepts a missing `leftAt` or a finite number.
- `markActivated`: the left tab gets `lastUsedAt = now` **and** `leftAt = now`.
- `refreshedForLiveTabs`, `keptForLiveTabs`: carry `leftAt` unchanged; first-seen tabs get no `leftAt`.
- `rematchedByUrl`: newest `leftAt` per URL, like `lastUsedAt`.
- `#put(tab, lastUsedAt, leftAt?)`.
- Read side for the sidebar: export a small read-only view, e.g. `TabLeftTimes.fromStored(value)` with `leftAt(tabId)`; malformed data → empty (cosmetic feature, log in DEV only).
- Remove `clear()` once the archiver no longer calls it (and its tests).

### Background — `src/background.ts`, `src/services/tabAutoArchiver.ts`
- `isRecording`: read both keys in one `chrome.storage.local.get([AUTO_ARCHIVE_AFTER_KEY, TAB_AGE_HIGHLIGHT_KEY])`, return `isTabActivityRecording(...)`.
- `storage.onChanged` (local) for `TAB_AGE_HIGHLIGHT_KEY` → `tabActivityTracker.load(await queryOpenTabs())`.
- `handleSettingChange` 'off': keep removing `autoArchiveEnabledAt`, then `tracker.load(await queryOpenTabs())` instead of `tracker.clear()`.
- Update the comments that say "nothing is recorded while Archive tabs after is Never" (tracker header, background ~228, `load` docs).

### Sidebar
- `App.tsx`: `useChromeLocalStorage<TabAgeHighlightStyle>(TAB_AGE_HIGHLIGHT_KEY, DEFAULT_…, { parse: parseTabAgeHighlightStyle, serialize: v => v })`; pass to `SettingsDialog` and set `data-tab-age-style` on the `.arc-theme` root (omit when `'off'`). When `applySpaceColor`, also set `--arc-tab-age-accent` to the Space accent as an `r, g, b` triplet (`hexToRgb(GROUP_COLORS[color]?.accentDarkHex …)`).
- New hook (e.g. `src/hooks/useTabLeftTimes.ts`): `chrome.storage.local.get(TabActivityTracker.RECORDS_KEY)` + `chrome.storage.onChanged`, returns `TabLeftTimes`. Skip reading entirely when the style is `'off'`.
- Minute clock: re-render every 60 s while the style isn't `'off'` (reuse an existing interval hook if there is one).
- `TabList.tsx`: for each regular tab row (not active, not selected) compute `tabAgeGrade(tabLastUseForHighlight(leftTimes.leftAt(tab.id), tab.lastAccessed), now)`; pass `tabAgeGrade` to `TabRow`. `lastAccessed` via the `TabWithLastAccess` type from `switcherLists.ts`.
- `TreeRow.tsx`: optional `ageGrade?: number` prop → `data-tab-age={ageGrade}`.

### CSS — `src/index.css` (values from prototype v2, grades 0..6)
- White, light: `rgba(255,255,255, .62 .46 .34 .25 .18 .12 .07)`; dark: `.17 .13 .10 .075 .055 .038 .022`.
- Accent, light: `rgba(var(--arc-tab-age-accent), .36 .26 .19 .14 .10 .07 .04)`; dark: `.58 .44 .33 .25 .18 .12 .07`. Default accent `106, 90, 205` light, `165, 155, 255` dark.
- Cooling, hues `24 38 50 90 160 195 220`, sat/light `95/55 95/52 92/48 60/45 55/42 65/48 60/58`; alpha light `.36 .30 .25 .21 .17 .13 .09`, dark `.62 .50 .40 .33 .27 .21 .15`.
- Trail: `linear-gradient(90deg, rgba(accent, a) 0%, rgba(accent, 0) L%)`, L `100 80 62 48 36 26 16`; a light `.38 .32 .28 .25 .22 .19 .16`, dark `.66 .56 .48 .42 .36 .31 .26`.
- Prefer CSS custom properties per grade over 4×7×2 literal rules if it reads cleaner; tune values on the real sidebar.
- Prototype for reference: `/private/tmp/claude-501/-Users-pkoptilin-workspace-repos-SideBarforArcUsers/3a19c148-ba05-4307-b2a5-4374dc5c196d/scratchpad/.superpowers/brainstorm/27682-1793290783/content/tab-age-backgrounds-v2.html` (throwaway).

### Settings UI — `src/components/SettingsDialog.tsx`
- Appearance tab: select "Highlight tabs by last use" — Off / White / Accent / Cooling / Trail. Short description: "Recently used tabs in the Tab list get a stronger background."
- Add `tabAgeHighlight` to the settings type, temp state, reset-on-open and save, like `useSpaceColor`.

## What Goes Where
- **Implementation Steps**: code, tests, docs in this repo.
- **Post-Completion**: manual checks in Chrome.

## Implementation Steps

### Task 1: Setting and grade model

**Files:**
- Create: `src/utils/tabAgeHighlight.ts`
- Create: `tests/tabAgeHighlight.test.mjs`

- [x] add `TabAgeHighlightStyle`, `TAB_AGE_HIGHLIGHT_KEY`, default `'white'`, `parseTabAgeHighlightStyle`
- [x] add `isTabActivityRecording(period, style)`
- [x] add `tabAgeGrade(lastUsedAt, now)` with the seven inclusive bounds and `tabLastUseForHighlight(leftAt, lastAccessed)`
- [x] write tests: grade boundaries (exactly 5 min → 0, 5 min + 1 ms → 1, exactly 24 h → 6, above 24 h → none, undefined → none, future → 0)
- [x] write tests: `tabLastUseForHighlight` with both / one / none; parse (absent, unknown, each value); recording condition (all four combinations)
- [x] run `make test` — must pass before task 2

### Task 2: `leftAt` in the tab activity records

**Files:**
- Modify: `src/stores/tabActivityTracker.ts`
- Modify: `tests/tabActivityTracker.test.mjs`

- [x] add optional `leftAt` to the stored entry, `TabUseRecord`, validation, `toStored`/`fromStored`, `#put`
- [x] stamp `leftAt` in `markActivated`; carry it in `refreshedForLiveTabs`, `keptForLiveTabs`; newest per URL in `rematchedByUrl`
- [x] export the read-only `TabLeftTimes` view for the sidebar
- [x] write tests: `markActivated` sets `leftAt`; `refresh` keeps an existing `leftAt` and gives first-seen / in-use tabs none
- [x] write tests: browser-restart rematch carries the newest `leftAt` per URL; stored records without `leftAt` load; `TabLeftTimes` on malformed data → empty
- [x] run `make test` — must pass before task 3

### Task 3: Record while either setting is on

**Files:**
- Modify: `src/background.ts`
- Modify: `src/services/tabAutoArchiver.ts`
- Modify: `src/stores/tabActivityTracker.ts`
- Modify: `tests/tabActivityTracker.test.mjs`

- [x] `isRecording` reads both settings and uses `isTabActivityRecording`
- [x] `storage.onChanged` for `TAB_AGE_HIGHLIGHT_KEY` → `tracker.load(queryOpenTabs())`
- [x] archiver 'off' calls `tracker.load(...)` instead of `tracker.clear()`; remove `clear()` and its tests if nothing else uses it
- [x] update the "nothing recorded while Never" comments in tracker, background, archiver
- [x] write tests: `load` keeps records when `isRecording` is true (highlight on, archive Never) and drops them when false (existing test may already cover the false case — extend, don't duplicate)
- [x] run `make test` — must pass before task 4

### Task 4: Setting in the Settings dialog

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] `useChromeLocalStorage` for `tabAgeHighlight` (raw string), pass into the settings object and save handler
- [ ] Appearance tab select with the five values and the description
- [ ] no tests (settings plumbing); `make test` and the TypeScript build still pass

### Task 5: Grades on Tab list rows

**Files:**
- Create: `src/hooks/useTabLeftTimes.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/TabList.tsx`
- Modify: `src/components/TreeRow.tsx`

- [ ] hook reading `tabLastUsedAt` + `onChanged`, returning `TabLeftTimes`; idle when style is `'off'`
- [ ] minute clock while the style isn't `'off'`
- [ ] `TabList` computes the grade per regular tab (skip active and selected rows) and passes it through `TabRow` to `TreeRow` (`data-tab-age`)
- [ ] `App` sets `data-tab-age-style` on the `.arc-theme` root and `--arc-tab-age-accent` from the Space colour when it's applied
- [ ] no new tests (wiring; grade logic tested in task 1); `make test` and build pass

### Task 6: The four looks in CSS

**Files:**
- Modify: `src/index.css`

- [ ] White, Accent, Cooling, Trail for grades 0..6, light and dark, via `background-image`
- [ ] make the age rules win over hover's `background` shorthand; show hover as an inset overlay on highlighted rows
- [ ] check grouped tabs: the highlight lies over the group colour
- [ ] tune values on the real sidebar (neutral, Space colour, dark)
- [ ] no tests (CSS); build passes

### Task 7: Verify acceptance criteria
- [ ] every item under "Decided with the user" works; grouped, selected, active, hover cases look right
- [ ] auto-archive unchanged: Never → period still gives a full period of grace; period → Never with the highlight on keeps the records; both off drops them
- [ ] run full test suite: `make test`
- [ ] run the build (`npm run build`)

### Task 8: [Final] Update documentation
- [ ] `docs/features/036-tab-age-highlight.md` — feature spec from this plan's Overview (use the `new-feature-doc` skill; bumps `docs/features/next-id.txt` to `037`)
- [ ] `PRIVACY.md` — records are kept while auto-archive or the tab highlight is on (on by default); turning both off deletes them
- [ ] `docs/state-reference.md` — `tabLastUsedAt.leftAt`, new key `tabAgeHighlight`, recording condition, new consumer (sidebar)
- [ ] `src/data/changelog.ts` (`1.0.352`) and `docs/chrome-web-store-info.md` — new setting, on by default
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Manual checks in Chrome — no checkboxes*

**Manual verification:**
- leave a tab after working in it for a while: it shows the freshest grade right away, not "1 h"
- open a link in the background (Cmd+click): the new tab is highlighted as fresh
- after updating the extension: tabs never left since show grades from Chrome's `lastAccessed`, not all as fresh
- restart the browser: grades come back for re-opened tabs (records re-matched by URL)
- each look in neutral, Space colour and dark; grouped tabs; selection and hover
- Settings → Off: no highlight; with auto-archive Never, `tabLastUsedAt` disappears from `chrome.storage.local`
