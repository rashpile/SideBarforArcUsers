import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useBookmarkTabsContext } from './BookmarkTabsContext';
import { useBookmarks } from '../hooks/useBookmarks';
import { Space, ALL_SPACE, SpaceMessageAction } from '../utils/spaceMessages';
import { spaceWindowStateProxy } from '../managers/proxies/spaceWindowStateProxy';
import { useSpaceWindowState } from '../hooks/useSpaceWindowState';
import { spaceManagerProxy } from '../managers/proxies/spaceManagerProxy';
import { tabSpaceRegistryProxy } from '../managers/proxies/tabSpaceRegistryProxy';
import { useSpaces } from '../hooks/useSpaces';
import { resolveActiveSpaceId } from '../utils/spaceSelection';

// Re-export Space and ALL_SPACE so all existing imports from SpacesContext continue to work
export type { Space } from '../utils/spaceMessages';
export { ALL_SPACE } from '../utils/spaceMessages';

// =============================================================================
// Helpers
// =============================================================================

const generateId = (): string =>
{
  return `space_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

// Debug spaces for development - only included in dev builds
const getDebugSpaces = (): Space[] =>
{
  // if (import.meta.env.DEV)
  // {
  //   return [
  //     {
  //       id: 'debug_home',
  //       name: 'Home',
  //       icon: 'Home',
  //       color: 'blue',
  //       bookmarkFolderPath: 'Bookmarks Bar/Home',
  //     },
  //     {
  //       id: 'debug_video',
  //       name: 'Video',
  //       icon: 'Camera',
  //       color: 'red',
  //       bookmarkFolderPath: 'Other Bookmarks/Video',
  //     },
  //   ];
  // }
  return [];
};

// =============================================================================
// Context Interface
// =============================================================================

/**
 * Who caused the active space to change. 'user' is a direct gesture (space bar
 * click, swipe, navigator); 'navigation' is everything code-initiated. App.tsx
 * reads it to decide whether to also activate a tab.
 */
export type SpaceSwitchSource = 'user' | 'navigation';

interface SpacesContextValue
{
  // Space definitions
  // readonly: this is the live array behind spaceManagerProxy's mirror, not
  // a copy. Sorting or pushing it in place would change what every consumer
  // sees without notifying any of them, since only the store's set() fires
  // listeners - and the next CRUD call would then persist that accident.
  // Build a new list and go through the context's own mutators instead.
  spaces: readonly Space[];
  allSpaces: Space[];  // Real, navigable Spaces
  activeSpace: Space;
  isInitialized: boolean;
  windowId: number | null;

  // Space CRUD
  createSpace: (
    name: string,
    icon: string,
    color: string,
    bookmarkFolderPath: string,
    bookmarkFolderSegments: string[],
    bookmarkFolderInAccount?: boolean
  ) => Space;
  updateSpace: (id: string, updates: Partial<Omit<Space, 'id'>>) => void;
  updateSpaceFolderPaths: (updates: { id: string; bookmarkFolderPath: string; bookmarkFolderSegments: string[] }[]) => void;
  deleteSpace: (id: string) => Promise<void>;
  moveSpace: (activeId: string, overId: string) => void;
  getSpaceById: (id: string) => Space | undefined;

  // Import/Export
  replaceSpaces: (spaces: Space[]) => Promise<void>;
  appendSpaces: (spaces: Space[]) => Promise<void>;

  // Per-window state
  activeSpaceId: string;
  setActiveSpaceId: (spaceId: string) => void;  // No tab activation (for code-initiated switches)
  switchToSpace: (spaceId: string) => void;     // User switch: also brings the Space's last used tab forward

  // Tab query (uses Chrome tab groups)
  getTabsForSpace: (spaceId: string) => Promise<chrome.tabs.Tab[]>;

  // Space switch source (read-once: returns value and resets to 'navigation')
  getSpaceSwitchSource: () => SpaceSwitchSource;

  // Actions
  getTabIdsInSpace: (space: Space) => Promise<number[]>;
  closeAllTabsInSpace: (space: Space) => Promise<void>;
}

const SpacesContext = createContext<SpacesContextValue | null>(null);

/**
 * Hands a new Space list to the proxy and deliberately drops the rejection -
 * a failed write doesn't surface as an unhandled promise rejection, since the
 * proxy has already logged the failure and resynced its mirror from
 * background by the time this settles.
 *
 * Returns the (always-resolving) promise so replaceSpaces/appendSpaces can
 * await it - import needs SpaceManager's segment self-heal (see the
 * shared-storage decision doc) to have actually landed before the import
 * dialog reports itself done. Every other caller below still doesn't await,
 * because none of them do anything afterwards that depends on the write
 * having landed.
 *
 * DeleteSpaceAction is the exception and calls the proxy directly, since an
 * undo right after a delete does have to know the delete arrived.
 */
const writeSpaces = (spaces: Space[]): Promise<void> =>
{
  return spaceManagerProxy.updateSpaces(spaces).then(() => {}, () => {});
};

// =============================================================================
// Provider
// =============================================================================

export const SpacesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) =>
{
  // ---------------------------------------------------------------------------
  // Dependencies for closeAllTabsInSpace
  // ---------------------------------------------------------------------------
  const { getTabIdForBookmark } = useBookmarkTabsContext();
  const { findFolderBySegments, getAllBookmarksInFolder } = useBookmarks();

  // ---------------------------------------------------------------------------
  // Space definitions - read-only mirror of spaceManagerProxy's store, kept
  // current by background.ts's broadcasts (cross-window sync is the
  // SPACES_CHANGED broadcast now, not a chrome.storage.onChanged listener)
  // ---------------------------------------------------------------------------
  const spaces = useSpaces();

  // ---------------------------------------------------------------------------
  // Per-window state (read-only mirror of spaceWindowStateProxy's store,
  // kept current by background.ts's broadcasts - see useSpaceWindowState)
  // ---------------------------------------------------------------------------
  const [windowId, setWindowId] = useState<number | null>(null);
  const windowState = useSpaceWindowState();
  const [isInitialized, setIsInitialized] = useState(false);

  // Get current window ID, then load both mirrors (spaces and this window's
  // SpaceWindowState) before considering the context initialized
  useEffect(() =>
  {
    chrome.windows.getCurrent((window) =>
    {
      if (window.id)
      {
        setWindowId(window.id);

        performance.mark('sidebar:spaces-start');
        Promise.all([
          spaceManagerProxy.load(),
          spaceWindowStateProxy.mirrorWindow(window.id),
        ]).then(([loadedSpaces]) =>
        {
          // Initialize with debug spaces if empty (dev mode only)
          if (loadedSpaces.length === 0)
          {
            const debugSpaces = getDebugSpaces();
            if (debugSpaces.length > 0)
            {
              writeSpaces(debugSpaces);
            }
          }

          setIsInitialized(true);
          performance.mark('sidebar:spaces-ready');
          performance.measure('sidebar:spaces-load', 'sidebar:spaces-start', 'sidebar:spaces-ready');
        }).catch((error) =>
        {
          console.error('Failed to load spaces/window state:', error);
          setIsInitialized(true);
          performance.mark('sidebar:spaces-ready');
          performance.measure('sidebar:spaces-load', 'sidebar:spaces-start', 'sidebar:spaces-ready');
        });
      }
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Space CRUD operations
  // ---------------------------------------------------------------------------

  const createSpace = useCallback((
    name: string,
    icon: string,
    color: string,
    bookmarkFolderPath: string,
    bookmarkFolderSegments: string[],
    bookmarkFolderInAccount?: boolean
  ): Space =>
  {
    if (bookmarkFolderPath && bookmarkFolderSegments.length === 0)
    {
      console.error('[createSpace] bookmarkFolderSegments required when bookmarkFolderPath is set');
    }

    const newSpace: Space = {
      id: generateId(),
      name,
      icon,
      color,
      bookmarkFolderPath,
      bookmarkFolderSegments,
      bookmarkFolderInAccount,
    };

    // Read the store snapshot at call time, not the render-captured `spaces`
    // const, so back-to-back calls each see the previous call's write (the
    // whole point of this refactor - see decision 4 in the shared-storage doc)
    const updatedSpaces = [...spaceManagerProxy.snapshot, newSpace];
    writeSpaces(updatedSpaces);
    return newSpace;
  }, []);

  const getSpaceById = useCallback((id: string): Space | undefined =>
  {
    return spaces.find(s => s.id === id);
  }, [spaces]);

  const updateSpace = useCallback(async (
    id: string,
    updates: Partial<Omit<Space, 'id'>>
  ) =>
  {
    const space = getSpaceById(id);
    if (!space || id === 'all') return;

    // Fail fast if caller sets bookmarkFolderPath without segments
    if (updates.bookmarkFolderPath !== undefined &&
        updates.bookmarkFolderPath !== '' &&
        (!updates.bookmarkFolderSegments || updates.bookmarkFolderSegments.length === 0))
    {
      console.error('[updateSpace] bookmarkFolderSegments required when bookmarkFolderPath is set');
    }

    // Update Space in storage - read the store snapshot at call time, not the
    // render-captured `spaces` const, so this doesn't clobber a write another
    // call made after this callback was created
    const updatedSpaces = spaceManagerProxy.snapshot.map(s =>
      s.id === id ? { ...s, ...updates } : s
    );
    await writeSpaces(updatedSpaces);
  }, [getSpaceById, windowId]);

  // Batch-update folder path + segments for multiple spaces at once (e.g. after a folder rename)
  const updateSpaceFolderPaths = useCallback((updates: { id: string; bookmarkFolderPath: string; bookmarkFolderSegments: string[] }[]) =>
  {
    if (updates.length === 0) return;
    const updatedSpaces = spaceManagerProxy.snapshot.map(s =>
    {
      const update = updates.find(u => u.id === s.id);
      return update
        ? { ...s, bookmarkFolderPath: update.bookmarkFolderPath, bookmarkFolderSegments: update.bookmarkFolderSegments }
        : s;
    });
    writeSpaces(updatedSpaces);
  }, []);

  const deleteSpaceBase = useCallback((id: string) =>
  {
    if (id === 'all') return; // Cannot delete "All" space
    const updatedSpaces = spaceManagerProxy.snapshot.filter(s => s.id !== id);
    writeSpaces(updatedSpaces);
  }, []);

  const moveSpace = useCallback((activeId: string, overId: string) =>
  {
    const currentSpaces = spaceManagerProxy.snapshot;
    const oldIndex = currentSpaces.findIndex(s => s.id === activeId);
    const newIndex = currentSpaces.findIndex(s => s.id === overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const updatedSpaces = [...currentSpaces];
    const [removed] = updatedSpaces.splice(oldIndex, 1);
    updatedSpaces.splice(newIndex, 0, removed);

    writeSpaces(updatedSpaces);
  }, []);

  // Replace all spaces (for import with "Replace" option). Awaits the write
  // so the caller (import) only reports success once SpaceManager's segment
  // self-heal has actually landed - see writeSpaces' doc comment.
  const replaceSpaces = useCallback(async (newSpaces: Space[]): Promise<void> =>
  {
    const spacesWithNewIds = newSpaces.map(space => ({
      ...space,
      id: generateId(),
    }));
    await writeSpaces(spacesWithNewIds);
  }, []);

  // Append spaces to existing (for import with "Add" option). Awaits for the
  // same reason as replaceSpaces above.
  const appendSpaces = useCallback(async (newSpaces: Space[]): Promise<void> =>
  {
    const spacesWithNewIds = newSpaces.map(space => ({
      ...space,
      id: generateId(),
    }));
    const combined = [...spaceManagerProxy.snapshot, ...spacesWithNewIds];
    await writeSpaces(combined);
  }, []);

  // ---------------------------------------------------------------------------
  // Space switch source tracking
  // ---------------------------------------------------------------------------
  const spaceSwitchSourceRef = useRef<SpaceSwitchSource>('navigation');

  const getSpaceSwitchSource = useCallback((): SpaceSwitchSource =>
  {
    const source = spaceSwitchSourceRef.current;
    spaceSwitchSourceRef.current = 'navigation';
    return source;
  }, []);

  // ---------------------------------------------------------------------------
  // Per-window state operations (mutate via spaceWindowStateProxy, mirror
  // updates via its ack and its "changed" broadcast listener)
  // ---------------------------------------------------------------------------

  // The two space-switch entry points below differ only in the source they
  // record, so the actual switch lives here once. The proxy owns the
  // optimistic mirror write, so nothing here touches its store.
  const applyActiveSpace = useCallback((spaceId: string, source: SpaceSwitchSource) =>
  {
    spaceSwitchSourceRef.current = source;

    // Notify background
    if (windowId)
    {
      if (import.meta.env.DEV)
      {
        console.log('[SpaceContext] spaceWindowStateProxy.setActiveSpace', {
          windowId,
          spaceId,
          source
        });
      }

      spaceWindowStateProxy.setActiveSpace(windowId, spaceId);
    }
  }, [windowId]);

  // Update active space (no tab activation)
  // Use for: history navigation, spaces disabled, create/delete space
  const setActiveSpaceId = useCallback((spaceId: string) =>
  {
    applyActiveSpace(spaceId, 'navigation');
  }, [applyActiveSpace]);

  // Switch to space as the user asked (Space bar click, swipe). Like Arc, the
  // background then brings the Space's most recently used tab forward, or opens
  // a new tab when the Space has none. Picking the Space already shown changes
  // nothing, so a Favorite open over it stays.
  const switchToSpace = useCallback((spaceId: string) =>
  {
    const alreadyActive = spaceId === windowState.activeSpaceId;
    applyActiveSpace(spaceId, 'user');
    if (!windowId || alreadyActive) return;

    chrome.runtime.sendMessage({ action: SpaceMessageAction.OPEN_SPACE, windowId, spaceId })
      .catch(() => { /* Background may be restarting */ });
  }, [applyActiveSpace, windowId, windowState.activeSpaceId]);

  // Get all tabs assigned to a Space by the internal registry.
  const getTabsForSpace = useCallback(async (spaceId: string): Promise<chrome.tabs.Tab[]> =>
  {
    if (!windowId) return [];

    const space = getSpaceById(spaceId);
    if (!space) return [];

    try
    {
      const [tabs, assignments] = await Promise.all([
        chrome.tabs.query({ windowId }),
        tabSpaceRegistryProxy.getWindowAssignments(windowId),
      ]);
      return tabs.filter(tab => tab.id !== undefined && assignments[tab.id] === space.id);
    }
    catch
    {
      return [];
    }
  }, [windowId, getSpaceById]);

  // Delete space and close all tabs in its associated Chrome group
  const deleteSpace = useCallback(async (id: string) =>
  {
    if (id === 'all') return;

    const space = getSpaceById(id);
    if (space && windowId)
    {
      try
      {
        const [tabs, assignments] = await Promise.all([
          chrome.tabs.query({ windowId }),
          tabSpaceRegistryProxy.getWindowAssignments(windowId),
        ]);
        const tabIds = tabs
          .filter(tab => tab.id !== undefined && assignments[tab.id] === space.id)
          .map(tab => tab.id as number);
        if (tabIds.length > 0)
        {
          await chrome.tabs.remove(tabIds);
        }
      }
      catch (error)
      {
        if (import.meta.env.DEV) console.error('[deleteSpace] Failed to close tabs:', error);
      }
    }

    // Delete space from storage
    deleteSpaceBase(id);
  }, [getSpaceById, windowId, deleteSpaceBase]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  // Collect all tab IDs that belong to a space (group tabs + live bookmark tabs)
  const getTabIdsInSpace = useCallback(async (space: Space): Promise<number[]> =>
  {
    if (!windowId) return [];

    const tabIdsToClose: number[] = [];

    // 1. Regular tabs from the extension's own Space associations
    try
    {
      const [tabs, assignments] = await Promise.all([
        chrome.tabs.query({ windowId }),
        tabSpaceRegistryProxy.getWindowAssignments(windowId),
      ]);
      tabs.forEach(tab =>
      {
        if (tab.id !== undefined && assignments[tab.id] === space.id) tabIdsToClose.push(tab.id);
      });
    }
    catch (error)
    {
      if (import.meta.env.DEV) console.error('[getTabIdsInSpace] Failed to get group tabs:', error);
    }

    // 2. Also find live bookmark tabs for bookmarks in the space's folder
    const spaceFolder = findFolderBySegments(space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount);
    if (spaceFolder)
    {
      const bookmarksInFolder = await getAllBookmarksInFolder(spaceFolder.id);
      const tabIdsSet = new Set(tabIdsToClose);
      bookmarksInFolder.forEach((bookmark: { id: string; title: string; url: string }) =>
      {
        const tabId = getTabIdForBookmark(bookmark.id);
        if (tabId !== undefined && !tabIdsSet.has(tabId))
        {
          tabIdsSet.add(tabId);
          tabIdsToClose.push(tabId);
        }
      });
    }

    return tabIdsToClose;
  }, [windowId, findFolderBySegments, getAllBookmarksInFolder, getTabIdForBookmark]);

  // Close all tabs in a space (non-undoable fallback)
  const closeAllTabsInSpace = useCallback(async (space: Space) =>
  {
    const tabIds = await getTabIdsInSpace(space);
    if (import.meta.env.DEV) console.log('[closeAllTabsInSpace] tabIds:', tabIds);
    if (tabIds.length > 0)
    {
      try
      {
        await chrome.tabs.remove(tabIds);
        if (import.meta.env.DEV) console.log('[closeAllTabsInSpace] Closed tabs successfully');
      }
      catch (error)
      {
        console.error('Failed to close tabs:', error);
      }
    }
  }, [getTabIdsInSpace]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  // The All Space is gone; the old field name stays, and it returns only real Spaces.
  const allSpaces = useMemo(() =>
  {
    return [...spaces];
  }, [spaces]);

  const resolvedActiveSpaceId = useMemo(
    () => resolveActiveSpaceId(spaces, windowState.activeSpaceId),
    [spaces, windowState.activeSpaceId]
  );

  // Currently active space
  const activeSpace = useMemo(() =>
  {
    return (resolvedActiveSpaceId && getSpaceById(resolvedActiveSpaceId)) || ALL_SPACE;
  }, [resolvedActiveSpaceId, getSpaceById]);

  // A legacy `all` or deleted ID moves to the first real Space.
  useEffect(() =>
  {
    if (resolvedActiveSpaceId && resolvedActiveSpaceId !== windowState.activeSpaceId)
    {
      setActiveSpaceId(resolvedActiveSpaceId);
    }
  }, [resolvedActiveSpaceId, windowState.activeSpaceId, setActiveSpaceId]);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo<SpacesContextValue>(() => ({
    spaces,
    allSpaces,
    activeSpace,
    isInitialized,
    windowId,
    createSpace,
    updateSpace,
    updateSpaceFolderPaths,
    deleteSpace,
    moveSpace,
    getSpaceById,
    replaceSpaces,
    appendSpaces,
    activeSpaceId: resolvedActiveSpaceId ?? windowState.activeSpaceId,
    setActiveSpaceId,
    switchToSpace,
    getTabsForSpace,
    getSpaceSwitchSource,
    getTabIdsInSpace,
    closeAllTabsInSpace,
  }), [
    spaces,
    allSpaces,
    activeSpace,
    isInitialized,
    windowId,
    createSpace,
    updateSpace,
    updateSpaceFolderPaths,
    deleteSpace,
    moveSpace,
    getSpaceById,
    replaceSpaces,
    appendSpaces,
    windowState.activeSpaceId,
    resolvedActiveSpaceId,
    setActiveSpaceId,
    switchToSpace,
    getTabsForSpace,
    getSpaceSwitchSource,
    getTabIdsInSpace,
    closeAllTabsInSpace,
  ]);

  return (
    <SpacesContext.Provider value={value}>
      {children}
    </SpacesContext.Provider>
  );
};

// =============================================================================
// Hook
// =============================================================================

export const useSpacesContext = (): SpacesContextValue =>
{
  const context = useContext(SpacesContext);
  if (!context)
  {
    throw new Error('useSpacesContext must be used within a SpacesProvider');
  }
  return context;
};
