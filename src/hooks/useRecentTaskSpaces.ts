import { useMemo } from 'react';
import { useSpacesContext } from '../contexts/SpacesContext';
import { useChromeLocalStorage } from './useChromeLocalStorage';
import { useClock } from './useClock';
import { useHiddenTaskSpaces } from './useHiddenTaskSpaces';
import { TASK_SPACE_LAST_USE_KEY, TaskSpaceLastUse } from '../stores/taskSpaceLastUse';
import { recentTaskSpaces, RecentTaskSpaces } from '../utils/recentTaskSpaces';
import { Space } from '../utils/spaceMessages';

const CLOCK_INTERVAL_MS = 60_000;

export interface RecentTaskSpacesState
{
  recent: RecentTaskSpaces<Space>;
  // The clock the selection used; the rows' time labels read against the same value
  now: number;
}

/**
 * The Task Spaces in the recent list above the Space buttons. The list and swipe both read it,
 * so swipe goes only to Task Spaces the list shows.
 */
export function useRecentTaskSpaces(): RecentTaskSpacesState
{
  const { spaces, activeSpaceId } = useSpacesContext();
  const [storedLastUse] = useChromeLocalStorage<unknown>(TASK_SPACE_LAST_USE_KEY, {});
  const lastUse = useMemo(() => TaskSpaceLastUse.fromStored(storedLastUse), [storedLastUse]);
  const hidden = useHiddenTaskSpaces();
  const now = useClock(true, CLOCK_INTERVAL_MS);

  const recent = useMemo(
    () => recentTaskSpaces({ spaces, activeSpaceId, lastUse, hidden, now }),
    [spaces, activeSpaceId, lastUse, hidden, now]
  );

  return { recent, now };
}
