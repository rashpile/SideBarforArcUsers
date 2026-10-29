// TabActivityTracker - last-use time of every tab, for auto-archive and the
// Tab list's age highlight, and which tabs were opened in the background and
// never visited, for the Tab list's unvisited marker.
//
// "Last use" is the moment a tab stopped being active. Chrome's tab.lastAccessed
// holds the moment it became active, so the background records deactivations
// itself: onActivated -> markActivated stamps the window's previously active tab.
//
// Each record holds two times. lastUsedAt is what auto-archive judges by: refresh
// also starts it for first-seen tabs and tabs in use. leftAt is stamped only when
// the user leaves the tab, so the highlight never shows a tab as fresh just
// because the tracker first saw it or it plays audio; the sidebar reads it
// through TabActivityView.
//
// A record may also carry unvisited: set when a tab is opened in the background
// (markOpenedUnvisited), cleared when the tab is activated or left. Until then
// the record follows the tab's URL (followUrl), so a browser restart can still
// re-match a tab that never loaded its final page.
//
// The service worker usually wakes up *on* the onActivated event, when neither
// memory nor a fresh query can tell which tab was active before. The active tab
// of each window is therefore kept in chrome.storage.session (survives worker
// restarts, cleared with the browser session); the last-use records are kept in
// chrome.storage.local so they survive browser restarts too.
//
// Records are kept while auto-archive, the tab age highlight or the unvisited
// marker is on (isTabActivityRecording). With all three off nothing is recorded:
// switching the last one off drops every record, and so does a worker start
// with all three off.
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
  /** The URL a new tab is loading before it commits; url is empty until then. */
  pendingUrl?: string;
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
  /** True while auto-archive, the tab age highlight or the unvisited marker is on; nothing is recorded otherwise. */
  isRecording: () => Promise<boolean>;
  /** The tab as it is now; undefined once it is closed. */
  getTab: (tabId: number) => Promise<TrackedTabLike | undefined>;
  now?: () => number;
}

/** What the tracker remembers per tab: where it was and when it was last used. */
interface TabUseRecord extends StoredTabRecord
{
  lastUsedAt: number;
  /** When the user last left the tab; undefined until the tracker sees that happen. */
  leftAt?: number;
  /** True while a tab opened in the background has not been activated yet. */
  unvisited?: boolean;
}

/** Stored form of a record; the tab ID is the key it is stored under. */
type StoredTabUse = Omit<TabUseRecord, 'tabId'>;

// A tab the tracker may record: with an ID, not incognito
function isTrackable(tab: TrackedTabLike): tab is TrackableTab
{
  return tab.id !== undefined && !tab.incognito;
}

// The tab's page; a new tab has only its pending URL until the page commits
function urlOf(tab: TrackedTabLike): string
{
  return tab.url || tab.pendingUrl || '';
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
    && Number.isFinite(value.lastUsedAt)
    && (value.leftAt === undefined || Number.isFinite(value.leftAt))
    && (value.unvisited === undefined || value.unvisited === true);
}

/** The newest of the times seen per URL. */
class NewestTimeByUrl
{
  #byUrl = new Map<string, number>();

  add(url: string, time: number): void
  {
    this.#byUrl.set(url, Math.max(time, this.#byUrl.get(url) ?? time));
  }

  newest(url: string): number | undefined
  {
    return this.#byUrl.get(url);
  }
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
      const { windowId, url, index, lastUsedAt, leftAt, unvisited } = entry;
      records.#byTabId.set(tabId, { tabId, windowId, url, index, lastUsedAt, leftAt, unvisited });
    }
    return records;
  }

  toStored(): Record<string, StoredTabUse>
  {
    const stored: Record<string, StoredTabUse> = {};

    // Key each record by its tab ID; leftAt only once the user has left the tab,
    // unvisited only while it is set
    for (const { tabId, windowId, url, index, lastUsedAt, leftAt, unvisited } of this.#byTabId.values())
    {
      const entry: StoredTabUse = { windowId, url, index, lastUsedAt };
      if (leftAt !== undefined) entry.leftAt = leftAt;
      if (unvisited) entry.unvisited = true;
      stored[tabId] = entry;
    }
    return stored;
  }

  /** Epoch millis the tab stopped being active (or was first seen); undefined if unknown. */
  lastUsedAt(tabId: number): number | undefined
  {
    return this.#byTabId.get(tabId)?.lastUsedAt;
  }

  /** Epoch millis the user last left the tab; undefined if unknown. */
  leftAt(tabId: number): number | undefined
  {
    return this.#byTabId.get(tabId)?.leftAt;
  }

  /** Whether the tab was opened in the background and not activated since. */
  isUnvisited(tabId: number): boolean
  {
    return this.#byTabId.get(tabId)?.unvisited === true;
  }

  /**
   * The user left the tab at this time; its record follows it to its current
   * page and position. A tab the user was on is visited, whatever the record said.
   */
  markLeft(tab: TrackableTab, time: number): void
  {
    this.#put(tab, time, time);
  }

  /**
   * The tab was just opened in the background. Its auto-archive clock starts
   * now, as for any first-seen tab; it has never been left.
   */
  markOpenedUnvisited(tab: TrackableTab, now: number): void
  {
    this.#put(tab, now, undefined, true);
  }

  /** The tab was activated: it is no longer unvisited. Returns whether that changed anything. */
  markVisited(tabId: number): boolean
  {
    const record = this.#byTabId.get(tabId);
    if (!record?.unvisited) return false;
    this.#byTabId.set(tabId, { ...record, unvisited: undefined });
    return true;
  }

  /**
   * An unvisited tab's URL changed (pending URL committed, redirects): its record
   * takes the tab's current URL and position, so a browser restart can re-match
   * it. Visited tabs are left alone: their record follows them when they are
   * left. Returns whether the record changed.
   */
  followUrl(tab: TrackableTab): boolean
  {
    const record = this.#byTabId.get(tab.id);
    const url = urlOf(tab);
    if (!record?.unvisited || url === '') return false;
    if (record.url === url && record.index === tab.index && record.windowId === tab.windowId) return false;
    this.#put(tab, record.lastUsedAt, record.leftAt, true);
    return true;
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
      if (record) kept.#put(tab, record.lastUsedAt, record.leftAt, record.unvisited);
    }
    return kept;
  }

  /**
   * As keptForLiveTabs, but every open tab ends up with a record: tabs seen for
   * the first time start their clock now, and so do tabs in use - active (a
   * safety net for a missed deactivation), sharing a split view with their
   * window's active tab, playing audio or pinned in Chrome - so a tab leaving
   * one of these exemptions gets a full period. leftAt and unvisited are
   * carried as they are: none of these is the user leaving or activating the tab.
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
      refreshed.#put(tab, inUse || !record ? now : record.lastUsedAt, record?.leftAt, record?.unvisited);
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
   * leftAt and unvisited stay with their own record: the highlight has no such
   * safety to keep, and the newest one would show every copy of a page (several
   * New Tab pages) as fresh.
   */
  rematchedByUrl(liveTabs: readonly TrackedTabLike[]): TabUseRecords
  {
    const records = Array.from(this.#byTabId.values()).filter(record => record.url !== '');
    const newestLastUse = new NewestTimeByUrl();
    const rematched = new TabUseRecords();

    // Newest last-use time per URL
    for (const { url, lastUsedAt } of records)
    {
      newestLastUse.add(url, lastUsedAt);
    }

    // Re-key each matched record to its tab's new ID
    for (const { record, tab } of matchStoredTabs(records, trackableTabs(liveTabs), { idMatch: 'off' }))
    {
      rematched.#put(tab, newestLastUse.newest(record.url) ?? record.lastUsedAt, record.leftAt, record.unvisited);
    }
    return rematched;
  }

  #put(tab: TrackableTab, lastUsedAt: number, leftAt?: number, unvisited?: boolean): void
  {
    this.#byTabId.set(tab.id, { tabId: tab.id, windowId: tab.windowId, url: urlOf(tab), index: tab.index, lastUsedAt, leftAt, unvisited });
  }
}

