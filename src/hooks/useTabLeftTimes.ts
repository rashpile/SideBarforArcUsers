import { useEffect, useMemo, useState } from 'react';
import { TabActivityTracker, TabLeftTimes } from '../stores/tabActivityTracker';
import { newerTime } from '../utils/time';

// The stored records as left times; unreadable records give none (the highlight is cosmetic)
function readLeftTimes(stored: unknown): TabLeftTimes
{
  try
  {
    return TabLeftTimes.fromStored(stored);
  }
  catch (error)
  {
    if (import.meta.env.DEV)
    {
      console.warn('[useTabLeftTimes] Unreadable tab activity records:', error);
    }
    return new TabLeftTimes();
  }
}

/** A leave the sidebar saw itself: the user left `tabId` at `at`. */
interface TabLeave
{
  tabId: number;
  at: number;
}

/**
 * When the user last left each tab, as the Tab list grades it: the background's
 * records plus a leave the sidebar saw itself. That leave fills the gap until
 * the background's record of it arrives; the newer of the two counts.
 */
class SidebarTabLeftTimes
{
  #stored: TabLeftTimes;
  #seenLeave: TabLeave | undefined;

  constructor(stored: TabLeftTimes, seenLeave: TabLeave | undefined)
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
}

/** The active tab as the sidebar last saw it, and the tab it saw the user leave before that. */
interface SeenActivation
{
  activeTabId: number | undefined;
  leave?: TabLeave;
}

/**
 * When the user last left each tab, for the Tab list's age highlight.
 * Reads the records background.ts keeps (TabActivityTracker) and follows their
 * changes. The tab the sidebar sees stop being active counts as left right then:
 * the background's record of that leave arrives a little later.
 * Returns the times and whether the records were read, like useChromeLocalStorage's
 * isLoaded. Not loaded (no times) until the first read resolves, and while `enabled`
 * is false (nothing is read then).
 */
export function useTabLeftTimes(enabled: boolean, activeTabId: number | undefined): [SidebarTabLeftTimes, boolean]
{
  const [stored, setStored] = useState<TabLeftTimes | undefined>(undefined);

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
      setStored(readLeftTimes(changes[key].newValue));
    };
    chrome.storage.onChanged.addListener(listener);

    chrome.storage.local.get(key).then(result =>
    {
      if (mounted) setStored(readLeftTimes(result[key]));
    }).catch(error =>
    {
      if (import.meta.env.DEV)
      {
        console.error('[useTabLeftTimes] Failed to read tab activity records:', error);
      }
      // Grade by Chrome's lastAccessed alone rather than not at all
      if (mounted) setStored(current => current ?? new TabLeftTimes());
    });

    return () =>
    {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
      // Switched off: drop the times, so switching on again doesn't grade with stale ones
      setStored(undefined);
    };
  }, [enabled]);

  const { leave } = seen;
  const leftTimes = useMemo(
    () => new SidebarTabLeftTimes(stored ?? new TabLeftTimes(), leave),
    [stored, leave]
  );
  return [leftTimes, stored !== undefined];
}
