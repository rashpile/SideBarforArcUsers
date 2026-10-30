import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { createChromeErrorHandler } from '../utils/chromeError';
import { tabSpaceRegistryProxy } from '../managers/proxies/tabSpaceRegistryProxy';
import { spaceManagerProxy } from '../managers/proxies/spaceManagerProxy';
import { SpaceMessageAction } from '../utils/spaceMessages';
import {
  getTabAssociations,
  storeTabAssociation,
  removeTabAssociation as removeStoredAssociation,
  setTabAssociations,
  saveTabAssociationBackup,
  removeTabAssociationBackup,
  WAIT_FOR_TAB_ASSOCIATIONS_READY,
  subscribeToTabAssociationChanges,
} from '../utils/tabAssociations';
import { restoreTabAssociations } from '../utils/restoreTabAssociations';
import { isActivationForWindow } from '../utils/tabActivationScope';
import { FAVORITES_MIGRATION_STORAGE_KEY, FavoritesMigrationState, type FavoriteRekeyMap } from '../services/favoritesMigration';
import { allFavoriteBookmarks } from '../utils/spaceFavorites';
import { hasFavoriteAssociationsToRekey, rekeyFavoriteAssociations } from '../utils/favoriteRekey';
import {
  FavoriteUrlMatcher,
  findParkedReplacementTab,
  getEffectiveTabUrl,
  parseParkedTabUrl,
  recoverFixedTabAssociations,
  recoverParkedTabAssociations,
} from '../utils/parkedTabAssociation';
import { UrlRecoveryGate } from '../utils/urlRecoveryGate';

// The Space of each tab in the window, as the registry records it
async function loadSpaceOfTab(windowId: number): Promise<(tabId: number) => string | undefined>
{
  const assignments = await tabSpaceRegistryProxy.getWindowAssignments(windowId);
  return tabId => assignments[tabId];
}

// Takes the whole getTree() result, like the bookmark recovery it runs beside; Space
// folders are looked up from the roots under its single untitled node
async function loadFavoriteUrlMatcher(
  windowId: number,
  bookmarkTree: chrome.bookmarks.BookmarkTreeNode[]
): Promise<FavoriteUrlMatcher>
{
  const [spaces, spaceOfTab] = await Promise.all([
    spaceManagerProxy.getSpaces(),
    loadSpaceOfTab(windowId),
  ]);
  return new FavoriteUrlMatcher(allFavoriteBookmarks(bookmarkTree[0]?.children ?? [], spaces), spaceOfTab);
}

async function loadFavoriteRekeyMap(): Promise<FavoriteRekeyMap>
{
  const result = await chrome.storage.local.get([FAVORITES_MIGRATION_STORAGE_KEY]);
  return FavoritesMigrationState.fromStored(result[FAVORITES_MIGRATION_STORAGE_KEY]).rekey;
}

// Helper to create item keys
const makeBookmarkKey = (bookmarkId: string) => `bookmark-${bookmarkId}`;
const makePinnedKey = (pinnedId: string) => `pinned-${pinnedId}`;

export interface OpenItemTabOptions
{
  loadUrl?: boolean;  // an existing tab also loads the item's URL (reloads when already on it)
}

interface BookmarkTabsContextValue
{
  // Bookmark functions
  openBookmarkTab: (bookmarkId: string, url: string, spaceId?: string, options?: OpenItemTabOptions) => Promise<number | undefined>;
  closeBookmarkTab: (bookmarkId: string) => void;
  isBookmarkLoaded: (bookmarkId: string) => boolean;
  isBookmarkAudible: (bookmarkId: string) => boolean;
  isBookmarkMuted: (bookmarkId: string) => boolean;
  isBookmarkActive: (bookmarkId: string) => boolean;
  getTabIdForBookmark: (bookmarkId: string) => number | undefined;
  getBookmarkLiveTitle: (bookmarkId: string) => string | undefined;
  associateExistingTab: (tabId: number, bookmarkId: string, spaceId?: string) => Promise<void>;
  restoreItemAssociation: (tabId: number, itemKey: string) => Promise<void>;
  deassociateBookmarkTab: (bookmarkId: string) => Promise<void>;
  // Pinned site functions
  openPinnedTab: (pinnedId: string, url: string, spaceId?: string, options?: OpenItemTabOptions) => Promise<number | undefined>;
  closePinnedTab: (pinnedId: string) => void;
  isPinnedLoaded: (pinnedId: string) => boolean;
  isPinnedAudible: (pinnedId: string) => boolean;
  isPinnedActive: (pinnedId: string) => boolean;
  getTabIdForPinned: (pinnedId: string) => number | undefined;
  getPinnedLiveTitle: (pinnedId: string) => string | undefined;
  associateExistingPinnedTab: (tabId: number, pinnedId: string) => Promise<void>;
  deassociatePinnedTab: (pinnedId: string) => Promise<void>;
  // Active item tracking
  getActiveItemKey: () => string | null;
  // Tab filtering for sidebar
  getManagedTabIds: () => Set<number>;
  // Get item key (bookmark-{id} or pinned-{id}) for a tab
  getItemKeyForTab: (tabId: number) => string | null;
  // Common
  isInitialized: boolean;
  error: string | null;
}

