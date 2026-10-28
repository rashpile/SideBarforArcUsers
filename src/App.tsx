import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, Suspense } from 'react';
import { BookmarkTree } from './components/BookmarkTree';
import { TabList, ExternalDropTarget, ResolveBookmarkDropTarget } from './components/TabList';
import { PinnedBar } from './components/PinnedBar';
import { Toolbar } from './components/Toolbar';
import { SpaceBar } from './components/SpaceBar';
import type { SettingsValues, BookmarkOpenMode, TabGroupDisplayOrder } from './components/SettingsDialog';
import { getWhatsNewSince, getRecentWhatsNew, ChangelogGroup } from './data/changelog';
import { AudioTabsDropdown } from './components/AudioTabsDropdown';
import { Toast } from './components/Toast';
import { UndoableAction } from './actions/types';
import { usePinnedSites, PinnedSite } from './hooks/usePinnedSites';
import { useTabs } from './hooks/useTabs';
import { useBookmarks, refreshAllBookmarks } from './hooks/useBookmarks';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useChromeLocalStorage } from './hooks/useChromeLocalStorage';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { FontSizeContext } from './contexts/FontSizeContext';
import { BookmarkTabsProvider, useBookmarkTabsContext } from './contexts/BookmarkTabsContext';
import { CloseTabAction } from './actions/closeTabAction';
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { BookmarkCreateFolderModal } from './components/BookmarkCreateFolderModal';
import { SpacesProvider, Space, useSpacesContext } from './contexts/SpacesContext';
import { SelectionProvider } from './contexts/SelectionContext';
import { UnifiedDndProvider } from './contexts/UnifiedDndContext';
import { UnifiedDragOverlay } from './components/UnifiedDragOverlay';
import { SpaceDialogs } from './components/SpaceDialogs';
import { useFontSize } from './contexts/FontSizeContext';
import { getSpaceBgColor } from './utils/groupColors';
import { Settings, Info, Upload, Download, RefreshCw, Undo2, Sparkles, Newspaper, Mail, Heart } from 'lucide-react';
import { SectionHeader } from './components/SectionHeader';
import { SpaceContextMenuContent } from './components/SpaceContextMenuContent';
import { useNewsCheck } from './hooks/useNewsCheck';
import { lastAudibleTrackerProxy } from './managers/proxies/lastAudibleTrackerProxy';
import { useFollowActiveTab } from './hooks/useFollowActiveTab';
import { FollowActiveTabMode, FOLLOW_ACTIVE_TAB_KEY, DEFAULT_FOLLOW_ACTIVE_TAB_MODE, parseFollowActiveTabMode } from './utils/followActiveTab';
import * as DropdownMenu from './components/menu/DropdownMenu';
import {
  AI_SETTINGS_STORAGE_KEY,
  AiRenameSettings,
  DEFAULT_AI_RENAME_SETTINGS,
  getHostPermissionPattern,
  parseAiRenameSettings,
} from './utils/aiConfig';
import { OpenAiCompatibleClient } from './services/aiRenameService';
import { resolveVersionDialogState } from './utils/versionDialogState';

// DEV-only, code-split so it never ends up in a production bundle - see
// src/tests/inpanel/TestRunnerPanel.tsx. Lazy (not the dynamic-import-on-click
// pattern the other "Unit Test ..." menu items use) because it needs to stay
// mounted at all times in DEV to detect a resumable paused run on every
// sidebar open, not just after the user opens it from the menu. Guarded by
// import.meta.env.DEV here too (not just at the render site below) so the
// dynamic import() call itself is unreachable in a production build,
// regardless of whether the bundler's tree-shaking would have stripped the
// chunk anyway.
const TestRunnerPanel = import.meta.env.DEV
  ? React.lazy(() => import('./tests/inpanel/TestRunnerPanel').then(m => ({ default: m.TestRunnerPanel })))
  : null;

