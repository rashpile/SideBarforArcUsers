import { SpaceMessageAction, SPACES_STORAGE_KEY } from './utils/spaceMessages';
import { FOLLOW_ACTIVE_TAB_KEY, parseFollowActiveTabMode } from './utils/followActiveTab';
import { getTabAssociations, storeTabAssociation, removeTabAssociation, saveTabAssociationBackup, removeTabAssociationBackup, updateTabAssociationBackupIndices, removeWindowAssociationBackup, restoreTabAssociationBackup, WAIT_FOR_TAB_ASSOCIATIONS_READY, BOOKMARK_ITEM_KEY_PREFIX } from './utils/tabAssociations';
import { fetchFaviconAsBase64, getFaviconUrl } from './utils/favicon';
import { parseManagerActionId, RoutedManager } from './managers/proxies/messageRouting';
import { SpaceWindowStateManager } from './managers/impl/spaceWindowStateManager';
import { TabSpaceRegistry } from './managers/impl/tabSpaceRegistry';
import { SpaceManager } from './managers/impl/spaceManager';
import { TabHistoryManager } from './managers/impl/tabHistoryManager';
import { LastAudibleTracker } from './managers/impl/lastAudibleTracker';
import { FavoriteIconsManager } from './managers/impl/favoriteIconsManager';
import { allFavoriteBookmarks } from './utils/spaceFavorites';
import { collectBookmarkIds } from './utils/bookmarkFolderLookup';
import { AttentionMarkManager } from './managers/impl/attentionMarkManager';
import { TabAssociationReadiness } from './utils/tabAssociationReadiness';
import { resolveActiveSpaceId } from './utils/spaceSelection';
import { findParkedReplacementTab, getEffectiveTabUrl, parseParkedTabUrl } from './utils/parkedTabAssociation';
import { BookmarkRecencyStore } from './stores/bookmarkRecencyStore';
import { BrowserSessionMarker } from './stores/browserSessionMarker';
import { TabActivityTracker } from './stores/tabActivityTracker';
import { queryOpenTabs, readTabActivityRecording, TabAutoArchiver } from './services/tabAutoArchiver';
import { FavoritesMigration } from './services/favoritesMigration';
import { AUTO_ARCHIVE_AFTER_KEY } from './utils/autoArchive';
import { TAB_AGE_HIGHLIGHT_KEY } from './utils/tabAgeHighlight';
import { isOpenedUnvisited, RecentWindows, UNVISITED_TAB_MARKER_KEY } from './utils/unvisitedTabMarker';
import { TAB_REOPENED_BY_UNDO_ACTION } from './utils/tabReopenedByUndo';
import { KeyboardSwitcher, parseSwitcherCommand } from './services/keyboardSwitcher';
import { buildSpaceCards, buildTabCards, findLastUsedTab, WindowSpaces } from './services/switcherLists';
import { SwitcherMessageAction } from './utils/switcherMessages';
import { BookmarkSpaceResolver } from './utils/bookmarkSpaceResolver';
import { tabListTopIndexForLinkTab } from './utils/linkTabPlacement';

// Set side panel to open when clicking the extension toolbar button
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const tabSpaceRegistry = new TabSpaceRegistry();

// Space membership comes only from the extension's TabSpaceRegistry;
// Chrome's native groupId belongs to the user.
async function getSpaceForTab(windowId: number, tabId: number): Promise<string | undefined>
{
  return tabSpaceRegistry.getSpace(windowId, tabId);
}

/**
 * The Space of a tab being activated. A bookmark's tab belongs to the Space
 * whose folder holds the bookmark, so a registry record saying otherwise is
 * corrected here, whatever wrote it. Debug builds log each correction, to find
 * that writer.
 */
