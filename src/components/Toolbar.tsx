import { Settings, Volume2, RotateCcwSquare, RotateCwSquare, Search, Sparkles } from 'lucide-react';
import React, { forwardRef, useState, useRef, useEffect, useCallback } from 'react';
import * as DropdownMenu from './menu/DropdownMenu';
import { useShowActiveTab } from '../hooks/useFollowActiveTab';
import { useSpacesContext } from '../contexts/SpacesContext';
import { tabHistoryManagerProxy } from '../managers/proxies/tabHistoryManagerProxy';
import { TabHistoryItem } from '../managers/shared/tabHistoryManagerApi';
import { ToolbarLayout } from '../utils/toolbarLayout';

interface ToolbarProps
{
  orientation: ToolbarLayout;
  onAudioDialogOpen: () => void;
  // When defined, enables long-press mode: quick click jumps to the latest audio tab, hold opens the list
  onAudioTabJump?: () => void;
  onMenuToggle: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement>;
  audioButtonRef?: React.RefObject<HTMLButtonElement>;
  // The search rows themselves are FilterBar; this only drives the toggle button and the bottom border
  showFilterArea?: boolean;
  onToggleFilterArea?: () => void;
  pageAgentOpen?: boolean;
  onTogglePageAgent?: () => void;
}


// Custom icon for the "show active tab" button: indented tree rows with a
// gutter arrow pointing at the active child row. Same 24x24 stroke-2 rounded
// style as the lucide icons around it.
const TreeGutterIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 5h16" />
    <path d="M11 12h9" />
    <path d="M11 19h9" />
    <path d="M3 12h3" />
    <path d="m4.5 9.5 2.5 2.5-2.5 2.5" />
  </svg>
);

