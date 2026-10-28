// Re-attach records saved per tab (Space assignment, last-use time) to the live
// tabs after a service-worker or browser restart. Within a browser session tab IDs
// stay valid; after a browser restart Chrome hands out IDs from a low counter
// again, so a record is found by URL and the nearest tab position instead.
// Callers whose IDs may come from an earlier browser session match by ID only
// when the site agrees.

/** What a stored record remembers about the tab it belongs to. */
export interface StoredTabRecord
{
  tabId: number;
  windowId: number;
  url: string;
  index: number;
}

/** The fields of chrome.tabs.Tab the matcher reads. */
export interface LiveTabLike
{
  id?: number;
  windowId?: number;
  url?: string;
  index: number;
}

/**
 * How the stored tab ID is tried before the URL + position fallback:
 * - 'off': not at all, records are matched by URL and position only.
 * - 'sameWindow': the tab with the stored ID in the stored window is the
 *   record's tab, whatever page it shows now. For IDs of the running browser
 *   session (worker restart): they are exact, while the stored URL may lag a
 *   navigation that happened while the worker slept.
 * - 'sameWindowAndSite': as 'sameWindow', but only when the tab is on the
 *   record's site (isSameSite). For IDs that may come from an earlier browser
 *   session (browser restart, extension reload or update), so an ID reused by
 *   an unrelated page is not taken.
 */
export type StoredTabIdMatch = 'off' | 'sameWindow' | 'sameWindowAndSite';

export interface StoredTabMatchOptions
{
  idMatch: StoredTabIdMatch;
}

export interface StoredTabMatch<R extends StoredTabRecord, T extends LiveTabLike>
{
  record: R;
  tab: T & { id: number };
}

// The host of a URL; '' when it has none or can't be parsed
function hostOf(url: string): string
{
  try
  {
    return new URL(url).hostname;
  }
  catch
  {
    return '';
  }
}

/**
 * True when two URLs belong to the same site: same host, or - for URLs without
 * a host (about:blank, file://) - the same URL. A tab that navigated within a
 * site still counts as the same tab; a reused ID on another site does not.
 */
export function isSameSite(storedUrl: string, liveUrl: string): boolean
{
  const host = hostOf(storedUrl);
  return host ? host === hostOf(liveUrl) : storedUrl === liveUrl;
}

/** Live tabs not yet given to a record. Each tab is handed out at most once. */
class UnclaimedTabs<T extends LiveTabLike>
{
  #tabs: Array<T & { id: number }>;

  constructor(liveTabs: readonly T[])
  {
    this.#tabs = liveTabs.filter((tab): tab is T & { id: number } => tab.id !== undefined);
  }

  /** The tab with the record's ID in its window (and, if asked, on its site), if still unclaimed. */
  claimById(record: StoredTabRecord, requireSameSite: boolean): (T & { id: number }) | undefined
  {
    const position = this.#tabs.findIndex(tab =>
      tab.id === record.tabId &&
      tab.windowId === record.windowId &&
      (!requireSameSite || isSameSite(record.url, tab.url ?? '')));
    return this.#take(position);
  }

  /** The unclaimed tab on this URL closest to the given position; the first one wins a tie. */
  claimNearestByUrl(url: string, index: number): (T & { id: number }) | undefined
  {
    let bestPosition = -1;
    let bestDistance = Infinity;

    // Scan every tab on the same URL and keep the closest one
    for (let position = 0; position < this.#tabs.length; position++)
    {
      const tab = this.#tabs[position];
      if (tab.url !== url) continue;
      const distance = Math.abs(tab.index - index);
      if (distance < bestDistance)
      {
        bestPosition = position;
        bestDistance = distance;
      }
    }
    return this.#take(bestPosition);
  }

  #take(position: number): (T & { id: number }) | undefined
  {
    if (position < 0) return undefined;
    const [tab] = this.#tabs.splice(position, 1);
    return tab;
  }
}

/**
 * Pair stored records with live tabs. Unless idMatch is 'off', records whose tab
 * ID still exists in the same window (on the same site for 'sameWindowAndSite')
 * keep that tab first; the remaining records then take the unclaimed tab on the
 * same URL with the nearest index. Records without a matching tab are dropped.
 * Pairs come back in record order.
 */
export function matchStoredTabs<R extends StoredTabRecord, T extends LiveTabLike>(
  records: readonly R[],
  liveTabs: readonly T[],
  options: StoredTabMatchOptions
): Array<StoredTabMatch<R, T>>
{
  const unclaimed = new UnclaimedTabs(liveTabs);
  const matchedTabs: Array<(T & { id: number }) | undefined> = new Array(records.length);

  // Pass 1: exact tab ID in the same window, so a stale record earlier in the list can't take the tab by URL
  if (options.idMatch !== 'off')
  {
    const requireSameSite = options.idMatch === 'sameWindowAndSite';
    records.forEach((record, position) =>
    {
      matchedTabs[position] = unclaimed.claimById(record, requireSameSite);
    });
  }

  // Pass 2: records still without a tab look for the same URL nearest to their old position
  records.forEach((record, position) =>
  {
    if (matchedTabs[position]) return;
    matchedTabs[position] = unclaimed.claimNearestByUrl(record.url, record.index);
  });

  return records.flatMap((record, position) =>
  {
    const tab = matchedTabs[position];
    return tab ? [{ record, tab }] : [];
  });
}
