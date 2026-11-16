// Which Task Spaces the recent list above the Space buttons shows, and where a swipe goes.
// Task Spaces stay out of the Space bar strip; this list keeps the last few within one click.

import { isTaskSpace } from './taskSpaces.ts';

export const RECENT_TASK_SPACES_WINDOW_MS = 24 * 60 * 60_000;
export const RECENT_TASK_SPACES_LIMIT = 3;

export interface RecentSpace
{
  id: string;
  task?: { createdAt: number };
}

export interface LastUseLookup
{
  lastUsedAt(spaceId: string): number | undefined;
}

export interface HiddenLookup
{
  isHidden(spaceId: string): boolean;
}

export interface RecentTaskSpacesInput<T>
{
  // Live Spaces; regular ones are ignored
  spaces: readonly T[];
  // This window's
  activeSpaceId: string | null;
  lastUse: LastUseLookup;
  hidden: HiddenLookup;
  now: number;
}

export interface RecentTaskSpaceRow<T>
{
  space: T;
  recentAt: number;
  isActive: boolean;
}

function createdAt(space: RecentSpace): number
{
  return space.task?.createdAt ?? 0;
}

export class RecentTaskSpaces<T extends RecentSpace>
{
  // Oldest first, so the most recent sits next to the Space buttons; the active Space is last
  readonly rows: readonly RecentTaskSpaceRow<T>[];

  constructor(rows: readonly RecentTaskSpaceRow<T>[])
  {
    this.rows = rows;
  }

  get isEmpty(): boolean
  {
    return this.rows.length === 0;
  }

  /**
   * The listed Spaces oldest-created first. Swipe uses this order because the rows reorder on
   * every switch, and swiping in row order would bounce between the same two Spaces.
   */
  byCreation(): T[]
  {
    return this.rows.map(row => row.space).sort((a, b) => createdAt(a) - createdAt(b));
  }
}

export function recentTaskSpaces<T extends RecentSpace>(input: RecentTaskSpacesInput<T>): RecentTaskSpaces<T>
{
  const { spaces, activeSpaceId, lastUse, hidden, now } = input;
  const candidates = spaces.filter(space => isTaskSpace(space) && !hidden.isHidden(space.id));

  // The active Space ranks newest whatever the stored times say: `now` comes from a once-a-minute
  // clock, while background stamps the Space just left, and createTaskSpace stamps a new Task
  // Space's createdAt, with the real time, so ranking by time would put the active Space above
  // the one just left or push it out of the list.
  const active = candidates.find(space => space.id === activeSpaceId);
  const slots = RECENT_TASK_SPACES_LIMIT - (active ? 1 : 0);

  const others = candidates
    .filter(space => space !== active)
    .map((space): RecentTaskSpaceRow<T> =>
    {
      const recentAt = Math.max(createdAt(space), lastUse.lastUsedAt(space.id) ?? 0);
      return { space, recentAt, isActive: false };
    })
    .filter(row => now - row.recentAt < RECENT_TASK_SPACES_WINDOW_MS)
    .sort((a, b) => (b.recentAt - a.recentAt) || (createdAt(b.space) - createdAt(a.space)))
    .slice(0, slots)
    .reverse();

  const rows = active ? [...others, { space: active, recentAt: now, isActive: true }] : others;
  return new RecentTaskSpaces(rows);
}

/** `now`, `5m` or `2h`. A time after the clock's `now` (the clock lags by up to a minute) reads `now`. */
export function recentAgeLabel(row: { recentAt: number; isActive: boolean }, now: number): string
{
  const minutes = Math.floor((now - row.recentAt) / 60_000);
  if (row.isActive || minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/**
 * The Space a swipe opens: `left` goes to the next one in `order`, `right` to the previous one.
 * Undefined at either end, and when the active Space isn't in `order` (a hidden or old Task
 * Space), since there is no place in the order to swipe from.
 */
export function swipeTarget<T extends { id: string }>(
  order: readonly T[],
  activeSpaceId: string | null,
  direction: 'left' | 'right',
): T | undefined
{
  const index = order.findIndex(space => space.id === activeSpaceId);
  if (index === -1) return undefined;
  return order[direction === 'left' ? index + 1 : index - 1];
}