export const Toolbar = forwardRef<HTMLButtonElement, ToolbarProps>(({
  orientation,
  onAudioDialogOpen,
  onAudioTabJump,
  onMenuToggle,
  menuButtonRef,
  audioButtonRef,
  showFilterArea = false,
  onToggleFilterArea,
  pageAgentOpen = false,
  onTogglePageAgent,
}, _ref) =>
{
  const activeButtonClass = 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 active:bg-blue-200 dark:active:bg-blue-800';
  const inactiveButtonClass = 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-500';

  // Both layouts keep the same elements and only swap classes, so changing the setting remounts nothing
  const vertical = orientation === 'vertical';
  const menuSide: DropdownMenu.DropdownSide = vertical ? 'right' : 'bottom';
  const separatorClass = vertical
    ? 'h-px w-4 bg-gray-300 dark:bg-gray-600 my-0.5'
    : 'w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5';

  // "Show active tab" button: switch to the active tab's space and scroll to it
  const showActiveTab = useShowActiveTab();

  // This sidebar's own window. Every tab-history call names it explicitly, so
  // background never has to guess which window the request came from.
  const { windowId } = useSpacesContext();

  // Tab history navigation shortcuts
  const [prevTabShortcut, setPrevTabShortcut] = useState<string>('');
  const [nextTabShortcut, setNextTabShortcut] = useState<string>('');

  // Tab history dropdown state. The row type is the manager's own
  // TabHistoryItem, so the dropdown and getHistoryDetails share one
  // declaration instead of two copies that can drift.
  const [historyDropdown, setHistoryDropdown] = useState<'prev' | 'next' | null>(null);
  const [historyBefore, setHistoryBefore] = useState<TabHistoryItem[]>([]);
  const [historyAfter, setHistoryAfter] = useState<TabHistoryItem[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // Long-press state for the audio button (used when onAudioTabJump is provided)
  const audioHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioIsLongPressRef = useRef(false);

  const handleAudioMouseDown = useCallback((e: React.MouseEvent) =>
  {
    if (e.button !== 0 || !onAudioTabJump) return;
    audioIsLongPressRef.current = false;
    audioHoldTimerRef.current = setTimeout(() =>
    {
      audioIsLongPressRef.current = true;
      onAudioDialogOpen();
    }, 400);
  }, [onAudioDialogOpen, onAudioTabJump]);

  const handleAudioMouseUp = useCallback(() =>
  {
    if (!onAudioTabJump) return;
    if (audioHoldTimerRef.current)
    {
      clearTimeout(audioHoldTimerRef.current);
      audioHoldTimerRef.current = null;
    }
    if (!audioIsLongPressRef.current)
    {
      onAudioTabJump();
    }
  }, [onAudioTabJump]);

  const handleAudioMouseLeave = useCallback(() =>
  {
    if (audioHoldTimerRef.current)
    {
      clearTimeout(audioHoldTimerRef.current);
      audioHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() =>
  {
    chrome.commands.getAll((commands) =>
    {
      for (const cmd of commands)
      {
        if (cmd.name === 'prev-used-tab' && cmd.shortcut)
        {
          setPrevTabShortcut(cmd.shortcut);
        }
        else if (cmd.name === 'next-used-tab' && cmd.shortcut)
        {
          setNextTabShortcut(cmd.shortcut);
        }
      }
    });
  }, []);

  // Tab history navigation handlers
  const handlePrevUsedTab = useCallback(() =>
  {
    if (windowId === null) return;
    tabHistoryManagerProxy.navigate(windowId, -1);
  }, [windowId]);

  const handleNextUsedTab = useCallback(() =>
  {
    if (windowId === null) return;
    tabHistoryManagerProxy.navigate(windowId, 1);
  }, [windowId]);

  // Fetch tab history for dropdown
  const fetchTabHistory = useCallback(async () =>
  {
    if (windowId === null) return;
    const details = await tabHistoryManagerProxy.getHistoryDetails(windowId);
    setHistoryBefore(details.before || []);
    setHistoryAfter(details.after || []);
  }, [windowId]);

  // Handle click-and-hold for history dropdown
  const handleHistoryMouseDown = useCallback((direction: 'prev' | 'next') =>
  {
    // If dropdown is already showing, dismiss it and don't start timer
    // (similar to Chrome's back/forward buttons behavior)
    if (historyDropdown !== null)
    {
      setHistoryDropdown(null);
      return;
    }

    // Clear any existing timer
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
    }

    // Start hold timer (300ms to show dropdown)
    holdTimerRef.current = setTimeout(() =>
    {
      fetchTabHistory();
      setHistoryDropdown(direction);
      holdTimerRef.current = null;
    }, 300);
  }, [fetchTabHistory, historyDropdown]);

  const handleHistoryMouseUp = useCallback((direction: 'prev' | 'next') =>
  {
    // If timer is still running, it was a quick click - navigate
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (direction === 'prev')
      {
        handlePrevUsedTab();
      }
      else
      {
        handleNextUsedTab();
      }
    }
    // If timer already fired or dropdown was just dismissed - don't navigate
  }, [handlePrevUsedTab, handleNextUsedTab]);

  const handleHistoryMouseLeave = useCallback(() =>
  {
    // Cancel hold timer if mouse leaves before it fires
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Navigate to specific history item
  const handleHistoryItemClick = useCallback((index: number) =>
  {
    if (windowId !== null)
    {
      tabHistoryManagerProxy.navigateToIndex(windowId, index);
    }
    setHistoryDropdown(null);
  }, [windowId]);

  return (
    <div
      className={
        vertical
          ? 'arc-toolbar arc-toolbar-vertical flex flex-col items-center gap-1 border-r border-gray-200 dark:border-gray-700'
          : `arc-toolbar arc-toolbar-row flex items-center justify-between ${
            showFilterArea ? '' : 'border-b border-gray-200 dark:border-gray-700'
          }`
      }
    >
      {/* Tab history and Filter buttons: left side of the row, top of the strip */}
      <div className={`flex items-center gap-1 ${vertical ? 'flex-col' : ''}`}>
        {/* Tab history navigation - Previous */}
        <DropdownMenu.Root
          open={historyDropdown === 'prev'}
          onOpenChange={(open) => !open && setHistoryDropdown(null)}
          anchorRef={prevButtonRef}
        >
          <button
            ref={prevButtonRef}
            onMouseDown={() => handleHistoryMouseDown('prev')}
            onMouseUp={() => handleHistoryMouseUp('prev')}
            onMouseLeave={handleHistoryMouseLeave}
            title={`Previous used tab${prevTabShortcut ? ` (${prevTabShortcut})` : ''}\nHold for history`}
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
              historyDropdown === 'prev' ? activeButtonClass : inactiveButtonClass
            }`}
          >
            <RotateCcwSquare size={16} className="-rotate-90" />
          </button>

          <DropdownMenu.Content side={menuSide} className="min-w-48 max-w-72 max-h-64 overflow-y-auto">
            {historyBefore.length > 0 ? (
              historyBefore.map((item) => (
                <DropdownMenu.Item
                  key={item.tabId}
                  onSelect={() => handleHistoryItemClick(item.index)}
                >
                  {item.favIconUrl ? (
                    <img src={item.favIconUrl} alt="" className="w-4 h-4 flex-shrink-0 mr-2" />
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0 bg-gray-300 dark:bg-gray-600 rounded mr-2" />
                  )}
                  <span className="truncate">{item.title}</span>
                </DropdownMenu.Item>
              ))
            ) : (
              <div className="px-3 py-2 text-gray-500 dark:text-gray-400">
                No previous tabs
              </div>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* Tab history navigation - Next */}
        <DropdownMenu.Root
          open={historyDropdown === 'next'}
          onOpenChange={(open) => !open && setHistoryDropdown(null)}
          anchorRef={nextButtonRef}
        >
          <button
            ref={nextButtonRef}
            onMouseDown={() => handleHistoryMouseDown('next')}
            onMouseUp={() => handleHistoryMouseUp('next')}
            onMouseLeave={handleHistoryMouseLeave}
            title={`Next used tab${nextTabShortcut ? ` (${nextTabShortcut})` : ''}\nHold for history`}
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
              historyDropdown === 'next' ? activeButtonClass : inactiveButtonClass
            }`}
          >
            <RotateCwSquare size={16} className="rotate-90" />
          </button>

          <DropdownMenu.Content side={menuSide} className="min-w-48 max-w-72 max-h-64 overflow-y-auto">
            {historyAfter.length > 0 ? (
              historyAfter.map((item) => (
                <DropdownMenu.Item
                  key={item.tabId}
                  onSelect={() => handleHistoryItemClick(item.index)}
                >
                  {item.favIconUrl ? (
                    <img src={item.favIconUrl} alt="" className="w-4 h-4 flex-shrink-0 mr-2" />
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0 bg-gray-300 dark:bg-gray-600 rounded mr-2" />
                  )}
                  <span className="truncate">{item.title}</span>
                </DropdownMenu.Item>
              ))
            ) : (
              <div className="px-3 py-2 text-gray-500 dark:text-gray-400">
                No next tabs
              </div>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* Separator */}
        <div className={separatorClass} />

        {/* Audio dialog button */}
        <button
          ref={audioButtonRef}
          onClick={onAudioTabJump ? undefined : onAudioDialogOpen}
          onMouseDown={onAudioTabJump ? handleAudioMouseDown : undefined}
          onMouseUp={onAudioTabJump ? handleAudioMouseUp : undefined}
          onMouseLeave={onAudioTabJump ? handleAudioMouseLeave : undefined}
          title={onAudioTabJump ? 'Click to jump to audio tab · Hold to show list' : 'Show tabs playing audio/video'}
          className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${inactiveButtonClass}`}
        >
          <Volume2 size={16} />
        </button>

        {/* Scroll to active tab button */}
        <button
          onClick={showActiveTab}
          title="Show active tab"
          className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${inactiveButtonClass}`}
        >
          <TreeGutterIcon size={16} />
        </button>

        {/* Separator */}
        <div className={separatorClass} />

        {/* Toggle search bar button */}
        {onToggleFilterArea && (
          <button
            onClick={onToggleFilterArea}
            title={showFilterArea ? "Hide search bar" : "Show search bar"}
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
              showFilterArea ? activeButtonClass : inactiveButtonClass
            }`}
          >
            <Search size={16} />
          </button>
        )}

        {onTogglePageAgent && (
          <button
            onClick={onTogglePageAgent}
            title="Page agent (experimental)"
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
              pageAgentOpen ? activeButtonClass : inactiveButtonClass
            }`}
          >
            <Sparkles size={16} />
          </button>
        )}

      </div>

      {/* Settings gear button: far right of the row, bottom of the strip */}
      <div className={`relative ${vertical ? 'mt-auto' : ''}`}>
        <button
          ref={menuButtonRef}
          onClick={onMenuToggle}
          title="Menu"
          className={`p-1.5 rounded transition-all duration-150 ${inactiveButtonClass}`}
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
});

Toolbar.displayName = 'Toolbar';
