// "Search popup: one row per page" setting: results of the same page (same title, same
// scheme, host and path) show as one row in the search popup (services/searchResults.ts).
export type SearchCollapseDuplicatesSetting = 'on' | 'off';

// chrome.storage.local key, stored as a raw string (not JSON). Written by the Settings dialog
// via App.tsx; read by background.ts each time the search popup opens.
export const SEARCH_COLLAPSE_DUPLICATES_KEY = 'searchCollapseDuplicates';

export const DEFAULT_SEARCH_COLLAPSE_DUPLICATES: SearchCollapseDuplicatesSetting = 'on';

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseSearchCollapseDuplicates(value: unknown): SearchCollapseDuplicatesSetting
{
  return value === 'off' ? 'off' : DEFAULT_SEARCH_COLLAPSE_DUPLICATES;
}
