// =============================================================================
// Search popup messages between background.ts, search.html and src/searchPopupFrame.ts
// =============================================================================

// The page connects with the port name `${SEARCH_POPUP_PORT_PREFIX}${sessionId}`, where sessionId
// comes from search.html?session=. Background accepts only the current session's port.
export const SEARCH_POPUP_PORT_PREFIX = 'search-popup:';

// Since Chrome 114 an open port alone doesn't keep the service worker running, only messages over
// it do, so the page pings well inside the worker's 30 s idle timeout.
export const SEARCH_POPUP_PING_MS = 20_000;

export type SearchScope = 'all' | 'tabs' | 'bookmarks' | 'archive' | 'closed';
export type SearchItemKind = 'tab' | 'bookmark' | 'archive' | 'closed';

// The order of the scope buttons, which Tab / Shift+Tab walk
export const SEARCH_SCOPES: readonly SearchScope[] = ['all', 'tabs', 'bookmarks', 'archive', 'closed'];

// One result row. The id is opaque: background maps it back to its own snapshot item, so the page
// never sends a tab id, URL or record that background acts on.
export interface SearchRow
{
  id: string;
  kind: SearchItemKind;
  title: string;
  subtitle: string;
  faviconPageUrl: string;
}

export interface SearchQuery
{
  text: string;
  scope: SearchScope;
  allSpaces: boolean;
}

// page -> background (port)
export type SearchPageMessage =
  | { type: 'query'; query: SearchQuery }
  | { type: 'pick'; rowId: string }
  | { type: 'searchWeb'; text: string }
  | { type: 'close'; reason: string }   // 'esc', 'blur', ...
  | { type: 'ping' };

// background -> page (port). Port messages arrive in order and each query is answered
// synchronously from the snapshot, so results need no sequence number.
export type SearchBackgroundMessage =
  | { type: 'init'; rows: SearchRow[]; steps: number; shortcut: string | undefined; hasSpaces: boolean }
  | { type: 'results'; rows: SearchRow[] }
  | { type: 'move'; steps: number };

// background <-> frame content script (tabs.sendMessage / runtime.sendMessage).
// searchPopupFrame.ts is injected as a classic script and can't import this file, so it repeats
// these strings and SEARCH_FRAME_CLOSE_REQUEST - change both together.
export const SearchFrameAction = {
  SHOW: 'search-frame-show',      // background -> frame script: draw the iframe, reply { shown }
  REMOVE: 'search-frame-remove',  // background -> frame script: remove the iframe, restore focus
  CLOSED: 'search-frame-closed',  // frame script -> background: the user closed it from the page
} as const;

// The popup page in the iframe -> the frame script (window.postMessage to the parent), sent when the
// page's port dropped and it can't ask background to remove the frame.
export const SEARCH_FRAME_CLOSE_REQUEST = 'search-frame-close-request';
