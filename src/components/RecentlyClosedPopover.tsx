/**
 * RecentlyClosedPopover - the active Space's recently closed tabs, opened from
 * the History button in the Space header. A click reopens the tab in that Space.
 */
import { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useFontSize } from '../contexts/FontSizeContext';
import { useEscapeKey } from './menu/MenuBase';
import { getFaviconUrl } from '../utils/favicon';
import { formatRelativeTime } from '../utils/folderRecentItems';
import type { ClosedTabRecord } from '../stores/recentlyClosedTabs';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const MAX_WIDTH = 360;

interface RecentlyClosedPopoverProps
{
  spaceName: string;
  records: readonly ClosedTabRecord[];
  anchorRect: DOMRect;
  popoverRef: React.RefObject<HTMLDivElement>;
  onReopen: (record: ClosedTabRecord) => void;
  onClear: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export const RecentlyClosedPopover = ({
  spaceName,
  records,
  anchorRect,
  popoverRef,
  onReopen,
  onClear,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: RecentlyClosedPopoverProps) =>
{
  const fontSize = useFontSize();
  const [top, setTop] = useState(anchorRect.bottom + ANCHOR_GAP);

  useEscapeKey(true, onClose);

  const now = Date.now();

  // Below the anchor row; flip above it when the panel has no room below
  useLayoutEffect(() =>
  {
    const height = popoverRef.current?.getBoundingClientRect().height ?? 0;
    const below = anchorRect.bottom + ANCHOR_GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    const above = anchorRect.top - ANCHOR_GAP - height;
    const pinnedToBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);

    if (fitsBelow) setTop(below);
    else setTop(above >= VIEWPORT_MARGIN ? above : pinnedToBottom);
  }, [anchorRect, records.length, popoverRef]);

  // Right-aligned to the header row, under the button, so the pointer reaches it within the close delay
  const left = Math.max(VIEWPORT_MARGIN, anchorRect.left, anchorRect.right - MAX_WIDTH);
  const width = Math.min(MAX_WIDTH, window.innerWidth - left - VIEWPORT_MARGIN);

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Recently closed in ${spaceName}`}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden text-gray-700 dark:text-gray-200"
      style={{ top, left, width, fontSize: `${fontSize}px` }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // React bubbles portal events to the header row's ancestors - keep clicks here
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-gray-400">
        Recently closed
      </div>

      <div className="max-h-80 overflow-y-auto py-1">
        {records.map(record => (
          <div
            key={record.id}
            role="button"
            title={record.url}
            className="flex items-center gap-2 mx-1 px-2 py-1.5 rounded-lg cursor-default select-none hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => onReopen(record)}
          >
            <img src={getFaviconUrl(record.url)} alt="" className="w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate">{record.title || record.url}</div>
              <div className="truncate text-xs text-gray-400">{formatRelativeTime(record.closedAt, now)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 py-1">
        <div
          role="button"
          className="flex items-center gap-2 mx-1 px-2 py-1.5 rounded-lg cursor-default select-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={onClear}
        >
          <Trash2 size={14} className="shrink-0" />
          <span>Clear</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
