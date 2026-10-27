// Last-active time of each bookmark's Arc-style tab (feature 034).
// background.ts is the only writer (BookmarkRecencyStore); the sidebar reads
// the same key through useChromeLocalStorage and wraps it in BookmarkRecency.

export const BOOKMARK_RECENCY_KEY = 'bookmarkLastActiveAt';

/** Serialized form: JSON string of bookmarkId → epoch millis. */
export type BookmarkRecencyRecord = Record<string, number>;

/** Read-only view of the recency record, as the sidebar consumes it. */
export class BookmarkRecency
{
  static readonly EMPTY = new BookmarkRecency({});

  #lastActiveAt: BookmarkRecencyRecord;

  constructor(record: BookmarkRecencyRecord)
  {
    this.#lastActiveAt = record;
  }

  /** Epoch millis of the bookmark's last activation, or undefined if never active. */
  lastActiveAt(bookmarkId: string): number | undefined
  {
    return this.#lastActiveAt[bookmarkId];
  }

  wasEverActive(bookmarkId: string): boolean
  {
    return this.#lastActiveAt[bookmarkId] !== undefined;
  }
}

export interface BookmarkRecencyStorage
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

/** Background-side writer. Serializes read-modify-write so concurrent touches don't drop entries. */
export class BookmarkRecencyStore
{
  #storage: BookmarkRecencyStorage;
  #now: () => number;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: BookmarkRecencyStorage, now: () => number = Date.now)
  {
    this.#storage = storage;
    this.#now = now;
  }

  async read(): Promise<BookmarkRecency>
  {
    await this.#tail;
    return new BookmarkRecency(await this.#read());
  }

  /** Record that the bookmark's tab is active right now. */
  touch(bookmarkId: string): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const record = await this.#read();
      record[bookmarkId] = this.#now();
      await this.#write(record);
    });
  }

  /** Drop entries for removed bookmarks. */
  forget(bookmarkIds: string[]): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const record = await this.#read();
      const known = bookmarkIds.filter(id => id in record);
      if (known.length === 0) return;

      // Remove each removed bookmark's entry
      for (const id of known) delete record[id];
      await this.#write(record);
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #read(): Promise<BookmarkRecencyRecord>
  {
    const result = await this.#storage.get(BOOKMARK_RECENCY_KEY);
    const raw = result[BOOKMARK_RECENCY_KEY];
    if (typeof raw !== 'string') return {};
    try
    {
      return JSON.parse(raw) as BookmarkRecencyRecord;
    }
    catch
    {
      return {};
    }
  }

  #write(record: BookmarkRecencyRecord): Promise<void>
  {
    return this.#storage.set({ [BOOKMARK_RECENCY_KEY]: JSON.stringify(record) });
  }
}
