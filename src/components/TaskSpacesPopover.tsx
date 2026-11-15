/**
 * TaskSpacesPopover - the list of Task Spaces, opened from the list button left of
 * (+) in the Space bar. Task Spaces have no place in the strip and the recent list
 * above it holds only the last few, so this list is how the rest are reached,
 * archived ones included.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ArchiveRestore, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useFontSize } from '../contexts/FontSizeContext';
import { useSpacesContext, Space } from '../contexts/SpacesContext';
import { useArchivedTaskSpaces } from '../hooks/useArchivedTaskSpaces';
import { getIcon } from '../utils/spaceIcons';
import { isTaskSpace } from '../utils/taskSpaces';
import { Overlay, useEscapeKey } from './menu/MenuBase';
import * as ContextMenu from './menu/ContextMenu';
import { SpaceContextMenuContent } from './SpaceContextMenuContent';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const MAX_WIDTH = 280;
// Rows have one fixed height so the list can show exactly VISIBLE_ROWS of them
const ROW_HEIGHT_EM = 2.25;
const VISIBLE_ROWS = 10;
const OPACITY_STEP = 0.07;
const MIN_OPACITY = 0.35;

// The newest row at full strength and each older one a step fainter, so the
// Task Spaces in use stand out from the ones left behind
function ageOpacity(index: number, count: number): number
{
  return Math.max(MIN_OPACITY, 1 - OPACITY_STEP * (count - 1 - index));
}

function byCreation(a: Space, b: Space): number
{
  return (a.task?.createdAt ?? 0) - (b.task?.createdAt ?? 0);
}

interface TaskSpacesPopoverProps
{
  anchorRect: DOMRect;
  canDelete: boolean;
  onSelect: (space: Space) => void;
  onEdit: (space: Space) => void;
  onDelete: (space: Space) => void;
  onCloseAllTabs: (space: Space) => void;
  onConvertToRegular: (space: Space) => void;
  onRestore: (space: Space) => void;
  onDeleteArchived: (space: Space) => void;
  onClose: () => void;
}

export const TaskSpacesPopover = ({
  anchorRect,
  canDelete,
  onSelect,
  onEdit,
  onDelete,
  onCloseAllTabs,
  onConvertToRegular,
  onRestore,
  onDeleteArchived,
  onClose,
}: TaskSpacesPopoverProps) =>
{
  const fontSize = useFontSize();
  const { spaces, activeSpaceId } = useSpacesContext();
  const archived = useArchivedTaskSpaces();
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEscapeKey(true, onClose);

  const live = useMemo(() => spaces.filter(isTaskSpace).sort(byCreation), [spaces]);

  // Opens on the newest Task Spaces, the ones most likely wanted again
  useLayoutEffect(() =>
  {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  // Above the Space bar, right-aligned to the button; grows upwards and never past the top edge
  const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - anchorRect.right);
  const width = Math.min(MAX_WIDTH, window.innerWidth - right - VIEWPORT_MARGIN);
  const bottom = window.innerHeight - anchorRect.top + ANCHOR_GAP;
  const maxHeight = Math.max(0, anchorRect.top - ANCHOR_GAP - VIEWPORT_MARGIN);

  const rowStyle = { height: `${ROW_HEIGHT_EM}em` };
  const rowClass = 'flex items-center gap-2 mx-1 px-2 rounded-lg cursor-default select-none';

  // A menu action may open a dialog, which must not open under the list
  const thenClose = (action: (space: Space) => void, space: Space) => () =>
  {
    onClose();
    action(space);
  };

  const isEmpty = live.length === 0 && archived.length === 0;

  return createPortal(
    <>
      <Overlay onClose={onClose} />
      <div
        role="dialog"
        aria-label="Task Spaces"
        className="fixed z-50 flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden text-gray-700 dark:text-gray-200"
        style={{ right, bottom, width, maxHeight, fontSize: `${fontSize}px` }}
      >
        {isEmpty ? (
          <div className="px-3 py-3 text-gray-400">
            No Task Spaces yet. Create one with + → New Task Space
          </div>
        ) : (
          <div
            ref={listRef}
            className="min-h-0 overflow-y-auto py-1"
            style={{ maxHeight: `calc(${ROW_HEIGHT_EM * VISIBLE_ROWS}em + 0.5rem)` }}
          >
            {archived.length > 0 && (
              <div
                role="button"
                aria-expanded={archivedExpanded}
                className={clsx(rowClass, 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700')}
                style={rowStyle}
                onClick={() => setArchivedExpanded(expanded => !expanded)}
              >
                {archivedExpanded
                  ? <ChevronDown size={14} className="shrink-0" />
                  : <ChevronRight size={14} className="shrink-0" />}
                <span className="truncate">Archived ({archived.length})</span>
              </div>
            )}

            {archivedExpanded && archived.map(space => (
              <ContextMenu.Root key={space.id}>
                <ContextMenu.Trigger asChild>
                  <div
                    role="button"
                    title={space.name}
                    className={clsx(rowClass, 'opacity-50 hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700')}
                    style={rowStyle}
                    onClick={() => onRestore(space)}
                  >
                    <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                      {getIcon(space.icon, 16, false)}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{space.name}</span>
                    {space.task?.archivedAt !== undefined && (
                      <span className="shrink-0 text-xs text-gray-400">
                        {new Date(space.task.archivedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content>
                    <ContextMenu.Item onSelect={() => onRestore(space)}>
                      <ArchiveRestore size={14} className="mr-2 flex-shrink-0" /> Restore
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item danger onSelect={() => onDeleteArchived(space)}>
                      <Trash2 size={14} className="mr-2 flex-shrink-0" /> Delete
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}

            {live.map((space, index) => (
              <ContextMenu.Root key={space.id}>
                <ContextMenu.Trigger asChild>
                  <div
                    role="button"
                    title={space.name}
                    className={clsx(
                      rowClass,
                      'transition-opacity opacity-[var(--task-row-opacity)] hover:opacity-100',
                      space.id === activeSpaceId
                        ? 'bg-gray-200 dark:bg-gray-700 font-medium'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                    style={{ ...rowStyle, '--task-row-opacity': ageOpacity(index, live.length) } as React.CSSProperties}
                    onClick={() => onSelect(space)}
                  >
                    <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                      {getIcon(space.icon, 16, false)}
                    </span>
                    <span className="truncate">{space.name}</span>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content>
                    <SpaceContextMenuContent
                      onEdit={thenClose(onEdit, space)}
                      onDelete={thenClose(onDelete, space)}
                      onCloseAllTabs={thenClose(onCloseAllTabs, space)}
                      onConvertToRegular={thenClose(onConvertToRegular, space)}
                      canDelete={canDelete}
                    />
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body
  );
};
