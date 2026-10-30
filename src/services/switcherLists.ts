// The lists the keyboard switcher shows (see services/keyboardSwitcher.ts):
// the window's tabs in the current Space, and the Spaces, both most recently
// used first.

import type { Space } from '../utils/spaceMessages.ts';
import type { SwitcherCard } from '../utils/switcherMessages.ts';
import { getIconUrl } from '../utils/iconify.ts';
import { isEmoji } from '../utils/emoji.ts';

// chrome.tabs.Tab.lastAccessed (Chrome 121+) is missing from @types/chrome 0.0.260
export type TabWithLastAccess = chrome.tabs.Tab & { lastAccessed?: number };

// What the lists need to know about the window's Spaces
export interface WindowSpaces
{
  activeSpaceId: string | undefined;  // undefined when no Spaces are set up
  spaceOf(tabId: number): string | undefined;
}

// Per-Space tab count and most recently used tab in one window. A Favorite's
// tab counts for the Space it is registered in, like any other tab.
class SpaceUsage
{
  #spaces = new Map<string, { tabCount: number; lastUse: number; lastTabId: number }>();

  constructor(tabs: TabWithLastAccess[], spaces: WindowSpaces)
  {
    for (const tab of tabs)
    {
      if (tab.id === undefined) continue;
      const spaceId = spaces.spaceOf(tab.id);
      if (!spaceId) continue;

      const used = tab.lastAccessed ?? 0;
      const usage = this.#spaces.get(spaceId);
      if (!usage)
      {
        this.#spaces.set(spaceId, { tabCount: 1, lastUse: used, lastTabId: tab.id });
        continue;
      }
      usage.tabCount++;
      if (used > usage.lastUse)
      {
        usage.lastUse = used;
        usage.lastTabId = tab.id;
      }
    }
  }

  lastUse(spaceId: string): number
  {
    return this.#spaces.get(spaceId)?.lastUse ?? 0;
  }

  tabCount(spaceId: string): number
  {
    return this.#spaces.get(spaceId)?.tabCount ?? 0;
  }

  lastTabId(spaceId: string): number | undefined
  {
    return this.#spaces.get(spaceId)?.lastTabId;
  }
}

// The tab to open when the Space switcher picks a Space, as Arc does: the
// Space's most recently used tab in the window; undefined when it has none
export function findLastUsedTab(tabs: TabWithLastAccess[], spaceId: string, spaces: WindowSpaces): number | undefined
{
  return new SpaceUsage(tabs, spaces).lastTabId(spaceId);
}

function hostOf(url: string): string
{
  try { return new URL(url).host || url; }
  catch { return url; }
}

// The current tab first, then the current Space's tabs, most recently used first
export function buildTabCards(tabs: TabWithLastAccess[], spaces: WindowSpaces): SwitcherCard[]
{
  const inCurrentSpace = (tabId: number) =>
    spaces.activeSpaceId === undefined
    || spaces.spaceOf(tabId) === spaces.activeSpaceId;

  const ordered = [...tabs].sort((a, b) =>
    Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));

  return ordered.flatMap((tab) =>
  {
    if (tab.id === undefined || (!tab.active && !inCurrentSpace(tab.id))) return [];
    const url = tab.url || tab.pendingUrl || '';
    return [{
      id: String(tab.id),
      title: tab.title || url || '(no title)',
      subtitle: hostOf(url),
      faviconPageUrl: url,
      badge: tab.active ? 'current' : undefined,
    }];
  });
}

// The current Space first, then the others by their most recently used tab in
// this window; Spaces without tabs keep their sidebar order (sort is stable)
export function buildSpaceCards(
  spaceList: Space[],
  tabs: TabWithLastAccess[],
  spaces: WindowSpaces
): SwitcherCard[]
{
  const usage = new SpaceUsage(tabs, spaces);
  const isCurrent = (space: Space) => space.id === spaces.activeSpaceId;
  const ordered = [...spaceList].sort((a, b) =>
    Number(isCurrent(b)) - Number(isCurrent(a)) || usage.lastUse(b.id) - usage.lastUse(a.id));

  return ordered.map((space) =>
  {
    const count = usage.tabCount(space.id);
    const icon = isEmoji(space.icon)
      ? { iconText: space.icon }
      : { iconUrl: getIconUrl(space.icon), invertIconInDark: true };
    return {
      id: space.id,
      title: space.name,
      subtitle: count === 1 ? '1 tab' : `${count} tabs`,
      ...icon,
      badge: isCurrent(space) ? 'current' : undefined,
    };
  });
}
