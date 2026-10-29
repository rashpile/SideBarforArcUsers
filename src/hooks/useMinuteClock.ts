import { useEffect, useState } from 'react';
import { MINUTE_MS } from '../utils/autoArchive';

/**
 * The current time, refreshed once a minute so the caller re-renders. Stops
 * ticking while `enabled` is false and catches up when it turns true again.
 */
export function useMinuteClock(enabled: boolean): number
{
  const [now, setNow] = useState(() => Date.now());

  useEffect(() =>
  {
    if (!enabled) return;

    setNow(Date.now());
    const intervalId = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(intervalId);
  }, [enabled]);

  return now;
}