async function getSpaceForActivatedTab(windowId: number, tabId: number): Promise<string | undefined>
{
  const registeredSpaceId = tabSpaceRegistry.getSpace(windowId, tabId);
  const itemKey = (await getTabAssociations(windowId))[tabId];
  if (!itemKey?.startsWith(BOOKMARK_ITEM_KEY_PREFIX)) return registeredSpaceId;

  const bookmarkSpaceId = await bookmarkSpaceResolver.findSpaceId(itemKey.slice(BOOKMARK_ITEM_KEY_PREFIX.length));
  if (!bookmarkSpaceId || bookmarkSpaceId === registeredSpaceId) return registeredSpaceId;

  if (import.meta.env.DEV)
  {
    console.log(`[TabSpace] bookmark tab ${tabId} (${itemKey}) was registered to Space ${registeredSpaceId}; `
      + `its bookmark is in Space ${bookmarkSpaceId}`);
  }
  await tabSpaceRegistry.register(windowId, tabId, bookmarkSpaceId);
  return bookmarkSpaceId;
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

    const persistedSpaceId = spaceStateManager.getActiveSpace(tab.windowId);
    const currentSpaceId = resolveActiveSpaceId(spaceManager.getSpaces(), persistedSpaceId);
    let destinationSpaceId = await getSpaceForActivatedTab(tab.windowId, tabId);

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
// Custom icon, emoji, color and cached favicon of each Favorite bookmark, by bookmark id
const favoriteIconsManager = new FavoriteIconsManager({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
  broadcast: (message) => chrome.runtime.sendMessage(message),
});
// Mark for Attention on tabs and bookmarks; auto-archive keeps marked tabs open
const attentionMarkManager = new AttentionMarkManager();
// Reads the history manager's activation order, so it has to come after it.
const lastAudibleTracker = new LastAudibleTracker(historyManager);
// The Space of a bookmark's tab, from the bookmark's folder (getSpaceForActivatedTab)
const bookmarkSpaceResolver = new BookmarkSpaceResolver(
  (id) => chrome.bookmarks.get(id).then(([node]) => node, () => undefined),
  () => spaceManager.getSpaces(),
);
// Last-use time of every tab, for auto-archive and the Tab list's age highlight, and the
// unvisited mark of tabs opened in the background. Background is the only writer; nothing
// is recorded while auto-archive, the age highlight and the unvisited marker are all off.
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
  isRecording: readTabActivityRecording,
  getTab: (tabId) => chrome.tabs.get(tabId).catch(() => undefined),
});

