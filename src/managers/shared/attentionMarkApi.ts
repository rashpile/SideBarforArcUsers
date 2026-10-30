// The wire contract for AttentionMarkManager, owned by neither side.
//
// impl/attentionMarkManager.ts implements AttentionMarkApi;
// proxies/attentionMarkProxy.ts implements Remote<AttentionMarkApi>.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting.ts';

export const ATTENTION_MARKED_TABS_KEY = 'attentionMarkedTabs';
export const ATTENTION_MARKED_BOOKMARKS_KEY = 'attentionMarkedBookmarks';

/** The marked tabs and bookmarks, as the sidebar sees them. */
export interface AttentionMarksState
{
  tabIds: number[];
  bookmarkIds: string[];
}

/**
 * The subset of AttentionMarkManager the sidebar can call. Every method
 * returns the resulting state, which the proxy uses to resync once its
 * in-flight writes drain.
 */
export interface AttentionMarkApi
{
  /** Marks the tabs at their current page and position; closed and incognito tabs are skipped. */
  markTabs(tabIds: number[]): Promise<AttentionMarksState>;
  clearTabs(tabIds: number[]): Promise<AttentionMarksState>;
  markBookmarks(ids: string[]): Promise<AttentionMarksState>;
  clearBookmarks(ids: string[]): Promise<AttentionMarksState>;
  getState(): AttentionMarksState;
}

/** Broadcast to every listening context when the marks change, with the full state and the requester's senderId. */
export const ATTENTION_MARKS_CHANGED = makeManagerActionId(ManagerId.ATTENTION_MARKS, 'changed');