/**
 * Read-only view of the stored records for the sidebar: when the user last
 * left each tab, and which tabs are still unvisited. An empty view (no times,
 * nothing unvisited) when constructed directly.
 */
export class TabActivityView
{
  #records = new TabUseRecords();

  /** Parse the value stored under TabActivityTracker.RECORDS_KEY; throws when it (or any entry) is malformed. */
  static fromStored(value: unknown): TabActivityView
  {
    const view = new TabActivityView();
    view.#records = TabUseRecords.fromStored(value);
    return view;
  }

  /** Epoch millis the user last left the tab; undefined if unknown. */
  leftAt(tabId: number): number | undefined
  {
    return this.#records.leftAt(tabId);
  }

  /** Whether the tab was opened in the background and not activated since. */
  isUnvisited(tabId: number): boolean
  {
    return this.#records.isUnvisited(tabId);
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
  /** chrome.storage.local: last-use records, { [tabId]: { windowId, url, index, lastUsedAt, leftAt?, unvisited? } }. */
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
   * Worker start, or auto-archive, the tab age highlight or the unvisited marker
   * switched on or off: attach the stored records to the live tabs and learn the
   * active tab of windows not known yet. While not recording (all off), drop whatever is
   * stored instead. Never throws - unreadable data is logged and the tracker
   * starts empty (clocks start later, never earlier).
   */
  load(liveTabs: readonly TrackedTabLike[]): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      try
      {
        // Nothing is kept while not recording, also records left from an earlier session
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
   * The tab became active in its window: it is visited now, and the tab active
   * there before stops being used. That tab's record is created if it has none
   * and follows the page it shows, so after a browser restart a recently used
   * page is matched with a recent time. Does nothing while not recording.
   */
  markActivated(windowId: number, tabId: number): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      if (!await this.#isRecording()) return;

      const [activeTabs, records] = await Promise.all([this.#readActiveTabs(), this.#readRecords()]);
      const previousTabId = activeTabs.activeTab(windowId);

      // The activated tab loses its mark even when the tab left behind is unknown
      // (worker just woke, previous tab closed or incognito)
      let changed = records.markVisited(tabId);

      // Stamp the tab the user just left; a closed or incognito tab gets no record
      if (previousTabId !== undefined && previousTabId !== tabId)
      {
        const left = await this.#getTab(previousTabId);
        if (left && isTrackable(left))
        {
          records.markLeft(left, this.#now());
          changed = true;
        }
      }
      if (changed) await this.#writeRecords(records);

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

  /**
   * The tab was just opened in the background: mark it unvisited until it is
   * activated or left. Does nothing while not recording, for incognito tabs,
   * and before load attached the records to this session's tabs (the write
   * would land among records keyed by a previous session's tab IDs).
   */
  markOpenedUnvisited(tab: TrackedTabLike): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      if (!this.#attached || !isTrackable(tab) || !await this.#isRecording()) return;
      const records = await this.#readRecords();
      records.markOpenedUnvisited(tab, this.#now());
      await this.#writeRecords(records);
    });
  }

  /**
   * An unvisited tab's URL changed: its record takes the new URL and position.
   * Same no-op conditions as markOpenedUnvisited.
   */
  followUrl(tab: TrackedTabLike): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      if (!this.#attached || !isTrackable(tab) || !await this.#isRecording()) return;
      const records = await this.#readRecords();
      if (records.followUrl(tab)) await this.#writeRecords(records);
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
