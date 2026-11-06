// "Open bookmark" setting: how a click on a bookmark opens it.
// - 'arc': the bookmark keeps one tab of its own and a click goes back to it
// - 'newTab': each click opens a new tab
// - 'activeTab': a click loads the bookmark into the active tab
export type BookmarkOpenMode = 'arc' | 'newTab' | 'activeTab';

// chrome.storage.local key, stored as a raw string (not JSON). Written by App.tsx via
// useChromeLocalStorage; read by background.ts when the search popup opens a bookmark.
export const BOOKMARK_OPEN_MODE_KEY = 'sidebar-bookmark-open-mode';

export const DEFAULT_BOOKMARK_OPEN_MODE: BookmarkOpenMode = 'arc';

// Parse a stored value, falling back to the default for absent/unknown values. The setting was
// once a boolean: 'true' meant Arc-style bookmarks, 'false' a new tab per click.
export function parseBookmarkOpenMode(value: unknown): BookmarkOpenMode
{
  if (value === 'true') return 'arc';
  if (value === 'false') return 'newTab';
  if (value === 'arc' || value === 'newTab' || value === 'activeTab')
  {
    return value;
  }
  return DEFAULT_BOOKMARK_OPEN_MODE;
}
