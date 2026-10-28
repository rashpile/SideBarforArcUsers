import { SpaceMessageAction } from './utils/spaceMessages';
import { FOLLOW_ACTIVE_TAB_KEY, parseFollowActiveTabMode } from './utils/followActiveTab';
import { getTabAssociations, storeTabAssociation, removeTabAssociation, saveTabAssociationBackup, removeTabAssociationBackup, updateTabAssociationBackupIndices, removeWindowAssociationBackup, restoreTabAssociationBackup, WAIT_FOR_TAB_ASSOCIATIONS_READY, BOOKMARK_ITEM_KEY_PREFIX } from './utils/tabAssociations';
import { fetchFaviconAsBase64, getFaviconUrl } from './utils/favicon';
import { parseManagerActionId, RoutedManager } from './managers/proxies/messageRouting';
import { SpaceWindowStateManager } from './managers/impl/spaceWindowStateManager';
import { TabSpaceRegistry } from './managers/impl/tabSpaceRegistry';
import { SpaceManager } from './managers/impl/spaceManager';
import { TabHistoryManager } from './managers/impl/tabHistoryManager';
import { LastAudibleTracker } from './managers/impl/lastAudibleTracker';
import { PinnedSitesManager } from './managers/impl/pinnedSitesManager';
import { TabAssociationReadiness } from './utils/tabAssociationReadiness';
import { resolveActiveSpaceId } from './utils/spaceSelection';
import { findParkedReplacementTab, getEffectiveTabUrl, parseParkedTabUrl } from './utils/parkedTabAssociation';
import { BookmarkRecencyStore } from './stores/bookmarkRecencyStore';
import { BrowserSessionMarker } from './stores/browserSessionMarker';
import { TabActivityTracker } from './stores/tabActivityTracker';
import { queryOpenTabs, readAutoArchivePeriod, TabAutoArchiver } from './services/tabAutoArchiver';
import { AUTO_ARCHIVE_AFTER_KEY } from './utils/autoArchive';

// Set side panel to open when clicking the extension toolbar button
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// NewsVersionChecker - Fetches latest news version from GitHub (at most once/week)
// =============================================================================

class NewsVersionChecker
{
  static LATEST_VERSION_URL =
    'https://monemone-org.github.io/ChromeSideBar/public/latest.version';
  static STORAGE_KEY_VERSION = 'sidebar-news-latest-version';
  static STORAGE_KEY_CHECK_TIME = 'sidebar-last-news-check-time';
  static CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

  #cachedVersion = 0;

  getCachedVersion(): number
  {
    return this.#cachedVersion;
  }

  async load(): Promise<void>
  {
    const result = await chrome.storage.local.get([NewsVersionChecker.STORAGE_KEY_VERSION]);
    const stored = parseInt(String(result[NewsVersionChecker.STORAGE_KEY_VERSION] ?? 0), 10);
    this.#cachedVersion = isNaN(stored) ? 0 : stored;
    await this.checkIfDue();
  }

  // Fetch from GitHub if enough time has passed since last check
  async checkIfDue(): Promise<void>
  {
    const result = await chrome.storage.local.get([NewsVersionChecker.STORAGE_KEY_CHECK_TIME]);
    const lastCheckTime = parseInt(String(result[NewsVersionChecker.STORAGE_KEY_CHECK_TIME] ?? 0), 10) || 0;
    if (Date.now() - lastCheckTime >= NewsVersionChecker.CHECK_INTERVAL_MS)
    {
      this.fetchLatestVersion();
    }
  }

  private async fetchLatestVersion(): Promise<void>
  {
    try
    {
      const res = await fetch(NewsVersionChecker.LATEST_VERSION_URL);
      if (!res.ok) return;

      const text = await res.text();
      const fetched = parseInt(text.trim(), 10);
      if (isNaN(fetched)) return;

      this.#cachedVersion = fetched;

      if (import.meta.env.DEV)
      {
        console.log(`[NewsVersionChecker] Fetched news version: ${fetched}`);
      }

      await chrome.storage.local.set({
        [NewsVersionChecker.STORAGE_KEY_VERSION]: fetched,
        [NewsVersionChecker.STORAGE_KEY_CHECK_TIME]: Date.now()
      });
    }
    catch
    {
      // Silently skip — try again next week
    }
  }
}

// Forward declaration - will be initialized below
let tabSpaceRegistry: TabSpaceRegistry;

