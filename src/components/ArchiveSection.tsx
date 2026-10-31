/**
 * ArchiveSection - the active Space's archive, between the Bookmarks
 * and Tabs sections. Auto-archive saves closed tabs as bookmarks in the Space
 * folder's `asd_Archive` folder; this section reopens them.
 * Expanded: every item, newest first, with a search field in the header row that narrows
 * them. Clicking an item reopens it as a regular tab.
 */
import { useState, useCallback, useMemo, useEffect, useRef, KeyboardEvent } from 'react';
import { Search, Trash, X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useInView } from '../hooks/useInView';
import { Space, useSpacesContext } from '../contexts/SpacesContext';
import { useFontSize } from '../contexts/FontSizeContext';
import { useUnifiedDnd } from '../contexts/UnifiedDndContext';
import { DragFormat, DropData, acceptsFormatsIf } from '../types/dragDrop';
import { UndoableAction } from '../actions/types';
import { DeleteBookmarkAction } from '../actions/deleteBookmarkAction';
import { runBatchOperation, useBookmarks } from '../hooks/useBookmarks';
import { ClearArchiveAction, ClearArchiveBookmarksApi } from '../actions/clearArchiveAction';
import { createChromeErrorHandler } from '../utils/chromeError';
import { findArchiveFolder } from '../utils/archiveFolder';
import { ArchiveClearOption, ArchiveItems } from '../utils/archiveItems';
import { formatRelativeTime } from '../utils/folderRecentItems';
import { getIndentPadding } from '../utils/indent';
import { SectionHeader } from './SectionHeader';
import { TreeRow } from './TreeRow';
import { BookmarkFavicon } from './BookmarkFavicon';
import { Dialog } from './Dialog';
import * as ContextMenu from './menu/ContextMenu';

// --- Item row ---

interface ArchiveItemRowProps
{
  page: chrome.bookmarks.BookmarkTreeNode;
  now: number;
  onRestore: (page: chrome.bookmarks.BookmarkTreeNode) => void;
  onDelete: (page: chrome.bookmarks.BookmarkTreeNode) => void;
}

/**
 * One archived page: favicon, title and archive time. Rows outside the viewport
 * render without favicon and menu, so a long archive stays cheap.
 */
const ArchiveItemRow = ({ page, now, onRestore, onDelete }: ArchiveItemRowProps) =>
{
  const { ref, isInView } = useInView<HTMLDivElement>();
  const url = page.url ?? '';
  const title = page.title || url;

  const archivedAt = page.dateAdded !== undefined && (
    // Hidden under the hover "x" without changing the row's layout
    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap group-hover:invisible">
      {formatRelativeTime(page.dateAdded, now)}
    </span>
  );

  if (!isInView)
  {
    return <TreeRow ref={ref} depth={0} title={title} badges={archivedAt} hideChevronSlot />;
  }

  // Shown on hover over the archive time, like a tab's close button
  const actions = (
    <div className="flex items-center opacity-0 group-hover:opacity-100 rounded">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) =>
        {
          e.stopPropagation();
          onDelete(page);
        }}
        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 rounded"
        title="Delete from Archive"
        aria-label="Delete from Archive"
      >
        <X size={14} className="text-gray-700 dark:text-gray-200" />
      </button>
    </div>
  );

  return (
    <ContextMenu.Root>
      {({ isOpen }) => (
        <>
          <ContextMenu.Trigger asChild>
            <TreeRow
              ref={ref}
              depth={0}
              title={title}
              tooltip={[page.title, url].filter(Boolean).join('\n')}
              icon={<BookmarkFavicon url={url} />}
              badges={archivedAt}
              actions={actions}
              hideChevronSlot
              role="button"
              tabIndex={0}
              isHighlighted={isOpen}
              // Modifier clicks restore the same way as a plain click
              onClick={() => onRestore(page)}
              onKeyDown={(e) =>
              {
                if (e.key === 'Enter' || e.key === ' ')
                {
                  e.preventDefault();
                  onRestore(page);
                }
              }}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item danger onSelect={() => onDelete(page)}>
                <Trash size={14} className="mr-2" /> Delete from Archive
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </>
      )}
    </ContextMenu.Root>
  );
};

// --- Search field ---

interface ArchiveSearchFieldProps
{
  value: string;
  onChange: (value: string) => void;
}

/**
 * The search input in the expanded Archive header. It fills the header's trailing slot and
 * keeps clicks there, because a click anywhere else in the header row toggles the section.
 */
