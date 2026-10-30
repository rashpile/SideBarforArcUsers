/**
 * FolderRecentPopover - Arc-style peek on a bookmark folder, opened from the
 * search button in the folder row. Lists the folder's bookmarks by last-active
 * time, with a search field.
 */
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import clsx from 'clsx';
import { useFontSize } from '../contexts/FontSizeContext';
import { useEscapeKey } from './menu/MenuBase';
import { getFaviconUrl } from '../utils/favicon';
import { BookmarkRecency } from '../stores/bookmarkRecencyStore';
import {
  collectFolderBookmarks,
  selectFolderRecentItems,
  formatRelativeTime,
} from '../utils/folderRecentItems';

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 150;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const MAX_WIDTH = 360;

// --- Hover state ---

export interface FolderPeek
{
  /** Folder row rect while the popover is open, null when closed. */
  anchorRect: DOMRect | null;
  /** Attached to the popover so scrolling inside it doesn't close it. */
  popoverRef: React.RefObject<HTMLDivElement>;
  triggerHandlers: {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
  };
  popoverHandlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
  close: () => void;
}

/**
 * Opens after the pointer rests on the trigger button, or at once on a click,
 * and stays open while the pointer travels between the button and the popover.
 */
export function useFolderPeek(enabled: boolean): FolderPeek
{
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() =>
  {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() =>
  {
    clearTimers();
    setAnchorRect(null);
  }, [clearTimers]);

  const scheduleClose = useCallback(() =>
  {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setAnchorRect(null), CLOSE_DELAY_MS);
  }, []);

  const cancelClose = useCallback(() =>
  {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  // Starting a drag or leaving Arc mode closes the peek
  useEffect(() =>
  {
    if (!enabled) close();
  }, [enabled, close]);

  // The anchor rect goes stale once the tree scrolls, so close instead of drifting
  useEffect(() =>
  {
    if (!anchorRect) return;
    const handleScroll = (e: Event) =>
    {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [anchorRect, close]);

  useEffect(() => clearTimers, [clearTimers]);

  // Anchor to the folder row, not the button: a popover hung off a button at
  // the row's right edge would run off a narrow sidebar
  const anchorOf = (trigger: HTMLElement) =>
    trigger.closest<HTMLElement>('[data-bookmark-id]') ?? trigger;

  const triggerHandlers: FolderPeek['triggerHandlers'] = {
    onPointerEnter: (e) =>
    {
      cancelClose();
      if (!enabled || anchorRect || openTimer.current) return;
      const anchor = anchorOf(e.currentTarget);
      openTimer.current = setTimeout(() =>
      {
        openTimer.current = null;
        setAnchorRect(anchor.getBoundingClientRect());
      }, OPEN_DELAY_MS);
    },
    onPointerLeave: scheduleClose,
    onClick: (e) =>
    {
      // The row's click toggles the folder
      e.stopPropagation();
      if (!enabled) return;
      cancelClose();
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = null;
      // Already open (often from the hover a moment ago): keep it, a toggle would close it
      if (anchorRect) return;
      setAnchorRect(anchorOf(e.currentTarget).getBoundingClientRect());
    },
  };

  const popoverHandlers = {
    onPointerEnter: cancelClose,
    onPointerLeave: scheduleClose,
  };

  return { anchorRect, popoverRef, triggerHandlers, popoverHandlers, close };
}

// --- Popover ---

interface FolderRecentPopoverProps
{
  folder: chrome.bookmarks.BookmarkTreeNode;
  anchorRect: DOMRect;
  popoverRef: React.RefObject<HTMLDivElement>;
  recency: BookmarkRecency;
  onOpenBookmark: (bookmark: chrome.bookmarks.BookmarkTreeNode, e: React.MouseEvent | React.KeyboardEvent) => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export const FolderRecentPopover = ({
  folder,
  anchorRect,
  popoverRef,
  recency,
  onOpenBookmark,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: FolderRecentPopoverProps) =>
{
  const fontSize = useFontSize();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [top, setTop] = useState(anchorRect.bottom + ANCHOR_GAP);

  useEscapeKey(true, onClose);

  const bookmarks = useMemo(() => collectFolderBookmarks(folder), [folder]);
  const items = useMemo(
    () => selectFolderRecentItems(bookmarks, recency, query),
    [bookmarks, recency, query]
  );
  const now = Date.now();

  // Focus the search field for type-to-search, unless the user is already typing elsewhere
  useEffect(() =>
  {
    const focused = document.activeElement;
    const isTypingElsewhere = focused instanceof HTMLInputElement
      || focused instanceof HTMLTextAreaElement
      || (focused instanceof HTMLElement && focused.isContentEditable);
    if (!isTypingElsewhere) inputRef.current?.focus();
  }, []);

  // A new query starts highlighting from the top row again
  useEffect(() =>
  {
    setHighlightIndex(0);
  }, [query]);

  // Below the folder row; flip above it when the panel has no room below
  useLayoutEffect(() =>
  {
    const height = popoverRef.current?.getBoundingClientRect().height ?? 0;
    const below = anchorRect.bottom + ANCHOR_GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    const above = anchorRect.top - ANCHOR_GAP - height;
    const pinnedToBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);

    // No room below: prefer above the row, otherwise pin to the panel's bottom edge
    if (fitsBelow) setTop(below);
    else setTop(above >= VIEWPORT_MARGIN ? above : pinnedToBottom);
  }, [anchorRect, items.length, popoverRef]);

  // Right-aligned to the row when the row is wider than the popover, so it sits
  // under the search button at the row's right edge and the pointer can reach it
  // within the close delay; a narrower row keeps the popover at the row's left
  const left = Math.max(VIEWPORT_MARGIN, anchorRect.left, anchorRect.right - MAX_WIDTH);
  const width = Math.min(MAX_WIDTH, window.innerWidth - left - VIEWPORT_MARGIN);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) =>
  {
    // Up/Down move the highlighted row, Enter opens it; other keys edit the query
    if (e.key === 'ArrowDown')
    {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, items.length - 1));
    }
    else if (e.key === 'ArrowUp')
    {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    }
    else if (e.key === 'Enter' && items[highlightIndex])
    {
      e.preventDefault();
      onOpenBookmark(items[highlightIndex].bookmark, e);
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Recent pages in ${folder.title}`}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden text-gray-700 dark:text-gray-200"
      style={{ top, left, width, fontSize: `${fontSize}px` }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // React bubbles portal events to the folder row's ancestors - keep clicks here
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <Search size={14} className="shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Search ${folder.title}...`}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder-gray-400"
        />
      </div>

      <div className="max-h-80 overflow-y-auto py-1">
        {items.length === 0 && (
          <div className="px-3 py-2 text-gray-400">
            {query.trim() ? 'No matching pages' : 'No recently opened pages'}
          </div>
        )}
        {items.map(({ bookmark, lastActiveAt }, index) => (
          <div
            key={bookmark.id}
            role="button"
            title={bookmark.url}
            className={clsx(
              "flex items-center gap-2 mx-1 px-2 py-1.5 rounded-lg cursor-default select-none",
              index === highlightIndex && "bg-gray-100 dark:bg-gray-700"
            )}
            onPointerMove={() => setHighlightIndex(index)}
            onClick={(e) => onOpenBookmark(bookmark, e)}
          >
            <img src={getFaviconUrl(bookmark.url!)} alt="" className="w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate">{bookmark.title || bookmark.url}</div>
              {lastActiveAt !== undefined && (
                <div className="truncate text-xs text-gray-400">{formatRelativeTime(lastActiveAt, now)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
};
