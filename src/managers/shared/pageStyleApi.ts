// The wire contract for PageStyleManager, owned by neither side.
//
// impl/pageStyleManager.ts implements PageStyleApi;
// proxies/pageStyleProxy.ts implements Remote<PageStyleApi>.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting.ts';
import type { StoredPageStyle, StoredPageStyles } from '../../stores/savedPageStyles.ts';

export const BOOKMARK_PAGE_STYLES_KEY = 'bookmarkPageStyles';

/** The saved page styles by bookmark id, as the sidebar sees them (SavedPageStyles.fromStored reads it). */
export interface PageStylesState
{
  styles: StoredPageStyles;
}

/**
 * The subset of PageStyleManager the sidebar can call. Every method returns
 * the resulting state, which the proxy uses to resync once its in-flight
 * writes drain.
 */
export interface PageStyleApi
{
  /**
   * Saves the CSS to the bookmark for pages on `pageUrl`'s origin. Rejects with the reason when
   * the CSS fails the page agent's sanitizer or the page isn't http(s). A new record starts with
   * Auto-apply on; an update keeps the bookmark's choice.
   */
  save(bookmarkId: string, css: string, pageUrl: string): Promise<PageStylesState>;
  setAutoApply(bookmarkId: string, on: boolean): Promise<PageStylesState>;
  remove(bookmarkId: string): Promise<PageStylesState>;
  /**
   * Puts a deleted bookmark's record, unchanged, onto the bookmark Undo created in its place.
   * Rejects a malformed record and CSS that fails the sanitizer.
   */
  restore(bookmarkId: string, style: StoredPageStyle): Promise<PageStylesState>;
  getState(): PageStylesState;
}

/** Broadcast to every listening context when the styles change, with the full state and the requester's senderId. */
export const PAGE_STYLES_CHANGED = makeManagerActionId(ManagerId.PAGE_STYLES, 'changed');
