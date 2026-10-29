export interface TabAssociationBackupEntry
{
  tabId: number;
  url: string;
  tabIndex: number;
}

export type WindowAssociationBackup = Record<string, TabAssociationBackupEntry>;

export interface TabAssociationBackupStorage
{
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

const BACKUP_KEY_PREFIX = 'tabAssociationsBackup_';
const BACKUP_WINDOW_IDS_KEY = 'tabAssociationsBackupWindowIds';

const backupKey = (windowId: number) => `${BACKUP_KEY_PREFIX}${windowId}`;

export class TabAssociationBackupStore
{
  #storage: TabAssociationBackupStorage;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: TabAssociationBackupStorage)
  {
    this.#storage = storage;
  }

  async read(windowId: number): Promise<WindowAssociationBackup>
  {
    await this.#tail;
    return this.#readBackup(windowId);
  }

  async windowIds(): Promise<number[]>
  {
    await this.#tail;
    return this.#readWindowIds();
  }

  save(windowId: number, itemKey: string, entry: TabAssociationBackupEntry): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const [backup, ids] = await Promise.all([
        this.#readBackup(windowId),
        this.#readWindowIds(),
      ]);
      backup[itemKey] = entry;
      await this.#storage.set({
        [backupKey(windowId)]: backup,
        [BACKUP_WINDOW_IDS_KEY]: ids.includes(windowId) ? ids : [...ids, windowId],
      });
    });
  }

  remove(windowId: number, itemKey: string): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const backup = await this.#readBackup(windowId);
      if (!(itemKey in backup)) return;
      delete backup[itemKey];

      if (Object.keys(backup).length > 0)
      {
        await this.#storage.set({ [backupKey(windowId)]: backup });
        return;
      }

      const ids = await this.#readWindowIds();
      await this.#storage.set({
        [BACKUP_WINDOW_IDS_KEY]: ids.filter(id => id !== windowId),
      });
      await this.#storage.remove(backupKey(windowId));
    });
  }

  updateIndices(windowId: number, itemKeyToIndex: Record<string, number>): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const backup = await this.#readBackup(windowId);
      let changed = false;

      // All affected items of the window in one serial transaction, so the object is written once.
      for (const [itemKey, tabIndex] of Object.entries(itemKeyToIndex))
      {
        const entry = backup[itemKey];
        if (!entry || entry.tabIndex === tabIndex) continue;
        backup[itemKey] = { ...entry, tabIndex };
        changed = true;
      }

      if (changed) await this.#storage.set({ [backupKey(windowId)]: backup });
    });
  }

  removeWindow(windowId: number): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const ids = await this.#readWindowIds();
      await this.#storage.set({
        [BACKUP_WINDOW_IDS_KEY]: ids.filter(id => id !== windowId),
      });
      await this.#storage.remove(backupKey(windowId));
    });
  }

  replaceAll(backups: ReadonlyMap<number, WindowAssociationBackup>): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const previousIds = await this.#readWindowIds();
      const nextIds = Array.from(backups.keys());
      const values: Record<string, unknown> = {
        [BACKUP_WINDOW_IDS_KEY]: nextIds,
      };

      // The restore writes all valid windows at once instead of a read-modify-write per window.
      for (const [windowId, backup] of backups)
      {
        values[backupKey(windowId)] = backup;
      }
      await this.#storage.set(values);

      const staleKeys = previousIds
        .filter(windowId => !backups.has(windowId))
        .map(backupKey);
      if (staleKeys.length > 0) await this.#storage.remove(staleKeys);
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #readBackup(windowId: number): Promise<WindowAssociationBackup>
  {
    const result = await this.#storage.get(backupKey(windowId));
    return (result[backupKey(windowId)] as WindowAssociationBackup | undefined) ?? {};
  }

  async #readWindowIds(): Promise<number[]>
  {
    const result = await this.#storage.get(BACKUP_WINDOW_IDS_KEY);
    return (result[BACKUP_WINDOW_IDS_KEY] as number[] | undefined) ?? [];
  }
}
