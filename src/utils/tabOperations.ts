/**
 * Shared tab operations for drag-and-drop and other tab management.
 */

import { Space } from '../contexts/SpacesContext';
import { tabSpaceRegistryProxy } from '../managers/proxies/tabSpaceRegistryProxy';

/**
 * Move a tab to an extension Space without changing its user-owned Chrome group.
 *
 * @param tabId - The Chrome tab ID to move
 * @param spaceId - The space ID to move to ('all' to ungroup)
 * @param spaces - Array of available spaces (excluding 'all')
 * @param windowId - The Chrome window containing the Tab
 * @returns Object with success status and optional error/toast message
 */
export async function moveTabToSpace(
  tabId: number,
  spaceId: string,
  spaces: readonly Space[],
  windowId: number
): Promise<{ success: boolean; message?: string; error?: string }>
{
  try
  {
    // Legacy All action: only clears the internal Space record and leaves native tab groups alone.
    if (spaceId === 'all')
    {
      await tabSpaceRegistryProxy.unregister(windowId, tabId);
      return { success: true, message: 'Removed from Space' };
    }

    const space = spaces.find(s => s.id === spaceId);
    if (!space)
    {
      return { success: false, error: 'Space not found' };
    }

    await tabSpaceRegistryProxy.register(windowId, tabId, space.id);

    return { success: true, message: `Moved to ${space.name}` };
  }
  catch (error)
  {
    if (import.meta.env.DEV)
    {
      console.error('[moveTabToSpace] Failed:', error);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Re-group a bookmark's associated live tab (if any) to match its new
 * folder's Space - keeps "a bookmark tab always lives in its bookmark's
 * Space" true regardless of how the bookmark got there (created, dragged
 * in, or moved afterward). No-op if the bookmark has no live tab, or if the
 * destination folder isn't under any Space.
 *
 * @param bookmarkId - The bookmark whose live tab (if any) should follow
 * @param targetFolderId - The folder the bookmark just moved into
 * @param getTabIdForBookmark - From useBookmarkTabsContext()
 * @param windowId - From useSpacesContext()
 * @param findSpaceForFolder - From useFindSpaceForFolder()
 */
export async function regroupAssociatedTab(
  bookmarkId: string,
  targetFolderId: string,
  getTabIdForBookmark: (bookmarkId: string) => number | undefined,
  windowId: number | null,
  findSpaceForFolder: (folderId: string) => Promise<Space | undefined>
): Promise<void>
{
  const tabId = getTabIdForBookmark(bookmarkId);
  if (tabId === undefined || !windowId) return;

  const targetSpace = await findSpaceForFolder(targetFolderId);
  if (!targetSpace) return;

  await tabSpaceRegistryProxy.register(windowId, tabId, targetSpace.id);
}

/**
 * Create a new tab from a URL, optionally adding it to a group.
 *
 * @param url - The URL to open
 * @param windowId - The window to create the tab in
 * @param groupId - Optional group ID to add the tab to
 * @returns The created tab or null on failure
 */
export async function createTabFromUrl(
  url: string,
  windowId?: number,
  groupId?: number
): Promise<chrome.tabs.Tab | null>
{
  try
  {
    const tab = await chrome.tabs.create({
      url,
      active: false,
      windowId
    });

    if (tab.id && groupId)
    {
      await chrome.tabs.group({ tabIds: [tab.id], groupId });
    }

    return tab;
  }
  catch (error)
  {
    if (import.meta.env.DEV)
    {
      console.error('[createTabFromUrl] Failed:', error);
    }
    return null;
  }
}

/**
 * Create a new tab in a specific space.
 * Creates or finds the space's Chrome group and adds the new tab to it.
 *
 * @param url - The URL to open
 * @param spaceId - The space to create the tab in
 * @param spaces - Array of available spaces
 * @param windowId - The window to create the tab in
 * @returns Object with success status and the created tab
 */
export async function createTabInSpace(
  url: string,
  spaceId: string,
  spaces: readonly Space[],
  windowId: number
): Promise<{ success: boolean; tab?: chrome.tabs.Tab; error?: string }>
{
  try
  {
    // Create the tab first
    const tab = await chrome.tabs.create({
      url,
      active: false,
      windowId
    });

    if (!tab.id)
    {
      return { success: false, error: 'Failed to create tab' };
    }

    // If "all" space, just create without grouping
    if (spaceId === 'all')
    {
      return { success: true, tab };
    }

    // Move to space's group
    const result = await moveTabToSpace(tab.id, spaceId, spaces, windowId);
    if (!result.success)
    {
      return { success: false, tab, error: result.error };
    }

    return { success: true, tab };
  }
  catch (error)
  {
    if (import.meta.env.DEV)
    {
      console.error('[createTabInSpace] Failed:', error);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
