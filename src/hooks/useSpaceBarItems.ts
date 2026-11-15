import { useEffect, useMemo, useState } from 'react';
import { useSpacesContext } from '../contexts/SpacesContext';
import { useChromeLocalStorage } from './useChromeLocalStorage';
import { TASK_SPACE_LAST_USE_KEY, TaskSpaceLastUse } from '../stores/taskSpaceLastUse';
import { spaceBarItems, SpaceBarItems } from '../utils/spaceBarItems';
import { Space } from '../utils/spaceMessages';

/**
 * The Space bar's regular and temporary Spaces. The strip and swipe both read it, so swipe
 * follows the same expiry rule and never lands on an icon the strip no longer shows.
 */
export function useSpaceBarItems(): SpaceBarItems<Space>
{
  const { spaces, activeSpaceId } = useSpacesContext();
  const [storedLastUse] = useChromeLocalStorage<unknown>(TASK_SPACE_LAST_USE_KEY, {});
  const lastUse = useMemo(() => TaskSpaceLastUse.fromStored(storedLastUse), [storedLastUse]);
  const [now, setNow] = useState(() => Date.now());

  const items = useMemo(
    () => spaceBarItems(spaces, activeSpaceId, lastUse, now),
    [spaces, activeSpaceId, lastUse, now]
  );

  const { nextExpiryAt } = items;
  useEffect(() =>
  {
    if (nextExpiryAt === undefined) return;

    // At least the expiry itself: a timer firing a millisecond early would otherwise keep the
    // icon, with nothing left scheduled to remove it
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), nextExpiryAt)),
      Math.max(0, nextExpiryAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [nextExpiryAt]);

  return items;
}
