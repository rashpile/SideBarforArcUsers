---
created: 2026-10-29
after-version: 1.0.351
status: completed
---

# 036 - Tab Age Highlight

## Feature Goal

Rows in the Tab list get a background that shows how recently each tab was used. The more recently you left a tab, the stronger its highlight. Tabs not used for more than 3 hours look as they did before. A setting picks one of four looks, or turns the highlight off.

Why: to find fresh tabs fast. The main moment is "where was I just now". Spotting old tabs is secondary.

Items marked **(call)** were decided while planning or building, not by the user. They are listed again at the end for review.

Plan: `docs/plans/completed/20261029-tab-age-highlight.md`.

## Scope

- **Highlighted:** regular tabs in the Tab list (the Tabs section), in every Space. Tabs in Chrome tab groups too, over the group colour. **(call)**
- **Not highlighted:** open bookmark pages in the Bookmarks section, Favorites, Archive items, the Tab Switcher and the Space Switcher.
- The active row keeps its current look and gets no age highlight. Selected rows get none either. **(call: selected rows)**

### Anti-goals

- Showing a tab as fresh because the extension just noticed it, or because it plays audio. Only leaving a tab counts as using it.
- Lighting up every tab on the first day after the update, when no tab has a recorded leave time yet.

## Settings

New option in the Settings dialog, Appearance tab: **Highlight tabs by last use**, with `Off` / `White` / `Accent` / `Cooling` / `Trail`. Description: "Recently used tabs in the Tab list get a stronger background". **(call)**

- It is the last option of the tab, below "Use space colour as sidebar background", because Accent and Trail take their colour from that setting. **(call)**
- Default: `White`, so people discover the feature.
- Stored in `chrome.storage.local` as a raw string, because the background reads it too: key `tabAgeHighlight`, values `'off' | 'white' | 'accent' | 'cooling' | 'trail'`. Absent or unknown values read as `'white'`. **(call)**
- One value for all Spaces and windows.

## Grades

Four grades by time since last use. Each upper bound is inclusive: a tab left exactly 1 minute ago is grade 0. Older tabs get no highlight.

| Grade | Last use within |
| --- | --- |
| 0 | 1 minute |
| 1 | 5 minutes |
| 2 | 30 minutes |
| 3 | 3 hours |
| none | older |

- The user changed the grades to these after trying the real sidebar. The first version had seven grades, up to 24 hours (≤5 min, ≤30 min, ≤1 h, ≤3 h, ≤6 h, ≤12 h, ≤24 h).
- The first two grades stand out. The rest fade quickly.
- A last use in the future (clock skew) is grade 0. An unknown time gets no highlight. **(call)**
- The sidebar recomputes the grades every 15 seconds while the highlight is on, and whenever the records change. A once-a-minute tick, as in the first version, could keep a tab in the 1-minute grade 0 for up to 2 minutes. **(call)**

## Last Use

- Last use is the moment the tab **stopped** being active, as auto-archive counts it (feature 035). Chrome's `tab.lastAccessed` is the moment the tab became active, so it can't be the source on its own.
- The auto-archive tracker (`TabActivityTracker`, key `tabLastUsedAt`) holds the times. It was extended rather than adding a second store.
- Each record gets its own `leftAt` field. Only `chrome.tabs.onActivated` stamps it, on the window's previously active tab, when the user leaves that tab. **(call)** Auto-archive keeps judging by `lastUsedAt`. Archiver runs set `lastUsedAt` to "now" for first-seen tabs and tabs in use (audible, Chrome-pinned, in a split view with the active tab). Using it for the highlight would make those tabs glow as fresh forever.
- The highlight takes `max(leftAt, tab.lastAccessed)`. **(call)** A tab with no `leftAt` (open before the update and not left since) falls back to `lastAccessed`, so the first day after the update doesn't light up every tab. A tab opened in the background should count as fresh from its creation, as Chrome is expected to set `lastAccessed` when it creates the tab (not yet verified, see Implementation Notes).
- `leftAt` survives worker and browser restarts the same way `lastUsedAt` does. After a browser restart (or an extension reload or update) records are re-matched by URL and position; each matched tab keeps its own record's `leftAt`. `lastUsedAt` takes the newest time among the records with that URL instead, for auto-archive's safety (close later, never earlier). The highlight has no such reason, and the newest `leftAt` would show every copy of a page, such as several New Tab pages, as fresh. **(call, changed in review)**
- The sidebar learns about a tab switch before the background's record of it arrives (the background stamps `leftAt` after a few storage round trips, more when its worker has to start). Until then the tab just left would be graded by `lastAccessed`, the moment it became active, and then jump to grade 0. So the sidebar counts the tab it sees stop being active as left at that moment, and takes the newer of that and the stored `leftAt`. **(call, made in review)**

## Recording

