/**
 * RecentTaskSpacesList - the last few Task Spaces, one row each, right above the
 * Space buttons. Task Spaces have no icon in the strip; these rows keep the ones in
 * use one click away. The sandwich list still holds all of them.
 */
import React from 'react';
import clsx from 'clsx';
import { useDroppable } from '@dnd-kit/core';
import { Minus } from 'lucide-react';
import { Space } from '../contexts/SpacesContext';
import { useUnifiedDnd } from '../contexts/UnifiedDndContext';
import { DragFormat, DropData, acceptsFormats, hasFormat } from '../types/dragDrop';
import { getIcon } from '../utils/spaceIcons';
import { recentAgeLabel, RecentTaskSpaces, RecentTaskSpaceRow } from '../utils/recentTaskSpaces';
import * as ContextMenu from './menu/ContextMenu';
import { SpaceContextMenuContent } from './SpaceContextMenuContent';

const ROW_HEIGHT_EM = 2;

interface RecentTaskSpaceActions
{
  canDelete: boolean;
  onSelect: (space: Space) => void;
  onHide: (space: Space) => void;
  onEdit: (space: Space) => void;
  onDelete: (space: Space) => void;
  onCloseAllTabs: (space: Space) => void;
  onConvertToRegular: (space: Space) => void;
}

interface RecentTaskSpacesListProps extends RecentTaskSpaceActions
{
  recent: RecentTaskSpaces<Space>;
  // The clock the selection used, so the labels agree with it
  now: number;
}

export const RecentTaskSpacesList = ({ recent, now, ...actions }: RecentTaskSpacesListProps) =>
{
  const { activeDragData, overId } = useUnifiedDnd();

  if (recent.isEmpty) return null;

  const isTabOrUrlDrag = !!(activeDragData && (
    hasFormat(activeDragData, DragFormat.TAB) || hasFormat(activeDragData, DragFormat.URL)
  ));

  // Same surface as the Space bar below it, so both read as one panel (index.css repaints it in the Arc look)
  return (
    <div
      aria-label="Recent Task Spaces"
      className="arc-recent-task-spaces py-1 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-200"
    >
      {recent.rows.map(row => (
        <RecentTaskSpaceRowItem
          key={row.space.id}
          row={row}
          label={recentAgeLabel(row, now)}
          isDropTarget={isTabOrUrlDrag && overId === `space-${row.space.id}`}
          {...actions}
        />
      ))}
    </div>
  );
};

interface RecentTaskSpaceRowItemProps extends RecentTaskSpaceActions
{
  row: RecentTaskSpaceRow<Space>;
  label: string;
  isDropTarget: boolean;
}

const RecentTaskSpaceRowItem = ({
  row,
  label,
  isDropTarget,
  canDelete,
  onSelect,
  onHide,
  onEdit,
  onDelete,
  onCloseAllTabs,
  onConvertToRegular,
}: RecentTaskSpaceRowItemProps) =>
{
  const { space, isActive } = row;
  // Task Spaces are never in the strip, so this id can't clash with a SpaceIcon's
  const dndId = `space-${space.id}`;

  // Zone 'spaceBar': SpaceBar's drop handler moves a dropped tab into this Space or opens a link there
  const { setNodeRef } = useDroppable({
    id: dndId,
    data: {
      zone: 'spaceBar',
      targetId: space.id,
      canAccept: acceptsFormats(DragFormat.TAB, DragFormat.URL),
      isContainerForFormat: (format: DragFormat) =>
        format === DragFormat.TAB || format === DragFormat.URL,
    } as DropData,
  });

  const handleKeyDown = (e: React.KeyboardEvent) =>
  {
    // Keys on the (−) button bubble up here; that button handles its own
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ')
    {
      e.preventDefault();
      onSelect(space);
    }
  };

  const handleHide = (e: React.MouseEvent) =>
  {
    e.stopPropagation();
    onHide(space);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {/* data-dnd-id: UnifiedDndContext finds the hovered element by it and drops the hover without it */}
        <div
          ref={setNodeRef}
          data-dnd-id={dndId}
          role="button"
          tabIndex={0}
          title={space.name}
          className={clsx(
            'group flex items-center gap-2 mx-1 px-2 rounded-lg cursor-default select-none',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
            isActive
              ? 'bg-gray-200 dark:bg-gray-700 font-medium'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700',
            isDropTarget && 'ring-2 ring-blue-500'
          )}
          style={{ height: `${ROW_HEIGHT_EM}em` }}
          onClick={() => onSelect(space)}
          onKeyDown={handleKeyDown}
        >
          <span className="w-4 h-4 shrink-0 flex items-center justify-center">
            {getIcon(space.icon, 15, false)}
          </span>
          <span className="flex-1 min-w-0 truncate">{space.name}</span>
          {/* (−) takes the label's place on hover and on keyboard focus of the row or the button. Not on
              any focus: a clicked row keeps focus after the switch and would keep showing (−). */}
          <span className="shrink-0 text-xs font-normal text-gray-400 group-hover:hidden group-focus-visible:hidden group-has-[:focus-visible]:hidden">
            {label}
          </span>
          <button
            title="Hide"
            aria-label="Hide from recent Task Spaces"
            className={clsx(
              'hidden group-hover:flex group-focus-visible:flex group-has-[:focus-visible]:flex',
              'shrink-0 items-center justify-center p-0.5 rounded',
              'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
              'hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50'
            )}
            onClick={handleHide}
          >
            <Minus size={14} />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <SpaceContextMenuContent
            onEdit={() => onEdit(space)}
            onDelete={() => onDelete(space)}
            onCloseAllTabs={() => onCloseAllTabs(space)}
            onConvertToRegular={() => onConvertToRegular(space)}
            canDelete={canDelete}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};