// Space 归属完全由扩展自己的 TabSpaceRegistry 决定；Chrome 原生 groupId 只属于用户。
async function getSpaceForTab(windowId: number, tabId: number): Promise<string | undefined>
{
  return tabSpaceRegistry.getSpace(windowId, tabId);
}

/**
 * Activates a tab and switches the sidebar to its space.
 *
 * Used by explicit user actions (audio quick-jump, audio tabs list, the
 * "show active tab" toolbar button), so it always switches space regardless of
 * the "Follow active tab" setting - that setting only governs passive following
 * in the onActivated listener.
 *
 * The space switch is performed here rather than left to onActivated: when the
 * requested tab is already the active one, Chrome fires no onActivated event, so
 * relying on that side effect would silently do nothing. When the tab really
 * does change, onActivated still fires but finds the space already correct.
 *
 * @param tabId - The tab to activate
 * @returns Object with success status and optional error
 */
async function setActiveTabAndSpace(
  tabId: number
): Promise<{ success: boolean; error?: string }>
{
  try
  {
    // Activate the tab. Our chrome.tabs.onActivated listener adds it to history.
    const tab = await chrome.tabs.update(tabId, { active: true });

    if (!tab.windowId)
    {
      return { success: false, error: 'Tab has no window' };
    }

    // 显式跳转始终跟随目标 Tab 的真实 Space。
    const persistedSpaceId = spaceStateManager.getActiveSpace(tab.windowId);
    const currentSpaceId = resolveActiveSpaceId(spaceManager.getSpaces(), persistedSpaceId);
    let destinationSpaceId = await getSpaceForTab(tab.windowId, tabId);

    if (currentSpaceId && currentSpaceId !== persistedSpaceId)
    {
      spaceStateManager.setActiveSpace(tab.windowId, currentSpaceId);
    }

    if (!destinationSpaceId && currentSpaceId)
    {
      await tabSpaceRegistry.register(tab.windowId, tabId, currentSpaceId);
      destinationSpaceId = currentSpaceId;
    }

    let spaceSwitched = false;
    if (destinationSpaceId && persistedSpaceId !== destinationSpaceId)
    {
      spaceStateManager.setActiveSpace(tab.windowId, destinationSpaceId);
      spaceSwitched = true;
    }

    // Tell the sidebar to scroll the tab into view. Flagged explicit so it
    // scrolls regardless of the "Follow active tab" setting - callers here are
    // deliberate user actions. This is the only scroll signal for keyboard
    // shortcuts, which never reach the sidebar, and for the "show active tab"
    // button, whose target is already active so onActivated never fires.
    chrome.runtime.sendMessage({
      action: SpaceMessageAction.TAB_ACTIVATED,
      windowId: tab.windowId,
      tabId,
      spaceSwitched,
      explicit: true
    }).catch(() =>
    {
      // Sidepanel may not be open - ignore error
    });

    return { success: true };
  }
  catch (error)
  {
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// Initialize trackers
// =============================================================================

const spaceStateManager = new SpaceWindowStateManager();
const spaceManager = new SpaceManager();
// setActiveTabAndSpace and getSpaceForTab are orchestration living here, so
// the manager takes them rather than importing them back out of this file -
// see TabHistoryDeps in managers/impl/tabHistoryManager.ts.
const historyManager = new TabHistoryManager({
  setActiveTabAndSpace,
  getSpaceForTab,
});
const pinnedSitesManager = new PinnedSitesManager();
// Reads the history manager's activation order, so it has to come after it.
const lastAudibleTracker = new LastAudibleTracker(historyManager);
tabSpaceRegistry = new TabSpaceRegistry();
const newsVersionChecker = new NewsVersionChecker();
// Last-use time of every tab, for auto-archive (feature 035). Background is the only writer;
// nothing is recorded while "Archive tabs after" is Never.
const tabActivityTracker = new TabActivityTracker({
  local: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
    remove: (key) => chrome.storage.local.remove(key),
  },
  session: {
    get: (key) => chrome.storage.session.get(key),
    set: (values) => chrome.storage.session.set(values),
    remove: (key) => chrome.storage.session.remove(key),
  },
  isRecording: async () => await readAutoArchivePeriod() !== 'never',
  getTab: (tabId) => chrome.tabs.get(tabId).catch(() => undefined),
});

/**
 * 后台启动时迁移每个窗口遗留的 all 或失效 Space ID。
 * 这一步在 stateReady 之前完成，避免侧边栏未打开时创建的新 Tab 失去归属。
 */
async function normalizeLoadedWindowSpaces(): Promise<void>
{
  const spaces = spaceManager.getSpaces();
  if (spaces.length === 0) return;

  const windows = await chrome.windows.getAll();
  for (const window of windows)
  {
    if (window.id === undefined) continue;
    const currentSpaceId = spaceStateManager.getActiveSpace(window.id);
    const resolvedSpaceId = resolveActiveSpaceId(spaces, currentSpaceId);
    if (resolvedSpaceId && resolvedSpaceId !== currentSpaceId)
    {
      spaceStateManager.setActiveSpace(window.id, resolvedSpaceId);
    }
  }
}

/**
 * 将旧版尚未登记的真实 Tab 迁移到内部 Space 关联。
 * 仅在迁移时读取已有原生组标题；迁移完成后原生组的任何变化都不再影响 Space。
 */
async function assignUntrackedTabsToSpaces(): Promise<void>
{
  const spaces = spaceManager.getSpaces();
  if (spaces.length === 0) return;

  const nameCounts = new Map<string, number>();
  for (const space of spaces)
  {
    nameCounts.set(space.name, (nameCounts.get(space.name) ?? 0) + 1);
  }

  const groups = await chrome.tabGroups.query({});
  const groupSpaceIds = new Map<number, string>();
  for (const group of groups)
  {
    const space = spaces.find(item => item.name === group.title);
    if (space && nameCounts.get(space.name) === 1) groupSpaceIds.set(group.id, space.id);
  }

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs)
  {
    if (tab.id === undefined || tab.windowId === undefined) continue;
    if (tabSpaceRegistry.getSpace(tab.windowId, tab.id)) continue;

    const activeSpaceId = resolveActiveSpaceId(
      spaces,
      spaceStateManager.getActiveSpace(tab.windowId)
    );
    const migratedSpaceId = groupSpaceIds.get(tab.groupId) ?? activeSpaceId;
    if (migratedSpaceId)
    {
      await tabSpaceRegistry.register(tab.windowId, tab.id, migratedSpaceId);
    }
  }
}

