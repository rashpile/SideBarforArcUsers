// "Highlight tabs by last use" setting: rows in the Tab list get a
// background that is stronger the more recently the user left the tab. Tabs not
// used for more than 3 hours get none. The style picks one of four looks or
// turns the highlight off.

import type { AutoArchivePeriod } from './autoArchive.ts';
import type { UnvisitedTabMarkerSetting } from './unvisitedTabMarker.ts';
import { HOUR_MS, MINUTE_MS, SECOND_MS, newerTime } from './time.ts';

export type TabAgeHighlightStyle = 'off' | 'white' | 'accent' | 'cooling' | 'trail';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by background.ts
// (whether to record last-use times) and App.tsx (which look to show).
export const TAB_AGE_HIGHLIGHT_KEY = 'tabAgeHighlight';

// Default: on, so people discover the feature.
export const DEFAULT_TAB_AGE_HIGHLIGHT_STYLE: TabAgeHighlightStyle = 'white';

const TAB_AGE_HIGHLIGHT_STYLES: readonly TabAgeHighlightStyle[] = ['off', 'white', 'accent', 'cooling', 'trail'];

// Inclusive upper bound of each grade's age; the index is the grade (0 = freshest).
// A tab older than the last bound has no grade.
const GRADE_UPPER_BOUNDS_MS: readonly number[] = [
  MINUTE_MS,
  5 * MINUTE_MS,
  30 * MINUTE_MS,
  3 * HOUR_MS,
];

// How often the sidebar re-grades the rows. Well under the 1-minute bound of
// grade 0, so a tab leaves it at most 15 s late.
export const TAB_AGE_REGRADE_INTERVAL_MS = 15 * SECOND_MS;

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseTabAgeHighlightStyle(value: unknown): TabAgeHighlightStyle
{
  return TAB_AGE_HIGHLIGHT_STYLES.find(style => style === value) ?? DEFAULT_TAB_AGE_HIGHLIGHT_STYLE;
}

/**
 * Whether the background keeps the tab activity records: auto-archive needs
 * them, and so do the highlight and the unvisited tab marker. Records are
 * dropped only when all three are off.
 */
export function isTabActivityRecording(
  period: AutoArchivePeriod,
  style: TabAgeHighlightStyle,
  marker: UnvisitedTabMarkerSetting
): boolean
{
  return period !== 'never' || style !== 'off' || marker === 'on';
}

/**
 * The grade (0 = freshest) of a tab last used at `lastUsedAt`, or undefined
 * when the time is unknown or older than 3 hours. A time in the future
 * (clock skew) counts as fresh.
 */
export function tabAgeGrade(lastUsedAt: number | undefined, now: number): number | undefined
{
  if (lastUsedAt === undefined) return undefined;
  const age = Math.max(0, now - lastUsedAt);
  const grade = GRADE_UPPER_BOUNDS_MS.findIndex(bound => age <= bound);
  return grade === -1 ? undefined : grade;
}

/**
 * A tab's last use for the highlight: the newer of the moment the user left it
 * (`leftAt`, from the tab activity records) and the moment it last became
 * active (Chrome's `lastAccessed`). A tab never left since the records started
 * falls back to `lastAccessed`; a tab opened in the background has
 * `lastAccessed` set at creation.
 */
export function tabLastUseForHighlight(leftAt?: number, lastAccessed?: number): number | undefined
{
  return newerTime(leftAt, lastAccessed);
}
