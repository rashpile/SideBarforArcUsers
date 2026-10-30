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
 * - 'sameWindowAndSite': for IDs that may come from an earlier browser session
 *   (browser restart, extension reload or update). The ID's tab is taken first
 *   only when it shows the stored URL. A tab elsewhere showing the stored URL
 *   beats an ID that is only on the record's site (isSameSite), since Chrome
 *   may have reused the ID for another page of that site; the same-site ID is
 *   tried last. An ID on another site is never taken.
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

/** What the URL of the stored ID's tab must be for claimById to take it. */
type IdTabUrl = 'any' | 'sameUrl' | 'sameSite';

function urlAccepted(rule: IdTabUrl, storedUrl: string, liveUrl: string): boolean
{
  if (rule === 'sameUrl') return storedUrl === liveUrl;
  if (rule === 'sameSite') return isSameSite(storedUrl, liveUrl);
  return true;
}

/** Live tabs not yet given to a record. Each tab is handed out at most once. */
class UnclaimedTabs<T extends LiveTabLike>
{
  #tabs: Array<T & { id: number }>;

  constructor(liveTabs: readonly T[])
  {
    this.#tabs = liveTabs.filter((tab): tab is T & { id: number } => tab.id !== undefined);
  }

  /** The tab with the record's ID in its window whose URL passes the rule, if still unclaimed. */
  claimById(record: StoredTabRecord, rule: IdTabUrl): (T & { id: number }) | undefined
  {
    const position = this.#tabs.findIndex(tab =>
      tab.id === record.tabId &&
      tab.windowId === record.windowId &&
      urlAccepted(rule, record.url, tab.url ?? ''));
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
 * Pair stored records with live tabs. With 'sameWindow', records whose tab ID
 * still exists in the same window keep that tab first. With 'sameWindowAndSite',
 * only an ID tab on the stored URL is kept first; a same-site ID tab is tried
 * after the URL pass. The URL pass gives each remaining record the unclaimed tab
 * on the same URL with the nearest index. Records without a matching tab are
 * dropped. Pairs come back in record order.
 */
export function matchStoredTabs<R extends StoredTabRecord, T extends LiveTabLike>(
  records: readonly R[],
  liveTabs: readonly T[],
  options: StoredTabMatchOptions
): Array<StoredTabMatch<R, T>>
{
  const unclaimed = new UnclaimedTabs(liveTabs);
  const matchedTabs: Array<(T & { id: number }) | undefined> = new Array(records.length);

  const claimForUnmatched = (claim: (record: R) => (T & { id: number }) | undefined): void =>
  {
    records.forEach((record, position) =>
    {
      if (!matchedTabs[position]) matchedTabs[position] = claim(record);
    });
  };

  // ID passes run before the URL pass, so a stale record earlier in the list can't take the tab by URL
  if (options.idMatch === 'sameWindow') claimForUnmatched(record => unclaimed.claimById(record, 'any'));
  if (options.idMatch === 'sameWindowAndSite') claimForUnmatched(record => unclaimed.claimById(record, 'sameUrl'));

  claimForUnmatched(record => unclaimed.claimNearestByUrl(record.url, record.index));

  // After a browser restart a same-site ID is the weakest hint: Chrome may have reused it for another
  // page of the site while the record's page reopened under a new ID, which the URL pass found
  if (options.idMatch === 'sameWindowAndSite') claimForUnmatched(record => unclaimed.claimById(record, 'sameSite'));

  return records.flatMap((record, position) =>
  {
    const tab = matchedTabs[position];
    return tab ? [{ record, tab }] : [];
  });
}
