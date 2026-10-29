// Where a tab opened from a link goes in its window's tab strip.
//
// Chrome puts it right after its opener. When the opener is a bookmark's or a
// Favorite's tab, that opener is hidden from the Tab list and sits anywhere in
// the strip, so the new tab would land at a random spot in the list. Such tabs
// go to the top of the Tab list instead. A tab opened from a regular tab stays
// next to its opener, which the list shows.

import { BOOKMARK_ITEM_KEY_PREFIX, FAVORITE_ITEM_KEY_PREFIX } from './tabAssociations.ts';

/** The fields of chrome.tabs.Tab the placement reads. */
export interface PlacedTab
{
  id?: number;
  index: number;
  pinned?: boolean;
}

function isHiddenFromTabList(itemKey: string | undefined): boolean
{
  return itemKey !== undefined
    && (itemKey.startsWith(BOOKMARK_ITEM_KEY_PREFIX) || itemKey.startsWith(FAVORITE_ITEM_KEY_PREFIX));
}

/**
 * The strip index that puts `newTab` at the top of the Tab list, or undefined
 * when it stays where Chrome put it: its opener is a regular tab (or unknown),
 * it is already on top, or no other Tab list tab exists. Chrome-pinned tabs
 * stay first, so the top is the first unpinned Tab list tab.
 *
 * @param openerItemKey the opener's association key (`bookmark-…`, `pinned-…`), undefined for a regular tab
 * @param tabListTabs the tabs the Tab list shows in this window and Space, the new tab included or not
 */
export function tabListTopIndexForLinkTab(
  newTab: { id: number; index: number },
  openerItemKey: string | undefined,
  tabListTabs: readonly PlacedTab[]
): number | undefined
{
  if (!isHiddenFromTabList(openerItemKey)) return undefined;

  const others = tabListTabs.filter(tab => tab.id !== newTab.id && !tab.pinned);
  if (others.length === 0) return undefined;

  const topIndex = Math.min(...others.map(tab => tab.index));
  return newTab.index > topIndex ? topIndex : undefined;
}
