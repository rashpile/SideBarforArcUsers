// Time units in milliseconds, and small helpers for epoch-millis times.

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The newer of two times, either of which may be unknown; undefined when both are. */
export function newerTime(a: number | undefined, b: number | undefined): number | undefined
{
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
