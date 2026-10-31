// Recently closed tabs per Space, in the form RecentlyClosedManager keeps in
// chrome.storage.local under `recentlyClosedTabs`. Records hold no tab ids:
// the list outlives the browser session the tabs belonged to.

export const RECENTLY_CLOSED_PER_SPACE = 50;

export interface ClosedTabRecord
{
  id: string;
  url: string;
  title: string;
  favIconUrl: string;
  closedAt: number;
}

type StoredRecentlyClosed = Record<string, ClosedTabRecord[]>;

function isClosedTabRecord(value: unknown): value is ClosedTabRecord
{
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && entry.id !== ''
    && typeof entry.url === 'string' && entry.url !== ''
    && typeof entry.title === 'string'
    && typeof entry.favIconUrl === 'string'
    && Number.isFinite(entry.closedAt);
}

function copyRecord(record: ClosedTabRecord): ClosedTabRecord
{
  const { id, url, title, favIconUrl, closedAt } = record;
  return { id, url, title, favIconUrl, closedAt };
}

/**
 * Closed tabs by Space id, newest first. Every change returns a new instance, so the
 * sidebar can hold one in React state and the manager can swap it in after a write.
 */
export class RecentlyClosedTabs
{
  readonly #bySpace: ReadonlyMap<string, readonly ClosedTabRecord[]>;

  private constructor(bySpace: ReadonlyMap<string, readonly ClosedTabRecord[]>)
  {
    this.#bySpace = bySpace;
  }

  static empty(): RecentlyClosedTabs
  {
    return new RecentlyClosedTabs(new Map());
  }

  /**
   * Parse the stored value: the JSON string the manager writes, or the parsed object.
   * A malformed value yields an empty list and a malformed record is dropped, so a bad
   * value never breaks the sidebar.
   */
  static fromStored(raw: unknown): RecentlyClosedTabs
  {
    let value = raw;
    if (typeof value === 'string')
    {
      try
      {
        value = JSON.parse(value);
      }
      catch
      {
        return RecentlyClosedTabs.empty();
      }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return RecentlyClosedTabs.empty();

    const bySpace = new Map<string, readonly ClosedTabRecord[]>();
    for (const [spaceId, records] of Object.entries(value as Record<string, unknown>))
    {
      if (spaceId === '' || !Array.isArray(records)) continue;
      const valid = records.filter(isClosedTabRecord).map(copyRecord)
        .sort((a, b) => b.closedAt - a.closedAt)
        .slice(0, RECENTLY_CLOSED_PER_SPACE);
      if (valid.length > 0) bySpace.set(spaceId, valid);
    }
    return new RecentlyClosedTabs(bySpace);
  }

  toStored(): StoredRecentlyClosed
  {
    const stored: StoredRecentlyClosed = {};
    for (const [spaceId, records] of this.#bySpace)
    {
      stored[spaceId] = records.map(copyRecord);
    }
    return stored;
  }

  /** Newest first. */
  forSpace(spaceId: string): readonly ClosedTabRecord[]
  {
    return this.#bySpace.get(spaceId) ?? [];
  }

  hasRecords(spaceId: string): boolean
  {
    return this.forSpace(spaceId).length > 0;
  }

  find(spaceId: string, id: string): ClosedTabRecord | undefined
  {
    return this.forSpace(spaceId).find(record => record.id === id);
  }

  /**
   * The record goes on top of its Space's list. An older record of the same URL in that
   * Space is replaced, so reopening and closing a page again doesn't fill the list;
   * the same URL in another Space is a separate record. The oldest records beyond the
   * cap are dropped.
   */
  add(spaceId: string, record: ClosedTabRecord): RecentlyClosedTabs
  {
    const others = this.forSpace(spaceId).filter(existing => existing.url !== record.url);
    const records = [copyRecord(record), ...others].slice(0, RECENTLY_CLOSED_PER_SPACE);
    return this.#withSpace(spaceId, records);
  }

  remove(spaceId: string, id: string): RecentlyClosedTabs
  {
    if (!this.find(spaceId, id)) return this;
    return this.#withSpace(spaceId, this.forSpace(spaceId).filter(record => record.id !== id));
  }

  clearSpace(spaceId: string): RecentlyClosedTabs
  {
    if (!this.#bySpace.has(spaceId)) return this;
    return this.#withSpace(spaceId, []);
  }

  /** Drops the records of Spaces that no longer exist. */
  retainSpaces(spaceIds: Iterable<string>): RecentlyClosedTabs
  {
    const keep = new Set(spaceIds);
    const kept = new Map<string, readonly ClosedTabRecord[]>();
    for (const [spaceId, records] of this.#bySpace)
    {
      if (keep.has(spaceId)) kept.set(spaceId, records);
    }
    if (kept.size === this.#bySpace.size) return this;
    return new RecentlyClosedTabs(kept);
  }

  #withSpace(spaceId: string, records: readonly ClosedTabRecord[]): RecentlyClosedTabs
  {
    const bySpace = new Map(this.#bySpace);
    if (records.length === 0)
    {
      bySpace.delete(spaceId);
    }
    else
    {
      bySpace.set(spaceId, records);
    }
    return new RecentlyClosedTabs(bySpace);
  }
}
