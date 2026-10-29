export interface RestoredTabAssociations
{
  associations: Record<number, string>;
  itemToTab: Map<string, number>;
  tabToItem: Map<number, string>;
  tabTitles: Map<number, string>;
  audibleTabs: Set<number>;
  mutedTabs: Set<number>;
}

type GetTab = (tabId: number) => Promise<chrome.tabs.Tab | null>;

/**
 * The session wins; the backup only fills in missing tabs that still exist, and each itemKey
 * stays on one tab.
 */
export function mergeRestoredTabAssociations(
  sessionAssociations: Record<number, string>,
  backupAssociations: Record<number, string>,
  validTabIds: ReadonlySet<number>
): Record<number, string>
{
  const merged: Record<number, string> = {};
  const claimedItemKeys = new Set<string>();

  for (const [tabIdText, itemKey] of Object.entries(sessionAssociations))
  {
    const tabId = Number(tabIdText);
    if (!validTabIds.has(tabId) || claimedItemKeys.has(itemKey)) continue;
    merged[tabId] = itemKey;
    claimedItemKeys.add(itemKey);
  }

  for (const [tabIdText, itemKey] of Object.entries(backupAssociations))
  {
    const tabId = Number(tabIdText);
    if (!validTabIds.has(tabId) || merged[tabId] || claimedItemKeys.has(itemKey)) continue;
    merged[tabId] = itemKey;
    claimedItemKeys.add(itemKey);
  }

  return merged;
}

/**
 * The Chrome API calls are independent, so running them concurrently keeps the startup wait from
 * growing linearly with the number of associations.
 */
export async function restoreTabAssociations(
  associations: Record<number, string>,
  getTab: GetTab
): Promise<RestoredTabAssociations>
{
  const entries = Object.entries(associations).map(([tabId, itemKey]) => ({
    tabId: Number(tabId),
    itemKey,
  }));

  const validated = await Promise.all(entries.map(async ({ tabId, itemKey }) => ({
    tabId,
    itemKey,
    tab: await getTab(tabId),
  })));

  const result: RestoredTabAssociations = {
    associations: {},
    itemToTab: new Map(),
    tabToItem: new Map(),
    tabTitles: new Map(),
    audibleTabs: new Set(),
    mutedTabs: new Set(),
  };

  for (const { tabId, itemKey, tab } of validated)
  {
    if (!tab) continue;

    result.associations[tabId] = itemKey;
    result.itemToTab.set(itemKey, tabId);
    result.tabToItem.set(tabId, itemKey);
    if (tab.title) result.tabTitles.set(tabId, tab.title);
    if (tab.audible) result.audibleTabs.add(tabId);
    if (tab.mutedInfo?.muted) result.mutedTabs.add(tabId);
  }

  return result;
}
