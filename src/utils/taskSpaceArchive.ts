// "Archive Task Spaces after" setting: how long a Task Space may stay unused before the
// background saves its tabs to the Space's Archive, closes them and moves the Space to the
// archived list. The period counts from the Task Space's last use, or from its creation when
// it was never used.

import type { TaskSpaceLastUse } from '../stores/taskSpaceLastUse.ts';
import { DAY_MS, MINUTE_MS, newerTime } from './time.ts';

/** Stored setting values. '1m' exists only for manual testing in DEV builds. */
export type TaskSpaceArchivePeriod = 'never' | '1m' | '1d' | '3d' | '7d' | '14d' | '30d';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by background.ts.
export const TASK_SPACE_ARCHIVE_AFTER_KEY = 'taskSpaceArchiveAfter';

// Default: an update never starts closing anyone's Task Spaces on its own.
export const DEFAULT_TASK_SPACE_ARCHIVE_PERIOD: TaskSpaceArchivePeriod = 'never';

const DEV_TASK_SPACE_ARCHIVE_PERIOD: TaskSpaceArchivePeriod = '1m';

// Values every build accepts.
const TASK_SPACE_ARCHIVE_PERIODS: readonly TaskSpaceArchivePeriod[] = ['never', '1d', '3d', '7d', '14d', '30d'];

/**
 * Parse a stored value, falling back to 'never' for absent/unknown values.
 * '1m' is accepted only when allowDevPeriod is set (callers pass
 * import.meta.env.DEV), so a value left over from a DEV build never makes a
 * release build archive Task Spaces after a minute.
 */
export function parseTaskSpaceArchivePeriod(value: unknown, allowDevPeriod = false): TaskSpaceArchivePeriod
{
  if (value === DEV_TASK_SPACE_ARCHIVE_PERIOD)
  {
    return allowDevPeriod ? DEV_TASK_SPACE_ARCHIVE_PERIOD : DEFAULT_TASK_SPACE_ARCHIVE_PERIOD;
  }
  return TASK_SPACE_ARCHIVE_PERIODS.find(period => period === value) ?? DEFAULT_TASK_SPACE_ARCHIVE_PERIOD;
}

/** How long a Task Space may stay unused under this period; null for 'never'. */
export function taskSpaceArchivePeriodMs(period: TaskSpaceArchivePeriod): number | null
{
  switch (period)
  {
    case 'never': return null;
    case '1m': return MINUTE_MS;
    case '1d': return DAY_MS;
    case '3d': return 3 * DAY_MS;
    case '7d': return 7 * DAY_MS;
    case '14d': return 14 * DAY_MS;
    case '30d': return 30 * DAY_MS;
  }
}

export interface ArchivableSpace
{
  id: string;
  task?: { createdAt: number };
}

export interface TaskSpaceArchiveSelection
{
  spaces: readonly ArchivableSpace[];
  lastUse: Pick<TaskSpaceLastUse, 'lastUsedAt'>;
  // The active Space of every open window
  activeSpaceIds: Iterable<string>;
  now: number;
  periodMs: number;
}

/**
 * Ids of the live Task Spaces unused for at least the period. A Task Space that is the active
 * Space of any window is in use however old its last touch is, so it is never picked. A last
 * use ahead of the clock (the clock was set back) keeps the Space rather than archiving it.
 */
export function selectTaskSpacesToArchive(selection: TaskSpaceArchiveSelection): string[]
{
  const active = new Set(selection.activeSpaceIds);
  const selected: string[] = [];
  for (const space of selection.spaces)
  {
    // Regular Spaces have no task marker and never archive
    if (!space.task || active.has(space.id)) continue;

    // createdAt counts as a use, so a Task Space made and never entered still gets its full period
    const usedAt = newerTime(space.task.createdAt, selection.lastUse.lastUsedAt(space.id));
    if (usedAt !== undefined && selection.now - usedAt >= selection.periodMs)
    {
      selected.push(space.id);
    }
  }
  return selected;
}
