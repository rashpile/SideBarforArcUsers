import React from 'react';
import clsx from 'clsx';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as ContextMenu from './menu/ContextMenu';
import { Space } from '../contexts/SpacesContext';
import { GROUP_COLORS, getHexColorStyle } from '../utils/groupColors';
import { getIcon } from '../utils/spaceIcons';
import { SpaceContextMenuContent } from './SpaceContextMenuContent';
import { createSpaceDragData, DropData, DropPosition, DragFormat, acceptsFormats } from '../types/dragDrop';

/**
 * Shared visual component for space icon rendering.
 * Used by both SpaceIcon and SpaceOverlay (drag overlay) for consistent appearance.
 */
interface SpaceIconVisualProps
{
  icon: string;
  color: string;
  isActive?: boolean;
  className?: string;
}

export const SpaceIconVisual: React.FC<SpaceIconVisualProps> = ({
  icon,
  color,
  isActive = false,
  className,
}) =>
{
  const colorStyle = GROUP_COLORS[color];

  if (colorStyle)
  {
    // Chrome color name path - use Tailwind classes
    return (
      <div
        className={clsx(
          "arc-space-icon-visual w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          className
        )}
        data-active={isActive || undefined}
      >
        <span
          className={clsx(
            "flex items-center justify-center",
            isActive ? colorStyle.text : "text-gray-400 dark:text-gray-500"
          )}
        >
          {getIcon(icon, 17, false)}
        </span>
      </div>
    );
  }

  // Hex color path - use inline styles
  const hexStyle = getHexColorStyle(color);
  return (
    <div
      className={clsx(
        "arc-space-icon-visual w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
        className
      )}
      data-active={isActive || undefined}
    >
      <span
        className={clsx(
          "flex items-center justify-center",
          !isActive && "text-gray-400 dark:text-gray-500"
        )}
        style={{ color: isActive ? hexStyle.text : undefined }}
      >
        {getIcon(icon, 17, false)}
      </span>
    </div>
  );
};

interface SpaceIconProps
{
  space: Space;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCloseAllTabs?: () => void;
  canDelete?: boolean;
  isDraggable?: boolean;
  isDropTarget?: boolean;
  dropPosition?: DropPosition;
}

export const SpaceIcon: React.FC<SpaceIconProps> = ({
  space,
  index,
  isActive,
  onClick,
  onEdit,
  onDelete,
  onCloseAllTabs,
  canDelete = true,
  isDraggable = false,
  isDropTarget = false,
  dropPosition,
}) =>
{
  const spaceId = `space-${space.id}`;

  // useSortable combines draggable + droppable
  // The data object includes BOTH drag data AND drop data
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: spaceId,
    data: {
      // Drag data (for when this item is being dragged)
      ...createSpaceDragData(space.id, space.name, space.icon, space.color),
      // Drop data (for when items are dropped onto this)
      zone: 'spaceBar',
      targetId: space.id,
      canAccept: acceptsFormats(DragFormat.SPACE, DragFormat.TAB, DragFormat.URL),
      isHorizontal: true,
      // TAB/URL drops go "into" the space; SPACE drops are before/after for reordering
      isContainerForFormat: (format: DragFormat) =>
        format === DragFormat.TAB || format === DragFormat.URL,
      index,
    } as DropData,
    disabled: !isDraggable,
  });

  // Apply transform style for sortable animation
  const style = isDraggable ? {
    transform: CSS.Transform.toString(transform),
    transition,
  } : undefined;

  const iconButton = (
    <button
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      title={space.name}
      data-space-id={space.id}
      data-space-button="true"
      data-dnd-id={spaceId}
      className={clsx(
        "relative",
        "hover:scale-105 focus:outline-none",
        !isActive && "hover:opacity-80",
        isDropTarget && (dropPosition === 'into' || dropPosition === 'intoFirst') &&
          "ring-2 ring-blue-500 rounded scale-125 shadow-lg shadow-blue-500/50"
      )}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
    >
      <SpaceIconVisual
        icon={space.icon}
        color={space.color}
        isActive={isActive}
      />
    </button>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {iconButton}
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content>
          <SpaceContextMenuContent
            onEdit={onEdit}
            onDelete={onDelete}
            onCloseAllTabs={onCloseAllTabs}
            canDelete={canDelete}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};
