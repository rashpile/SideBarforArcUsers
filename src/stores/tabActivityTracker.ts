// TabActivityTracker - last-use time of every tab, for auto-archive (feature 035).
//
// "Last use" is the moment a tab stopped being active. Chrome's tab.lastAccessed
// holds the moment it became active, so the background records deactivations
// itself: onActivated -> markActivated stamps the window's previously active tab.
//
// The service worker usually wakes up *on* the onActivated event, when neither
// memory nor a fresh query can tell which tab was active before. The active tab
// of each window is therefore kept in chrome.storage.session (survives worker
// restarts, cleared with the browser session); the last-use records are kept in
// chrome.storage.local so they survive browser restarts too.
//
// Nothing is recorded while "Archive tabs after" is Never: switching it off drops
// every record, and a worker start with the setting off drops leftovers.
//
// background.ts is the only writer. Every change is a read-modify-write of the
// stored data, serialized so concurrent events don't drop entries. Incognito
// tabs are never recorded (their URLs must not reach persistent storage).

import { matchStoredTabs } from '../utils/storedTabMatcher.ts';
import type { LiveTabLike, StoredTabRecord } from '../utils/storedTabMatcher.ts';
import { SplitViewsOnScreen } from '../utils/autoArchivePolicy.ts';
import type { TabLastUseTimes } from '../utils/autoArchivePolicy.ts';
import { BrowserSessionMarker } from './browserSessionMarker.ts';

/** The fields of chrome.tabs.Tab the tracker reads. */
export interface TrackedTabLike extends LiveTabLike
{
  windowId: number;
  active: boolean;
  audible?: boolean;
  pinned?: boolean;
  incognito?: boolean;
  /** Chrome 140+: the split view showing the tab; -1 or absent when none. */
  splitViewId?: number;
}

type TrackableTab = TrackedTabLike & { id: number };

/** One chrome.storage area (local or session), as the tracker uses it. */
export interface TabActivityStorageArea
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

/** What the tracker is built from (chrome APIs in background.ts, fakes in tests). */
export interface TabActivityTrackerOptions
{
  local: TabActivityStorageArea;
  session: TabActivityStorageArea;
  /** True while "Archive tabs after" is set to a period; nothing is recorded otherwise. */
  isRecording: () => Promise<boolean>;
  /** The tab as it is now; undefined once it is closed. */
  getTab: (tabId: number) => Promise<TrackedTabLike | undefined>;
  now?: () => number;
}

/** What the tracker remembers per tab: where it was and when it was last used. */
interface TabUseRecord extends StoredTabRecord
{
  lastUsedAt: number;
}

/** Stored form of a record; the tab ID is the key it is stored under. */
type StoredTabUse = Omit<TabUseRecord, 'tabId'>;

// A tab the tracker may record: with an ID, not incognito
function isTrackable(tab: TrackedTabLike): tab is TrackableTab
{
  return tab.id !== undefined && !tab.incognito;
}

function trackableTabs(liveTabs: readonly TrackedTabLike[]): TrackableTab[]
{
  return liveTabs.filter(isTrackable);
}

function isObjectRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredTabUse(value: unknown): value is StoredTabUse
{
  return isObjectRecord(value)
    && Number.isFinite(value.windowId)
    && typeof value.url === 'string'
    && Number.isFinite(value.index)
    && Number.isFinite(value.lastUsedAt);
}

/** Last-use records keyed by tab ID. */
class TabUseRecords implements TabLastUseTimes
{
  #byTabId = new Map<number, TabUseRecord>();

  /** Parse the stored value; throws when it (or any entry) is malformed. */
  static fromStored(value: unknown): TabUseRecords
  {
    const records = new TabUseRecords();
    if (value === undefined) return records;
    if (!isObjectRecord(value)) throw new Error(`expected an object, got ${typeof value}`);

    // Validate every entry: one malformed entry makes the whole value untrustworthy
    for (const [key, entry] of Object.entries(value))
    {
      const tabId = Number(key);
      if (!Number.isInteger(tabId) || !isStoredTabUse(entry))
      {
        throw new Error(`malformed record for tab "${key}"`);
      }
      const { windowId, url, index, lastUsedAt } = entry;
      records.#byTabId.set(tabId, { tabId, windowId, url, index, lastUsedAt });
    }
    return records;
  }

