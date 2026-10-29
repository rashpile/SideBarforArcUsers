export interface TabSource
{
  readTabs: (onResult: (tabs: chrome.tabs.Tab[], error: string | null) => void) => void;
  subscribe: (onChange: () => void) => (() => void);
}

export interface TabStoreSnapshot
{
  tabs: chrome.tabs.Tab[];
  error: string | null;
}

export class SharedTabStore
{
  #sourceFactory: () => TabSource | undefined;
  #isBatchOperation: () => boolean;
  #debounceMs: number;
  #snapshot: TabStoreSnapshot = { tabs: [], error: null };
  #listeners = new Set<() => void>();
  #source: TabSource | null = null;
  #unsubscribeSource: (() => void) | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshInFlight = false;
  #refreshQueued = false;
  #measureInitialRead = false;

  constructor(
    sourceFactory: () => TabSource | undefined,
    isBatchOperation: () => boolean,
    debounceMs: number = 50
  )
  {
    this.#sourceFactory = sourceFactory;
    this.#isBatchOperation = isBatchOperation;
    this.#debounceMs = debounceMs;
  }

  getSnapshot = (): TabStoreSnapshot => this.#snapshot;

  subscribe = (onChange: () => void): (() => void) =>
  {
    this.#listeners.add(onChange);
    if (this.#listeners.size === 1) this.#start();

    return () =>
    {
      this.#listeners.delete(onChange);
      if (this.#listeners.size === 0) this.#stop();
    };
  };

  refresh = (): void =>
  {
    const source = this.#source ?? this.#sourceFactory();
    if (!source)
    {
      this.#setSnapshot({ tabs: [], error: 'Unable to access browser tabs' });
      return;
    }

    if (this.#refreshInFlight)
    {
      this.#refreshQueued = true;
      return;
    }

    this.#refreshInFlight = true;
    source.readTabs((tabs, error) =>
    {
      this.#refreshInFlight = false;
      if (this.#measureInitialRead)
      {
        this.#measureInitialRead = false;
        performance.mark('sidebar:tabs-ready');
        performance.measure('sidebar:tabs-load', 'sidebar:tabs-start', 'sidebar:tabs-ready');
      }
      this.#setSnapshot({ tabs: error ? this.#snapshot.tabs : tabs, error });
      if (this.#refreshQueued)
      {
        this.#refreshQueued = false;
        this.refresh();
      }
    });
  };

  #start(): void
  {
    this.#source = this.#sourceFactory() ?? null;
    if (!this.#source)
    {
      this.#setSnapshot({ tabs: [], error: 'Unable to access browser tabs' });
      return;
    }
    this.#unsubscribeSource = this.#source.subscribe(this.#handleSourceChange);
    this.#measureInitialRead = performance.getEntriesByName('sidebar:tabs-load').length === 0;
    if (this.#measureInitialRead) performance.mark('sidebar:tabs-start');
    this.refresh();
  }

  #stop(): void
  {
    this.#unsubscribeSource?.();
    this.#unsubscribeSource = null;
    this.#source = null;
    if (this.#refreshTimer)
    {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }

  #handleSourceChange = (): void =>
  {
    if (this.#isBatchOperation()) return;
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() =>
    {
      this.#refreshTimer = null;
      this.refresh();
    }, this.#debounceMs);
  };

  #setSnapshot(next: TabStoreSnapshot): void
  {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