/**
 * 将旧映射明确记录的 Space 原生组无损解散，再清理已停用状态。
 * 只调用 ungroup，不关闭 Tab；没有出现在旧映射中的用户普通组不会受影响。
 */
async function detachLegacySpaceGroups(): Promise<void>
{
  const result = await chrome.storage.local.get('spaceTabGroupMappings');
  const mappings = result.spaceTabGroupMappings as Record<string, number> | undefined;
  const groupIds = new Set(Object.values(mappings ?? {}));
  for (const groupId of groupIds)
  {
    try
    {
      const tabs = await chrome.tabs.query({ groupId });
      const tabIds = tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]);
      if (tabIds.length > 0) await chrome.tabs.ungroup(tabIds);
    }
    catch { /* Group may already be closed or only remain as a Saved Group shortcut. */ }
  }

  await chrome.storage.local.remove([
    'spaceTabGroupMappings',
    'spaceTabGroupDiagnostics',
  ]);
}

// Attach the stored last-use records to the open tabs (or drop them while auto-archive is off).
// A failure here doesn't hold up the other managers: the tracker then refuses to refresh,
// and no tab is auto-archived.
async function loadTabActivity(): Promise<void>
{
  try
  {
    await tabActivityTracker.load(await queryOpenTabs());
  }
  catch (error)
  {
    console.error('[TabActivityTracker] failed to query tabs for load:', error);
  }
}

// Tells a worker restart (stored tab and window IDs are exact) from a browser restart or an
// extension reload/update (stored IDs may now belong to other tabs) for the startup restore below
const browserSessionMarker = new BrowserSessionMarker({
  get: (key) => chrome.storage.session.get(key),
  set: (values) => chrome.storage.session.set(values),
}, 'tabRestoreSessionStarted');

// Read once, before the startup restore rewrites the stored tab IDs. The marker is written only
// after that restore, so the first worker of a new browser session still finds it missing.
const sameBrowserSession = browserSessionMarker.isSameBrowserSession().then((same) =>
{
  if (import.meta.env.DEV)
  {
    console.log(same
      ? '[BrowserSessionMarker] worker restart: stored tab records matched by tab ID and window'
      : '[BrowserSessionMarker] new browser session or extension reload: tab ID matches also need the same site');
  }
  return same;
});

// 固定 Tab 关联必须在 manager 数据加载后恢复；Side Panel 会显式等待这一就绪点。
const managerLoadPromise = Promise.all([
  spaceStateManager.load(),
  spaceManager.load(),
  historyManager.load(),
  lastAudibleTracker.load(),
  pinnedSitesManager.load(),
  sameBrowserSession.then((same) => tabSpaceRegistry.load(same)),
  newsVersionChecker.load(),
  loadTabActivity()
])
  .then(normalizeLoadedWindowSpaces)
  .then(assignUntrackedTabsToSpaces)
  .then(detachLegacySpaceGroups);

