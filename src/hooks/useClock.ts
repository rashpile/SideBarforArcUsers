import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` so the caller re-renders.
 * Stops ticking while `enabled` is false and catches up when it turns true again.
 */
export function useClock(enabled: boolean, intervalMs: number): number
{
  const [now, setNow] = useState(() => Date.now());

  useEffect(() =>
  {
    if (!enabled) return;

    setNow(Date.now());
    const intervalId = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(intervalId);
  }, [enabled, intervalMs]);

  return now;
}
