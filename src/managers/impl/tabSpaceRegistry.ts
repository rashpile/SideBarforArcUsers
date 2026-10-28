// TabSpaceRegistry - authoritative Space assignment for every real Chrome Tab.
//
// Background-side implementation of shared/tabSpaceRegistryApi.ts. Only
// The sidebar reads and mutates assignments through proxies/tabSpaceRegistryProxy.ts.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import { TAB_SPACE_ASSIGNMENTS_CHANGED } from '../shared/tabSpaceRegistryApi.ts';
import type { TabSpaceRegistryApi } from '../shared/tabSpaceRegistryApi.ts';
import { matchStoredTabs } from '../../utils/storedTabMatcher.ts';

export class TabSpaceRegistry implements RoutedManager, TabSpaceRegistryApi
{
  static STORAGE_KEY = 'tabSpaceAssignments';
  static LEGACY_SESSION_KEY = 'bg_tabSpaces';

  readonly managerId = ManagerId.TAB_SPACE_REGISTRY;

  // Map<windowId, Map<tabId, spaceId>>
  #registry: Map<number, Map<number, string>> = new Map();
  #tabMetadata = new Map<string, { url: string; index: number }>();

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    switch (method)
    {
      case 'register':
        return this.register(message.windowId as number, message.tabId as number, message.spaceId as string);

      case 'unregister':
        return this.unregister(message.windowId as number, message.tabId as number);

      case 'getWindowAssignments':
        return this.getWindowAssignments(message.windowId as number);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  async register(windowId: number, tabId: number, spaceId: string): Promise<void>
  {
    if (!this.#registry.has(windowId))
    {
      this.#registry.set(windowId, new Map());
    }
    this.#registry.get(windowId)!.set(tabId, spaceId);
    try
    {
      const tab = await chrome.tabs.get(tabId);
      this.#tabMetadata.set(`${windowId}:${tabId}`, { url: tab.url ?? '', index: tab.index });
    }
    catch { /* Tab may close between creation and registration. */ }
    await this.save();
    this.broadcast(windowId);
  }

  getSpace(windowId: number, tabId: number): string | undefined
  {
    return this.#registry.get(windowId)?.get(tabId);
  }

  async unregister(windowId: number, tabId: number): Promise<void>
  {
    this.#registry.get(windowId)?.delete(tabId);
    this.#tabMetadata.delete(`${windowId}:${tabId}`);
    await this.save();
    this.broadcast(windowId);
  }

  getWindowAssignments(windowId: number): Record<number, string>
  {
    return Object.fromEntries(this.#registry.get(windowId) ?? []);
  }

  private async save(): Promise<void>
  {
    const data: Array<{ windowId: number; tabId: number; spaceId: string; url: string; index: number }> = [];
    for (const [windowId, tabMap] of this.#registry)
    {
      for (const [tabId, spaceId] of tabMap)
      {
        const metadata = this.#tabMetadata.get(`${windowId}:${tabId}`) ?? { url: '', index: -1 };
        data.push({ windowId, tabId, spaceId, ...metadata });
      }
    }
    await chrome.storage.local.set({ [TabSpaceRegistry.STORAGE_KEY]: data });
  }

  removeWindow(windowId: number): void
  {
    this.#registry.delete(windowId);
    for (const key of this.#tabMetadata.keys())
    {
      if (key.startsWith(`${windowId}:`)) this.#tabMetadata.delete(key);
    }
    void this.save();
  }

  /** Tab 排序或批量移动后刷新持久化恢复所需的 URL/index 元数据。 */
  async refreshWindowMetadata(windowId: number): Promise<void>
  {
    const assignments = this.#registry.get(windowId);
    if (!assignments || assignments.size === 0) return;

    const tabs = await chrome.tabs.query({ windowId });
    for (const tab of tabs)
    {
      if (tab.id === undefined || !assignments.has(tab.id)) continue;
      this.#tabMetadata.set(`${windowId}:${tab.id}`, { url: tab.url ?? '', index: tab.index });
    }
    await this.save();
  }

  /**
   * Re-attach the stored assignments to the live tabs at worker start.
   * `sameBrowserSession` is true on a worker restart within the browser session
   * that stored them (BrowserSessionMarker), when their tab IDs are exact.
   */
  async load(sameBrowserSession: boolean): Promise<void>
  {
    const [localResult, legacyResult] = await Promise.all([
      chrome.storage.local.get([TabSpaceRegistry.STORAGE_KEY]),
      chrome.storage.session.get([TabSpaceRegistry.LEGACY_SESSION_KEY]),
    ]);
    const data = Array.isArray(localResult[TabSpaceRegistry.STORAGE_KEY])
      ? localResult[TabSpaceRegistry.STORAGE_KEY] as Array<{
        windowId: number; tabId: number; spaceId: string; url: string; index: number;
      }>
      : [];
    const tabs = await chrome.tabs.query({});
    const liveTabs = new Map<number, chrome.tabs.Tab>(
      tabs.flatMap(tab => tab.id === undefined ? [] : [[tab.id, tab] as const])
    );

    // Re-attach each stored assignment. On a worker restart a record keeps the tab with its ID in
    // its window whatever page that tab shows now: the stored URL lags a navigation that happened
    // while the worker slept. After a browser restart or an extension reload/update the ID counts
    // only on the record's site, since Chrome hands out low IDs again. The rest are found by URL
    // and position.
    const idMatch = sameBrowserSession ? 'sameWindow' : 'sameWindowAndSite';
    for (const { record, tab } of matchStoredTabs(data, tabs, { idMatch }))
    {
      if (!this.#registry.has(tab.windowId)) this.#registry.set(tab.windowId, new Map());
      this.#registry.get(tab.windowId)!.set(tab.id, record.spaceId);
      this.#tabMetadata.set(`${tab.windowId}:${tab.id}`, { url: tab.url ?? '', index: tab.index });
    }

    // 一次性兼容旧 session 数据，避免升级当下丢失仍打开 Tab 的归属。
    const legacy = legacyResult[TabSpaceRegistry.LEGACY_SESSION_KEY];
    if (Array.isArray(legacy))
    {
      for (const [windowId, entries] of legacy)
      {
        for (const [tabId, spaceId] of entries)
        {
          const tab = liveTabs.get(tabId);
          if (!tab || tab.windowId !== windowId || this.getSpace(windowId, tabId)) continue;
          if (!this.#registry.has(windowId)) this.#registry.set(windowId, new Map());
          this.#registry.get(windowId)!.set(tabId, spaceId);
          this.#tabMetadata.set(`${windowId}:${tabId}`, { url: tab.url ?? '', index: tab.index });
        }
      }
    }
    await this.save();
  }

  private broadcast(windowId: number): void
  {
    chrome.runtime.sendMessage({
      action: TAB_SPACE_ASSIGNMENTS_CHANGED,
      windowId,
      assignments: this.getWindowAssignments(windowId),
    }).catch(() => {});
  }
}