/**
 * Migrates each window's leftover `all` or invalid Space ID at startup. It runs before stateReady,
 * so a tab created while the sidebar is closed doesn't lose its Space.
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
 * Assigns tabs that older versions never registered to a Space. Native group titles are read only
 * during this migration; after it, changes to native groups never affect Spaces.
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
 * Ungroups only the Space groups the legacy mapping recorded, then clears that retired state.
 * No tab is closed, and the user's own groups that the mapping doesn't list are left alone.
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

// Attach the stored last-use records to the open tabs (or drop them while auto-archive, the
// tab age highlight and the unvisited marker are all off). A failure here doesn't hold up the other managers: the
// tracker then refuses to refresh, and no tab is auto-archived.
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

// Switching the tab age highlight or the unvisited marker on or off starts recording, or drops
// the records when nothing else needs them. A change between two looks reloads harmlessly.
chrome.storage.onChanged.addListener((changes, areaName) =>
{
  if (areaName !== 'local') return;
  if (changes[TAB_AGE_HIGHLIGHT_KEY] || changes[UNVISITED_TAB_MARKER_KEY]) void loadTabActivity();
});

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

// Pinned tab associations must wait for the managers to load; the Side Panel waits for this point.
const managerLoadPromise = Promise.all([
  spaceStateManager.load(),
  spaceManager.load(),
  historyManager.load(),
  lastAudibleTracker.load(),
  favoriteIconsManager.load(),
  sameBrowserSession.then((same) => tabSpaceRegistry.load(same)),
  sameBrowserSession.then((same) => attentionMarkManager.load(same)),
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

// Events and messages all wait for this one initialization, so no tab is handled while Space
// records are still being restored or legacy groups migrated.
const stateReady = tabAssociationReadiness.wait();

// =============================================================================
// Bookmark recency - last-active time per Arc-style bookmark tab,
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

chrome.bookmarks.onRemoved.addListener((id, removeInfo) =>
{
  const ids = removeInfo.node ? collectBookmarkIds(removeInfo.node) : [id];
  bookmarkRecencyStore.forget(ids)
    .catch((error) => console.error('[BookmarkRecency] failed to forget removed bookmarks:', error));
  // After the marks load, so the load can't bring back a mark this removal dropped
  void stateReady
    .then(() => attentionMarkManager.handleBookmarksRemoved(ids))
    .catch((error) => console.error('[AttentionMarkManager] failed to drop marks of removed bookmarks:', error));
  // After the icons load, so the load can't bring back an entry this removal dropped
  void stateReady
    .then(() => favoriteIconsManager.removeIcons(ids))
    .catch((error) => console.error('[FavoriteIconsManager] failed to drop icons of removed bookmarks:', error));
});

// =============================================================================
// Favorites migration - copies the legacy global Favorites into every Space's
// asd_Favorites once. Retried on the triggers below until it is done.
// =============================================================================

const favoritesMigration = new FavoritesMigration({
  bookmarks: {
    getTree: () => chrome.bookmarks.getTree(),
    getChildren: (id) => chrome.bookmarks.getChildren(id),
    create: (bookmark) => chrome.bookmarks.create(bookmark),
  },
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
  restoreIcons: (id, entry) => favoriteIconsManager.restoreIcons(id, entry),
  getSpaces: () => spaceManager.getSpaces(),
});

// managerLoadPromise, not stateReady: a failed tab restore doesn't matter here, but the
// icon store must have loaded, or restoring icons would overwrite the stored ones
function runFavoritesMigration(): void
{
  managerLoadPromise
    .then(() => favoritesMigration.run())
    .catch((error) => console.error('[FavoritesMigration] failed:', error));
}

runFavoritesMigration();

// A Space gained a folder, or its folder arrived by sync
chrome.bookmarks.onCreated.addListener(() => runFavoritesMigration());
chrome.bookmarks.onMoved.addListener(() => runFavoritesMigration());

// SPACES_CHANGED is broadcast with runtime.sendMessage, which doesn't reach background's
// own listeners; the stored Space list changes at the same moment
chrome.storage.onChanged.addListener((changes, areaName) =>
{
  if (areaName === 'local' && SPACES_STORAGE_KEY in changes) runFavoritesMigration();
});

// =============================================================================
// Tab auto-archive - closes tabs unused for the "Archive tabs
// after" period, saving regular tabs to their Space's asd_Archive folder first.
// Works with the sidebar closed: once at worker start and on an alarm.
// =============================================================================

const tabAutoArchiver = new TabAutoArchiver({
  startupRestoreSucceeded: () => tabAssociationReadiness.wait(),
  tracker: tabActivityTracker,
  spaceRegistry: tabSpaceRegistry,
  getSpaces: () => spaceManager.getSpaces(),
  isTabMarked: (tabId) => attentionMarkManager.isTabMarked(tabId),
  tabMarksLoaded: () => attentionMarkManager.tabMarksLoaded,
});

// Registered at top level so the alarm wakes the worker
chrome.alarms.onAlarm.addListener((alarm) =>
{
  if (alarm.name === TabAutoArchiver.ALARM_NAME) void tabAutoArchiver.run();
});

// Switching the setting on starts every tab's clock and the alarm; switching it off stops the
// alarm and drops the last-use records unless the tab age highlight or the unvisited marker still needs them
chrome.storage.onChanged.addListener((changes, areaName) =>
{
  const change = changes[AUTO_ARCHIVE_AFTER_KEY];
  if (areaName === 'local' && change) void tabAutoArchiver.handleSettingChange(change);
});

void tabAutoArchiver.start();

// =============================================================================
// Keyboard switchers (spike) - Cmd+Tab-style lists of the current Space's tabs
// and of the Spaces, by last use. See services/keyboardSwitcher.ts.
// =============================================================================

function readWindowSpaces(windowId: number): WindowSpaces
{
  return {
    activeSpaceId: resolveActiveSpaceId(spaceManager.getSpaces(), spaceStateManager.getActiveSpace(windowId)) ?? undefined,
    spaceOf: (tabId) => tabSpaceRegistry.getSpace(windowId, tabId),
  };
}

const keyboardSwitcher = new KeyboardSwitcher({
  buildCards: async (kind, win) =>
  {
    const windowSpaces = readWindowSpaces(win.id!);
    const tabs = win.tabs ?? [];
    return kind === 'tabs'
      ? buildTabCards(tabs, windowSpaces)
      : buildSpaceCards(spaceManager.getSpaces(), tabs, windowSpaces);
  },
  pick: async (kind, windowId, cardId) =>
  {
    if (kind === 'tabs')
    {
      await setActiveTabAndSpace(Number(cardId));
      return;
    }

    await openSpace(windowId, cardId);
  },
});

/**
 * Brings a Space forward the way Arc does: its most recently used tab is
 * activated, and a Space with no tabs of its own gets a new one. Used by the
 * Space bar, swipes (OPEN_SPACE) and the Space Switcher.
 */
