---
created: 2026-10-29
after-version: 1.0.351
status: completed
---

# 036 - Tab Age Highlight

## Feature Goal

Rows in the Tab list get a background that shows how recently each tab was used. The more recently you left a tab, the stronger its highlight. Tabs not used for more than 24 hours look as they did before. A setting picks one of four looks, or turns the highlight off.

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

Eight grades by time since last use. Each upper bound is inclusive: a tab left exactly 5 minutes ago is grade 0.

| Grade | Last use within |
| --- | --- |
| 0 | 5 minutes |
| 1 | 30 minutes |
| 2 | 1 hour |
| 3 | 3 hours |
| 4 | 6 hours |
| 5 | 12 hours |
| 6 | 24 hours |
| none | older |

- The first two grades stand out. The rest fade quickly.
- A last use in the future (clock skew) is grade 0. An unknown or non-finite time gets no highlight. **(call)**
- The sidebar recomputes the grades once a minute while the highlight is on, and whenever the records change. **(call)**

## Last Use

- Last use is the moment the tab **stopped** being active, as auto-archive counts it (feature 035). Chrome's `tab.lastAccessed` is the moment the tab became active, so it can't be the source on its own.
- The auto-archive tracker (`TabActivityTracker`, key `tabLastUsedAt`) holds the times. It was extended rather than adding a second store.
- Each record gets its own `leftAt` field. Only `chrome.tabs.onActivated` stamps it, on the window's previously active tab, when the user leaves that tab. **(call)** Auto-archive keeps judging by `lastUsedAt`. Archiver runs set `lastUsedAt` to "now" for first-seen tabs and tabs in use (audible, Chrome-pinned, in a split view with the active tab). Using it for the highlight would make those tabs glow as fresh forever.
- The highlight takes `max(leftAt, tab.lastAccessed)`. **(call)** A tab with no `leftAt` (open before the update and not left since) falls back to `lastAccessed`, so the first day after the update doesn't light up every tab. A tab opened in the background counts as fresh from its creation, because Chrome sets `lastAccessed` when it creates the tab.
- `leftAt` survives worker and browser restarts the same way `lastUsedAt` does. After a browser restart every tab matched on a URL gets the newest `leftAt` among the records with that URL.

## Recording

- The tracker records while auto-archive **or** the highlight is on, and drops its records only when both are off (`isTabActivityRecording`). The highlight is on by default, so the tracker now runs for everyone. `PRIVACY.md` says so. **(call)**
- Changing either setting calls `TabActivityTracker.load` with the open tabs. `load` attaches the stored records while recording and drops them otherwise. It replaces the `tracker.clear()` the archiver used to call when switched to `Never`.
- Auto-archive's grace still holds: no tab closes earlier than one period after switching on from `Never`. The archiver already judges by `max(lastUsedAt, autoArchiveEnabledAt)`, so records kept while auto-archive was off can't close a tab early. **(call)**

## Looks

The look is the `data-tab-age-style` attribute on the `.arc-theme` root, left off for `Off`. Each graded row has `data-tab-age="0"` to `"6"`.

- **White.** A white wash, like a fainter active row.
- **Accent.** One colour that fades with age.
- **Cooling.** Orange, yellow, green, cyan, then blue as the tab gets older.
- **Trail.** A gradient from the row's left edge. Its length and strength show freshness: full width at grade 0, 16% at grade 6.

Details:

- Accent and Trail use the active Space's accent colour when the Space colour is applied to the sidebar, otherwise the theme violet (`106, 90, 205` light, `165, 155, 255` dark). **(call)**
- The Space accent is the light accent (`accentLightHex`) in light mode and the dark accent (`accentDarkHex`) in dark mode, from `getSpaceAccentRgb`. The plan had the dark accent in both, but prototype v2's Space look used a strong blue in light mode. **(call, made while building)**
- The dark theme uses stronger tints than the light one. On the dark base the light-theme values blur together.
- The highlight is a `background-image`. A tab group's colour is a Tailwind `background-color`, so it stays underneath. **(call)**
- Hover stays visible over the highlight. On a highlighted row the hover overlay is an inset `box-shadow`, and the row's own background colour drops out so the overlay doesn't apply twice. **(call)**
- The row's hover buttons (Pin, Close) repaint the age colour under them for White, Accent and Cooling. Without it a darker box would show behind them. Trail keeps the old paint, see Known Limitations. **(call)**
- All values are CSS custom properties in `src/index.css`: one table per look (and per theme) on the theme root, `--arc-tab-age-0` to `-6` plus `--arc-tab-age-length-0` to `-6` for Trail, and one rule per grade that picks its entry. They are the prototype v2 values, not yet tuned on the real sidebar.

