// Mark for Attention - which tabs and bookmarks the user marked, in the form
// AttentionMarkManager keeps in chrome.storage.local.
//
// A tab mark is a StoredTabRecord: tab IDs don't survive a browser restart, so
// the record also remembers the tab's URL and position and re-attaches with
// matchStoredTabs after a browser restart. A worker restart keeps IDs exact, so
// records then stay with their tab ID only. Incognito tabs are never marked (their URLs
// must not reach persistent storage).

import { matchStoredTabs } from '../utils/storedTabMatcher.ts';
import type { LiveTabLike, StoredTabRecord } from '../utils/storedTabMatcher.ts';

/** The fields of chrome.tabs.Tab the tab marks read. */
export interface MarkableTabLike extends LiveTabLike
{
  windowId: number;
  incognito?: boolean;
  /** The URL a new tab is loading before it commits; url is empty until then. */
  pendingUrl?: string;
}

type MarkableTab = MarkableTabLike & { id: number };

// A tab that may carry a mark: with an ID, not incognito
function isMarkable(tab: MarkableTabLike): tab is MarkableTab
{
  return tab.id !== undefined && !tab.incognito;
}

// The tab's page; a new tab has only its pending URL until the page commits
function urlOf(tab: MarkableTabLike): string
{
  return tab.url || tab.pendingUrl || '';
}

function recordOf(tab: MarkableTab): StoredTabRecord
{
  return { tabId: tab.id, windowId: tab.windowId, url: urlOf(tab), index: tab.index };
}

function isStoredTabRecord(value: unknown): value is StoredTabRecord
{
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Number.isInteger(entry.tabId)
    && Number.isFinite(entry.windowId)
    && typeof entry.url === 'string'
    && Number.isFinite(entry.index);
}

/** Marked tabs, keyed by tab ID. */
export class TabMarks
{
  #byTabId = new Map<number, StoredTabRecord>();

  /** Parse the stored value; throws when it (or any entry) is malformed. */
  static fromStored(value: unknown): TabMarks
  {
    const marks = new TabMarks();
    if (value === undefined) return marks;
    if (!Array.isArray(value)) throw new Error(`expected an array, got ${typeof value}`);

    // One malformed entry makes the whole value untrustworthy
    for (const entry of value)
    {
      if (!isStoredTabRecord(entry)) throw new Error(`malformed tab mark ${JSON.stringify(entry)}`);
      const { tabId, windowId, url, index } = entry;
      marks.#byTabId.set(tabId, { tabId, windowId, url, index });
    }
    return marks;
  }

  toStored(): StoredTabRecord[]
  {
    return Array.from(this.#byTabId.values(), record => ({ ...record }));
  }

  isMarked(tabId: number): boolean
  {
    return this.#byTabId.has(tabId);
  }

  markedTabIds(): number[]
  {
    return Array.from(this.#byTabId.keys());
  }

  /** Mark the tab at its current page and position. Incognito tabs and tabs without ID are refused. Returns whether anything changed. */
  mark(tab: MarkableTabLike): boolean
  {
    if (!isMarkable(tab)) return false;
    const before = this.#byTabId.get(tab.id);
    const record = recordOf(tab);
    this.#byTabId.set(tab.id, record);
    return !before || !sameRecord(before, record);
  }

  /** Returns whether the tab was marked. */
  clear(tabId: number): boolean
  {
    return this.#byTabId.delete(tabId);
  }

  /**
   * A marked tab navigated, moved or changed window: its record takes the tab's
   * current page and position so a browser restart can still re-match it.
   * Unmarked tabs are left alone. Returns whether the record changed.
   */
  follow(tab: MarkableTabLike): boolean
  {
    if (!isMarkable(tab)) return false;
    const before = this.#byTabId.get(tab.id);
    if (!before) return false;
    const record = recordOf(tab);
    if (sameRecord(before, record)) return false;
    this.#byTabId.set(tab.id, record);
    return true;
  }

  /**
   * The marks kept at a worker restart, when stored tab IDs are exact: a record
   * stays with the live tab of its ID, whatever page or window that tab shows
   * now, and takes the tab's current page and position. Records of tabs closed
   * while the worker slept are dropped and never move to another tab on the
   * same URL.
   */
  keptForLiveTabs(liveTabs: readonly MarkableTabLike[]): TabMarks
  {
    const kept = new TabMarks();
    for (const tab of liveTabs.filter(isMarkable))
    {
      if (this.#byTabId.has(tab.id)) kept.#byTabId.set(tab.id, recordOf(tab));
    }
    return kept;
  }

  /**
   * The marks re-attached to the live tabs after a browser restart or extension
   * reload, when a stored ID may belong to an unrelated tab: a tab on the
   * record's URL wins, an ID tab on another page of the record's site is the
   * last resort, an ID on another site never counts. Each matched
   * record is rebuilt from its live tab (new ID, window, URL, position), so
   * storage written from the result holds only IDs of this browser session;
   * records without a live tab are dropped. Incognito tabs never take a mark.
   */
  rematched(liveTabs: readonly MarkableTabLike[]): TabMarks
  {
    const rematched = new TabMarks();
    const candidates = liveTabs.filter(isMarkable);
    const records = Array.from(this.#byTabId.values());

    for (const { tab } of matchStoredTabs(records, candidates, { idMatch: 'sameWindowAndSite' }))
    {
      rematched.#byTabId.set(tab.id, recordOf(tab));
    }
    return rematched;
  }
}

function sameRecord(a: StoredTabRecord, b: StoredTabRecord): boolean
{
  return a.tabId === b.tabId && a.windowId === b.windowId && a.url === b.url && a.index === b.index;
}

/** Marked bookmarks, by bookmark ID. */
export class BookmarkMarks
{
  #ids = new Set<string>();

  /** Parse the stored value; throws when it (or any entry) is malformed. */
  static fromStored(value: unknown): BookmarkMarks
  {
    const marks = new BookmarkMarks();
    if (value === undefined) return marks;
    if (!Array.isArray(value)) throw new Error(`expected an array, got ${typeof value}`);

    for (const id of value)
    {
      if (typeof id !== 'string' || id === '') throw new Error(`malformed bookmark mark ${JSON.stringify(id)}`);
      marks.#ids.add(id);
    }
    return marks;
  }

  toStored(): string[]
  {
    return Array.from(this.#ids);
  }

  markedIds(): string[]
  {
    return Array.from(this.#ids);
  }

  /** Returns whether any of the bookmarks was not marked yet. */
  mark(ids: readonly string[]): boolean
  {
    const sizeBefore = this.#ids.size;
    for (const id of ids)
    {
      this.#ids.add(id);
    }
    return this.#ids.size !== sizeBefore;
  }

  /** Returns whether any of the bookmarks was marked. */
  clear(ids: readonly string[]): boolean
  {
    let changed = false;
    for (const id of ids)
    {
      changed = this.#ids.delete(id) || changed;
    }
    return changed;
  }

  /** The marks whose bookmark still exists; marks of bookmarks deleted while the worker was away are dropped. */
  keptIn(existingIds: ReadonlySet<string>): BookmarkMarks
  {
    const kept = new BookmarkMarks();
    for (const id of this.#ids)
    {
      if (existingIds.has(id)) kept.#ids.add(id);
    }
    return kept;
  }
}
