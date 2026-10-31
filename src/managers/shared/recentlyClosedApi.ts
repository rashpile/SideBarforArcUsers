// The wire contract for RecentlyClosedManager, owned by neither side.
//
// impl/recentlyClosedManager.ts implements RecentlyClosedApi;
// proxies/recentlyClosedProxy.ts implements Remote<RecentlyClosedApi>.
// The sidebar reads the list itself, read-only, from chrome.storage.local, so
// there is no mirror store or broadcast for this manager.

import type { ClosedTabRecord } from '../../stores/recentlyClosedTabs.ts';

export type { ClosedTabRecord };

/** Stored as a JSON string of RecentlyClosedTabs.toStored(); parse it with RecentlyClosedTabs.fromStored. */
export const RECENTLY_CLOSED_TABS_KEY = 'recentlyClosedTabs';

/** The subset of RecentlyClosedManager the sidebar can call. */
export interface RecentlyClosedApi
{
  /** Opens the record's page as the active tab of `windowId`, puts it in the record's Space and drops the record. */
  reopen(windowId: number, spaceId: string, recordId: string): Promise<void>;
  clear(spaceId: string): Promise<void>;
  /** A closed tab of this page in this Space came back by Undo; its record goes. */
  forgetReopened(spaceId: string, url: string): Promise<void>;
  /** The Space's records, for a Space delete to keep for its Undo. */
  spaceRecords(spaceId: string): Promise<ClosedTabRecord[]>;
  /** Puts back records from spaceRecords after the Space itself is restored. */
  restoreSpace(spaceId: string, records: ClosedTabRecord[]): Promise<void>;
  /** The tabs are about to be closed by an Archive action; their close is not recorded. */
  expectArchiveClose(tabIds: number[]): void;
}