// Restore the associations, then mark the browser session: the stored tab records now carry its
// tab IDs, so later worker starts match by ID. A failed load or restore leaves the marker unset.
async function restoreAssociationsAndMarkSession(): Promise<void>
{
  await restoreTabAssociationBackup(await sameBrowserSession);
  await browserSessionMarker.mark();
}

const tabAssociationReadiness = new TabAssociationReadiness(
  () => managerLoadPromise,
  restoreAssociationsAndMarkSession,
  (error) => console.error('[TabAssociationReadiness] initialization failed:', error)
);

// 所有事件和消息都等待同一个真实初始化流程，避免 Tab 在归属恢复和旧组迁移中途被处理。
const stateReady = tabAssociationReadiness.wait();

// =============================================================================
// Bookmark recency (feature 034) - last-active time per Arc-style bookmark tab,
// read by the sidebar's collapsed-folder popover. Background is the only writer.
// =============================================================================

const bookmarkRecencyStore = new BookmarkRecencyStore({
  get: (key) => chrome.storage.local.get(key),
  set: (values) => chrome.storage.local.set(values),
});

// Record the activation if the tab is a bookmark's Arc-style tab
function recordBookmarkActivation(windowId: number, tabId: number): void
{
  getTabAssociations(windowId)
    .then((associations) =>
    {
      const itemKey = associations[tabId];
      if (!itemKey?.startsWith(BOOKMARK_ITEM_KEY_PREFIX)) return;
      return bookmarkRecencyStore.touch(itemKey.slice(BOOKMARK_ITEM_KEY_PREFIX.length));
    })
    .catch((error) => console.error('[BookmarkRecency] failed to record activation:', error));
}

// Opening a bookmark from the sidebar activates the new tab before the sidebar
// stores its association, so onActivated finds nothing. Re-check the window's
// active tab whenever its associations change.
chrome.storage.onChanged.addListener((changes, areaName) =>
{
  if (areaName !== 'session') return;

  // Each changed tabAssociations_{windowId} key names a window to re-check
  for (const key of Object.keys(changes))
  {
    const match = /^tabAssociations_(\d+)$/.exec(key);
    if (!match) continue;

    const windowId = Number(match[1]);
    chrome.tabs.query({ active: true, windowId })
      .then(([tab]) =>
      {
        if (tab?.id !== undefined) recordBookmarkActivation(windowId, tab.id);
      })
      .catch(() => { /* Window may be gone */ });
  }
});

// Collect a removed node's id and, for folders, every descendant id
function collectBookmarkIds(node: chrome.bookmarks.BookmarkTreeNode): string[]
{
  return [node.id, ...(node.children ?? []).flatMap(collectBookmarkIds)];
}

chrome.bookmarks.onRemoved.addListener((id, removeInfo) =>
{
  const ids = removeInfo.node ? collectBookmarkIds(removeInfo.node) : [id];
  bookmarkRecencyStore.forget(ids)
    .catch((error) => console.error('[BookmarkRecency] failed to forget removed bookmarks:', error));
});

// =============================================================================
// Tab auto-archive (feature 035) - closes tabs unused for the "Archive tabs
// after" period, saving regular tabs to their Space's asd_Archive folder first.
// Works with the sidebar closed: once at worker start and on an alarm.
// =============================================================================

const tabAutoArchiver = new TabAutoArchiver({
  startupRestoreSucceeded: () => tabAssociationReadiness.wait(),
  tracker: tabActivityTracker,
  spaceRegistry: tabSpaceRegistry,
  getSpaces: () => spaceManager.getSpaces(),
  getPinnedSites: () => pinnedSitesManager.getPinnedSites(),
});

// Registered at top level so the alarm wakes the worker
chrome.alarms.onAlarm.addListener((alarm) =>
{
  if (alarm.name === TabAutoArchiver.ALARM_NAME) void tabAutoArchiver.run();
});

// Switching the setting on starts every tab's clock and the alarm; switching it off stops the
// alarm and drops the last-use records
chrome.storage.onChanged.addListener((changes, areaName) =>
{
  const change = changes[AUTO_ARCHIVE_AFTER_KEY];
  if (areaName === 'local' && change) void tabAutoArchiver.handleSettingChange(change);
});

void tabAutoArchiver.start();