  toStored(): Record<string, StoredTabUse>
  {
    const stored: Record<string, StoredTabUse> = {};

    // Key each record by its tab ID
    for (const { tabId, windowId, url, index, lastUsedAt } of this.#byTabId.values())
    {
      stored[tabId] = { windowId, url, index, lastUsedAt };
    }
    return stored;
  }

  /** Epoch millis the tab stopped being active (or was first seen); undefined if unknown. */
  lastUsedAt(tabId: number): number | undefined
  {
    return this.#byTabId.get(tabId)?.lastUsedAt;
  }

  /** The tab was in use until this time; its record follows it to its current page and position. */
  markUsed(tab: TrackableTab, time: number): void
  {
    this.#put(tab, time);
  }

  remove(tabId: number): boolean
  {
    return this.#byTabId.delete(tabId);
  }

  /** Within a browser session tab IDs are exact: keep the records of tabs still open. */
  keptForLiveTabs(liveTabs: readonly TrackedTabLike[]): TabUseRecords
  {
    const kept = new TabUseRecords();

    // Carry each open tab's record over; records of closed tabs stay behind
    for (const tab of trackableTabs(liveTabs))
    {
      const record = this.#byTabId.get(tab.id);
      if (record) kept.#put(tab, record.lastUsedAt);
    }
    return kept;
  }

  /**
   * As keptForLiveTabs, but every open tab ends up with a record: tabs seen for
   * the first time start their clock now, and so do tabs in use - active (a
   * safety net for a missed deactivation), sharing a split view with their
   * window's active tab, playing audio or pinned in Chrome - so a tab leaving
   * one of these exemptions gets a full period.
   */
  refreshedForLiveTabs(liveTabs: readonly TrackedTabLike[], now: number): TabUseRecords
  {
    const refreshed = new TabUseRecords();
    const splitViewsOnScreen = SplitViewsOnScreen.of(liveTabs);

    // One record per open tab, keeping the known time of tabs not in use
    for (const tab of trackableTabs(liveTabs))
    {
      const record = this.#byTabId.get(tab.id);
      const inUse = tab.active || tab.audible === true || tab.pinned === true || splitViewsOnScreen.shows(tab);
      refreshed.#put(tab, inUse || !record ? now : record.lastUsedAt);
    }
    return refreshed;
  }

  /**
   * After a browser restart Chrome hands out tab IDs from a low counter again, so
   * a stored ID may now belong to an unrelated tab. Records find their tab by URL
   * and nearest position only; records without a URL can't be told apart and are
   * dropped, like records with no matching tab.
   *
   * Records sharing a URL (the page open in several windows, or a window closed
   * just before the restart) may land on each other's tabs, so every tab on such
   * a URL gets the newest last-use time among them: it closes later, never earlier.
   */
  rematchedByUrl(liveTabs: readonly TrackedTabLike[]): TabUseRecords
  {
    const records = Array.from(this.#byTabId.values()).filter(record => record.url !== '');
    const newestLastUseByUrl = new Map<string, number>();
    const rematched = new TabUseRecords();

    // Newest last-use time per URL
    for (const { url, lastUsedAt } of records)
    {
      newestLastUseByUrl.set(url, Math.max(lastUsedAt, newestLastUseByUrl.get(url) ?? lastUsedAt));
    }

    // Re-key each matched record to its tab's new ID
    for (const { record, tab } of matchStoredTabs(records, trackableTabs(liveTabs), { idMatch: 'off' }))
    {
      rematched.#put(tab, newestLastUseByUrl.get(record.url) ?? record.lastUsedAt);
    }
    return rematched;
  }

  #put(tab: TrackableTab, lastUsedAt: number): void
  {
    this.#byTabId.set(tab.id, { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? '', index: tab.index, lastUsedAt });
  }
}

/** The active tab of each window, as last seen by the background. */
class ActiveTabsByWindow
{
  #tabIdByWindow = new Map<number, number>();

  /** Parse the stored value; malformed entries are skipped. */
  static fromStored(value: unknown): ActiveTabsByWindow
  {
    const activeTabs = new ActiveTabsByWindow();
    if (!isObjectRecord(value)) return activeTabs;

    // Keep each window whose entry is a valid tab ID
    for (const [key, tabId] of Object.entries(value))
    {
      const windowId = Number(key);
      if (Number.isInteger(windowId) && typeof tabId === 'number' && Number.isInteger(tabId))
      {
        activeTabs.#tabIdByWindow.set(windowId, tabId);
      }
    }
    return activeTabs;
  }

  toStored(): Record<string, number>
  {
    return Object.fromEntries(this.#tabIdByWindow);
  }

  activeTab(windowId: number): number | undefined
  {
    return this.#tabIdByWindow.get(windowId);
  }

  setActiveTab(windowId: number, tabId: number): void
  {
    this.#tabIdByWindow.set(windowId, tabId);
  }

  /** Take the active tab of windows not known yet from the live tabs. */
  addMissingWindows(liveTabs: readonly TrackedTabLike[]): void
  {
    // A known window keeps its entry: the live state may already show the tab
    // whose activation woke the worker, and the entry names the tab it replaced
    for (const tab of liveTabs)
    {
      if (!tab.active || tab.id === undefined || this.#tabIdByWindow.has(tab.windowId)) continue;
      this.#tabIdByWindow.set(tab.windowId, tab.id);
    }
  }
}

export class TabActivityTracker
{
  /** chrome.storage.local: last-use records, { [tabId]: { windowId, url, index, lastUsedAt } }. */
  static RECORDS_KEY = 'tabLastUsedAt';
  /** chrome.storage.session: active tab per window, { [windowId]: tabId }. */
  static ACTIVE_TABS_KEY = 'tabActivityActiveTabs';
  /** chrome.storage.session: BrowserSessionMarker, set once the records were matched to this browser session's tabs. */
  static SESSION_MARKER_KEY = 'tabActivitySessionStarted';

  #local: TabActivityStorageArea;
  #session: TabActivityStorageArea;
  #sessionMarker: BrowserSessionMarker;
  #isRecording: () => Promise<boolean>;
  #getTab: (tabId: number) => Promise<TrackedTabLike | undefined>;
  #now: () => number;
  #tail: Promise<unknown> = Promise.resolve();
  // Set once load matched the stored records to the live tabs (or dropped them).
  // Until then the records may still carry tab IDs from before a browser restart.
  #attached = false;

  constructor(options: TabActivityTrackerOptions)
  {
    this.#local = options.local;
    this.#session = options.session;
    this.#sessionMarker = new BrowserSessionMarker(options.session, TabActivityTracker.SESSION_MARKER_KEY);
    this.#isRecording = options.isRecording;
    this.#getTab = options.getTab;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Worker start, or auto-archive switched on: attach the stored records to the
   * live tabs and learn the active tab of windows not known yet. With the
   * setting off, drop whatever is stored instead. Never throws - unreadable data
   * is logged and the tracker starts empty (clocks start later, never earlier).
   */
  load(liveTabs: readonly TrackedTabLike[]): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      try
      {
        // Nothing is kept while auto-archive is off, also records left from an earlier session
        if (!await this.#isRecording())
        {
          await this.#removeEverything();
          this.#attached = true;
          return;
        }

        const [records, activeTabs, sameBrowserSession] = await Promise.all([
          this.#readRecords(),
          this.#readActiveTabs(),
          this.#sessionMarker.isSameBrowserSession(),
        ]);

        // A worker restart keeps tab IDs; a browser restart (session storage cleared) does not
        const attached = sameBrowserSession
          ? records.keptForLiveTabs(liveTabs)
          : records.rematchedByUrl(liveTabs);
        await this.#writeRecords(attached);
        this.#attached = true;

        activeTabs.addMissingWindows(liveTabs);
        await this.#session.set({ [TabActivityTracker.ACTIVE_TABS_KEY]: activeTabs.toStored() });
        await this.#sessionMarker.mark();
      }
      catch (error)
      {
        console.error('[TabActivityTracker] load failed:', error);
      }
    });
  }

  /**
   * Auto-archive was switched to Never: drop every record and the active-tab
   * map. Switching on again starts from load.
   */
  clear(): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      await this.#removeEverything();
      this.#attached = true;  // No record left that could land on a wrong tab
    });
  }