async function openSpace(windowId: number, spaceId: string): Promise<void>
{
  const restored = await stateReady;
  spaceStateManager.setActiveSpace(windowId, spaceId);
  // Without the restored assignments no tab can be told apart by Space
  if (!restored) return;

  const tabs = await chrome.tabs.query({ windowId });
  const lastTabId = findLastUsedTab(tabs, spaceId, readWindowSpaces(windowId));
  if (lastTabId !== undefined) await setActiveTabAndSpace(lastTabId);
  // onCreated registers the new tab to the window's active Space, set above
  else await chrome.tabs.create({ windowId, active: true });
}

chrome.windows.onRemoved.addListener((windowId) => keyboardSwitcher.handleWindowRemoved(windowId));
chrome.tabs.onRemoved.addListener((tabId) => keyboardSwitcher.handleTabRemoved(tabId));

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
  let destinationSpaceId = await getSpaceForActivatedTab(activeInfo.windowId, activeInfo.tabId);

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
 * A tab suspender extension creates a park page and closes the original tab. The pinned identity
 * moves to the new tab, so the tab doesn't show up again in Tabs.
 */
async function migrateParkedTabAssociation(tab: chrome.tabs.Tab): Promise<boolean>
{
  if (tab.id === undefined || tab.windowId === undefined) return false;

  const parked = parseParkedTabUrl(tab.url);
  if (!parked || parked.sourceTabId === tab.id) return false;

  const associations = await getTabAssociations(tab.windowId);
  const itemKey = associations[parked.sourceTabId];
  if (!itemKey) return false;

  // Store the new association before removing the old one, so the sidebar never shows the pinned
  // item as a regular tab between the two storage events.
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
  attentionMarkManager.handleTabRemoved(tabId, removeInfo.isWindowClosing)
    .catch((error) => console.error('[AttentionMarkManager] failed to drop a closed tab\'s mark:', error));
  await tabSpaceRegistry.unregister(removeInfo.windowId, tabId);

  if (!removeInfo.isWindowClosing)
  {
    // A closed window's records are dropped by the next auto-archive run or worker start instead
    tabActivityTracker.forget(tabId)
      .catch((error) => console.error('[TabActivityTracker] failed to forget closed tab:', error));

    const associations = await getTabAssociations(removeInfo.windowId);
    const itemKey = associations[tabId];
    if (itemKey)
    {
      // The park page usually exists before the original tab closes: migrate first, and clean up
      // as a real close only when no replacement is found.
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
  attentionMarkManager.refreshWindowTabs(moveInfo.windowId)
    .catch((error) => console.error('[AttentionMarkManager] failed to refresh marked tabs after a move:', error));
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
  // Covers the attached tab's new window and position and the tabs it pushed right
  attentionMarkManager.refreshWindowTabs(attachInfo.newWindowId)
    .catch((error) => console.error('[AttentionMarkManager] failed to refresh marked tabs after an attach:', error));
  if (spaceId)
  {
    await tabSpaceRegistry.register(attachInfo.newWindowId, tabId, spaceId);
  }

  // The tabs right of the attached one move right
  await refreshBackupIndices(attachInfo.newWindowId);
});

// Favicon loading scenario 5 - see "Favicon loading" in docs/development.md
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

  // An unvisited tab's record follows its redirects, so a browser restart can still re-match it.
  // The active tab is skipped here only to save a queued records read per navigation: its mark
  // was already cleared when it was activated.
  if (changeInfo.url && tab && !tab.active)
  {
    tabActivityTracker.followUrl(tab)
      .catch((error) => console.error('[TabActivityTracker] failed to follow an unvisited tab\'s URL:', error));
  }

  if (changeInfo.url && tab)
  {
    attentionMarkManager.handleTabChanged(tab)
      .catch((error) => console.error('[AttentionMarkManager] failed to follow a marked tab\'s URL:', error));
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

  // Scenario 5: update Favorite favicons when Chrome reports a new favIconUrl
  if (changeInfo.favIconUrl && tab?.url)
  {
    try
    {
      let tabHostname: string;
      try { tabHostname = new URL(tab.url).hostname; }
      catch { return; }

      // Match by hostname across every Space's Favorites, only those showing no icon of any kind.
      // The manager gets a patch, not a rewritten store, and re-checks each entry's eligibility.
      const icons = favoriteIconsManager.icons;
      const roots = (await chrome.bookmarks.getTree())[0]?.children ?? [];
      const matchingFavorites = allFavoriteBookmarks(roots, spaceManager.getSpaces()).map(({ bookmark }) => bookmark).filter(bookmark =>
      {
        const entry = icons.entryFor(bookmark.id);
        if (entry?.favicon || entry?.customIconName || entry?.emoji) return false;
        try { return new URL(bookmark.url!).hostname === tabHostname; }
        catch { return false; }
      });

      if (matchingFavorites.length > 0)
      {
        // Use Chrome's internal _favicon API instead of fetching favIconUrl directly.
        // This avoids CORS errors on private/local servers (e.g. homeassistant, proxmox).
        // Chrome has just cached the favicon (it just fired favIconUrl), so this will work.
        const favicon = await fetchFaviconAsBase64(getFaviconUrl(tab.url));
        if (favicon)
        {
          // No originId: this change started here, so every sidebar needs to hear about it
          favoriteIconsManager.setFavicons(
            matchingFavorites.map(bookmark => ({ id: bookmark.id, favicon }))
          );

          if (import.meta.env.DEV)
          {
            console.log('[Background] updated favicon for Favorites:',
              matchingFavorites.map(bookmark => bookmark.url));
          }
        }
      }
    }
    catch { /* tab may have been closed */ }
  }
});

