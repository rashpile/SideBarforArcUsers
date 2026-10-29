export interface TabAssociationSessionStorage
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

const storageKey = (windowId: number) => `tabAssociations_${windowId}`;

/** Serialized writes to the session tabId → pinned item map, so concurrent updates lose nothing. */
export class TabAssociationSessionStore
{
  #storage: TabAssociationSessionStorage;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: TabAssociationSessionStorage)
  {
    this.#storage = storage;
  }

  async read(windowId: number): Promise<Record<number, string>>
  {
    await this.#tail;
    return this.#read(windowId);
  }

  save(windowId: number, tabId: number, itemKey: string): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const associations = await this.#read(windowId);
      associations[tabId] = itemKey;
      await this.#write(windowId, associations);
    });
  }

  remove(windowId: number, tabId: number): Promise<void>
  {
    return this.#enqueue(async () =>
    {
      const associations = await this.#read(windowId);
      delete associations[tabId];
      await this.#write(windowId, associations);
    });
  }

  replace(windowId: number, associations: Record<number, string>): Promise<void>
  {
    return this.#enqueue(() => this.#write(windowId, associations));
  }

  #enqueue(task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #read(windowId: number): Promise<Record<number, string>>
  {
    const key = storageKey(windowId);
    const result = await this.#storage.get(key);
    return (result[key] as Record<number, string> | undefined) ?? {};
  }

  #write(windowId: number, associations: Record<number, string>): Promise<void>
  {
    return this.#storage.set({ [storageKey(windowId)]: associations });
  }
}