- The tracker records while auto-archive **or** the highlight is on, and drops its records only when both are off (`isTabActivityRecording`). The highlight is on by default, so the tracker now runs for everyone. `PRIVACY.md` says so. **(call)**
- Switching auto-archive between `Never` and a period, and every change to the highlight, calls `TabActivityTracker.load` with the open tabs. A change between two periods doesn't. `load` attaches the stored records while recording and drops them otherwise. It replaces the `tracker.clear()` the archiver used to call when switched to `Never`.
- Auto-archive's grace still holds: no tab closes earlier than one period after switching on from `Never`. The archiver already judges by `max(lastUsedAt, autoArchiveEnabledAt)`, so records kept while auto-archive was off can't close a tab early. **(call)**

## Looks

The look is the `data-tab-age-style` attribute on the `.arc-theme` root, left off for `Off`. Each graded row has `data-tab-age="0"` to `"3"`.

- **White.** A white wash, like a fainter active row.
- **Accent.** One colour that fades with age.
- **Cooling.** Orange, yellow, green, then blue as the tab gets older.
- **Trail.** A gradient from the row's left edge. Its length and strength show freshness: full width at grade 0, 20% at grade 3.

Details:

- Accent and Trail use the active Space's accent colour when the Space colour is applied to the sidebar, otherwise the theme violet (`106, 90, 205` light, `165, 155, 255` dark). **(call)**
- The Space accent is the light accent (`accentLightHex`) in light mode and the dark accent (`accentDarkHex`) in dark mode, from `getSpaceAccentRgb`. The plan had the dark accent in both, but prototype v2's Space look used a strong blue in light mode. **(call, made while building)**
- The dark theme uses lower alphas than the light one, so highlighted rows don't outshine the plain ones and White's grade 0 stays below the active row. The user had them halved after the first look on the real sidebar, and also had the dark active row (tabs and bookmarks) lowered from 0.14 to 0.10 and the dark expanded-folder and active-peek washes lowered to 0.05 and 0.06.
- The highlight is a `background-image`. A tab group's colour is a Tailwind `background-color`, so it stays underneath. **(call)**
- Hover stays visible over the highlight. On a highlighted row the hover overlay is an inset `box-shadow`, and the row's own background colour drops out so the overlay doesn't apply twice. **(call)**
- White on the light theme: the usual white hover is lost in the white wash of the fresh grades, so a hovered White row darkens a little instead (`rgba(41, 35, 76, 0.035)`). The dark theme keeps the usual hover. **(call, made in review)**
- The row's hover buttons (Pin, Close) repaint the age colour under them for White, Accent and Cooling. Without it a darker box would show behind them. Trail keeps the old paint, see Known Limitations. **(call)**
- All colours are CSS custom properties in `src/index.css`: one table per look (and per theme) on the theme root, `--arc-tab-age-0` to `-3`, and one rule per grade that picks its entry and sets the Trail's length (the same in every theme). The values were set for four grades with the grade change; the plan's Technical Details list them.

## State