// A tab opened from a link in a bookmark's or Favorite's tab goes to the top of the Tab list.
// Chrome puts it next to its opener, which the Tab list doesn't show, so it would land at a
// random spot in the list (see utils/linkTabPlacement.ts).
async function moveLinkTabToTabListTop(tabId: number, windowId: number, openerTabId: number, spaceId: string | null): Promise<void>
{
  const associations = await getTabAssociations(windowId);
  const openerItemKey = associations[openerTabId];
  if (!openerItemKey) return;  // A regular opener: the tab stays next to it

  const windowTabs = await chrome.tabs.query({ windowId });
  const newTab = windowTabs.find(t => t.id === tabId);
  const opener = windowTabs.find(t => t.id === openerTabId);
  if (!newTab || !opener) return;

  // The tabs the Tab list shows: no bookmark or Favorite association, in the tab's Space
  const tabListTabIds = new Set(windowTabs
    .filter(t => t.id !== undefined
      && !associations[t.id]
      && (!spaceId || tabSpaceRegistry.getSpace(windowId, t.id) === spaceId))
    .map(t => t.id!));
  const index = tabListTopIndexForLinkTab(
    { id: tabId, index: newTab.index, url: newTab.url, pendingUrl: newTab.pendingUrl },
    { index: opener.index, itemKey: openerItemKey },
    windowTabs,
    tabListTabIds
  );
  if (index !== undefined) await chrome.tabs.move(tabId, { index });
}

