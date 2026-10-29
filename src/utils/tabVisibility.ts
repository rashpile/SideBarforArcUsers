/**
 * Only an actual association hides a tab: a tab opened by hand on a bookmarked
 * URL is not shown under that bookmark, so it must stay visible as a regular tab.
 */
export function filterUnmanagedTabs<T extends { id?: number }>(
  tabs: readonly T[],
  managedTabIds: ReadonlySet<number>
): T[]
{
  return tabs.filter(tab => tab.id === undefined || !managedTabIds.has(tab.id));
}

/** Space membership comes from the extension's tabId → spaceId map, never from Chrome groupId. */
export function filterTabsForSpace<T extends { id?: number }>(
  tabs: readonly T[],
  assignments: Readonly<Record<number, string>>,
  spaceId: string
): T[]
{
  return tabs.filter(tab => tab.id !== undefined && assignments[tab.id] === spaceId);
}
