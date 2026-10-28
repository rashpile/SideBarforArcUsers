/**
 * ArchiveSection - the active Space's archive (feature 035), between the Bookmarks
 * and Tabs sections. Auto-archive saves closed tabs as bookmarks in the Space
 * folder's `asd_Archive` folder; this section reopens them.
 * Collapsed: hovering the header peeks the newest items (FolderRecentPopover).
 * Expanded: every item, newest first. Clicking an item reopens it as a regular tab.
 */
import { useState, useCallback, useMemo } from 'react';
import { Trash } from 'lucide-react';
import { useBookmarks } from '../hooks/useBookmarks';
import { useInView } from '../hooks/useInView';
import { Space, useSpacesContext } from '../contexts/SpacesContext';
import { useUnifiedDnd } from '../contexts/UnifiedDndContext';
import { useFontSize } from '../contexts/FontSizeContext';
import { UndoableAction } from '../actions/types';
import { DeleteBookmarkAction } from '../actions/deleteBookmarkAction';
import { createChromeErrorHandler } from '../utils/chromeError';
import { findArchiveFolder } from '../utils/archiveFolder';
import { ArchiveItems } from '../utils/archiveItems';
import { formatRelativeTime } from '../utils/folderRecentItems';
import { SectionHeader } from './SectionHeader';
import { TreeRow } from './TreeRow';
import { BookmarkFavicon } from './BookmarkFavicon';
import { FolderRecentPopover, useFolderPeek } from './FolderRecentPopover';
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
    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
      {formatRelativeTime(page.dateAdded, now)}
    </span>
  );

  if (!isInView)
  {
    return <TreeRow ref={ref} depth={0} title={title} badges={archivedAt} hideChevronSlot />;
  }

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

// --- Section ---

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
  const { activeId: dragActiveId } = useUnifiedDnd();
  const fontSize = useFontSize();
  const [error, setError] = useState<string | null>(null);
  const handleError = useCallback(
    createChromeErrorHandler('Archive', setError),
    []
  );

  // The active Space's archive: the first asd_Archive child of its bookmark folder (items in
  // further copies, e.g. made by a bookmark sync, show only in Chrome's Bookmark Manager)
  const spaceFolder = findFolderBySegments(activeSpace.bookmarkFolderSegments ?? [], activeSpace.bookmarkFolderInAccount);
  const archiveFolder = spaceFolder ? findArchiveFolder(spaceFolder.children ?? []) : undefined;

  const items = useMemo(() => ArchiveItems.fromFolder(archiveFolder), [archiveFolder]);
  const recency = useMemo(() => items.toRecency(), [items]);
  const visibleItems = useMemo(() => items.matching(filterText), [items, filterText]);

  // Hidden without items (no archive, empty, or nothing matches the text filter) and
  // under "With open tabs": archived pages have no live tab
  const isHidden = filterLiveTabs || visibleItems.length === 0;

  // The collapsed header peeks the newest items, in every bookmark open mode
  const peek = useFolderPeek(!isHidden && isCollapsed && !dragActiveId);
  const closePeek = peek.close;

  // Reopen as a regular tab of the active Space (background assigns new tabs to it, like
  // "+ New Tab"), then drop the item. Opening first means a failed open loses nothing.
  const handleRestore = useCallback((page: chrome.bookmarks.BookmarkTreeNode) =>
  {
    closePeek();
    chrome.tabs.create({ url: page.url, active: true, windowId: windowId ?? undefined }, () =>
    {
      if (handleError('reopen archived page')) return;
      chrome.bookmarks.remove(page.id, () =>
      {
        handleError('remove archived page');
      });
    });
  }, [closePeek, windowId, handleError]);

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

  if (isHidden) return null;

  const now = Date.now();

  return (
    <div>
      <div
        onPointerEnter={peek.rowHandlers.onPointerEnter}
        onPointerLeave={peek.rowHandlers.onPointerLeave}
      >
        <SectionHeader
          label="Archive"
          menuContent={null}
          showMenuButton={false}
          fontSize={fontSize}
          labelClassName="font-medium"
          className="arc-space-title"
          collapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
        />
      </div>
      {peek.anchorRect && archiveFolder && (
        <FolderRecentPopover
          folder={archiveFolder}
          label="Archive"
          anchorRect={peek.anchorRect}
          popoverRef={peek.popoverRef}
          recency={recency}
          onOpenBookmark={handleRestore}
          onClose={closePeek}
          onPointerEnter={peek.popoverHandlers.onPointerEnter}
          onPointerLeave={peek.popoverHandlers.onPointerLeave}
        />
      )}

      {!isCollapsed && visibleItems.map((page) => (
        <ArchiveItemRow
          key={page.id}
          page={page}
          now={now}
          onRestore={handleRestore}
          onDelete={handleDelete}
        />
      ))}

      {error && (
        <p className="text-red-500 text-sm px-2 py-1 text-center">{error}</p>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
    </div>
  );
};
