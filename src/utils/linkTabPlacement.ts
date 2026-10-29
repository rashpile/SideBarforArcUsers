// Where a tab opened from a link goes in its window's tab strip.
//
// Chrome puts it right after its opener. When the opener is a bookmark's or a
// Favorite's tab, that opener is hidden from the Tab list and sits anywhere in
// the strip, so the new tab would land at a random spot in the list. Such tabs
// go to the top of the Tab list instead. A tab opened from a regular tab stays
// next to its opener, which the list shows.
//
// Chrome also names the active tab as the opener of a tab it appends at the end
// of the strip (Cmd+T, the + button, Alt+Enter in the address bar). Those
// already land in a predictable place, so only a tab Chrome put right after its
// opener is moved.

import { BOOKMARK_ITEM_KEY_PREFIX, FAVORITE_ITEM_KEY_PREFIX } from './tabAssociations.ts';

/** The fields of chrome.tabs.Tab the placement reads. */
export interface PlacedTab
{
  id?: number;
  index: number;
  groupId?: number;
  pinned?: boolean;
}

/** The new tab's opener: its strip index and its association key (`bookmark-…`, `pinned-…`), undefined for a regular tab. */
export interface LinkTabOpener
{
  index: number;
  itemKey: string | undefined;
}

function isHiddenFromTabList(itemKey: string | undefined): boolean
{
  return itemKey !== undefined
    && (itemKey.startsWith(BOOKMARK_ITEM_KEY_PREFIX) || itemKey.startsWith(FAVORITE_ITEM_KEY_PREFIX));
}

function isGrouped(tab: PlacedTab): boolean
{
  return tab.groupId !== undefined && tab.groupId !== -1;
}

/**
 * The strip index that puts `newTab` at the top of the Tab list, or undefined
 * when it stays where Chrome put it: its opener is a regular tab, Chrome did not
 * put it right after the opener, it is already on top, or no other Tab list tab
 * exists. Chrome-pinned tabs stay first, so the top is the first unpinned Tab
 * list tab. When that tab is in a Chrome group, the new tab goes before the
 * whole group, hidden members included, so Chrome doesn't add it to the group.
 *
 * @param windowTabs every tab of the window's strip
 * @param tabListTabIds the tabs the Tab list shows in this window and Space
 */
export function tabListTopIndexForLinkTab(
  newTab: { id: number; index: number },
  opener: LinkTabOpener,
  windowTabs: readonly PlacedTab[],
  tabListTabIds: ReadonlySet<number>
): number | undefined
{
  if (!isHiddenFromTabList(opener.itemKey) || opener.index !== newTab.index - 1) return undefined;

  const others = windowTabs.filter(tab => tab.id !== undefined
    && tab.id !== newTab.id
    && tabListTabIds.has(tab.id)
    && !tab.pinned);
  if (others.length === 0) return undefined;

  const top = others.reduce((first, tab) => (tab.index < first.index ? tab : first));
  const topIndex = isGrouped(top)
    ? Math.min(...windowTabs.filter(tab => tab.groupId === top.groupId).map(tab => tab.index))
    : top.index;
  return newTab.index > topIndex ? topIndex : undefined;
}