const BookmarkTabsContext = createContext<BookmarkTabsContextValue | null>(null);

export const useBookmarkTabsContext = (): BookmarkTabsContextValue =>
{
  const context = useContext(BookmarkTabsContext);
  if (!context)
  {
    throw new Error('useBookmarkTabsContext must be used within BookmarkTabsProvider');
  }
  return context;
};

interface BookmarkTabsProviderProps
{
  children: ReactNode;
}

export const BookmarkTabsProvider = ({ children }: BookmarkTabsProviderProps) =>
{
  // Current window ID for window-scoped storage
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  // In-memory mappings for fast lookup (key is "bookmark-{id}" or "pinned-{id}")
  const [itemToTab, setItemToTab] = useState<Map<string, number>>(new Map());
  const [tabToItem, setTabToItem] = useState<Map<number, string>>(new Map());
  const [audibleTabs, setAudibleTabs] = useState<Set<number>>(new Set());
  const [mutedTabs, setMutedTabs] = useState<Set<number>>(new Set());
  const [tabTitles, setTabTitles] = useState<Map<number, string>>(new Map());
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const isRebuilding = useRef(false);
  const urlRecoveryGate = useRef<{ windowId: number; gate: UrlRecoveryGate } | null>(null);

  // Get current window ID on mount
  useEffect(() =>
  {
    chrome.windows.getCurrent((win) =>
    {
      if (win.id)
      {
        setCurrentWindowId(win.id);
      }
    });
  }, []);

  const handleError = useMemo(() => createChromeErrorHandler('BookmarkTabs', setError), []);

  // Rebuilds associations from storage: keeps stored tab IDs that still exist. URL matching runs
  // for park pages on every rebuild, and for other tabs once per browser session per window
  // (UrlRecoveryGate), so a tab opened by hand on a bookmarked URL stays a regular tab.
  const rebuildAssociations = useCallback(async (windowId: number) =>
  {
    if (isRebuilding.current) return;
    isRebuilding.current = true;

    try
    {
      await chrome.runtime.sendMessage({ action: WAIT_FOR_TAB_ASSOCIATIONS_READY });

      // One query for the window, so first open doesn't cost a chrome.tabs.get per pinned tab.
      const [storedAssociations, allTabs, rekeyMap] = await Promise.all([
        getTabAssociations(windowId),
        chrome.tabs.query({ windowId }),
        loadFavoriteRekeyMap(),
      ]);
      const tabsById = new Map(
        allTabs.flatMap(tab => tab.id === undefined ? [] : [[tab.id, tab] as const])
      );

      // Before URL recovery, so a re-keyed Favorite already claims its new key there
      let associations = storedAssociations;
      if (hasFavoriteAssociationsToRekey(associations, rekeyMap))
      {
        const rekeyed = rekeyFavoriteAssociations(associations, rekeyMap, await loadSpaceOfTab(windowId));
        associations = rekeyed.associations;
        await Promise.all(rekeyed.moves.map(async ({ tabId, fromKey, toKey }) =>
        {
          const tab = tabsById.get(tabId);
          if (toKey && tab)
          {
            await saveTabAssociationBackup(windowId, toKey, {
              tabId,
              url: getEffectiveTabUrl(tab.url),
              tabIndex: tab.index,
            });
          }
          await removeTabAssociationBackup(windowId, fromKey);
        }));
      }

      performance.mark('sidebar:associations-start');
      const restored = await restoreTabAssociations(
        associations,
        async (tabId) => tabsById.get(tabId) ?? null
      );

      // A tab suspender may replace a tab with its park page. Restore by the old tab ID first;
      // only when that association is lost, read bookmarks and Favorites and heal it from the
      // park page's original URL.
      let recovered = recoverParkedTabAssociations(allTabs, associations);
      const hasUnresolvedParkedTab = allTabs.some(tab =>
        tab.id !== undefined
        && parseParkedTabUrl(tab.url) !== null
        && !restored.associations[tab.id]
        && !recovered[tab.id]
      );
      if (hasUnresolvedParkedTab)
      {
        const bookmarkRoots = await chrome.bookmarks.getTree();
        const favorites = await loadFavoriteUrlMatcher(windowId, bookmarkRoots);
        recovered = {
          ...recovered,
          ...recoverParkedTabAssociations(
            allTabs,
            { ...associations, ...recovered },
            bookmarkRoots,
            favorites
          ),
        };
      }

      const recoveredBackups: Promise<void>[] = [];
      // Persisted at once, so recovered park pages stay associated after the sidebar closes again.
      for (const [tabIdText, itemKey] of Object.entries(recovered))
      {
        const tabId = Number(tabIdText);
        const tab = tabsById.get(tabId);
        if (!tab) continue;

        restored.associations[tabId] = itemKey;
        restored.itemToTab.set(itemKey, tabId);
        restored.tabToItem.set(tabId, itemKey);
        if (tab.title) restored.tabTitles.set(tabId, tab.title);
        if (tab.audible) restored.audibleTabs.add(tabId);
        if (tab.mutedInfo?.muted) restored.mutedTabs.add(tabId);
        recoveredBackups.push(saveTabAssociationBackup(windowId, itemKey, {
          tabId,
          url: getEffectiveTabUrl(tab.url),
          tabIndex: tab.index,
        }));
      }
      await Promise.all(recoveredBackups);
      performance.mark('sidebar:associations-ready');
      performance.measure('sidebar:associations-restore', 'sidebar:associations-start', 'sidebar:associations-ready');

      // Write only if stale tabs were dropped, or the storage listener loops on pointless rebuilds.
      if (JSON.stringify(restored.associations) !== JSON.stringify(storedAssociations))
      {
        await setTabAssociations(windowId, restored.associations);
      }

      setItemToTab(restored.itemToTab);
      setTabToItem(restored.tabToItem);
      setTabTitles(restored.tabTitles);
      setAudibleTabs(restored.audibleTabs);
      setMutedTabs(restored.mutedTabs);
      setIsInitialized(true);

      if (urlRecoveryGate.current?.windowId !== windowId)
      {
        urlRecoveryGate.current = {
          windowId,
          gate: new UrlRecoveryGate({
            get: key => chrome.storage.session.get(key),
            set: values => chrome.storage.session.set(values),
          }, windowId),
        };
      }
      // Runs after the first state commit: pinned identities fill in shortly, without bringing
      // back the blank wait on first open.
      void urlRecoveryGate.current.gate.runOnce(async () =>
      {
        const bookmarkRoots = await chrome.bookmarks.getTree();
        const [favorites, latestAssociations] = await Promise.all([
          loadFavoriteUrlMatcher(windowId, bookmarkRoots),
          getTabAssociations(windowId),
        ]);
        const fixedAssociations = recoverFixedTabAssociations(
          allTabs,
          latestAssociations,
          bookmarkRoots,
          favorites
        );
        if (Object.keys(fixedAssociations).length === 0) return;

        await setTabAssociations(windowId, { ...latestAssociations, ...fixedAssociations });
        await Promise.all(Object.entries(fixedAssociations).map(([tabIdText, itemKey]) =>
        {
          const tab = tabsById.get(Number(tabIdText));
          if (!tab) return Promise.resolve();
          return saveTabAssociationBackup(windowId, itemKey, {
            tabId: Number(tabIdText),
            url: getEffectiveTabUrl(tab.url),
            tabIndex: tab.index,
          });
        }));
      }).catch(err => console.error('Failed to recover fixed tab associations:', err));
    }
    catch (err)
    {
      console.error('Failed to rebuild associations:', err);
      setIsInitialized(true);
    }
    finally
    {
      isRebuilding.current = false;
    }
  }, []);

  // Initialize when windowId is available
  useEffect(() =>
  {
    if (currentWindowId !== null)
    {
      rebuildAssociations(currentWindowId);
    }
  }, [currentWindowId, rebuildAssociations]);

  // The migration may finish while the sidebar is open; its re-key map then moves open
  // Favorite tabs to their Space's copies
  useEffect(() =>
  {
    if (currentWindowId === null) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) =>
    {
      if (areaName === 'local' && FAVORITES_MIGRATION_STORAGE_KEY in changes) void rebuildAssociations(currentWindowId);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [currentWindowId, rebuildAssociations]);

  useEffect(() =>
  {
    if (currentWindowId === null) return;
    return subscribeToTabAssociationChanges(
      currentWindowId,
      () => { void rebuildAssociations(currentWindowId); }
    );
  }, [currentWindowId, rebuildAssociations]);

  // Helper to remove association for a tab
  const removeLocalTabAssociation = useCallback(async (tabId: number, windowId: number): Promise<void> =>
  {
    const itemKey = tabToItem.get(tabId);
    if (!itemKey) return;

    setItemToTab((prev) =>
    {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setTabToItem((prev) =>
    {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    setTabTitles((prev) =>
    {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    setAudibleTabs((prev) =>
    {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    setMutedTabs((prev) =>
    {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });

    // Await both the session and local backup removals, so closing the Side Panel loses no write.
    await Promise.all([
      removeStoredAssociation(windowId, tabId),
      removeTabAssociationBackup(windowId, itemKey),
    ]);
  }, [tabToItem]);

  // Listen for tab removal
  useEffect(() =>
  {
    if (currentWindowId === null) return;

    const handleTabRemoved = async (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) =>
    {
      if (removeInfo.windowId !== currentWindowId) return;

      // A suspender opens the park page before closing the tab: move the identity instead of
      // clearing the backup as on a normal close.
      const currentTabs = await chrome.tabs.query({ windowId: currentWindowId });
      const replacement = findParkedReplacementTab(currentTabs, tabId);
      const replacementId = replacement?.id;
      if (replacement && replacementId !== undefined)
      {
        const associations = await getTabAssociations(currentWindowId);
        const itemKey = associations[tabId] ?? tabToItem.get(tabId);
        if (itemKey)
        {
          await storeTabAssociation(currentWindowId, replacementId, itemKey);
          await removeStoredAssociation(currentWindowId, tabId);
          await saveTabAssociationBackup(currentWindowId, itemKey, {
            tabId: replacementId,
            url: getEffectiveTabUrl(replacement.url),
            tabIndex: replacement.index,
          });
          return;
        }
      }

      await removeLocalTabAssociation(tabId, currentWindowId);
    };

    chrome.tabs?.onRemoved?.addListener(handleTabRemoved);

    return () =>
    {
      chrome.tabs?.onRemoved?.removeListener(handleTabRemoved);
    };
  }, [currentWindowId, removeLocalTabAssociation, tabToItem]);

  // Listen for tab detached (moved to another window)
  // When a tab is detached from this window, treat it as closed in this window
  useEffect(() =>
  {
    if (currentWindowId === null) return;

    const handleTabDetached = (tabId: number, detachInfo: chrome.tabs.TabDetachInfo) =>
    {
      // Only remove if detached from our window
      if (detachInfo.oldWindowId === currentWindowId)
      {
        void removeLocalTabAssociation(tabId, currentWindowId);
      }
    };

    chrome.tabs?.onDetached?.addListener(handleTabDetached);

    return () =>
    {
      chrome.tabs?.onDetached?.removeListener(handleTabDetached);
    };
  }, [currentWindowId, removeLocalTabAssociation]);

  // Listen for background telling us a tracked tab was dragged into a
  // different space's Chrome group - break the association, same as the user
  // manually choosing "Move to Tabs" (see DEASSOCIATE_TAB in spaceMessages.ts)
  useEffect(() =>
  {
    if (currentWindowId === null) return;

    const handleMessage = (message: { action?: string; windowId?: number; tabId?: number }) =>
    {
      if (message.action !== SpaceMessageAction.DEASSOCIATE_TAB) return;
      if (message.windowId !== currentWindowId || message.tabId === undefined) return;

      void removeLocalTabAssociation(message.tabId, currentWindowId);
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () =>
    {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [currentWindowId, removeLocalTabAssociation]);

  // Listen for tab audible and title changes
  useEffect(() =>
  {
    const handleTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) =>
    {
      // Track audible state
      if (changeInfo.audible !== undefined)
      {
        setAudibleTabs((prev) =>
        {
          const newSet = new Set(prev);
          if (changeInfo.audible)
          {
            newSet.add(tabId);
          }
          else
          {
            newSet.delete(tabId);
          }
          return newSet;
        });
      }

      if (changeInfo.mutedInfo !== undefined)
      {
        setMutedTabs((prev) =>
        {
          const newSet = new Set(prev);
          if (changeInfo.mutedInfo?.muted)
          {
            newSet.add(tabId);
          }
          else
          {
            newSet.delete(tabId);
          }
          return newSet;
        });
      }

      // Track title changes for managed tabs only
      if (changeInfo.title !== undefined)
      {
        setTabToItem((prev) =>
        {
          // Only track title if this is a managed tab
          if (prev.has(tabId))
          {
            setTabTitles((prevTitles) =>
            {
              const newMap = new Map(prevTitles);
              newMap.set(tabId, changeInfo.title!);
              return newMap;
            });
          }
          return prev;
        });
      }
    };

    chrome.tabs?.onUpdated?.addListener(handleTabUpdated);

    return () =>
    {
      chrome.tabs?.onUpdated?.removeListener(handleTabUpdated);
    };
  }, []);

  // Listen for active tab changes
  useEffect(() =>
  {
    if (currentWindowId === null) return;

    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) =>
    {
      if (isActivationForWindow(currentWindowId, activeInfo))
      {
        setActiveTabId(activeInfo.tabId);
      }
    };

    // Initialize with current active tab
    chrome.tabs?.query({ active: true, windowId: currentWindowId }, (tabs) =>
    {
      if (tabs.length > 0 && tabs[0].id)
      {
        setActiveTabId(tabs[0].id);
      }
    });

    chrome.tabs?.onActivated?.addListener(handleTabActivated);

    return () =>
    {
      chrome.tabs?.onActivated?.removeListener(handleTabActivated);
    };
  }, [currentWindowId]);

  // Store association in session storage and local backup
  // tabUrl and tabIndex can be passed directly (e.g. from tab creation callback) to avoid
  // an extra chrome.tabs.get call and its async yield point
  const storeAssociation = useCallback(async (
    tabId: number,
    itemKey: string,
    tabUrl?: string,
    tabIndex?: number
  ): Promise<void> =>
  {
    if (currentWindowId === null) return;

    await storeTabAssociation(currentWindowId, tabId, itemKey);

    let url = tabUrl;
    let index = tabIndex;

    if (url === undefined || index === undefined)
    {
      const tab = await new Promise<chrome.tabs.Tab | null>((resolve) =>
      {
        chrome.tabs.get(tabId, (t) =>
        {
          resolve(chrome.runtime.lastError ? null : t);
        });
      });
      url = tab?.url ?? '';
      index = tab?.index;
    }

    if (url !== undefined && index !== undefined)
    {
      await saveTabAssociationBackup(currentWindowId, itemKey, { tabId, url, tabIndex: index });
    }
  }, [currentWindowId]);

  // Create a new tab for an item (no grouping)
  // Returns the created tab ID, or undefined if creation failed
  const createItemTab = useCallback(async (
    itemKey: string,
    url: string,
    spaceId?: string
  ): Promise<number | undefined> =>
  {
    return new Promise((resolve) =>
    {
      chrome.tabs.create({ url, active: true, windowId: currentWindowId ?? undefined }, async (tab) =>
      {
        if (handleError('create') || !tab.id)
        {
          resolve(undefined);
          return;
        }

        const tabId = tab.id;
        const windowId = currentWindowId ?? tab.windowId;

        // Store association (pass url+index to avoid extra chrome.tabs.get call)
        await storeAssociation(tabId, itemKey, tab.url ?? '', tab.index);

        setItemToTab((prev) =>
        {
          const newMap = new Map(prev);
          newMap.set(itemKey, tabId);
          return newMap;
        });
        setTabToItem((prev) =>
        {
          const newMap = new Map(prev);
          newMap.set(tabId, itemKey);
          return newMap;
        });

        if (spaceId && windowId)
        {
          await tabSpaceRegistryProxy.register(windowId, tabId, spaceId);
        }

        resolve(tabId);
      });
    });
  }, [handleError, storeAssociation, currentWindowId]);

  // Item tabs still being created. A second click that arrives before the association
  // lands (a double-click) gets the same tab instead of opening another one
  const pendingItemTabsRef = useRef(new Map<string, Promise<number | undefined>>());

  const createItemTabOnce = useCallback((
    itemKey: string,
    url: string,
    spaceId?: string
  ): Promise<number | undefined> =>
  {
    const creation = createItemTab(itemKey, url, spaceId)
      .finally(() => pendingItemTabsRef.current.delete(itemKey));
    pendingItemTabsRef.current.set(itemKey, creation);
    return creation;
  }, [createItemTab]);

  // Open a tab for an item (bookmark or pinned site)
  // Returns the tab ID (existing or newly created), or undefined if failed
  const openItemTab = useCallback(async (
    itemKey: string,
    url: string,
    spaceId?: string,
    options?: OpenItemTabOptions
  ): Promise<number | undefined> =>
  {
    const pending = pendingItemTabsRef.current.get(itemKey);
    if (pending) return pending;

    const existingTabId = itemToTab.get(itemKey);

    if (existingTabId)
    {
      return new Promise((resolve) =>
      {
        chrome.tabs.get(existingTabId, (tab) =>
        {
          if (chrome.runtime.lastError || !tab)
          {
            createItemTabOnce(itemKey, url, spaceId).then(resolve);
          }
          else if (options?.loadUrl && tab.url === url)
          {
            // Already on the item's page: update() with the same URL skips a hash URL, so reload
            chrome.tabs.update(existingTabId, { active: true }, () =>
            {
              handleError('activate');
              chrome.tabs.reload(existingTabId, {}, () =>
              {
                handleError('reload');
                resolve(existingTabId);
              });
            });
          }
          else
          {
            const update: chrome.tabs.UpdateProperties = options?.loadUrl ? { url, active: true } : { active: true };
            chrome.tabs.update(existingTabId, update, () =>
            {
              handleError(options?.loadUrl ? 'load' : 'activate');
              resolve(existingTabId);
            });
          }
        });
      });
    }
    else
    {
      return createItemTabOnce(itemKey, url, spaceId);
    }
  }, [itemToTab, createItemTabOnce, handleError]);

  // Close an item's associated tab
  const closeItemTab = useCallback((itemKey: string): void =>
  {
    const tabId = itemToTab.get(itemKey);
    if (tabId)
    {
      chrome.tabs.remove(tabId, () =>
      {
        handleError('close');
      });
    }
  }, [itemToTab, handleError]);

  // Check if an item has a loaded tab
  const isItemLoaded = useCallback((itemKey: string): boolean =>
  {
    return itemToTab.has(itemKey);
  }, [itemToTab]);

  // --- Bookmark-specific wrappers ---
  const openBookmarkTab = useCallback(async (
    bookmarkId: string,
    url: string,
    spaceId?: string,
    options?: OpenItemTabOptions
  ): Promise<number | undefined> =>
  {
    return openItemTab(makeBookmarkKey(bookmarkId), url, spaceId, options);
  }, [openItemTab]);

  const closeBookmarkTab = useCallback((bookmarkId: string): void =>
  {
    closeItemTab(makeBookmarkKey(bookmarkId));
  }, [closeItemTab]);

  const isBookmarkLoaded = useCallback((bookmarkId: string): boolean =>
  {
    return isItemLoaded(makeBookmarkKey(bookmarkId));
  }, [isItemLoaded]);

  const isBookmarkAudible = useCallback((bookmarkId: string): boolean =>
  {
    const tabId = itemToTab.get(makeBookmarkKey(bookmarkId));
    return tabId !== undefined && audibleTabs.has(tabId);
  }, [itemToTab, audibleTabs]);

  const isBookmarkMuted = useCallback((bookmarkId: string): boolean =>
  {
    const tabId = itemToTab.get(makeBookmarkKey(bookmarkId));
    return tabId !== undefined && mutedTabs.has(tabId);
  }, [itemToTab, mutedTabs]);

  const getTabIdForBookmark = useCallback((bookmarkId: string): number | undefined =>
  {
    return itemToTab.get(makeBookmarkKey(bookmarkId));
  }, [itemToTab]);

  const getBookmarkLiveTitle = useCallback((bookmarkId: string): string | undefined =>
  {
    const tabId = itemToTab.get(makeBookmarkKey(bookmarkId));
    return tabId !== undefined ? tabTitles.get(tabId) : undefined;
  }, [itemToTab, tabTitles]);

  // Associate an existing tab with a bookmark (for drag-drop from tabs to bookmarks,
  // or "Add to Bookmark"). spaceId is the Space that owns the bookmark's folder -
  // resolved by the caller, since a folder belongs to at most one Space (see
  // CLAUDE.md "Design Assumptions"). Mirrors createItemTab's registration +
  // grouping so a bookmarked tab always matches its bookmark's Space, regardless
  // of which space the tab happened to be in before it was bookmarked.
  const associateExistingTab = useCallback(async (
    tabId: number,
    bookmarkId: string,
    spaceId?: string
  ): Promise<void> =>
  {
    const itemKey = makeBookmarkKey(bookmarkId);

    // Store association
    await storeAssociation(tabId, itemKey);

    if (spaceId && currentWindowId !== null)
    {
      await tabSpaceRegistryProxy.register(currentWindowId, tabId, spaceId);
    }

    setItemToTab((prev) =>
    {
      const newMap = new Map(prev);
      newMap.set(itemKey, tabId);
      return newMap;
    });
    setTabToItem((prev) =>
    {
      const newMap = new Map(prev);
      newMap.set(tabId, itemKey);
      return newMap;
    });
  }, [storeAssociation, currentWindowId]);

  // Restore an item association by raw itemKey (for undo — works for both bookmark and pinned)
  const restoreItemAssociation = useCallback(async (tabId: number, itemKey: string): Promise<void> =>
  {
    await storeAssociation(tabId, itemKey);

    setItemToTab((prev) =>
    {
      const newMap = new Map(prev);
      newMap.set(itemKey, tabId);
      return newMap;
    });
    setTabToItem((prev) =>
    {
      const newMap = new Map(prev);
      newMap.set(tabId, itemKey);
      return newMap;
    });
  }, [storeAssociation]);

  // Deassociate a bookmark from its tab (tab stays alive, bookmark becomes unloaded)
  const deassociateBookmarkTab = useCallback(async (bookmarkId: string): Promise<void> =>
  {
    if (currentWindowId === null) return;
    const itemKey = makeBookmarkKey(bookmarkId);
    const tabId = itemToTab.get(itemKey);
    if (tabId !== undefined)
    {
      await removeLocalTabAssociation(tabId, currentWindowId);
    }
  }, [itemToTab, currentWindowId, removeLocalTabAssociation]);

  // --- Pinned site-specific wrappers ---
  const openPinnedTab = useCallback(async (
    pinnedId: string,
    url: string,
    spaceId?: string,
    options?: OpenItemTabOptions
  ): Promise<number | undefined> =>
  {
    return openItemTab(makePinnedKey(pinnedId), url, spaceId, options);
  }, [openItemTab]);

  const closePinnedTab = useCallback((pinnedId: string): void =>
  {
    closeItemTab(makePinnedKey(pinnedId));
  }, [closeItemTab]);

  const isPinnedLoaded = useCallback((pinnedId: string): boolean =>
  {
    return isItemLoaded(makePinnedKey(pinnedId));
  }, [isItemLoaded]);

  const isPinnedAudible = useCallback((pinnedId: string): boolean =>
  {
    const tabId = itemToTab.get(makePinnedKey(pinnedId));
    return tabId !== undefined && audibleTabs.has(tabId);
  }, [itemToTab, audibleTabs]);

  const getTabIdForPinned = useCallback((pinnedId: string): number | undefined =>
  {
    return itemToTab.get(makePinnedKey(pinnedId));
  }, [itemToTab]);

  const getPinnedLiveTitle = useCallback((pinnedId: string): string | undefined =>
  {
    const tabId = itemToTab.get(makePinnedKey(pinnedId));
    return tabId !== undefined ? tabTitles.get(tabId) : undefined;
  }, [itemToTab, tabTitles]);

  // Links the tab a Favorite was just made from. The URL pass runs once per browser session,
  // so without this the tab would stay in the Tab list and the Favorite would open a second one.
  const associateExistingPinnedTab = useCallback(async (tabId: number, pinnedId: string): Promise<void> =>
  {
    await restoreItemAssociation(tabId, makePinnedKey(pinnedId));
  }, [restoreItemAssociation]);

  // Deassociate a pinned site from its tab (tab stays alive, becomes unmanaged).
  // Remove the association first, then background makes it a regular tab of the current Space.
  const deassociatePinnedTab = useCallback(async (pinnedId: string): Promise<void> =>
  {
    if (currentWindowId === null) return;
    const itemKey = makePinnedKey(pinnedId);
    const tabId = itemToTab.get(itemKey);
    if (tabId !== undefined)
    {
      await removeLocalTabAssociation(tabId, currentWindowId);
      chrome.runtime.sendMessage({ action: 'queue-tab-for-grouping', tabId, windowId: currentWindowId });
    }
  }, [itemToTab, currentWindowId, removeLocalTabAssociation]);

  // --- Active state functions ---
  const isBookmarkActive = useCallback((bookmarkId: string): boolean =>
  {
    if (activeTabId === null) return false;
    const tabId = itemToTab.get(makeBookmarkKey(bookmarkId));
    return tabId === activeTabId;
  }, [itemToTab, activeTabId]);

  const isPinnedActive = useCallback((pinnedId: string): boolean =>
  {
    if (activeTabId === null) return false;
    const tabId = itemToTab.get(makePinnedKey(pinnedId));
    return tabId === activeTabId;
  }, [itemToTab, activeTabId]);

  const getActiveItemKey = useCallback((): string | null =>
  {
    if (activeTabId === null) return null;
    return tabToItem.get(activeTabId) ?? null;
  }, [tabToItem, activeTabId]);

  // Get all managed tab IDs (for filtering in TabList)
  const getManagedTabIds = useCallback((): Set<number> =>
  {
    return new Set(tabToItem.keys());
  }, [tabToItem]);

  // Get item key for a tab (used to find bookmark element for scrolling)
  const getItemKeyForTab = useCallback((tabId: number): string | null =>
  {
    return tabToItem.get(tabId) ?? null;
  }, [tabToItem]);


  const value = useMemo<BookmarkTabsContextValue>(() => ({
    openBookmarkTab,
    closeBookmarkTab,
    isBookmarkLoaded,
    isBookmarkAudible,
    isBookmarkMuted,
    isBookmarkActive,
    getTabIdForBookmark,
    getBookmarkLiveTitle,
    associateExistingTab,
    restoreItemAssociation,
    deassociateBookmarkTab,
    openPinnedTab,
    closePinnedTab,
    isPinnedLoaded,
    isPinnedAudible,
    isPinnedActive,
    getTabIdForPinned,
    getPinnedLiveTitle,
    associateExistingPinnedTab,
    deassociatePinnedTab,
    getActiveItemKey,
    getManagedTabIds,
    getItemKeyForTab,
    isInitialized,
    error,
  }), [
    openBookmarkTab,
    closeBookmarkTab,
    isBookmarkLoaded,
    isBookmarkAudible,
    isBookmarkMuted,
    isBookmarkActive,
    getTabIdForBookmark,
    getBookmarkLiveTitle,
    associateExistingTab,
    restoreItemAssociation,
    deassociateBookmarkTab,
    openPinnedTab,
    closePinnedTab,
    isPinnedLoaded,
    isPinnedAudible,
    isPinnedActive,
    getTabIdForPinned,
    getPinnedLiveTitle,
    associateExistingPinnedTab,
    deassociatePinnedTab,
    getActiveItemKey,
    getManagedTabIds,
    getItemKeyForTab,
    isInitialized,
    error,
  ]);

  return (
    <BookmarkTabsContext.Provider value={value}>
      {children}
    </BookmarkTabsContext.Provider>
  );
};
