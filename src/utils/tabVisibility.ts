/**
 * 返回未被书签或 Favorite 关联管理的 Chrome Tab。
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

/** 按扩展持有的 tabId → spaceId 关联筛选普通 Tab，Chrome groupId 不参与判断。 */
export function filterTabsForSpace<T extends { id?: number }>(
  tabs: readonly T[],
  assignments: Readonly<Record<number, string>>,
  spaceId: string
): T[]
{
  return tabs.filter(tab => tab.id !== undefined && assignments[tab.id] === spaceId);
}
