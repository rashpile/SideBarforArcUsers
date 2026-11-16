import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { FolderPlus, LayoutGrid, ListTodo, Menu, Plus } from 'lucide-react';
import { SpaceIcon } from './SpaceIcon';
import { TaskSpacesPopover } from './TaskSpacesPopover';
import { useSpacesContext, Space } from '../contexts/SpacesContext';
import { useUnifiedDnd, DropHandler } from '../contexts/UnifiedDndContext';
import { DragData, DragFormat, DropData, DropPosition, getItemsByFormat, getPrimaryItem, hasFormat } from '../types/dragDrop';
import { moveTabToSpace, createTabInSpace } from '../utils/tabOperations';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { BookmarkCreateFolderModal } from './BookmarkCreateFolderModal';
import { useBookmarks } from '../hooks/useBookmarks';
import { useCloseAllTabsInSpace } from '../hooks/useCloseAllTabsInSpace';
import { regularSpaces } from '../utils/taskSpaces';
import { spaceManagerProxy } from '../managers/proxies/spaceManagerProxy';
import * as DropdownMenu from './menu/DropdownMenu';
import type { UndoableAction } from '../actions/types';

interface SpaceBarProps
{
  onCreateSpace: () => void;
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (space: Space) => void;
  dropTargetSpaceId?: string | null;
  onPerformAction?: (action: UndoableAction) => Promise<void>;
  onShowToast: (message: string) => void;
  // Puts the label and the Space buttons at the right end of the bar, next to "+" (vertical toolbar)
  alignEnd?: boolean;
}

