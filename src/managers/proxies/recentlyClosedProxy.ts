// Sidebar-side client for RecentlyClosedManager. The sidebar reads the list
// from chrome.storage.local itself, so this proxy only forwards the calls.

import { ManagerId, callManager, Remote } from './messageRouting';
import { RecentlyClosedApi, ClosedTabRecord } from '../shared/recentlyClosedApi';

export const recentlyClosedProxy: Remote<RecentlyClosedApi> = {
  async reopen(windowId: number, spaceId: string, recordId: string): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'reopen', { windowId, spaceId, recordId });
  },

  async clear(spaceId: string): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'clear', { spaceId });
  },

  async forgetReopened(spaceId: string, url: string): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'forgetReopened', { spaceId, url });
  },

  async spaceRecords(spaceId: string): Promise<ClosedTabRecord[]>
  {
    return callManager<ClosedTabRecord[]>(ManagerId.RECENTLY_CLOSED, 'spaceRecords', { spaceId });
  },

  async restoreSpace(spaceId: string, records: ClosedTabRecord[]): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'restoreSpace', { spaceId, records });
  },

  async expectArchiveClose(tabIds: number[]): Promise<void>
  {
    await callManager<void>(ManagerId.RECENTLY_CLOSED, 'expectArchiveClose', { tabIds });
  },
};
