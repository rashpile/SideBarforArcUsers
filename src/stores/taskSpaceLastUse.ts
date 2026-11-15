// Last use of each Task Space: the Space bar shows a temporary icon for a while after it, and
// auto-archive counts its period from it. background.ts is the only writer
// (TaskSpaceLastUseStore); the sidebar reads the same key through useChromeLocalStorage and
// wraps it in TaskSpaceLastUse.

export const TASK_SPACE_LAST_USE_KEY = 'taskSpaceLastUsedAt';

// Every tab activation inside a Task Space touches it, so closer touches are dropped
// instead of writing storage on each tab switch
export const TASK_SPACE_TOUCH_INTERVAL_MS = 60_000;

// Keeps only entries holding a finite number, so a corrupt or hand-edited value reads as
// "never used" rather than as a time that keeps a Task Space from archiving
function validEntries(value: unknown): Map<string, number>
{
  const entries = new Map<string, number>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return entries;

  for (const [spaceId, time] of Object.entries(value))
  {
    if (typeof time === 'number' && Number.isFinite(time)) entries.set(spaceId, time);
  }
  return entries;
}

/** Read-only view of the last-use times, as the sidebar and the archiver consume them. */
export class TaskSpaceLastUse
{
  static readonly EMPTY = new TaskSpaceLastUse(new Map());

  #lastUsedAt: ReadonlyMap<string, number>;

  constructor(lastUsedAt: ReadonlyMap<string, number>)
  {
    this.#lastUsedAt = lastUsedAt;
  }

  /** The stored value as useChromeLocalStorage parses it; junk entries read as absent. */
  static fromStored(value: unknown): TaskSpaceLastUse
  {
    return new TaskSpaceLastUse(validEntries(value));
  }

  /** Epoch millis of the Space's last use, or undefined if none was recorded. */
  lastUsedAt(spaceId: string): number | undefined
  {
    return this.#lastUsedAt.get(spaceId);
  }
}

export interface TaskSpaceLastUseStorage
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

/** Background-side writer. Serializes read-modify-write so concurrent touches don't drop entries. */
export class TaskSpaceLastUseStore
{
  #storage: TaskSpaceLastUseStorage;
  #now: () => number;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: TaskSpaceLastUseStorage, now: () => number = Date.now)
  {
    this.#storage = storage;
    this.#now = now;
  }

  async read(): Promise<TaskSpaceLastUse>
  {
    await this.#tail;
    return new TaskSpaceLastUse(await this.#read());
  }

  /** Record that the Task Space is in use right now. */
  touch(spaceId: string): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const entries = await this.#read();
      const now = this.#now();
      const previous = entries.get(spaceId);
      // A stored time ahead of the clock (the clock was set back) is overwritten, or it would
      // keep the Space looking recently used until the clock catches up
      if (previous !== undefined && previous <= now && now - previous < TASK_SPACE_TOUCH_INTERVAL_MS) return;

      entries.set(spaceId, now);
      await this.#write(entries);
    });
  }

  /** Drop entries of Spaces that are no longer live or archived Task Spaces. */
  retain(taskSpaceIds: Iterable<string>): Promise<void>
  {
    const kept = new Set(taskSpaceIds);
    return this.#enqueue(async () =>
    {
      const entries = await this.#read();
      const dropped = [...entries.keys()].filter(spaceId => !kept.has(spaceId));
      if (dropped.length === 0) return;

      for (const spaceId of dropped) entries.delete(spaceId);
      await this.#write(entries);
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #read(): Promise<Map<string, number>>
  {
    const result = await this.#storage.get(TASK_SPACE_LAST_USE_KEY);
    const raw = result[TASK_SPACE_LAST_USE_KEY];
    if (typeof raw !== 'string') return new Map();
    try
    {
      return validEntries(JSON.parse(raw));
    }
    catch
    {
      return new Map();
    }
  }

  // A JSON string, as the sidebar's useChromeLocalStorage parses it by default
  #write(entries: ReadonlyMap<string, number>): Promise<void>
  {
    return this.#storage.set({ [TASK_SPACE_LAST_USE_KEY]: JSON.stringify(Object.fromEntries(entries)) });
  }
}