// =============================================================================
// Event Listeners
// =============================================================================

// Update tracked group when active tab changes + track history + switch to tab's Space
chrome.tabs.onActivated.addListener(async (activeInfo) =>
{
  // Wait for state to load (handles service worker restart)
  await stateReady;

  // Stamp the tab the user just left before any other await, so an auto-archive
  // run queued behind this can't judge it by an older last-use time
  tabActivityTracker.markActivated(activeInfo.windowId, activeInfo.tabId)
    .catch((error) => console.error('[TabActivityTracker] failed to record activation:', error));

  // Check for news updates (throttled to once per week)
  await newsVersionChecker.checkIfDue();

  const isNavigating = historyManager.isNavigating(activeInfo.windowId);

  // if (import.meta.env.DEV)
  // {
  //   console.log(`[onActivated] START tabId=${activeInfo.tabId}, isNavigating=${isNavigating}`);
  // }

  // Track tab history (skip if this activation was triggered by navigation)
  if (!isNavigating)
  {
    historyManager.push(activeInfo.windowId, activeInfo.tabId);
  }

  recordBookmarkActivation(activeInfo.windowId, activeInfo.tabId);

  const persistedSpaceId = spaceStateManager.getActiveSpace(activeInfo.windowId);
  const currentSpaceId = resolveActiveSpaceId(spaceManager.getSpaces(), persistedSpaceId);
  if (currentSpaceId && currentSpaceId !== persistedSpaceId)
  {
    spaceStateManager.setActiveSpace(activeInfo.windowId, currentSpaceId);
  }

  // Lookup destination space for sidebar switch
  let destinationSpaceId = await getSpaceForTab(activeInfo.windowId, activeInfo.tabId);

  if (!destinationSpaceId && currentSpaceId)
  {
    try
    {
      await tabSpaceRegistry.register(activeInfo.windowId, activeInfo.tabId, currentSpaceId);
      destinationSpaceId = currentSpaceId;
    }
    catch { /* Tab may no longer exist */ }
  }

  // if (import.meta.env.DEV)
  // {
  //   console.log(`[onActivated] destinationSpaceId=${destinationSpaceId}`);
  // }

  // Read the "Follow active tab" mode - 'off' disables space switching (and the
  // sidebar skips scrolling)
  const followResult = await chrome.storage.local.get([FOLLOW_ACTIVE_TAB_KEY]);
  const followMode = parseFollowActiveTabMode(followResult[FOLLOW_ACTIVE_TAB_KEY]);

  // Follow 模式只在真实 Space 之间切换。
  let spaceSwitched = false;
  if (followMode !== 'off' && destinationSpaceId)
  {
    if (currentSpaceId !== destinationSpaceId)
    {
      spaceStateManager.setActiveSpace(activeInfo.windowId, destinationSpaceId);
      spaceSwitched = true;
    }
  }

  // Announce the activation so the sidebar can scroll the tab into view.
  // The sidebar decides whether to scroll based on the follow mode and spaceSwitched.
  chrome.runtime.sendMessage({
    action: SpaceMessageAction.TAB_ACTIVATED,
    windowId: activeInfo.windowId,
    tabId: activeInfo.tabId,
    spaceSwitched
  }).catch(() =>
  {
    // Sidepanel may not be open - ignore error
  });

});

// Refresh tab indices in local backup for all managed tabs in a window.
// Called after any tab creation, move, removal, attach or detach that may shift indices,
// so a browser restart can place the entries by index (index+domain restore pass).
async function refreshBackupIndices(windowId: number): Promise<void>
{
  const associations = await getTabAssociations(windowId);
  if (Object.keys(associations).length === 0) return;

  const allTabs = await chrome.tabs.query({ windowId });
  const tabIndexMap = new Map(allTabs.map(t => [t.id!, t.index]));

  const updates: Record<string, number> = {};
  for (const [id, itemKey] of Object.entries(associations))
  {
    const newIndex = tabIndexMap.get(Number(id));
    if (newIndex !== undefined)
    {
      updates[itemKey] = newIndex;
    }
  }

  if (Object.keys(updates).length > 0)
  {
    await updateTabAssociationBackupIndices(windowId, updates);
  }
}

/**
 * 外部休眠扩展会创建 park 页面并关闭原 Tab。把固定身份迁到新 Tab，避免它重新出现在 Tabs。
 */
