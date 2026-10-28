// "Archive tabs after" setting (feature 035): how long a tab may stay unused
// before the background closes it. Regular tabs are saved to the Space's
// archive folder first; open bookmark pages are closed without archiving.

/** Stored setting values. '1m' exists only for manual testing in DEV builds. */
export type AutoArchivePeriod = 'never' | '1m' | '12h' | '24h' | '3d' | '7d' | '30d';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by background.ts.
export const AUTO_ARCHIVE_AFTER_KEY = 'autoArchiveAfter';

// chrome.storage.local key, epoch millis of the moment the setting went from
// 'never' to a period. background.ts is the only writer; no tab is closed
// earlier than one period after this moment.
export const AUTO_ARCHIVE_ENABLED_AT_KEY = 'autoArchiveEnabledAt';

// Default: an update never starts closing anyone's tabs on its own.
export const DEFAULT_AUTO_ARCHIVE_PERIOD: AutoArchivePeriod = 'never';

// Short period offered only by DEV builds, for manual testing.
const DEV_AUTO_ARCHIVE_PERIOD: AutoArchivePeriod = '1m';

// Values every build accepts.
const AUTO_ARCHIVE_PERIODS: readonly AutoArchivePeriod[] = ['never', '12h', '24h', '3d', '7d', '30d'];

export const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Parse a stored value, falling back to 'never' for absent/unknown values.
 * '1m' is accepted only when allowDevPeriod is set (callers pass
 * import.meta.env.DEV), so a value left over from a DEV build never makes a
 * release build close tabs after a minute.
 */
export function parseAutoArchivePeriod(value: unknown, allowDevPeriod = false): AutoArchivePeriod
{
  if (value === DEV_AUTO_ARCHIVE_PERIOD)
  {
    return allowDevPeriod ? DEV_AUTO_ARCHIVE_PERIOD : DEFAULT_AUTO_ARCHIVE_PERIOD;
  }
  return AUTO_ARCHIVE_PERIODS.find(period => period === value) ?? DEFAULT_AUTO_ARCHIVE_PERIOD;
}

/** How long a tab may stay unused under this period; null for 'never'. */
export function autoArchivePeriodMs(period: AutoArchivePeriod): number | null
{
  switch (period)
  {
    case 'never': return null;
    case '1m': return MINUTE_MS;
    case '12h': return 12 * HOUR_MS;
    case '24h': return 24 * HOUR_MS;
    case '3d': return 3 * DAY_MS;
    case '7d': return 7 * DAY_MS;
    case '30d': return 30 * DAY_MS;
  }
}

/**
 * What a change of the stored setting means for the background:
 * - 'off': the new value is Never - drop the start time and the last-use records;
 * - 'on': Never to a period - every tab's clock starts now (grace);
 * - 'unchanged': one period to another - the start time is kept, no grace.
 * Values are parsed like everywhere else, so a '1m' left over from a DEV build
 * counts as Never in a release build.
 */
export function autoArchiveSwitch(
  change: { oldValue?: unknown; newValue?: unknown },
  allowDevPeriod = false
): 'on' | 'off' | 'unchanged'
{
  if (parseAutoArchivePeriod(change.newValue, allowDevPeriod) === 'never') return 'off';
  return parseAutoArchivePeriod(change.oldValue, allowDevPeriod) === 'never' ? 'on' : 'unchanged';
}
