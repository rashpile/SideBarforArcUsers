// Which Spaces the Space bar strip shows. Task Spaces stay out of the strip, except as a
// temporary icon while one is this window's active Space and for a while after its last use,
// so a Task Space the user just left is still one click (or swipe) away.

import { isTaskSpace } from './taskSpaces.ts';

export const TEMPORARY_TASK_SPACE_ICON_MS = 10 * 60_000;

export interface StripSpace
{
  id: string;
  task?: { createdAt: number };
}

export interface LastUseLookup
{
  lastUsedAt(spaceId: string): number | undefined;
}

export interface SpaceBarItems<T>
{
  // The sortable strip, in the Space list's order
  regular: T[];
  // Task Spaces shown after the strip, oldest first
  temporary: T[];
  // When the next temporary icon goes away; undefined when none will on its own
  nextExpiryAt?: number;
}

export function spaceBarItems<T extends StripSpace>(
  spaces: readonly T[],
  activeSpaceId: string | null,
  lastUse: LastUseLookup,
  now: number,
): SpaceBarItems<T>
{
  const regular: T[] = [];
  const temporary: T[] = [];
  let nextExpiryAt: number | undefined;

  for (const space of spaces)
  {
    if (!isTaskSpace(space))
    {
      regular.push(space);
      continue;
    }

    if (space.id === activeSpaceId)
    {
      // Shown for as long as it is active, so its expiry would change nothing
      temporary.push(space);
      continue;
    }

    const lastUsedAt = lastUse.lastUsedAt(space.id);
    if (lastUsedAt === undefined || now - lastUsedAt >= TEMPORARY_TASK_SPACE_ICON_MS) continue;

    temporary.push(space);
    const expiresAt = lastUsedAt + TEMPORARY_TASK_SPACE_ICON_MS;
    nextExpiryAt = nextExpiryAt === undefined ? expiresAt : Math.min(nextExpiryAt, expiresAt);
  }

  temporary.sort((a, b) => (a.task?.createdAt ?? 0) - (b.task?.createdAt ?? 0));
  return { regular, temporary, nextExpiryAt };
}