async function migrateParkedTabAssociation(tab: chrome.tabs.Tab): Promise<boolean>
{
  if (tab.id === undefined || tab.windowId === undefined) return false;

  const parked = parseParkedTabUrl(tab.url);
  if (!parked || parked.sourceTabId === tab.id) return false;

  const associations = await getTabAssociations(tab.windowId);
  const itemKey = associations[parked.sourceTabId];
  if (!itemKey) return false;

  // 先写入新关联再删除旧关联，侧边栏不会在两个 storage 事件之间把固定项目短暂当成普通 Tab。
  await storeTabAssociation(tab.windowId, tab.id, itemKey);
  await removeTabAssociation(tab.windowId, parked.sourceTabId);
  await saveTabAssociationBackup(tab.windowId, itemKey, {
    tabId: tab.id,
    url: parked.originalUrl,
    tabIndex: tab.index,
  });

  const registeredSpaceId = tabSpaceRegistry.getSpace(tab.windowId, parked.sourceTabId);
  if (registeredSpaceId)
  {
    await tabSpaceRegistry.unregister(tab.windowId, parked.sourceTabId);
    await tabSpaceRegistry.register(tab.windowId, tab.id, registeredSpaceId);
  }
  return true;
}

// Clean up history, last audible tracker, tab registry, and local backup when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) =>
{
  await stateReady;
  historyManager.remove(removeInfo.windowId, tabId);
  lastAudibleTracker.clearIfMatches(tabId);
  await tabSpaceRegistry.unregister(removeInfo.windowId, tabId);

  if (!removeInfo.isWindowClosing)
  {
    // A closed window's records are dropped by the next auto-archive run instead
    tabActivityTracker.forget(tabId)
      .catch((error) => console.error('[TabActivityTracker] failed to forget closed tab:', error));

    const associations = await getTabAssociations(removeInfo.windowId);
    const itemKey = associations[tabId];
    if (itemKey)
    {
      // park 页面通常已经存在，再关闭原 Tab；优先迁移，找不到替代页才按真正关闭清理。
      const currentTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
      const replacement = findParkedReplacementTab(currentTabs, tabId);
      if (!replacement || !await migrateParkedTabAssociation(replacement))
      {
        await removeTabAssociationBackup(removeInfo.windowId, itemKey);
      }
    }

    // Any tab removal shifts indices of tabs after it
    await refreshBackupIndices(removeInfo.windowId);
  }
});

// Clean up in-memory maps and local backup when a window is closed
chrome.windows.onRemoved.addListener(async (windowId) =>
{
  await stateReady;

  // TODO: remove after testing
  if (import.meta.env.DEV)
  {
    console.log(`[onRemoved] cleaning up in-memory state for window=${windowId}`);
  }

  spaceStateManager.removeWindow(windowId);
  historyManager.removeWindow(windowId);
  tabSpaceRegistry.removeWindow(windowId);
  await removeWindowAssociationBackup(windowId);
});

// Update tab indices in local backup when any tab is moved.
// A single move shifts all tabs between fromIndex and toIndex, so we refresh
// all managed tabs in the window.
chrome.tabs.onMoved.addListener(async (_tabId, moveInfo) =>
{
  await stateReady;
  await Promise.all([
    refreshBackupIndices(moveInfo.windowId),
    tabSpaceRegistry.refreshWindowMetadata(moveInfo.windowId),
  ]);
});

const detachedTabSpaces = new Map<number, string>();

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) =>
{
  await stateReady;

  // Hand the tab's Space to onAttached before any other await: Chrome fires onAttached
  // right after this event, and it reads detachedTabSpaces as soon as stateReady settles.
  // An await here would let it register the tab to the new window's active Space instead.
  const spaceId = tabSpaceRegistry.getSpace(detachInfo.oldWindowId, tabId);
  if (spaceId)
  {
    detachedTabSpaces.set(tabId, spaceId);
  }

  await Promise.all([
    spaceId ? tabSpaceRegistry.unregister(detachInfo.oldWindowId, tabId) : Promise.resolve(),
    // The tabs right of the detached one move left
    refreshBackupIndices(detachInfo.oldWindowId),
  ]);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) =>
{
  await stateReady;
  const spaceId = detachedTabSpaces.get(tabId)
    ?? resolveActiveSpaceId(spaceManager.getSpaces(), spaceStateManager.getActiveSpace(attachInfo.newWindowId));
  detachedTabSpaces.delete(tabId);
  if (spaceId)
  {
    await tabSpaceRegistry.register(attachInfo.newWindowId, tabId, spaceId);
  }

  // The tabs right of the attached one move right
  await refreshBackupIndices(attachInfo.newWindowId);
});

