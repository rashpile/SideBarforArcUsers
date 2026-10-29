export interface SpaceIdentity {
  id: string;
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

  return spaces[0]?.id ?? null;
}

/**
 * Picks an adjacent Space, so deleting the current one never lands back on the old All view.
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

  const deletedIndex = spaces.findIndex(space => space.id === deletedSpaceId);
  if (deletedIndex === -1)
  {
    return resolveActiveSpaceId(spaces, activeSpaceId);
  }

  return spaces[deletedIndex + 1]?.id
    ?? spaces[deletedIndex - 1]?.id
    ?? null;
}
