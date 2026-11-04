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
   * Saves the CSS and script to the bookmark for pages on `pageUrl`'s origin; either may be empty,
   * not both. `cssByUser` marks CSS from the user's code editor, which is only held to the size
   * cap. Rejects with the reason when the CSS fails its check (the page agent's sanitizer unless
   * `cssByUser`), the script is too large or the page isn't http(s). A new record starts with
   * Auto-apply on; an update keeps the bookmark's choice.
   */
  save(bookmarkId: string, css: string, script: string, pageUrl: string, cssByUser: boolean): Promise<PageStylesState>;
  setAutoApply(bookmarkId: string, on: boolean): Promise<PageStylesState>;
  remove(bookmarkId: string): Promise<PageStylesState>;
  /**
   * Puts a deleted bookmark's record, unchanged, onto the bookmark Undo created in its place.
   * Rejects a malformed record, CSS that fails its check (by the record's `cssByUser`) and a script
   * that is too large.
   */
  restore(bookmarkId: string, style: StoredPageStyle): Promise<PageStylesState>;
  getState(): PageStylesState;
}

/** Broadcast to every listening context when the styles change, with the full state and the requester's senderId. */
export const PAGE_STYLES_CHANGED = makeManagerActionId(ManagerId.PAGE_STYLES, 'changed');
