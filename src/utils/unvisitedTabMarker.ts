// "Mark unvisited tabs" setting: a dot marks Tab list rows of tabs opened in
// the background until the user first switches to them. Which new tab counts
// as unvisited is decided here when Chrome reports it (isOpenedUnvisited); the
// mark itself lives in the tab activity records (stores/tabActivityTracker.ts).

import { parseParkedTabUrl } from './parkedTabAssociation.ts';
import { SECOND_MS } from './time.ts';

export type UnvisitedTabMarkerSetting = 'on' | 'off';

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by background.ts
// (whether to record) and App.tsx (whether to show the dot).
export const UNVISITED_TAB_MARKER_KEY = 'markUnvisitedTabs';

export const DEFAULT_UNVISITED_TAB_MARKER: UnvisitedTabMarkerSetting = 'on';

// Chrome has no "restored" flag and doesn't restore lastAccessed, but it
// dispatches windows.onCreated a few ms before a restored window's tabs. Inactive
// tabs this close to their window's creation are taken as restored, not new.
const RESTORED_WINDOW_MS = 2 * SECOND_MS;

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseUnvisitedTabMarker(value: unknown): UnvisitedTabMarkerSetting
{
  return value === 'off' ? 'off' : DEFAULT_UNVISITED_TAB_MARKER;
}

/** Windows created in the last RESTORED_WINDOW_MS, kept in memory by the background. */
export class RecentWindows
{
  #createdAt = new Map<number, number>();

  markCreated(windowId: number, at: number): void
  {
    // Pruned here so the map stays bounded over a long browser session
    for (const [knownId, createdAt] of this.#createdAt)
    {
      if (at - createdAt > RESTORED_WINDOW_MS) this.#createdAt.delete(knownId);
    }
    this.#createdAt.set(windowId, at);
  }

  isJustCreated(windowId: number, now: number): boolean
  {
    const createdAt = this.#createdAt.get(windowId);
    return createdAt !== undefined && now - createdAt <= RESTORED_WINDOW_MS;
  }
}

/** The fields of a newly created tab that isOpenedUnvisited reads. */
interface NewTabLike
{
  active: boolean;
  windowId: number;
  url?: string;
  pendingUrl?: string;
}

/**
 * Whether a tab Chrome just reported as created was opened in the background
 * and should carry the unvisited mark. Not for tab suspender park pages (an
 * existing tab in another form) and tabs of a window created moments ago (a
 * restored window). Incognito tabs are left to the tracker, which never records them.
 */
export function isOpenedUnvisited(tab: NewTabLike, recentWindows: RecentWindows, now: number): boolean
{
  return !tab.active
    && !parseParkedTabUrl(tab.pendingUrl ?? tab.url)
    && !recentWindows.isJustCreated(tab.windowId, now);
}