// Favicon loading Scenario 5 — see docs/favicon-loading-strategy.md
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) =>
{
  await stateReady;
  if (changeInfo.audible === false)
  {
    lastAudibleTracker.setLastAudibleTabId(tabId);
  }

  // The url/favIconUrl handlers below need the tab - fetch it once
  // and share it, instead of each handler independently re-fetching
  let tab: chrome.tabs.Tab | undefined;
  if (changeInfo.url !== undefined || changeInfo.favIconUrl !== undefined)
  {
    try { tab = await chrome.tabs.get(tabId); }
    catch { /* tab may have been closed */ }
  }

  if (tab && parseParkedTabUrl(tab.url))
  {
    await migrateParkedTabAssociation(tab);
  }

  // Update URL in local backup when a managed tab navigates
  if (changeInfo.url && tab?.windowId)
  {
    try
    {
      const associations = await getTabAssociations(tab.windowId);
      const itemKey = associations[tabId];
      if (itemKey)
      {
        saveTabAssociationBackup(tab.windowId, itemKey, {
          tabId,
          url: getEffectiveTabUrl(changeInfo.url),
          tabIndex: tab.index,
        });
      }
    }
    catch { /* tab may have been closed */ }

    const spaceId = tabSpaceRegistry.getSpace(tab.windowId, tabId);
    if (spaceId)
    {
      await tabSpaceRegistry.register(tab.windowId, tabId, spaceId);
    }
  }

  // Scenario 5: update pinned site favicon when Chrome reports a new favIconUrl
  if (changeInfo.favIconUrl && tab?.url)
  {
    try
    {
      let tabHostname: string;
      try { tabHostname = new URL(tab.url).hostname; }
      catch { return; }

      // Match by hostname, only sites without favicon and no custom icon/emoji.
      // PinnedSitesManager owns this list now, so this reads its in-memory copy
      // instead of storage, and hands back a patch instead of a whole rewritten
      // array - see Case 2 in the shared-storage decision doc.
      const matchingSites = pinnedSitesManager.getPinnedSites().filter(site =>
      {
        if (site.favicon || site.customIconName || site.emoji) return false;
        try { return new URL(site.url).hostname === tabHostname; }
        catch { return false; }
      });

      if (matchingSites.length > 0)
      {
        // Use Chrome's internal _favicon API instead of fetching favIconUrl directly.
        // This avoids CORS errors on private/local servers (e.g. homeassistant, proxmox).
        // Chrome has just cached the favicon (it just fired favIconUrl), so this will work.
        const favicon = await fetchFaviconAsBase64(getFaviconUrl(tab.url));
        if (favicon)
        {
          // No originId: this change started here, so every sidebar needs to
          // hear about it. The manager re-checks each pin's eligibility, since
          // the fetch above gave the user time to set an icon by hand.
          pinnedSitesManager.setFavicons(
            matchingSites.map(site => ({ id: site.id, favicon }))
          );

          if (import.meta.env.DEV)
          {
            console.log('[Background] updated favicon for pinned sites:',
              matchingSites.map(s => s.url));
          }
        }
      }
    }
    catch { /* tab may have been closed */ }
  }
});

// 新 Tab 直接登记到当前 Space；Chrome 原生 groupId 不参与 Space 生命周期。
chrome.tabs.onCreated.addListener(async (tab) =>
{
  if (!tab.id || !tab.windowId) return;
  await stateReady;
  const targetSpaceId = resolveActiveSpaceId(
    spaceManager.getSpaces(),
    spaceStateManager.getActiveSpace(tab.windowId)
  );
  if (targetSpaceId)
  {
    await tabSpaceRegistry.register(tab.windowId, tab.id, targetSpaceId);
  }

  // A tab opened left of a bookmark or Favorite tab (a link opened next to its tab) moves it right
  await refreshBackupIndices(tab.windowId);
});

// =============================================================================
// Message Handlers
// =============================================================================

// Every manager that owns messages, keyed by the managerId half of its action
// strings. Built once here so routing is an exact-match lookup rather than a
// prefix scan - "Space" would otherwise also match "SpaceWindowState".
const routedManagers = new Map<string, RoutedManager>();

// Registering the same managerId twice would silently give one manager's
// messages to the other, so fail at load instead of at runtime.
function registerManager(manager: RoutedManager): void
{
  if (routedManagers.has(manager.managerId))
  {
    throw new Error(`duplicate managerId "${manager.managerId}" - message routing would be ambiguous`);
  }
  routedManagers.set(manager.managerId, manager);
}

