import { useEffect, useMemo, useState } from 'react';
import { TabActivityTracker, TabActivityView } from '../stores/tabActivityTracker';
import { newerTime } from '../utils/time';

// The stored records as a view; unreadable records give an empty one (the highlight and the dot are cosmetic)
function readTabActivity(stored: unknown): TabActivityView
{
  try
  {
    return TabActivityView.fromStored(stored);
  }
  catch (error)
  {
    if (import.meta.env.DEV)
    {
      console.warn('[useTabActivityView] Unreadable tab activity records:', error);
    }
    return new TabActivityView();
  }
}

/** A leave the sidebar saw itself: the user left `tabId` at `at`. */
interface TabLeave
{
  tabId: number;
  at: number;
}

/**
 * Tab activity as the Tab list shows it: the background's records plus a leave
 * the sidebar saw itself. That leave fills the gap until the background's record
 * of it arrives: for the left time the newer of the two counts, and the left tab
 * is no longer unvisited.
 */
class SidebarTabActivityView
{
  #stored: TabActivityView;
  #seenLeave: TabLeave | undefined;

  constructor(stored: TabActivityView, seenLeave: TabLeave | undefined)
  {
    this.#stored = stored;
    this.#seenLeave = seenLeave;
  }

  /** Epoch millis the user last left the tab; undefined if unknown. */
  leftAt(tabId: number): number | undefined
  {
    const seenLeftAt = this.#seenLeave?.tabId === tabId ? this.#seenLeave.at : undefined;
    return newerTime(this.#stored.leftAt(tabId), seenLeftAt);
  }

  /** Whether the tab was opened in the background and not activated since. */
  isUnvisited(tabId: number): boolean
  {
    return this.#seenLeave?.tabId !== tabId && this.#stored.isUnvisited(tabId);
  }
}

/** The active tab as the sidebar last saw it, and the tab it saw the user leave before that. */
interface SeenActivation
{
  activeTabId: number | undefined;
  leave?: TabLeave;
}

/**
 * When the user last left each tab and which tabs are still unvisited, for the
 * Tab list's age highlight and unvisited dot. Reads the records background.ts
 * keeps (TabActivityTracker) and follows their changes. The tab the sidebar sees
 * stop being active counts as left right then: the background's record of that
 * leave arrives a little later.
 * Returns the view and whether the records were read, like useChromeLocalStorage's
 * isLoaded. Not loaded (an empty view) until the first read resolves, and while
 * `enabled` is false (nothing is read then).
 */
export function useTabActivityView(enabled: boolean, activeTabId: number | undefined): [SidebarTabActivityView, boolean]
{
  const [stored, setStored] = useState<TabActivityView | undefined>(undefined);

  // Set while rendering, not in an effect, so the first render that shows the left tab as
  // inactive already grades it as just left. A pass without an active tab keeps the last leave
  const [seen, setSeen] = useState<SeenActivation>({ activeTabId });
  if (seen.activeTabId !== activeTabId)
  {
    setSeen({
      activeTabId,
      leave: seen.activeTabId === undefined ? seen.leave : { tabId: seen.activeTabId, at: Date.now() },
    });
  }

  useEffect(() =>
  {
    if (!enabled) return;

    let mounted = true;
    const key = TabActivityTracker.RECORDS_KEY;

    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) =>
    {
      if (areaName !== 'local' || !(key in changes)) return;
      setStored(readTabActivity(changes[key].newValue));
    };
    chrome.storage.onChanged.addListener(listener);

    chrome.storage.local.get(key).then(result =>
    {
      if (mounted) setStored(readTabActivity(result[key]));
    }).catch(error =>
    {
      if (import.meta.env.DEV)
      {
        console.error('[useTabActivityView] Failed to read tab activity records:', error);
      }
      // Grade by Chrome's lastAccessed alone rather than not at all
      if (mounted) setStored(current => current ?? new TabActivityView());
    });

    return () =>
    {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
      // Switched off: drop the records, so switching on again doesn't show stale ones
      setStored(undefined);
    };
  }, [enabled]);

  const { leave } = seen;
  const view = useMemo(
    () => new SidebarTabActivityView(stored ?? new TabActivityView(), leave),
    [stored, leave]
  );
  return [view, stored !== undefined];
}