## State

| Key | Writer | Readers |
| --- | --- | --- |
| `tabAgeHighlight` (new) | Settings dialog | sidebar (`App.tsx`), background (the tracker's recording condition) |
| `tabLastUsedAt` (gains `leftAt`) | background (`TabActivityTracker`) | background (auto-archive), sidebar (`useTabLeftTimes`, read-only) |

Both are in `chrome.storage.local`. Records stored before this feature have no `leftAt` and keep loading. Shapes and lifecycle are in `docs/state-reference.md`.

## Code

- `src/utils/tabAgeHighlight.ts`: the setting's key, type, default and parser, `isTabActivityRecording`, `tabAgeGrade`, `tabLastUseForHighlight`.
- `src/stores/tabActivityTracker.ts`: `leftAt` in the records, and `TabLeftTimes`, the sidebar's read-only view of them.
- `src/services/tabAutoArchiver.ts`: `readTabActivityRecording` (the tracker's `isRecording`). `handleSettingChange` calls `tracker.load`.
- `src/background.ts`: `chrome.storage.onChanged` for `tabAgeHighlight` calls `loadTabActivity()`.
- `src/hooks/useTabLeftTimes.ts` and `src/hooks/useMinuteClock.ts`: the records and a minute clock for the sidebar. Both are idle while the setting is `Off`.
- `src/components/TabList.tsx`: the grade of each regular tab at its three row render sites. `TabRow` drops it on the active and selected rows. `src/components/TreeRow.tsx` sets `data-tab-age`.
- `src/App.tsx`: the setting, plus `data-tab-age-style` and `--arc-tab-age-accent` on the `.arc-theme` root. `src/components/SettingsDialog.tsx`: the option.
- `src/utils/groupColors.ts`: `getSpaceAccentRgb`.
- `src/index.css`: the looks.
- Tests: `tests/tabAgeHighlight.test.mjs` covers the grade bounds, the last-use max, parsing and the recording condition. `tests/tabActivityTracker.test.mjs` covers `leftAt` stamping and carrying, the browser-restart rematch, records without `leftAt`, and recording with either setting on.

## Decided by the User

- Eight grades: ≤5 min, ≤30 min, ≤1 h, ≤3 h, ≤6 h, ≤12 h, ≤24 h, older (no highlight).
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
- Grades are recomputed once a minute and on every records change.

While building:

- The Space accent is the light accent in light mode and the dark accent in dark mode.
- The option is the last one in the Appearance tab.
- A time in the future is grade 0. A missing or non-finite time gets no grade.
- Hover on a highlighted row is an inset box-shadow, and the row's background colour drops out.
- Hover buttons repaint the age colour, except for Trail.
- The prototype v2 values are kept as they are.

## Implementation Notes

- A stored record has no `leftAt` until the user has left its tab, so a record without it looks exactly as before this feature.
- `TabActivityTracker.clear()` is gone. When auto-archive switches to `Never`, the archiver now calls `load`, which drops the records only if the highlight is off too. `readAutoArchivePeriod` became `readTabActivityRecording`, which reads both keys in one `chrome.storage.local.get`.
- Every change to `tabAgeHighlight` reloads the tracker, also a change between two looks. `load` does nothing harmful within a session.
- While auto-archive is `Never` no archiver run updates the records. They change when the user leaves a tab, when a tab closes, and at each worker start or setting change. Records of tabs closed together with their window stay until the next worker start, which drops records whose tab is gone.
- If the sidebar can't read the records, it gets no `leftAt` times (logged in DEV builds only), and every row falls back to `lastAccessed`.
- `TabList` only gets an on/off flag. The look is all CSS.
- Unit tests cover the logic. The CSS cascade was checked in headless Chrome against the built CSS, in light and dark mode. The look on the real sidebar and the manual checks in the plan's Post-Completion list are still to do, for example that a tab opened in the background shows as fresh.

## Known Limitations

- Right after a browser restart, before the background has re-matched the records to the new tab IDs, the sidebar may briefly show grades from old IDs. Cosmetic. It fixes itself on the next records write.
- Trail: the row's hover buttons (Pin, Close) don't repaint the trail under them. Only the freshest grade (full width) still has a faint tint at the right end, so hovering such a row leaves a slightly untinted patch behind the buttons.
- A hovered grouped tab loses its group colour under the highlight. Hovered grouped tabs already do this without the highlight, because hover's `background` shorthand replaces the Tailwind colour.
- While a highlighted row is hovered, the hover overlay replaces its keyboard-focus or context-menu ring, since both are box-shadows. Rare: it needs keyboard focus and the pointer on the same row, or the pointer back on the row while its menu is open.