registerManager(tabSpaceRegistry);
registerManager(spaceStateManager);
registerManager(spaceManager);
registerManager(historyManager);
registerManager(lastAudibleTracker);
registerManager(pinnedSitesManager);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
{
  if (message?.action === WAIT_FOR_TAB_ASSOCIATIONS_READY)
  {
    tabAssociationReadiness.wait().then(() => sendResponse({ ready: true }));
    return true;
  }

  // Manager-routed messages come first: anything shaped "<Manager>_msg_<method>"
  // belongs to exactly one manager and never falls through to the flat
  // orchestration handlers below.
  const routed = parseManagerActionId(message?.action);
  if (routed)
  {
    const manager = routedManagers.get(routed.managerId);
    if (!manager)
    {
      console.error(`[messageRouting] no manager registered for "${routed.managerId}"`);
      return;
    }

    // stateReady is awaited here, once, rather than in every manager method -
    // the service worker can be woken by any of these messages.
    (async () =>
    {
      await stateReady;
      try
      {
        sendResponse(await manager.dispatch(routed.method, message));
      }
      catch (error)
      {
        console.error(`[messageRouting] ${routed.managerId}.${routed.method} failed:`, error);
        sendResponse({ error: String(error) });
      }
    })();
    return true;  // async response
  }

  // 兼容旧调用名：现在只更新内部 Space 关联，不再操作 Chrome 标签组。
  if (message.action === 'queue-tab-for-grouping')
  {
    (async () =>
    {
      await stateReady;
      if (message.tabId && message.windowId)
      {
        const targetSpaceId = resolveActiveSpaceId(
          spaceManager.getSpaces(),
          message.spaceId ?? spaceStateManager.getActiveSpace(message.windowId)
        );
        if (targetSpaceId)
        {
          await tabSpaceRegistry.register(message.windowId, message.tabId, targetSpaceId);
        }
      }
    })();
    return;
  }

  if (message.action === 'set-active-tab-and-space')
  {
    if (message.tabId !== undefined)
    {
      (async () =>
      {
        await stateReady;
        const result = await setActiveTabAndSpace(message.tabId);
        sendResponse(result);
      })();
      return true;  // async response
    }
  }
});

// =============================================================================
// Keyboard Shortcuts
// =============================================================================

chrome.commands.onCommand.addListener((command) =>
{
  (async () =>
  {
    await stateReady;

    if (command === "prev-used-tab" || command === "next-used-tab")
    {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      {
        if (tabs.length === 0) return;
        const direction = command === "prev-used-tab" ? -1 : 1;
        historyManager.navigate(tabs[0].windowId, direction);
      });
    }

    // Open Space Navigator as a focused popup window so it reliably receives keyboard input
    if (command === "open-space-navigator")
    {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) =>
      {
        if (tabs.length === 0) return;
        const windowId = tabs[0].windowId;
        const win = await chrome.windows.get(windowId);

        // Size the popup to fit all spaces without scrolling (capped at 480px content height).
        // Measured from SpaceNavigatorApp.tsx / SpaceList.tsx rendering (Tailwind defaults, 1rem = 16px):
        //   headerHeight = 37   ("Navigate to Space" row: py-2 padding 16 + text-sm line-height 20 + border-b 1)
        //   searchBoxHeight = 39 (search row: py-1.5 padding 12 + input py-1 padding 8
        //                         + input text-xs line-height 16 + input border 2 + border-b 1)
        //   listPadding = 8    (SpaceList's rows container: py-1 padding, top + bottom)
        //   rowHeight = 28     (each space row: h-7)
        const spaces = spaceManager.getSpaces();
        const itemCount = spaces.length;
        const popupWidth = 300;
        const headerHeight = 37;
        const searchBoxHeight = 39;
        const listPadding = 8;
        const rowHeight = 28;
        const bottomPadding = 10;
        const contentHeight = headerHeight + searchBoxHeight + listPadding + itemCount * rowHeight + bottomPadding;
        const popupHeight = Math.min(contentHeight, 480) + 30; // +30 for OS title bar

        // Center the popup within the browser window
        const left = Math.round((win.left ?? 0) + ((win.width ?? 1200) - popupWidth) / 2);
        const top = Math.round((win.top ?? 0) + ((win.height ?? 800) - popupHeight) / 2);

        chrome.windows.create({
          url: chrome.runtime.getURL(`navigator.html?windowId=${windowId}`),
          type: 'popup',
          focused: true,
          width: popupWidth,
          height: popupHeight,
          left,
          top,
        });
      });
    }
  })();
});