// 首屏不需要的对话框按需加载，避免把设置、导入和 emoji 数据放进冷启动路径。
const SettingsDialog = React.lazy(() => import('./components/SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const AboutDialog = React.lazy(() => import('./components/AboutDialog').then(m => ({ default: m.AboutDialog })));
const ExportDialog = React.lazy(() => import('./components/ExportDialog').then(m => ({ default: m.ExportDialog })));
const ImportDialog = React.lazy(() => import('./components/ImportDialog').then(m => ({ default: m.ImportDialog })));
const ArcImportDialog = React.lazy(() => import('./components/ArcImportDialog').then(m => ({ default: m.ArcImportDialog })));
const WelcomeDialog = React.lazy(() => import('./components/WelcomeDialog').then(m => ({ default: m.WelcomeDialog })));
const WhatsNewDialog = React.lazy(() => import('./components/WhatsNewDialog').then(m => ({ default: m.WhatsNewDialog })));

// Inner component that renders content for a single space
interface SidebarContentProps
{
  onPin: (url: string, title: string, faviconUrl?: string, tabId?: number) => void;
  onPinMultiple: (pins: Array<{ url: string; title: string; faviconUrl?: string }>) => void;
  hideOtherBookmarks: boolean;
  externalDropTarget: ExternalDropTarget | null;
  bookmarkOpenMode: BookmarkOpenMode;
  arcSingleClickOpensTab: boolean;
  onResolverReady: (fn: ResolveBookmarkDropTarget) => void;
  filterLiveTabs: boolean;
  filterText: string;
  tabGroupDisplayOrder: TabGroupDisplayOrder;
  onTabGroupDisplayOrderChange: (order: TabGroupDisplayOrder) => void;
  onExternalDropTargetChange: (target: ExternalDropTarget | null) => void;
  resolveBookmarkDropTarget: () => ResolveBookmarkDropTarget | null;
  onShowToast?: (message: string) => void;
  onPerformAction?: (action: UndoableAction) => Promise<void>;
  onSpaceDropTargetChange?: (spaceId: string | null) => void;
  onAiRenameBookmark?: (bookmark: chrome.bookmarks.BookmarkTreeNode, tabId?: number) => void;
  onBookmarkCreated?: (bookmark: chrome.bookmarks.BookmarkTreeNode, tabId?: number) => void;
}

// Storage key for scroll position per space per window
const getScrollTopKey = (windowId: number, spaceId: string) =>
  `scrollTop_${windowId}_${spaceId}`;

const SidebarContent: React.FC<SidebarContentProps> = ({
  onPin,
  onPinMultiple,
  hideOtherBookmarks,
  externalDropTarget,
  bookmarkOpenMode,
  arcSingleClickOpensTab,
  onResolverReady,
  filterLiveTabs,
  filterText,
  tabGroupDisplayOrder,
  onTabGroupDisplayOrderChange,
  onExternalDropTargetChange,
  resolveBookmarkDropTarget,
  onShowToast,
  onPerformAction,
  onSpaceDropTargetChange,
  onAiRenameBookmark,
  onBookmarkCreated,
}) =>
{
  const { spaces, activeSpace, activeSpaceId, windowId, getSpaceSwitchSource } = useSpacesContext();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const prevSpaceIdRef = useRef(activeSpaceId);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced onScroll handler — saves scroll position to session storage
  const handleScroll = useCallback(() =>
  {
    if (scrollContainerRef.current)
    {
      lastScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
    if (scrollSaveTimerRef.current)
    {
      clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = setTimeout(() =>
    {
      if (!windowId) return;
      const spaceId = prevSpaceIdRef.current;
      const key = getScrollTopKey(windowId, spaceId);
      chrome.storage.session.set({ [key]: lastScrollTopRef.current });
    }, 300);
  }, [windowId]);

  // Save/restore scroll position on space change
  useEffect(() =>
  {
    if (!windowId) return;
    if (activeSpaceId === prevSpaceIdRef.current) return;

    const prevSpaceId = prevSpaceIdRef.current;
    const switchSource = getSpaceSwitchSource();

    // Save current scroll position for the previous space
    const saveKey = getScrollTopKey(windowId, prevSpaceId);
    chrome.storage.session.set({ [saveKey]: lastScrollTopRef.current });

    prevSpaceIdRef.current = activeSpaceId;

    // For user-initiated switches, try to restore saved scroll position
    if (switchSource === 'user')
    {
      const restoreKey = getScrollTopKey(windowId, activeSpaceId);
      chrome.storage.session.get([restoreKey], (result) =>
      {
        const savedScrollTop = result[restoreKey];
        if (savedScrollTop !== undefined && scrollContainerRef.current)
        {
          setTimeout(() =>
          {
            if (scrollContainerRef.current)
            {
              scrollContainerRef.current.scrollTop = savedScrollTop;
            }
          }, 50);
        }
      });
    }
  }, [activeSpaceId, windowId, getSpaceSwitchSource]);

  // Cleanup scroll save timer on unmount
  useEffect(() =>
  {
    return () =>
    {
      if (scrollSaveTimerRef.current)
      {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

  if (spaces.length === 0)
  {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center text-gray-500 dark:text-gray-400">
        Create your first Space with the + button below.
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      data-testid="sidebar-scroll-container"
      className="h-full overflow-y-auto overflow-x-hidden p-2"
      onScroll={handleScroll}
    >
      <BookmarkTree
        onPin={onPin}
        onPinMultiple={onPinMultiple}
        hideOtherBookmarks={hideOtherBookmarks}
        externalDropTarget={externalDropTarget}
        bookmarkOpenMode={bookmarkOpenMode}
        arcSingleClickOpensTab={arcSingleClickOpensTab}
        onResolverReady={onResolverReady}
        filterLiveTabs={filterLiveTabs}
        filterText={filterText}
        activeSpace={activeSpace}
        onShowToast={onShowToast}
        onPerformAction={onPerformAction}
        onAiRename={onAiRenameBookmark}
        onBookmarkCreated={onBookmarkCreated}
      />
      <TabList
        onPin={onPin}
        onPinMultiple={onPinMultiple}
        tabGroupDisplayOrder={tabGroupDisplayOrder}
        onTabGroupDisplayOrderChange={onTabGroupDisplayOrderChange}
        onExternalDropTargetChange={onExternalDropTargetChange}
        resolveBookmarkDropTarget={resolveBookmarkDropTarget}
        arcStyleEnabled={bookmarkOpenMode === 'arc'}
        filterText={filterText}
        activeSpace={activeSpace}
        onSpaceDropTargetChange={onSpaceDropTargetChange}
        onPerformAction={onPerformAction}
        onBookmarkCreated={onBookmarkCreated}
      />
    </div>
  );
};

// Fixed space title bar - shows current space icon and name
interface SpaceTitleProps
{
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (space: Space) => void;
  onCloseAllTabs: (space: Space) => void;
  onCreateFolder?: () => void;
}

const SpaceTitle: React.FC<SpaceTitleProps> = ({ onEditSpace, onDeleteSpace, onCloseAllTabs, onCreateFolder }) =>
{
  const { spaces, activeSpace } = useSpacesContext();
  const fontSize = useFontSize();
  const titleFontSize = fontSize;

  if (spaces.length === 0)
  {
    return (
      <SectionHeader
        label="Create a Space"
        menuContent={null}
        fontSize={titleFontSize}
        showMenuButton={false}
        labelClassName="font-medium"
        className="arc-space-title"
      />
    );
  }

  const menuContent = (
    <SpaceContextMenuContent
      onEdit={() => onEditSpace(activeSpace)}
      onDelete={() => onDeleteSpace(activeSpace)}
      onCloseAllTabs={() => onCloseAllTabs(activeSpace)}
      onCreateFolder={onCreateFolder}
      canDelete={spaces.length > 1}
    />
  );

  return (
    <SectionHeader
      label={activeSpace.name}
      menuContent={menuContent}
      menuTitle="Space options"
      fontSize={titleFontSize}
      showMenuButton={true}
      labelClassName="font-medium"
      className="arc-space-title"
    />
  );
};

// Wrapper that provides close tabs handler using hooks (must be inside providers)
interface SpaceTitleWrapperProps
{
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (space: Space) => void;
  onPerformAction?: (action: UndoableAction) => Promise<void>;
}

const SpaceTitleWrapper: React.FC<SpaceTitleWrapperProps> = ({ onEditSpace, onDeleteSpace, onPerformAction }) =>
{
  const { activeSpace, getTabIdsInSpace, windowId } = useSpacesContext();
  const { getItemKeyForTab, restoreItemAssociation } = useBookmarkTabsContext();
  const { findFolderBySegments, createFolder } = useBookmarks();
  const [confirmCloseAllDialog, setConfirmCloseAllDialog] = useState<{
    isOpen: boolean;
    tabIds: number[];
  }>({ isOpen: false, tabIds: [] });
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<string | null>(null);

  // Root folder of the active space - target for "New Folder" in the space menu
  const spaceRoot = findFolderBySegments(activeSpace.bookmarkFolderSegments ?? [], activeSpace.bookmarkFolderInAccount);

  const handleCreateFolder = useCallback(() =>
  {
    if (spaceRoot)
    {
      setCreatingFolderParentId(spaceRoot.id);
    }
  }, [spaceRoot]);

  const handleSaveFolder = useCallback((parentId: string, title: string) =>
  {
    createFolder(parentId, title);
  }, [createFolder]);

  const handleCloseAllTabs = useCallback(async (space: Space) =>
  {
    if (!windowId) return;

    const tabIds = await getTabIdsInSpace(space);
    if (tabIds.length === 0) return;

    // Check if this would close all tabs in the window
    const allTabs = await chrome.tabs.query({ windowId });
    const remaining = allTabs.filter(t => t.id !== undefined && !tabIds.includes(t.id!));
    if (remaining.length === 0)
    {
      // Show confirmation — closing will destroy the window (no undo possible)
      setConfirmCloseAllDialog({ isOpen: true, tabIds });
      return;
    }

    const action = new CloseTabAction(tabIds, windowId, getItemKeyForTab, restoreItemAssociation);
    if (onPerformAction)
    {
      onPerformAction(action);
    }
    else
    {
      action.do();
    }
  }, [onPerformAction, windowId, getTabIdsInSpace, getItemKeyForTab, restoreItemAssociation]);

  // Confirm close all tabs in window (no undo — window will close)
  const handleConfirmCloseAll = useCallback(() =>
  {
    if (confirmCloseAllDialog.tabIds.length > 0)
    {
      chrome.tabs.remove(confirmCloseAllDialog.tabIds);
    }
    setConfirmCloseAllDialog({ isOpen: false, tabIds: [] });
  }, [confirmCloseAllDialog.tabIds]);

  return (
    <>
      <SpaceTitle
        onEditSpace={onEditSpace}
        onDeleteSpace={onDeleteSpace}
        onCloseAllTabs={handleCloseAllTabs}
        onCreateFolder={spaceRoot ? handleCreateFolder : undefined}
      />
      <BookmarkCreateFolderModal
        isOpen={creatingFolderParentId !== null}
        parentId={creatingFolderParentId}
        onSave={handleSaveFolder}
        onClose={() => setCreatingFolderParentId(null)}
      />
      <ConfirmDeleteDialog
        isOpen={confirmCloseAllDialog.isOpen}
        itemCount={confirmCloseAllDialog.tabIds.length}
        itemType="tabs"
        details="This will close the window."
        onConfirm={handleConfirmCloseAll}
        onClose={() => setConfirmCloseAllDialog({ isOpen: false, tabIds: [] })}
      />
    </>
  );
};

// Container with swipe navigation and slide animation
interface SwipeableContainerProps extends SidebarContentProps
{
}

const SwipeableContainer: React.FC<SwipeableContainerProps> = (props) =>
{
  const { allSpaces, activeSpaceId, switchToSpace } = useSpacesContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const prevSpaceIdRef = useRef(activeSpaceId);

  const currentIndex = allSpaces.findIndex(s => s.id === activeSpaceId);
  const canSwipeLeft = currentIndex < allSpaces.length - 1;
  const canSwipeRight = currentIndex > 0;

  // Detect space change and set slide direction
  useEffect(() =>
  {
    if (activeSpaceId !== prevSpaceIdRef.current)
    {
      const prevIndex = allSpaces.findIndex(s => s.id === prevSpaceIdRef.current);
      const newIndex = allSpaces.findIndex(s => s.id === activeSpaceId);
      setSlideDirection(newIndex > prevIndex ? 'left' : 'right');
      prevSpaceIdRef.current = activeSpaceId;
    }
  }, [activeSpaceId, allSpaces]);

  // Clear animation after it completes
  useEffect(() =>
  {
    if (slideDirection)
    {
      const timer = setTimeout(() => setSlideDirection(null), 200);
      return () => clearTimeout(timer);
    }
  }, [slideDirection]);

  const handleSwipe = useCallback((direction: 'left' | 'right') =>
  {
    if (direction === 'left' && canSwipeLeft)
    {
      switchToSpace(allSpaces[currentIndex + 1].id);
    }
    else if (direction === 'right' && canSwipeRight)
    {
      switchToSpace(allSpaces[currentIndex - 1].id);
    }
  }, [allSpaces, currentIndex, canSwipeLeft, canSwipeRight, switchToSpace]);

  useSwipeNavigation(containerRef, { onSwipe: handleSwipe });

  const animationClass = slideDirection === 'left'
    ? 'animate-slide-left'
    : slideDirection === 'right'
      ? 'animate-slide-right'
      : '';

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      <div className={`h-full ${animationClass}`}>
        <SidebarContent {...props} />
      </div>
    </div>
  );
};

// Wrapper for ExportDialog that uses spaces from context
interface ExportDialogWrapperProps
{
  isOpen: boolean;
  onClose: () => void;
  pinnedSites: readonly PinnedSite[];
}

const ExportDialogWrapper: React.FC<ExportDialogWrapperProps> = (props) =>
{
  const { spaces } = useSpacesContext();
  const { bookmarks } = useBookmarks();
  return <ExportDialog {...props} bookmarks={bookmarks} spaces={spaces} />;
};

// Wrapper for ImportDialog that uses spaces from context
interface ImportDialogWrapperProps
{
  isOpen: boolean;
  onClose: () => void;
  replacePinnedSites: (sites: PinnedSite[]) => void;
  appendPinnedSites: (sites: PinnedSite[]) => void;
}

const ImportDialogWrapper: React.FC<ImportDialogWrapperProps> = (props) =>
{
  const { spaces, replaceSpaces, appendSpaces } = useSpacesContext();
  return (
    <ImportDialog
      {...props}
      replaceSpaces={replaceSpaces}
      appendSpaces={appendSpaces}
      existingSpaces={spaces}
    />
  );
};

// Wrapper for ArcImportDialog that uses spaces from context
const ArcImportDialogWrapper: React.FC<ImportDialogWrapperProps> = (props) =>
{
  const { spaces, replaceSpaces, appendSpaces } = useSpacesContext();
  return (
    <ArcImportDialog
      {...props}
      replaceSpaces={replaceSpaces}
      appendSpaces={appendSpaces}
      existingSpaces={spaces}
    />
  );
};

// Wrapper div that applies the active space's colour as the sidebar background.
// Must live inside SpacesProvider so it can read activeSpace from context.
interface AppContainerProps
{
  useSpaceColor: boolean;
  spaceColorAlpha: number;  // 1-100 percent
  fontSize: number;
  followActiveTab: FollowActiveTabMode;
  children: React.ReactNode;
}

const AppContainer: React.FC<AppContainerProps> = ({ useSpaceColor, spaceColorAlpha, fontSize, followActiveTab, children }) =>
{
  const { activeSpace } = useSpacesContext();
  useFollowActiveTab(followActiveTab);
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useLayoutEffect(() =>
  {
    if (performance.getEntriesByName('sidebar:first-commit').length > 0) return;

    performance.mark('sidebar:first-commit');
    performance.measure('sidebar:react-first-commit', 'sidebar:main-evaluated', 'sidebar:first-commit');

    const frameId = requestAnimationFrame(() =>
    {
      performance.mark('sidebar:first-frame', {
        detail: {
          bookmarkRows: document.querySelectorAll('[data-bookmark-id]').length,
          tabRows: document.querySelectorAll('[data-tab-id]').length,
        },
      });
      performance.measure('sidebar:time-to-first-frame', 'sidebar:html-start', 'sidebar:first-frame');
    });

    return () => cancelAnimationFrame(frameId);
  }, []);

  // Keep isDark in sync when the OS theme changes
  useEffect(() =>
  {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const applySpaceColor = useSpaceColor && activeSpace.id !== 'all';
  const spaceBgColor = applySpaceColor
    ? getSpaceBgColor(activeSpace.color, isDark, spaceColorAlpha / 100)
    : null;
  // --arc-sidebar-bg lets row hover actions repaint the sidebar colour (see index.css)
  const bgStyle = spaceBgColor
    ? { backgroundColor: spaceBgColor, '--arc-sidebar-bg': spaceBgColor } as React.CSSProperties
    : {};
  const bgClass = applySpaceColor ? '' : 'arc-neutral-background';

  return (
    <div
      className={`arc-theme relative flex flex-col h-screen ${bgClass} text-gray-900 dark:text-gray-100 overflow-hidden`}
      style={{ fontSize: `${fontSize}px`, ...bgStyle }}
    >
      {children}
    </div>
  );
};

function App() {
  const [fontSize, setFontSize] = useLocalStorage('sidebar-font-size-px', 14, {
    parse: (v) => parseInt(v, 10),
    serialize: (v) => v.toString()
  });
  const [hideOtherBookmarks, setHideOtherBookmarks] = useLocalStorage(
    'sidebar-hide-other-bookmarks',
    false,
    { parse: (v) => v === 'true', serialize: (v) => v.toString() }
  );
  const [tabGroupDisplayOrder, setTabGroupDisplayOrder] = useLocalStorage<TabGroupDisplayOrder>(
    'sidebar-tab-group-display-order',
    'groupsFirst',
    {
      parse: (v) => v as TabGroupDisplayOrder,
      serialize: (v) => v
    }
  );

  // One-time migration from old 'sidebar-sort-groups-first' to new key
  useEffect(() =>
  {
    const oldKey = 'sidebar-sort-groups-first';
    const newKey = 'sidebar-tab-group-display-order';
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue !== null && localStorage.getItem(newKey) === null)
    {
      const migrated = oldValue === 'true' ? 'groupsFirst' : 'chromeOrder';
      localStorage.setItem(newKey, migrated);
      localStorage.removeItem(oldKey);
      setTabGroupDisplayOrder(migrated);
    }
  }, [setTabGroupDisplayOrder]);
  const [pinnedIconSize, setPinnedIconSize] = useLocalStorage(
    'sidebar-pinned-icon-size-px',
    22,
    { parse: (v) => parseInt(v, 10), serialize: (v) => v.toString() }
  );
  const [bookmarkOpenMode, setBookmarkOpenMode] = useChromeLocalStorage<BookmarkOpenMode>(
    'sidebar-bookmark-open-mode',
    'arc',
    {
      parse: (v) => {
        // Migration from old boolean setting
        if (v === 'true') return 'arc';
        if (v === 'false') return 'newTab';
        return v as BookmarkOpenMode;
      },
      serialize: (v) => v
    }
  );
  const [arcSingleClickOpensTab, setArcSingleClickOpensTab] = useChromeLocalStorage(
    'sidebar-arc-single-click-opens-tab',
    true,
    { parse: (v) => v === 'true', serialize: (v) => v.toString() }
  );
  const [audioQuickJump, setAudioQuickJump] = useChromeLocalStorage(
    'sidebar-audio-quick-jump',
    false,
    { parse: (v) => v === 'true', serialize: (v) => v.toString() }
  );
  const [useSpaceColor, setUseSpaceColor] = useChromeLocalStorage(
    'sidebar-use-space-color',
    false,
    { parse: (v) => v === 'true', serialize: (v) => v.toString() }
  );
  const [spaceColorAlpha, setSpaceColorAlpha] = useChromeLocalStorage(
    'sidebar-space-color-alpha',
    100,
    { parse: (v) => parseInt(v, 10), serialize: (v) => v.toString() }
  );
  const [followActiveTab, setFollowActiveTab] = useChromeLocalStorage<FollowActiveTabMode>(
    FOLLOW_ACTIVE_TAB_KEY,
    DEFAULT_FOLLOW_ACTIVE_TAB_MODE,
    { parse: parseFollowActiveTabMode, serialize: (v) => v }
  );
  const [aiSettings, setAiSettings] = useChromeLocalStorage<AiRenameSettings>(
    AI_SETTINGS_STORAGE_KEY,
    DEFAULT_AI_RENAME_SETTINGS,
    { parse: parseAiRenameSettings, serialize: JSON.stringify }
  );
  const [showFilterArea, setShowFilterArea] = useLocalStorage(
    'sidebar-show-filter-area',
    false,
    { parse: (v) => v === 'true', serialize: (v) => v.toString() }
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showTestRunner, setShowTestRunner] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showArcImport, setShowArcImport] = useState(false);
  const currentVersion = chrome.runtime.getManifest().version;

  // Migrate old 'sidebar-has-seen-welcome' boolean to 'sidebar-last-seen-version'.
  // Writes to localStorage so useChromeLocalStorage can auto-migrate it to chrome.storage.local.
  const migrationDoneRef = useRef(false);
  useEffect(() =>
  {
    if (migrationDoneRef.current) return;
    migrationDoneRef.current = true;

    if (localStorage.getItem('sidebar-last-seen-version') !== null) return;
    const oldFlag = localStorage.getItem('sidebar-has-seen-welcome');
    if (oldFlag !== null)
    {
      // Existing user who saw welcome: set to "0" so What's New dialog shows
      // Existing user who hasn't seen welcome: leave empty (new install flow)
      const migratedValue = oldFlag === 'true' ? '0' : '';
      localStorage.setItem('sidebar-last-seen-version', migratedValue);
      localStorage.removeItem('sidebar-has-seen-welcome');
    }
  }, []);

  const [lastSeenVersion, setLastSeenVersion, lastSeenVersionLoaded] = useChromeLocalStorage(
    'sidebar-last-seen-version',
    '',
    { parse: (v) => v, serialize: (v) => v }
  );

  const { isNewInstall, hasVersionChanged } = resolveVersionDialogState({
    isLoaded: lastSeenVersionLoaded,
    lastSeenVersion,
    currentVersion,
  });

  const [showWelcome, setShowWelcome] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [whatsNewDialogGroups, setWhatsNewDialogGroups] = useState<ChangelogGroup[]>([]);
  const [whatsNewDialogVersion, setWhatsNewDialogVersion] = useState<string | undefined>(undefined);

  // Trigger What's New dialog once lastSeenVersion loads from async storage.
  // hasVersionChanged is false for new installs (welcome handles those) and when already up to date.
  useEffect(() =>
  {
    if (!hasVersionChanged) return;
    const groups = getWhatsNewSince(lastSeenVersion);
    if (groups.length > 0)
    {
      setWhatsNewDialogGroups(groups);
      setWhatsNewDialogVersion(currentVersion);
      setShowWhatsNew(true);
    }
  }, [hasVersionChanged]);
  const [showMenu, setShowMenu] = useState(false);
  const [filterLiveTabs, setFilterLiveTabs] = useState(false);
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [playingTabs, setPlayingTabs] = useState<chrome.tabs.Tab[]>([]);
  const [lastAudibleTabs, setLastAudibleTabs] = useState<chrome.tabs.Tab[]>([]);
  const [filterText, setFilterText] = useState('');
  const [savedFilters, setSavedFilters] = useChromeLocalStorage<string[]>(
    'sidebar-saved-filters',
    [],
    { parse: (v) => JSON.parse(v), serialize: (v) => JSON.stringify(v) }
  );
  const [recentFilters, setRecentFilters] = useChromeLocalStorage<string[]>(
    'sidebar-recent-filters',
    [],
    { parse: (v) => JSON.parse(v), serialize: (v) => JSON.stringify(v) }
  );
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [externalDropTarget, setExternalDropTarget] = useState<ExternalDropTarget | null>(null);
  const [spaceDropTargetId, setSpaceDropTargetId] = useState<string | null>(null);
  const [spaceToEdit, setSpaceToEdit] = useState<Space | null>(null);
  const [showSpaceEditDialog, setShowSpaceEditDialog] = useState(false);
  const [spaceToDelete, setSpaceToDelete] = useState<Space | null>(null);
  const [showSpaceDeleteDialog, setShowSpaceDeleteDialog] = useState(false);
  const bookmarkDropResolverRef = useRef<ResolveBookmarkDropTarget | null>(null);
  const newsHoverTimerRef = useRef<number | null>(null);
  const aiRequestIdsRef = useRef(new Map<string, number>());
  // Clean up hover timer on unmount
  useEffect(() =>
  {
    return () =>
    {
      if (newsHoverTimerRef.current)
      {
        clearTimeout(newsHoverTimerRef.current);
      }
    };
  }, []);
  const buttonRef = useRef<HTMLButtonElement>(null!);
  const audioButtonRef = useRef<HTMLButtonElement>(null!);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const {
    pinnedSites,
    addPin,
    addPins,
    removePin,
    updatePin,
    renamePinIfUnchanged,
    resetFavicon,
    movePin,
    duplicatePin,
    replacePinnedSites,
    appendPinnedSites,
  } = usePinnedSites();
  const { tabs, refreshTabs } = useTabs();
  const { hasUnreadNews, markNewsRead, openNews } = useNewsCheck();

  const handleApplySettings = (newSettings: SettingsValues) => {
    setFontSize(newSettings.fontSize);
    setHideOtherBookmarks(newSettings.hideOtherBookmarks);
    setTabGroupDisplayOrder(newSettings.tabGroupDisplayOrder);
    setPinnedIconSize(newSettings.pinnedIconSize);
    setBookmarkOpenMode(newSettings.bookmarkOpenMode);
    setArcSingleClickOpensTab(newSettings.arcSingleClickOpensTab);
    setAudioQuickJump(newSettings.audioQuickJump);
    setUseSpaceColor(newSettings.useSpaceColor);
    setSpaceColorAlpha(newSettings.spaceColorAlpha);
    setFollowActiveTab(newSettings.followActiveTab);
    setAiSettings(newSettings.aiSettings);
    setShowSettings(false);
  };

  // Filter handlers
  const handleFilterTextChange = (text: string) => {
    setFilterText(text);
  };

  const handleSaveFilter = (text: string) => {
    if (text.trim() && !savedFilters.includes(text.trim())) {
      setSavedFilters([text.trim(), ...savedFilters]);
    }
  };

  const handleDeleteSavedFilter = (text: string) => {
    setSavedFilters(savedFilters.filter((f) => f !== text));
  };

  const handleApplyFilter = (text: string) => {
    setFilterText(text);
    // Add to recent filters (avoid duplicates, max 5)
    const trimmed = text.trim();
    if (trimmed) {
      const newRecent = [trimmed, ...recentFilters.filter((f) => f !== trimmed)].slice(0, 5);
      setRecentFilters(newRecent);
    }
  };

  // Update recent filter (called on blur/Enter from toolbar)
  // If existingEntry is provided, replace it; otherwise add new
  const handleUpdateRecent = useCallback((text: string, existingEntry?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Remove existing entry if provided (we're updating it)
    // Also remove duplicates of the new text
    const filtered = recentFilters.filter((f) => f !== trimmed && f !== existingEntry);
    // Add new text at the top, max 5
    setRecentFilters([trimmed, ...filtered].slice(0, 5));
  }, [recentFilters]);

  // Undoable action state
  const [lastAction, setLastAction] = useState<UndoableAction | null>(null);

  // Toast helpers
  const showToast = useCallback((message: string) => {
    setLastAction(null);
    setToastMessage(message);
    setToastVisible(true);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  /**
   * 为同一目标生成递增请求号，较早返回的慢请求不能覆盖较新的重命名。
   */
  const beginAiRequest = useCallback((targetKey: string): number =>
  {
    const next = (aiRequestIdsRef.current.get(targetKey) ?? 0) + 1;
    aiRequestIdsRef.current.set(targetKey, next);
    return next;
  }, []);

  const hasPageContentAccess = useCallback(async (): Promise<boolean> =>
  {
    try
    {
      return await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
    }
    catch
    {
      return false;
    }
  }, []);

  /**
   * 手动操作可直接申请 API origin；自动操作只能使用设置阶段已经授予的权限。
   */
  const hasApiAccess = useCallback(async (manualRequest: boolean): Promise<boolean> =>
  {
    const origin = getHostPermissionPattern(aiSettings.baseUrl);
    return manualRequest
      ? await chrome.permissions.request({ origins: [origin] })
      : await chrome.permissions.contains({ origins: [origin] });
  }, [aiSettings.baseUrl]);

  /**
   * 对固定项目执行 AI 重命名，并通过后台条件写入保护用户后续编辑。
   */
  const handleAiRenamePin = useCallback(async (
    site: PinnedSite,
    tabId?: number,
    notify = true
  ) =>
  {
    if (!aiSettings.baseUrl.trim() || !aiSettings.apiKey.trim() || !aiSettings.model.trim())
    {
      if (notify)
      {
        showToast('Configure and validate AI settings first');
        setShowSettings(true);
      }
      return;
    }

    const targetKey = `pin:${site.id}`;
    const requestId = beginAiRequest(targetKey);
    try
    {
      if (!await hasApiAccess(notify))
      {
        throw new Error('Permission to access the API host was not granted');
      }
      const newTitle = await new OpenAiCompatibleClient().generateTitle(aiSettings, {
        url: site.url,
        title: site.title,
        tabId,
        allowPageContent: await hasPageContentAccess(),
      });
      if (aiRequestIdsRef.current.get(targetKey) !== requestId) return;

      await renamePinIfUnchanged(site.id, site.title, site.url, newTitle);
      if (notify) showToast(`Renamed to “${newTitle}”`);
    }
    catch (error)
    {
      if (aiRequestIdsRef.current.get(targetKey) !== requestId) return;
      const message = error instanceof Error ? error.message : 'AI rename failed';
      showToast(notify ? message : `Automatic AI rename failed: ${message}`);
    }
  }, [aiSettings, beginAiRequest, hasApiAccess, hasPageContentAccess, renamePinIfUnchanged, showToast]);

  /**
   * 书签 API 没有事务式条件更新，因此写入前重新读取并核对标题与 URL。
   */
  const handleAiRenameBookmark = useCallback(async (
    bookmark: chrome.bookmarks.BookmarkTreeNode,
    tabId?: number,
    notify = true
  ) =>
  {
    if (!bookmark.url) return;
    if (!aiSettings.baseUrl.trim() || !aiSettings.apiKey.trim() || !aiSettings.model.trim())
    {
      if (notify)
      {
        showToast('Configure and validate AI settings first');
        setShowSettings(true);
      }
      return;
    }

    const targetKey = `bookmark:${bookmark.id}`;
    const requestId = beginAiRequest(targetKey);
    try
    {
      if (!await hasApiAccess(notify))
      {
        throw new Error('Permission to access the API host was not granted');
      }
      const newTitle = await new OpenAiCompatibleClient().generateTitle(aiSettings, {
        url: bookmark.url,
        title: bookmark.title,
        tabId,
        allowPageContent: await hasPageContentAccess(),
      });
      if (aiRequestIdsRef.current.get(targetKey) !== requestId) return;

      const current = (await chrome.bookmarks.get(bookmark.id))[0];
      if (!current || current.title !== bookmark.title || current.url !== bookmark.url) return;
      await chrome.bookmarks.update(bookmark.id, { title: newTitle });
      if (notify) showToast(`Renamed to “${newTitle}”`);
    }
    catch (error)
    {
      if (aiRequestIdsRef.current.get(targetKey) !== requestId) return;
      const message = error instanceof Error ? error.message : 'AI rename failed';
      showToast(notify ? message : `Automatic AI rename failed: ${message}`);
    }
  }, [aiSettings, beginAiRequest, hasApiAccess, hasPageContentAccess, showToast]);

  /**
   * 先完成固定操作，再异步命名；AI 失败不会撤销用户刚创建的固定项目。
   */
  const handleAddPin = useCallback(async (
    url: string,
    title: string,
    faviconUrl?: string,
    atIndex?: number
  ) =>
  {
    const newPin = await addPin(url, title, faviconUrl, atIndex);
    if (newPin && aiSettings.autoRename)
    {
      void handleAiRenamePin(newPin, undefined, false);
    }
  }, [addPin, aiSettings.autoRename, handleAiRenamePin]);

  const handlePinFromSidebar = useCallback(async (
    url: string,
    title: string,
    faviconUrl?: string,
    tabId?: number
  ) =>
  {
    const newPin = await addPin(url, title, faviconUrl);
    if (newPin && aiSettings.autoRename)
    {
      void handleAiRenamePin(newPin, tabId, false);
    }
  }, [addPin, aiSettings.autoRename, handleAiRenamePin]);

  const handleAddPins = useCallback(async (
    pins: Array<{ url: string; title: string; faviconUrl?: string }>
  ) =>
  {
    const newPins = await addPins(pins);
    if (aiSettings.autoRename)
    {
      // 多选固定会产生多个独立请求；每个请求失败都只保留自己的原标题。
      for (const pin of newPins)
      {
        void handleAiRenamePin(pin, undefined, false);
      }
    }
  }, [addPins, aiSettings.autoRename, handleAiRenamePin]);

  const handleBookmarkCreated = useCallback((
    bookmark: chrome.bookmarks.BookmarkTreeNode,
    tabId?: number
  ) =>
  {
    if (aiSettings.autoRename)
    {
      void handleAiRenameBookmark(bookmark, tabId, false);
    }
  }, [aiSettings.autoRename, handleAiRenameBookmark]);

  // Execute an undoable action: run do(), show toast with undo button
  const performAction = useCallback(async (action: UndoableAction) => {
    try
    {
      await action.do();
      setLastAction(action);
      setToastMessage(action.description);
      setToastVisible(true);
    }
    catch (err)
    {
      setLastAction(null);
      const message = err instanceof Error ? err.message : 'Action failed';
      setToastMessage(message);
      setToastVisible(true);
    }
  }, []);

  // Undo the last action
  const handleUndo = useCallback(async () => {
    if (!lastAction) return;
    try
    {
      await lastAction.undo();
      setLastAction(null);
      setToastMessage('Restored');
      setToastVisible(true);
    }
    catch (err)
    {
      setLastAction(null);
      const message = err instanceof Error ? err.message : 'Undo failed';
      setToastMessage(message);
      setToastVisible(true);
    }
  }, [lastAction]);

  // Space handlers
  const handleCreateSpace = useCallback(() => {
    setSpaceToEdit(null);
    setShowSpaceEditDialog(true);
  }, []);

  const handleEditSpace = useCallback((space: Space) => {
    setSpaceToEdit(space);
    setShowSpaceEditDialog(true);
  }, []);

  const handleDeleteSpace = useCallback((space: Space) => {
    setSpaceToDelete(space);
    setShowSpaceDeleteDialog(true);
  }, []);

  // Audio quick-jump: activates the most recently playing tab (used when audioQuickJump setting is on)
  const handleJumpToAudioTab = useCallback(async () =>
  {
    try
    {
      // App() sits outside SpacesProvider, so there is no context windowId to
      // read - resolve this window inline instead.
      const { id: windowId } = await chrome.windows.getCurrent();
      if (windowId === undefined) return;

      const { playingTabIds, historyTabIds } = await lastAudibleTrackerProxy.getAudioTabLists(windowId);
      const targetTabId = playingTabIds[0] ?? historyTabIds[0];

      if (targetTabId !== undefined)
      {
        // Background switches space and sends an explicit TAB_ACTIVATED, which
        // scrolls the tab (or its bookmark row) into view - App() sits outside
        // the providers, so it cannot route the scroll itself
        await chrome.runtime.sendMessage({
          action: 'set-active-tab-and-space',
          tabId: targetTabId,
          skipHistory: false
        });
      }
    }
    catch { /* ignore */ }
  }, []);

  // Audio dialog handler - query for playing and history tabs before opening
  const handleOpenAudioDialog = useCallback(async () => {
    try
    {
      // Same as handleJumpToAudioTab: no context windowId out here, so this
      // window is resolved inline.
      const { id: windowId } = await chrome.windows.getCurrent();
      if (windowId === undefined) return;

      const { playingTabIds, historyTabIds } = await lastAudibleTrackerProxy.getAudioTabLists(windowId);

      // Convert ID arrays to Sets for O(1) lookup
      const playingIdSet = new Set(playingTabIds);
      const historyIdSet = new Set(historyTabIds);
      const playing: chrome.tabs.Tab[] = [];
      const history: chrome.tabs.Tab[] = [];

      for (const tab of tabs)
      {
        if (tab.id !== undefined)
        {
          if (playingIdSet.has(tab.id)) playing.push(tab);
          if (historyIdSet.has(tab.id)) history.push(tab);
        }
      }
      history.sort((a, b) => historyTabIds.indexOf(a.id!) - historyTabIds.indexOf(b.id!));

      setPlayingTabs(playing);
      setLastAudibleTabs(history);
    }
    catch
    {
      setPlayingTabs([]);
      setLastAudibleTabs([]);
    }
    setShowAudioDialog(true);
  }, [tabs]);

  // DropdownMenu handles click-outside and escape key automatically

  // Refresh data when sidepanel becomes visible
  useEffect(() =>
  {
    const handleVisibilityChange = () =>
    {
      if (document.visibilityState === 'visible')
      {
        if (import.meta.env.DEV)
        {
          console.log('Sidepanel visible - refreshing data');
        }
        refreshTabs();
        refreshAllBookmarks();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshTabs]);

  return (
    <FontSizeContext.Provider value={fontSize}>
      <BookmarkTabsProvider>
      <SpacesProvider>
      <SelectionProvider>
      <UnifiedDndProvider>
      <AppContainer useSpaceColor={useSpaceColor} spaceColorAlpha={spaceColorAlpha} fontSize={fontSize} followActiveTab={followActiveTab}>
      <Suspense fallback={null}>
        {showSettings && (
          <SettingsDialog
            isOpen
            onClose={() => setShowSettings(false)}
            settings={{
              fontSize,
              hideOtherBookmarks,
              tabGroupDisplayOrder,
              pinnedIconSize,
              bookmarkOpenMode,
              arcSingleClickOpensTab,
              audioQuickJump,
              useSpaceColor,
              spaceColorAlpha,
              followActiveTab,
              aiSettings,
            }}
            onApply={handleApplySettings}
          />
        )}

        {showAbout && (
          <AboutDialog
            isOpen
            onClose={() => setShowAbout(false)}
            onShowWelcome={() => setShowWelcome(true)}
          />
        )}

        {showExport && (
          <ExportDialogWrapper
            isOpen
            onClose={() => setShowExport(false)}
            pinnedSites={pinnedSites}
          />
        )}

        {showImport && (
          <ImportDialogWrapper
            isOpen
            onClose={() => setShowImport(false)}
            replacePinnedSites={replacePinnedSites}
            appendPinnedSites={appendPinnedSites}
          />
        )}

        {showArcImport && (
          <ArcImportDialogWrapper
            isOpen
            onClose={() => setShowArcImport(false)}
            replacePinnedSites={replacePinnedSites}
            appendPinnedSites={appendPinnedSites}
          />
        )}

        {(isNewInstall || showWelcome) && (
          <WelcomeDialog
            isOpen
            onClose={() => {
              setLastSeenVersion(currentVersion);
              setShowWelcome(false);
            }}
          />
        )}

        {showWhatsNew && (
          <WhatsNewDialog
            isOpen
            groups={whatsNewDialogGroups}
            version={whatsNewDialogVersion}
            onClose={() => {
              setLastSeenVersion(currentVersion);
              setShowWhatsNew(false);
            }}
          />
        )}
      </Suspense>

      <DropdownMenu.Root
        open={showAudioDialog}
        onOpenChange={setShowAudioDialog}
        anchorRef={audioButtonRef}
      >
        <AudioTabsDropdown
          playingTabs={playingTabs}
          historyTabs={lastAudibleTabs}
        />
      </DropdownMenu.Root>

      {/* Toolbar */}
      <div ref={toolbarRef} className="relative">
        <Toolbar
          filterLiveTabsActive={filterLiveTabs}
          onFilterLiveTabsToggle={() =>
          {
            const newValue = !filterLiveTabs;
            setFilterLiveTabs(newValue);
          }}
          onAudioDialogOpen={handleOpenAudioDialog}
          onAudioTabJump={audioQuickJump ? handleJumpToAudioTab : undefined}
          onMenuToggle={() => setShowMenu(!showMenu)}
          menuButtonRef={buttonRef}
          audioButtonRef={audioButtonRef}
          filterText={filterText}
          onFilterTextChange={handleFilterTextChange}
          savedFilters={savedFilters}
          recentFilters={recentFilters}
          onSaveFilter={handleSaveFilter}
          onDeleteSavedFilter={handleDeleteSavedFilter}
          onApplyFilter={handleApplyFilter}
          onUpdateRecent={handleUpdateRecent}
          onShowToast={showToast}
          showFilterArea={showFilterArea}
          onToggleFilterArea={() => {
            const newShowFilterArea = !showFilterArea;
            setShowFilterArea(newShowFilterArea);
            if (!newShowFilterArea)
            {
              setFilterText('');
            }
          }}
          hasUnreadNews={hasUnreadNews}
        />

        {/* Settings popup menu */}
        <DropdownMenu.Root
          open={showMenu}
          onOpenChange={setShowMenu}
          anchorRef={buttonRef}
        >
          <DropdownMenu.Content align="end">
            {lastAction && (
              <>
                <DropdownMenu.Item onSelect={handleUndo}>
                  <Undo2 size={14} className="mr-2" />
                  Undo: {lastAction.description}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
              </>
            )}
            <DropdownMenu.Item onSelect={() => setShowSettings(true)}>
              <Settings size={14} className="mr-2" />
              Settings
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => setShowExport(true)}>
              <Upload size={14} className="mr-2" />
              Export...
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => {
              setShowImport(false);
              setTimeout(() => setShowImport(true), 0);
            }}>
              <Download size={14} className="mr-2" />
              Import...
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => {
              setShowArcImport(false);
              setTimeout(() => setShowArcImport(true), 0);
            }}>
              <Download size={14} className="mr-2" />
              Import from Arc Browser...
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => {
              setWhatsNewDialogGroups(getRecentWhatsNew(3));
              setWhatsNewDialogVersion(undefined);
              setShowWhatsNew(true);
            }}>
              <Sparkles size={14} className="mr-2" />
              What's New
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={openNews}
              onMouseEnter={() =>
              {
                newsHoverTimerRef.current = window.setTimeout(markNewsRead, 1000);
              }}
              onMouseLeave={() =>
              {
                if (newsHoverTimerRef.current)
                {
                  clearTimeout(newsHoverTimerRef.current);
                  newsHoverTimerRef.current = null;
                }
              }}
            >
              <Newspaper size={14} className="mr-2" />
              News
              {/* Red dot for unread news */}
              {hasUnreadNews && (
                <span className="ml-1.5 w-2 h-2 bg-red-500 rounded-full inline-block" />
              )}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => window.open('mailto:chrome-dev@monemone.org?subject=Sidebar Feedback')}>
              <Mail size={14} className="mr-2" />
              Email Us
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => window.open('https://github.com/sponsors/monehsieh', '_blank')}>
              <Heart size={14} className="mr-2" />
              Support Us
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setShowAbout(true)}>
              <Info size={14} className="mr-2" />
              About
            </DropdownMenu.Item>
            {import.meta.env.DEV && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={async () => {
                  const { runSearchParserTests } = await import('./tests/searchParserTest');
                  runSearchParserTests(showToast);
                }}>
                  <span className="w-[14px] mr-2" />
                  Unit Test Search Parser
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={async () => {
                  const { runDeleteBookmarkTests } = await import('./tests/deleteBookmarkActionTest');
                  await runDeleteBookmarkTests(showToast);
                }}>
                  <span className="w-[14px] mr-2" />
                  Unit Test Do/Undo Delete Bookmarks
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={async () => {
                  const { runCloseTabTests } = await import('./tests/closeTabActionTest');
                  await runCloseTabTests(showToast);
                }}>
                  <span className="w-[14px] mr-2" />
                  Unit Test Do/Undo Close Tabs
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={async () => {
                  const { runDeletePinnedSiteTests } = await import('./tests/deletePinnedSiteActionTest');
                  await runDeletePinnedSiteTests(showToast);
                }}>
                  <span className="w-[14px] mr-2" />
                  Unit Test Do/Undo Delete Pinned Sites
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={async () => {
                  const { runDeleteSpaceTests } = await import('./tests/deleteSpaceActionTest');
                  await runDeleteSpaceTests(showToast);
                }}>
                  <span className="w-[14px] mr-2" />
                  Unit Test Do/Undo Delete Space
                </DropdownMenu.Item>
                {/*} add new unit tests here */}
                <DropdownMenu.Item onSelect={() => setShowTestRunner(true)}>
                  <span className="w-[14px] mr-2" />
                  Test Runner…
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => chrome.runtime.reload()}>
                  <RefreshCw size={14} className="mr-2" />
                  Reload Extension
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {/* Pinned Sites */}
      <PinnedBar
        pinnedSites={pinnedSites}
        removePin={removePin}
        updatePin={updatePin}
        resetFavicon={resetFavicon}
        movePin={movePin}
        duplicatePin={duplicatePin}
        addPin={handleAddPin}
        iconSize={pinnedIconSize}
        bookmarkOpenMode={bookmarkOpenMode}
        filterLiveTabs={showFilterArea && filterLiveTabs}
        filterText={filterText}
        onPerformAction={performAction}
        onAiRename={handleAiRenamePin}
      />

      {/* Space Title */}
      <SpaceTitleWrapper
        onEditSpace={handleEditSpace}
        onDeleteSpace={handleDeleteSpace}
        onPerformAction={performAction}
      />

      {/* Content with 2-finger swipe navigation */}
      <SwipeableContainer
        onPin={handlePinFromSidebar}
        onPinMultiple={handleAddPins}
        hideOtherBookmarks={hideOtherBookmarks}
        externalDropTarget={externalDropTarget}
        bookmarkOpenMode={bookmarkOpenMode}
        arcSingleClickOpensTab={arcSingleClickOpensTab}
        onResolverReady={(fn) => { bookmarkDropResolverRef.current = fn; }}
        filterLiveTabs={showFilterArea && filterLiveTabs}
        filterText={filterText}
        tabGroupDisplayOrder={tabGroupDisplayOrder}
        onTabGroupDisplayOrderChange={setTabGroupDisplayOrder}
        onExternalDropTargetChange={setExternalDropTarget}
        resolveBookmarkDropTarget={() => bookmarkDropResolverRef.current}
        onShowToast={showToast}
        onPerformAction={performAction}
        onSpaceDropTargetChange={setSpaceDropTargetId}
        onAiRenameBookmark={handleAiRenameBookmark}
        onBookmarkCreated={handleBookmarkCreated}
      />

      {/* Space Dialogs */}
      <SpaceDialogs
        showEditDialog={showSpaceEditDialog}
        spaceToEdit={spaceToEdit}
        onCloseEditDialog={() => setShowSpaceEditDialog(false)}
        showDeleteDialog={showSpaceDeleteDialog}
        spaceToDelete={spaceToDelete}
        onCloseDeleteDialog={() => setShowSpaceDeleteDialog(false)}
        onPerformAction={performAction}
      />

      <SpaceBar
        onCreateSpace={handleCreateSpace}
        onEditSpace={handleEditSpace}
        onDeleteSpace={handleDeleteSpace}
        dropTargetSpaceId={spaceDropTargetId}
        onPerformAction={performAction}
      />

      <Toast
        message={toastMessage}
        isVisible={toastVisible}
        onDismiss={hideToast}
        onUndo={lastAction ? handleUndo : undefined}
      />

      {/* Unified Drag Overlay for cross-component DnD */}
      <UnifiedDragOverlay pinnedIconSize={pinnedIconSize} yOffset={24} />

      {/* DEV Test Runner - docked at the bottom of the flex column (not a
          modal), last child so it renders below the space bar and
          everything else stays interactive while it's open */}
      {TestRunnerPanel && (
        <Suspense fallback={null}>
          <TestRunnerPanel
            isOpen={showTestRunner}
            onOpenChange={setShowTestRunner}
            pinnedSites={pinnedSites}
            addPin={async (url, title) => { await addPin(url, title); }}
            removePin={removePin}
            updatePin={updatePin}
            resetFavicon={resetFavicon}
            movePin={movePin}
            duplicatePin={duplicatePin}
            replacePinnedSites={replacePinnedSites}
            appendPinnedSites={appendPinnedSites}
          />
        </Suspense>
      )}
      </AppContainer>
      </UnifiedDndProvider>
      </SelectionProvider>
      </SpacesProvider>
      </BookmarkTabsProvider>
    </FontSizeContext.Provider>
  );
}

export default App;