// Inactive tabs arriving right after their window are a restored window's, not new ones
// (see RESTORED_WINDOW_MS). Memory only: a worker woken by the window event has no stateReady
// to wait for, and the tabs follow within milliseconds. Registered before tabs.onCreated.
const recentWindows = new RecentWindows();
chrome.windows.onCreated.addListener((createdWindow) =>
{
  if (createdWindow.id !== undefined) recentWindows.markCreated(createdWindow.id, Date.now());
});

// A new tab joins the current Space; Chrome's native groupId plays no part in the Space lifecycle.
chrome.tabs.onCreated.addListener(async (tab) =>
{
  if (!tab.id || !tab.windowId) return;
  // Decided now: after the await below the window may no longer count as just created
  const openedUnvisited = isOpenedUnvisited(tab, recentWindows, Date.now());
  await stateReady;
  // Before any other await, so a quick switch to the tab clears the mark after it was set
  if (openedUnvisited)
  {
    tabActivityTracker.markOpenedUnvisited(tab)
      .catch((error) => console.error('[TabActivityTracker] failed to mark a tab opened in the background:', error));
  }
  const targetSpaceId = resolveActiveSpaceId(
    spaceManager.getSpaces(),
    spaceStateManager.getActiveSpace(tab.windowId)
  );
  if (targetSpaceId)
  {
    await tabSpaceRegistry.register(tab.windowId, tab.id, targetSpaceId);
  }

  if (tab.openerTabId !== undefined)
  {
    await moveLinkTabToTabListTop(tab.id, tab.windowId, tab.openerTabId, targetSpaceId)
      .catch((error) => console.error('[LinkTabPlacement] failed to move a link tab to the Tab list top:', error));
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
registerManager(favoriteIconsManager);
registerManager(attentionMarkManager);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
{
  if (message?.action === WAIT_FOR_TAB_ASSOCIATIONS_READY)
  {
    tabAssociationReadiness.wait().then(() => sendResponse({ ready: true }));
    return true;
  }

  // The sidebar sends this after chrome.tabs.create returned, so tabs.onCreated for the tab
  // was dispatched first and its handler is already waiting on stateReady. Chained on the same
  // promise, this runs after it and enqueues the clear after onCreated's markOpenedUnvisited.
  if (message?.action === TAB_REOPENED_BY_UNDO_ACTION)
  {
    if (Number.isInteger(message.tabId))
    {
      void stateReady
        .then(() => tabActivityTracker.markReopened(message.tabId))
        .catch((error) => console.error('[TabActivityTracker] failed to unmark a tab reopened by Undo:', error));
    }
    return;
  }

  if (message?.action === SpaceMessageAction.OPEN_SPACE)
  {
    void openSpace(message.windowId, message.spaceId);
    return;
  }

  if (message?.action === SwitcherMessageAction.READY)
  {
    sendResponse(keyboardSwitcher.handleWindowReady());
    return;
  }

  if (message?.action === SwitcherMessageAction.COMMIT)
  {
    (async () =>
    {
      await stateReady;
      await keyboardSwitcher.commit(message.id, message.reason);
    })();
    return;
  }

  if (message?.action === SwitcherMessageAction.CANCEL)
  {
    void keyboardSwitcher.cancel(message.reason);
    return;
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

  // Legacy action name: it now only updates the internal Space association, not Chrome tab groups.
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
  // Chained on stateReady (the lists read Space state) rather than awaited in
  // the block below, so quick presses still reach the switcher in order
  const switcherCommand = parseSwitcherCommand(command);
  if (switcherCommand)
  {
    void stateReady.then(() =>
      keyboardSwitcher.handleShortcut(switcherCommand.kind, switcherCommand.direction));
    return;
  }

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
  })();
});