| Key | Writer | Readers |
| --- | --- | --- |
| `tabAgeHighlight` (new) | Settings dialog | sidebar (`App.tsx`), background (the tracker's recording condition) |
| `tabLastUsedAt` (gains `leftAt`) | background (`TabActivityTracker`) | background (auto-archive), sidebar (`useTabLeftTimes`, read-only) |

Both are in `chrome.storage.local`. Records stored before this feature have no `leftAt` and keep loading. Shapes and lifecycle are in `docs/state-reference.md`.

## Code

- `src/utils/tabAgeHighlight.ts`: the setting's key, type, default and parser, `isTabActivityRecording`, `tabAgeGrade`, `tabLastUseForHighlight`, and `TAB_AGE_REGRADE_INTERVAL_MS` (15 s).
- `src/stores/tabActivityTracker.ts`: `leftAt` in the records, and `TabLeftTimes`, the sidebar's read-only view of them.
- `src/services/tabAutoArchiver.ts`: `readTabActivityRecording` (the tracker's `isRecording`). `handleSettingChange` calls `tracker.load`.
- `src/background.ts`: `chrome.storage.onChanged` for `tabAgeHighlight` calls `loadTabActivity()`.
- `src/hooks/useTabLeftTimes.ts` and `src/hooks/useClock.ts`: the records and a clock for the sidebar, which TabList ticks every `TAB_AGE_REGRADE_INTERVAL_MS`. Both are idle while the setting is `Off`. `useTabLeftTimes` also counts the tab the sidebar sees stop being active as left right then (its `SidebarTabLeftTimes`, the newer of that and the stored `leftAt`), and returns `[leftTimes, isLoaded]` like `useChromeLocalStorage`; TabList grades no row until `isLoaded`, so no row is graded on `lastAccessed` alone for a frame.
- `src/components/TabList.tsx`: the grade of each regular tab at its three row render sites. `TabRow` drops it on the active and selected rows and passes `data-tab-age` to its `TreeRow`, which spreads it on the row.
- `src/App.tsx`: the setting, plus `data-tab-age-style` and `--arc-tab-age-accent` on the `.arc-theme` root. The setting counts as `Off` until it has loaded, so opening the sidebar doesn't flash the default look. `src/components/SettingsDialog.tsx`: the option.
- `src/utils/groupColors.ts`: `getSpaceAccentRgb`.
- `src/utils/time.ts`: `SECOND_MS` / `MINUTE_MS` / `HOUR_MS` (shared with auto-archive) and `newerTime`, the newer-of-two-times rule behind `tabLastUseForHighlight` and the seen leave.
- `src/index.css`: the looks.
- Tests: `tests/tabAgeHighlight.test.mjs` covers the grade bounds, the last-use max, parsing and the recording condition. `tests/tabActivityTracker.test.mjs` covers `leftAt` stamping and carrying, the browser-restart rematch, records without `leftAt`, and recording with either setting on.

## Decided by the User

- Four grades: ≤1 min, ≤5 min, ≤30 min, ≤3 h, older (no highlight). Changed after trying the real sidebar; the first version had seven grades up to 24 h.
- Four looks, all offered in Settings: White, Accent, Cooling, Trail.
- Default: White.
- The first two grades stand out and the rest fade quickly. The dark theme gets more contrast than the first prototype.
- Only regular tabs in the Tab list.
- The time is the moment the tab stopped being active, from the auto-archive tracker, which is extended rather than adding a second store.
- The active tab keeps its current look.

## Calls Made (for review)

While planning:

- Key `tabAgeHighlight`, raw string. Label "Highlight tabs by last use", in the Appearance tab.
- A separate `leftAt`, stamped only when the user leaves the tab.
- Last use for the highlight is `max(leftAt, lastAccessed)`.
- The tracker records while either setting is on, so for everyone by default. `PRIVACY.md` updated.
- Auto-archive's grace relies on `max(lastUsedAt, autoArchiveEnabledAt)` and needs no change.
- Accent and Trail follow the Space colour when it is applied.
- Grouped tabs are highlighted over the group colour. Selected and active rows are not. Hover stays visible.
- Grades are recomputed on a timer (once a minute at first) and on every records change.

While building:

- The Space accent is the light accent in light mode and the dark accent in dark mode.
- The option is the last one in the Appearance tab.
- A time in the future is grade 0. A missing time gets no grade.
- Hover on a highlighted row is an inset box-shadow, and the row's background colour drops out.
- Hover buttons repaint the age colour, except for Trail.
- The prototype v2 values are kept as they are (later changed by the user: dark tints halved, then four grades).

In review:

- After a browser restart each tab keeps its own record's `leftAt`, not the newest on its URL.
- The sidebar counts the tab it sees stop being active as left at that moment.
- White on the light theme darkens a hovered row instead of the usual white hover.
- The setting counts as `Off` until it has loaded, and rows get no grade until the records are read.

With the four grades:

- The sidebar re-grades every 15 seconds instead of once a minute, so a tab leaves the 1-minute grade 0 at most 15 seconds late.

## Implementation Notes

- A stored record has no `leftAt` until the user has left its tab, so a record without it looks exactly as before this feature.
- `TabActivityTracker.clear()` is gone. When auto-archive switches to `Never`, the archiver now calls `load`, which drops the records only if the highlight is off too. `readAutoArchivePeriod` became `readTabActivityRecording`, which reads both keys in one `chrome.storage.local.get`.
- Every change to `tabAgeHighlight` reloads the tracker, also a change between two looks. `load` does nothing harmful within a session.
- While auto-archive is `Never` no archiver run updates the records. They change when the user leaves a tab, when a tab closes, at each worker start, and when either setting changes (auto-archive only between `Never` and a period). Records of tabs closed together with their window stay until the next worker start, which drops records whose tab is gone.
- If the sidebar can't read the records, it gets no `leftAt` times (logged in DEV builds only), and every row falls back to `lastAccessed`.
- `TabList` only gets an on/off flag. The look is all CSS.
- Unit tests cover the logic. The CSS cascade was checked in headless Chrome against the built CSS, in light and dark mode. The look on the real sidebar and the manual checks in the plan's Post-Completion list are still to do, for example that a tab opened in the background shows as fresh.

## Known Limitations

- Right after a browser restart, before the background has re-matched the records to the new tab IDs, the sidebar may briefly show grades from old IDs. Cosmetic. It fixes itself on the next records write.
- Trail: the row's hover buttons (Pin, Close) don't repaint the trail under them. Only the freshest grade (full width) still has a faint tint at the right end, so hovering such a row leaves a slightly untinted patch behind the buttons.
- A hovered grouped tab loses its group colour under the highlight. Hovered grouped tabs already do this without the highlight, because hover's `background` shorthand replaces the Tailwind colour.
- While a highlighted row is hovered, the hover overlay replaces its keyboard-focus or context-menu ring, since both are box-shadows. Rare: it needs keyboard focus and the pointer on the same row, or the pointer back on the row while its menu is open.
- Incognito tabs are never recorded (their URLs must not reach storage), so when the extension is allowed in incognito their rows are graded by Chrome's `lastAccessed` alone. A tab read for a while and then left shows the grade of the moment it became active. While the sidebar stays open, the tab it sees the user leave still counts as just left.
- After a browser restart, copies of a page at the same position in different windows may swap their `leftAt`, and a tab may take the older `leftAt` of a copy whose window was closed just before the restart, because the re-match goes by URL and position only. Cosmetic, and fixed the next time the tab is left.