const ArchiveSearchField = ({ value, onChange }: ArchiveSearchFieldProps) =>
{
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) =>
  {
    if (e.key !== 'Escape') return;
    // The document-level Escape handler would also clear the tab/bookmark multi-selection
    e.stopPropagation();
    if (value)
    {
      onChange('');
    }
    else
    {
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className="flex w-full min-w-0 pl-2 cursor-text"
      onClick={(e) =>
      {
        e.stopPropagation();
        inputRef.current?.focus();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-1 items-center gap-1.5 min-w-0 pl-2 pr-0.5 rounded-md bg-black/5 dark:bg-white/10">
        <Search size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search Archive..."
          aria-label="Search Archive"
          className="flex-1 min-w-0 py-0.5 bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
        />
        {value && (
          <button
            type="button"
            onClick={(e) =>
            {
              e.stopPropagation();
              onChange('');
              inputRef.current?.focus();
            }}
            className="shrink-0 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
            // .arc-space-title hides header buttons until hover or focus; a hidden "x" would hide
            // that the rows are filtered
            style={{ opacity: 1 }}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

// --- Clear menu ---

interface ArchiveClearMenuProps
{
  items: ArchiveItems;
  onClear: (option: ArchiveClearOption) => void;
}

/**
 * The header menu's Clear submenu. It mounts when the menu opens, so the counts use the time
 * of opening rather than the section's last render, which may be hours old in an idle sidebar.
 * Counts cover the whole archive: clearing ignores the toolbar filter and the Archive search.
 */
const ArchiveClearMenu = ({ items, onClear }: ArchiveClearMenuProps) =>
{
  const [openedAt] = useState(() => Date.now());

  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger>
        <Trash size={14} className="mr-2" /> Clear
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        {ArchiveClearOption.MENU_ORDER.map((option) =>
        {
          const count = items.clearable(option, openedAt).length;
          return (
            <ContextMenu.Item key={option.label} disabled={count === 0} onSelect={() => onClear(option)}>
              {option.label} ({count})
            </ContextMenu.Item>
          );
        })}
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  );
};

interface ClearAllDialogProps
{
  pageCount: number | null;  // null: closed
  onConfirm: () => void;
  onClose: () => void;
}

const ClearAllDialog = ({ pageCount, onConfirm, onClose }: ClearAllDialogProps) =>
{
  const pages = pageCount === 1 ? 'the 1 archived page' : `all ${pageCount} archived pages`;

  return (
    <Dialog isOpen={pageCount !== null} onClose={onClose} title="Clear Archive" maxWidth="max-w-xs">
      <div className="flex flex-col">
        <p className="p-4 text-gray-700 dark:text-gray-300">
          Remove {pages} from this Space's Archive? You can undo this.
        </p>
        <div className="flex justify-end gap-2 p-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md"
          >
            Clear
          </button>
        </div>
      </div>
    </Dialog>
  );
};

// Promise-based chrome.bookmarks for ClearArchiveAction, which keeps chrome.* out of its module
const chromeArchiveBookmarks: ClearArchiveBookmarksApi = {
  getSubTree: (id) => chrome.bookmarks.getSubTree(id),
  remove: (id) => chrome.bookmarks.remove(id),
  create: (bookmark) => chrome.bookmarks.create(bookmark),
};

// --- Section ---

const ARCHIVE_DROP_ID = 'archive-section';

interface ArchiveSectionProps
{
  activeSpace: Space;
  filterText: string;
  filterLiveTabs: boolean;
  isCollapsed: boolean;  // Collapse state as shown (expanded while the text filter is active)
  onToggleCollapsed?: () => void;  // Undefined while the text filter is active
  onPerformAction?: (action: UndoableAction) => Promise<void>;
}

export const ArchiveSection = ({
  activeSpace,
  filterText,
  filterLiveTabs,
  isCollapsed,
  onToggleCollapsed,
  onPerformAction,
}: ArchiveSectionProps) =>
{
  const { findFolderBySegments } = useBookmarks();
  const { windowId } = useSpacesContext();
  const fontSize = useFontSize();
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [clearAllCount, setClearAllCount] = useState<number | null>(null);
  const handleError = useMemo(() => createChromeErrorHandler('Archive', setError), []);

  // The active Space's archive: the first asd_Archive child of its bookmark folder (items in
  // further copies, e.g. made by a bookmark sync, show only in Chrome's Bookmark Manager)
  const spaceFolder = findFolderBySegments(activeSpace.bookmarkFolderSegments ?? [], activeSpace.bookmarkFolderInAccount);
  const archiveFolder = spaceFolder ? findArchiveFolder(spaceFolder.children ?? []) : undefined;

  const items = useMemo(() => ArchiveItems.fromFolder(archiveFolder), [archiveFolder]);
  const filteredItems = useMemo(() => items.matching(filterText), [items, filterText]);
  const visibleItems = useMemo(() => items.matching(filterText, searchText), [items, filterText, searchText]);

  // Hidden without items (no archive, empty, or nothing matches the text filter) and
  // under "With open tabs": archived pages have no live tab. The Archive search doesn't
  // hide the section, or a search without matches would take its own input away
  const isHidden = filterLiveTabs || filteredItems.length === 0;

  // Dropping Tab-list rows here archives them (TabList's 'archive' drop handler does the work).
  // Only drags that start in the Tab list: other items may carry TAB too but are no open rows.
  // A hidden section attaches no node, so it is no drop target
  const { sourceZone, overZone } = useUnifiedDnd();
  const hasSpaceFolder = spaceFolder !== null;
  const { setNodeRef: setDropRef } = useDroppable({
    id: ARCHIVE_DROP_ID,
    data: {
      zone: 'archive',
      targetId: activeSpace.id,
      isFolder: true,
      canAccept: acceptsFormatsIf([DragFormat.TAB_GROUP, DragFormat.TAB], () => hasSpaceFolder && sourceZone === 'tabList'),
    } as DropData,
  });
  const isDropTarget = overZone === 'archive';

  useEffect(() =>
  {
    if (isCollapsed) setSearchText('');
  }, [isCollapsed]);

  // Reopen as a regular tab of the active Space (background assigns new tabs to it, like
  // "+ New Tab"), then drop the item. Opening first means a failed open loses nothing.
  const handleRestore = useCallback((page: chrome.bookmarks.BookmarkTreeNode) =>
  {
    chrome.tabs.create({ url: page.url, active: true, windowId: windowId ?? undefined }, () =>
    {
      if (handleError('reopen archived page')) return;
      chrome.bookmarks.remove(page.id, () =>
      {
        handleError('remove archived page');
      });
    });
  }, [windowId, handleError]);

  // Undoable, like deleting a bookmark from the tree. Undo creates the bookmark again, so the
  // item comes back on top with a new archive time
  const handleDelete = useCallback((page: chrome.bookmarks.BookmarkTreeNode) =>
  {
    const action = new DeleteBookmarkAction([page.id]);
    if (onPerformAction)
    {
      onPerformAction(action);
    }
    else
    {
      action.do();
    }
  }, [onPerformAction]);

  // The action re-reads the folder by id when it runs, so a page moved out of the archive
  // since this render is never removed
  const archiveFolderId = archiveFolder?.id;
  const handleClear = useCallback((option: ArchiveClearOption) =>
  {
    if (!archiveFolderId) return;
    const action = new ClearArchiveAction(chromeArchiveBookmarks, archiveFolderId, option, Date.now, runBatchOperation);
    if (onPerformAction)
    {
      onPerformAction(action);
    }
    else
    {
      action.do();
    }
  }, [archiveFolderId, onPerformAction]);

  // Age options run at once (Undo covers them); Clear All asks first
  const handleSelectClearOption = useCallback((option: ArchiveClearOption) =>
  {
    if (option === ArchiveClearOption.ALL)
    {
      setClearAllCount(items.clearable(option, Date.now()).length);
    }
    else
    {
      handleClear(option);
    }
  }, [items, handleClear]);

  const closeClearAllDialog = useCallback(() => setClearAllCount(null), []);

  const confirmClearAll = useCallback(() =>
  {
    setClearAllCount(null);
    handleClear(ArchiveClearOption.ALL);
  }, [handleClear]);

  // A dialog left open while the archive emptied elsewhere must not pop up again later
  useEffect(() =>
  {
    if (isHidden) setClearAllCount(null);
  }, [isHidden]);

  if (isHidden) return null;

  const now = Date.now();

  return (
    <div>
      <div
        ref={setDropRef}
        data-dnd-id={ARCHIVE_DROP_ID}
        className={isDropTarget ? 'rounded-md ring-2 ring-inset ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : undefined}
      >
        <SectionHeader
          label="Archive"
          menuContent={<ArchiveClearMenu items={items} onClear={handleSelectClearOption} />}
          menuTitle="Archive options"
          fontSize={fontSize}
          labelClassName="font-medium"
          className="arc-space-title"
          collapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          trailing={!isCollapsed && <ArchiveSearchField value={searchText} onChange={setSearchText} />}
        />

        {!isCollapsed && visibleItems.map((page) => (
          <ArchiveItemRow
            key={page.id}
            page={page}
            now={now}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
        ))}

        {!isCollapsed && visibleItems.length === 0 && (
          <div
            className="py-1 text-sm text-gray-500 dark:text-gray-400"
            style={{ paddingLeft: `${getIndentPadding(0)}px` }}
          >
            No matching pages
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-500 text-sm px-2 py-1 text-center">{error}</p>
      )}

      <ClearAllDialog pageCount={clearAllCount} onConfirm={confirmClearAll} onClose={closeClearAllDialog} />

      <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
    </div>
  );
};