  /**
   * The tab became active in its window: the tab active there before stops
   * being used now. Its record is created if it has none and follows the page
   * it shows, so after a browser restart a recently used page is matched with
   * a recent time. Does nothing while auto-archive is off.
   */
  markActivated(windowId: number, tabId: number): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      if (!await this.#isRecording()) return;

      const activeTabs = await this.#readActiveTabs();
      const previousTabId = activeTabs.activeTab(windowId);

      // Stamp the tab the user just left; a closed or incognito tab gets no record
      if (previousTabId !== undefined && previousTabId !== tabId)
      {
        const left = await this.#getTab(previousTabId);
        if (left && isTrackable(left))
        {
          const records = await this.#readRecords();
          records.markUsed(left, this.#now());
          await this.#writeRecords(records);
        }
      }

      activeTabs.setActiveTab(windowId, tabId);
      await this.#session.set({ [TabActivityTracker.ACTIVE_TABS_KEY]: activeTabs.toStored() });
    });
  }

  /**
   * Bring the records in line with the live tabs (one write): drop closed tabs,
   * follow moves, start the clock of first-seen tabs and tabs in use (active,
   * in a split view with the active tab, audible, Chrome-pinned). Returns the
   * last-use times the auto-archive policy judges by. Rejects when load did
   * not succeed: records keyed by tab IDs of a previous browser session would
   * hand old last-use times to unrelated tabs.
   */
  refresh(liveTabs: readonly TrackedTabLike[]): Promise<TabLastUseTimes>
  {
    return this.#enqueue(async () =>
    {
      if (!this.#attached)
      {
        throw new Error('last-use records were not matched to the live tabs (load failed)');
      }
      const records = (await this.#readRecords()).refreshedForLiveTabs(liveTabs, this.#now());
      await this.#writeRecords(records);
      return records;
    });
  }

  /** Drop a closed tab's record. */
  forget(tabId: number): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const records = await this.#readRecords();
      if (records.remove(tabId)) await this.#writeRecords(records);
    });
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #readRecords(): Promise<TabUseRecords>
  {
    const result = await this.#local.get(TabActivityTracker.RECORDS_KEY);
    try
    {
      return TabUseRecords.fromStored(result[TabActivityTracker.RECORDS_KEY]);
    }
    catch (error)
    {
      console.error('[TabActivityTracker] ignoring unreadable last-use records:', error);
      return new TabUseRecords();
    }
  }

  #writeRecords(records: TabUseRecords): Promise<void>
  {
    return this.#local.set({ [TabActivityTracker.RECORDS_KEY]: records.toStored() });
  }

  async #removeEverything(): Promise<void>
  {
    await Promise.all([
      this.#local.remove(TabActivityTracker.RECORDS_KEY),
      this.#session.remove(TabActivityTracker.ACTIVE_TABS_KEY),
    ]);
  }

  async #readActiveTabs(): Promise<ActiveTabsByWindow>
  {
    const result = await this.#session.get(TabActivityTracker.ACTIVE_TABS_KEY);
    return ActiveTabsByWindow.fromStored(result[TabActivityTracker.ACTIVE_TABS_KEY]);
  }
}
