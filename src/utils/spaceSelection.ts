import { isTaskSpace } from './taskSpaces.ts';

export interface SpaceIdentity
{
  id: string;
  task?: unknown;
}

// A fallback prefers a regular Space: a Task Space is hidden from the Space bar strip,
// so landing on one would leave the user in a Space they didn't pick and can't see.
function fallbackSpaceId(spaces: readonly SpaceIdentity[]): string | null
{
  return (spaces.find(space => !isTaskSpace(space)) ?? spaces[0])?.id ?? null;
}

/**
 * The `all` saved by older versions and deleted IDs both fall back to the first real Space.
 */
export function resolveActiveSpaceId(
  spaces: readonly SpaceIdentity[],
  requestedSpaceId: string,
): string | null
{
  if (spaces.some(space => space.id === requestedSpaceId))
  {
    return requestedSpaceId;
  }

  return fallbackSpaceId(spaces);
}

/**
 * Picks an adjacent Space, so deleting the current one never lands back on the old All view.
 * The neighbour comes from the deleted Space's own group (regular or Task), since the two
 * groups are shown apart and a neighbour in the other group isn't next to it on screen.
 */
export function resolveSpaceIdAfterDeletion(
  spaces: readonly SpaceIdentity[],
  deletedSpaceId: string,
  activeSpaceId: string,
): string | null
{
  if (activeSpaceId !== deletedSpaceId && spaces.some(space => space.id === activeSpaceId))
  {
    return activeSpaceId;
  }

  const deleted = spaces.find(space => space.id === deletedSpaceId);
  if (!deleted)
  {
    return resolveActiveSpaceId(spaces, activeSpaceId);
  }

  const group = spaces.filter(space => isTaskSpace(space) === isTaskSpace(deleted));
  const deletedIndex = group.indexOf(deleted);
  const neighbour = group[deletedIndex + 1] ?? group[deletedIndex - 1];
  if (neighbour)
  {
    return neighbour.id;
  }

  return fallbackSpaceId(spaces.filter(space => space.id !== deletedSpaceId));
}
