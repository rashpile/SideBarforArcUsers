import { useCallback, useState } from 'react';
import { useSpacesContext, Space } from '../contexts/SpacesContext';
import { useBookmarkTabsContext } from '../contexts/BookmarkTabsContext';
import { useAttentionMarks } from './useAttentionMarks';
import { CloseTabAction } from '../actions/closeTabAction';
import type { UndoableAction } from '../actions/types';

/** The confirmation asked before closing every tab of the window; feeds a ConfirmDeleteDialog. */
export interface CloseAllTabsConfirmation
{
  isOpen: boolean;
  tabCount: number;
  confirm: () => void;
  cancel: () => void;
}

export interface CloseAllTabsInSpace
{
  closeAllTabs: (space: Space) => Promise<void>;
  confirmation: CloseAllTabsConfirmation;
}

/**
 * "Close All Tabs In Space" of the Space menus (Space title, Space bar icons, Task Space lists).
 * Marked tabs stay open. Closing every tab of the window would close the window, which Undo can't
 * bring back, so that case waits for the confirmation instead of closing at once.
 */
export function useCloseAllTabsInSpace(onPerformAction?: (action: UndoableAction) => Promise<void>): CloseAllTabsInSpace
{
  const { getTabIdsInSpace, windowId } = useSpacesContext();
  const { getItemKeyForTab, restoreItemAssociation } = useBookmarkTabsContext();
  const { isTabMarked } = useAttentionMarks();
  const [pendingTabIds, setPendingTabIds] = useState<number[]>([]);

  const closeAllTabs = useCallback(async (space: Space) =>
  {
    if (!windowId) return;

    // Marked tabs stay open; filtered before the whole-window check so it sees what really closes
    const tabIds = (await getTabIdsInSpace(space)).filter(id => !isTabMarked(id));
    if (tabIds.length === 0) return;

    const allTabs = await chrome.tabs.query({ windowId });
    const remaining = allTabs.filter(t => t.id !== undefined && !tabIds.includes(t.id));
    if (remaining.length === 0)
    {
      setPendingTabIds(tabIds);
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
  }, [onPerformAction, windowId, getTabIdsInSpace, isTabMarked, getItemKeyForTab, restoreItemAssociation]);

  // No undo here: the window closes with its last tab
  const confirm = useCallback(() =>
  {
    if (pendingTabIds.length > 0)
    {
      chrome.tabs.remove(pendingTabIds);
    }
    setPendingTabIds([]);
  }, [pendingTabIds]);

  const cancel = useCallback(() => setPendingTabIds([]), []);

  return {
    closeAllTabs,
    confirmation: { isOpen: pendingTabIds.length > 0, tabCount: pendingTabIds.length, confirm, cancel },
  };
}
