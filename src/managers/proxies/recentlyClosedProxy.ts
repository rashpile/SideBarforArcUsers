// Sidebar-side client for RecentlyClosedManager. The sidebar reads the list
// from chrome.storage.local itself, so this proxy only forwards the calls.

import { ManagerId, callManager, Remote } from './messageRouting';
import { RecentlyClosedApi } from '../shared/recentlyClosedApi';

export const recentlyClosedProxy: Remote<RecentlyClosedApi> = {
  async reopen(windowId: number, spaceId: string, recordId: string): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'reopen', { windowId, spaceId, recordId });
  },

  async clear(spaceId: string): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'clear', { spaceId });
  },

  async expectArchiveClose(tabIds: number[]): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'expectArchiveClose', { tabIds });
  },
};