export const SpaceBar: React.FC<SpaceBarProps> = ({
  onCreateSpace,
  onEditSpace,
  onDeleteSpace,
  dropTargetSpaceId,
  onPerformAction,
  onShowToast,
  alignEnd,
}) =>
{
  const { spaces, activeSpace, activeSpaceId, switchToSpace, moveSpace, createTaskSpace, convertToRegularSpace, windowId } = useSpacesContext();
  // Task Spaces stay out of the strip; the recent list above it (RecentTaskSpacesSection) holds the last few
  const regular = useMemo(() => regularSpaces(spaces), [spaces]);
  const { closeAllTabs: handleCloseAllTabsInSpace, confirmation: closeAllConfirmation } = useCloseAllTabsInSpace(onPerformAction);
  const { findFolderBySegments, createFolder } = useBookmarks();
  const { activeDragData, overId, dropPosition, registerDropHandler, unregisterDropHandler } = useUnifiedDnd();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<string | null>(null);
  const [taskListAnchor, setTaskListAnchor] = useState<DOMRect | null>(null);

  // Auto-scroll to make active space visible
  useEffect(() =>
  {
    const container = scrollContainerRef.current;
    if (!container) return;

    const activeButton = container.querySelector(`[data-space-id="${activeSpaceId}"]`);
    if (activeButton)
    {
      activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeSpaceId]);

  const handleSpaceClick = (spaceId: string) =>
  {
    switchToSpace(spaceId);
    // Tab group is NOT created on space switch
    // It will be created when first tab/bookmark is opened
  };

  const handleCreateFolder = useCallback(() =>
  {
    const spaceRoot = findFolderBySegments(activeSpace.bookmarkFolderSegments ?? [], activeSpace.bookmarkFolderInAccount);
    if (spaceRoot)
    {
      setCreatingFolderParentId(spaceRoot.id);
    }
  }, [activeSpace.bookmarkFolderSegments, activeSpace.bookmarkFolderInAccount, findFolderBySegments]);

  const handleSaveFolder = useCallback((parentId: string, title: string) =>
  {
    createFolder(parentId, title);
  }, [createFolder]);

  const handleCreateTaskSpace = useCallback(async () =>
  {
    try
    {
      const space = await createTaskSpace();
      switchToSpace(space.id);
    }
    catch (error)
    {
      console.error('[SpaceBar] Failed to create Task Space:', error);
      onShowToast('Could not create a Task Space');
    }
  }, [createTaskSpace, switchToSpace, onShowToast]);

  const closeTaskList = useCallback(() => setTaskListAnchor(null), []);

  const handleSelectTaskSpace = useCallback((space: Space) =>
  {
    closeTaskList();
    switchToSpace(space.id);
  }, [closeTaskList, switchToSpace]);

  const handleRestoreTaskSpace = useCallback(async (space: Space) =>
  {
    closeTaskList();
    try
    {
      // Awaited so background has the Space in its live list before the switch reaches it
      await spaceManagerProxy.restoreTaskSpace(space.id);
      switchToSpace(space.id);
    }
    catch (error)
    {
      console.error('[SpaceBar] Failed to restore Task Space:', error);
      onShowToast('Could not restore the Task Space');
    }
  }, [closeTaskList, switchToSpace, onShowToast]);

  const handleDeleteArchivedTaskSpace = useCallback(async (space: Space) =>
  {
    try
    {
      await spaceManagerProxy.deleteArchivedTaskSpace(space.id);
    }
    catch (error)
    {
      console.error('[SpaceBar] Failed to delete archived Task Space:', error);
      onShowToast('Could not delete the Task Space');
    }
  }, [onShowToast]);

  const handleConvertToRegular = useCallback((space: Space) =>
  {
    convertToRegularSpace(space.id);
  }, [convertToRegularSpace]);

  const handleCreateTab = useCallback(() =>
  {
    chrome.tabs.create({ active: true, windowId: windowId ?? undefined });
  }, [windowId]);

  const handleDelete = (space: Space) =>
  {
    onDeleteSpace(space);
  };

  // Drop handler for SpaceBar zone
  const handleDrop: DropHandler = useCallback(async (
    dragData: DragData,
    dropData: DropData,
    position: DropPosition,
    acceptedFormat: DragFormat
  ) =>
  {
    if (!position) return;

    const primaryItem = getPrimaryItem(dragData);
    if (!primaryItem) return;

    // Extract space ID from drop target (e.g., "space-work" -> "work")
    const targetSpaceId = dropData.targetId.startsWith('space-')
      ? dropData.targetId.slice(6)
      : dropData.targetId;

    switch (acceptedFormat)
    {
      case DragFormat.SPACE:
        // Reorder spaces (handled by SortableContext, but drop handler still called)
        if (primaryItem.space && primaryItem.space.spaceId !== targetSpaceId)
        {
          moveSpace(primaryItem.space.spaceId, targetSpaceId);
        }
        break;

      case DragFormat.TAB:
        // Move all tabs to space's Chrome group
        if (windowId)
        {
          const tabItems = getItemsByFormat(dragData, DragFormat.TAB);
          for (const item of tabItems)
          {
            if (item.tab)
            {
              const result = await moveTabToSpace(
                item.tab.tabId,
                targetSpaceId,
                spaces,
                windowId
              );
              if (import.meta.env.DEV && !result.success)
              {
                console.error('[SpaceBar] Failed to move tab:', result.error);
              }
            }
          }
        }
        break;

      case DragFormat.URL:
        // Create new tabs in space from all URLs
        if (windowId)
        {
          const urlItems = getItemsByFormat(dragData, DragFormat.URL);
          for (const item of urlItems)
          {
            if (item.url)
            {
              const result = await createTabInSpace(
                item.url.url,
                targetSpaceId,
                spaces,
                windowId
              );
              if (import.meta.env.DEV && !result.success)
              {
                console.error('[SpaceBar] Failed to create tab:', result.error);
              }
            }
          }
        }
        break;
    }
  }, [moveSpace, spaces, windowId]);

  // Register drop handler
  useEffect(() =>
  {
    registerDropHandler('spaceBar', handleDrop);
    return () => unregisterDropHandler('spaceBar');
  }, [registerDropHandler, unregisterDropHandler, handleDrop]);

  // Show drop indicators for SPACE reordering (before/after position)
  const isSpaceDrag = !!(activeDragData && hasFormat(activeDragData, DragFormat.SPACE));
  // Show drop indicators for TAB/URL drops (into position)
  const isTabOrUrlDrag = !!(activeDragData && (
    hasFormat(activeDragData, DragFormat.TAB) || hasFormat(activeDragData, DragFormat.URL)
  ));

  const sortableSpaceIds = useMemo(
    () => regular.map(space => `space-${space.id}`),
    [regular]
  );

  const renderSpaceIcon = (space: Space, index: number) => (
    <SpaceIcon
      key={space.id}
      space={space}
      index={index}
      isActive={space.id === activeSpaceId}
      onClick={() => handleSpaceClick(space.id)}
      onEdit={() => onEditSpace(space)}
      onDelete={() => handleDelete(space)}
      onCloseAllTabs={() => handleCloseAllTabsInSpace(space)}
      canDelete={spaces.length > 1}
      isDraggable
      isDropTarget={
        dropTargetSpaceId === space.id ||
        (isSpaceDrag && overId === `space-${space.id}`) ||
        (isTabOrUrlDrag && overId === `space-${space.id}`)
      }
      dropPosition={
        (isSpaceDrag && overId === `space-${space.id}`) ? dropPosition :
        (isTabOrUrlDrag && overId === `space-${space.id}`) ? 'into' :
        null
      }
    />
  );

  // alignEnd packs the row, not the scroll container: justify-end inside an overflow-x container makes the
  // leftmost Spaces unreachable once they overflow, while here the scroll container shrinks first and leaves
  // the row no free space. Not an auto margin on the label either: the Arc styling hides it (index.css).
  return (
    <>
      <div
        className={clsx(
          'arc-space-bar flex items-stretch border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50',
          alignEnd && 'justify-end'
        )}
      >
        {/* Vertical "SPACE" label */}
        <div className="arc-space-label flex items-center justify-center px-0.5">
          <span
            className="text-[8px] font-medium text-gray-400 dark:text-gray-500 tracking-wide"
            style={{
              writingMode: 'vertical-lr',
              transform: 'rotate(180deg)',
            }}
          >
            SPACE
          </span>
        </div>

        {/* Horizontal scrollable space icons */}
        <div
          ref={scrollContainerRef}
          className={clsx(
            alignEnd ? 'min-w-0' : 'flex-1',
            'flex items-center gap-1.5 px-1 py-1 overflow-x-auto'
          )}
          style={{ scrollbarWidth: 'none' }}
          data-dnd-zone="spaceBar"
        >
          <SortableContext items={sortableSpaceIds} strategy={horizontalListSortingStrategy}>
            {regular.map((space, index) => renderSpaceIcon(space, index))}
          </SortableContext>
        </div>

        {/* Task Spaces list and Arc-style create menu */}
        <div className="arc-create-space flex items-center gap-0.5 px-1">
          <button
            title="Task Spaces"
            aria-label="Task Spaces"
            aria-expanded={taskListAnchor !== null}
            onClick={(e) => setTaskListAnchor(e.currentTarget.getBoundingClientRect())}
            className={clsx(
              "p-1.5 rounded",
              "transition-all duration-150",
              "focus:outline-none",
              taskListAnchor
                ? "text-gray-900 dark:text-gray-100 bg-gray-200 dark:bg-gray-700"
                : clsx(
                  "text-gray-500 dark:text-gray-400",
                  "hover:text-gray-900 dark:hover:text-gray-100",
                  "hover:bg-gray-200 dark:hover:bg-gray-700"
                )
            )}
          >
            <Menu size={18} />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                title="Create"
                aria-label="Create"
                className={clsx(
                  "p-1.5 rounded",
                  "text-gray-500 dark:text-gray-400",
                  "hover:text-gray-900 dark:hover:text-gray-100",
                  "hover:bg-gray-200 dark:hover:bg-gray-700",
                  "transition-all duration-150",
                  "focus:outline-none"
                )}
              >
                <Plus size={18} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={onCreateSpace}>
                <LayoutGrid size={14} className="mr-2" /> New Space
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={handleCreateTaskSpace}>
                <ListTodo size={14} className="mr-2" /> New Task Space
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={handleCreateFolder}>
                <FolderPlus size={14} className="mr-2" /> New Folder
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={handleCreateTab}>
                <Plus size={14} className="mr-2" /> New Tab
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>

      {taskListAnchor && (
        <TaskSpacesPopover
          anchorRect={taskListAnchor}
          canDelete={spaces.length > 1}
          onSelect={handleSelectTaskSpace}
          onEdit={onEditSpace}
          onDelete={handleDelete}
          onCloseAllTabs={handleCloseAllTabsInSpace}
          onConvertToRegular={handleConvertToRegular}
          onRestore={handleRestoreTaskSpace}
          onDeleteArchived={handleDeleteArchivedTaskSpace}
          onClose={closeTaskList}
        />
      )}

      <ConfirmDeleteDialog
        isOpen={closeAllConfirmation.isOpen}
        itemCount={closeAllConfirmation.tabCount}
        itemType="tabs"
        details="This will close the window."
        onConfirm={closeAllConfirmation.confirm}
        onClose={closeAllConfirmation.cancel}
      />

      <BookmarkCreateFolderModal
        isOpen={creatingFolderParentId !== null}
        parentId={creatingFolderParentId}
        onSave={handleSaveFolder}
        onClose={() => setCreatingFolderParentId(null)}
      />
    </>
  );
};
