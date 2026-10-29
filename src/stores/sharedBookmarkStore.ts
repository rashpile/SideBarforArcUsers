export interface BookmarkTreeSource
{
  readTree: (
    onResult: (tree: chrome.bookmarks.BookmarkTreeNode[], error: string | null) => void
  ) => void;
  subscribe: (onChange: () => void) => (() => void);
}

export interface BookmarkStoreSnapshot
{
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  error: string | null;
}

/**
 * The Side Panel mounts several components at once on first open. Sharing one bookmark tree and
 * one set of Chrome event listeners among the useBookmarks callers keeps each of them from
 * calling getTree and adding duplicate listeners, while the bookmark operation API stays the same.
 */
export class SharedBookmarkStore
{
  #sourceFactory: () => BookmarkTreeSource | undefined;
  #isBatchOperation: () => boolean;
  #debounceMs: number;
  #snapshot: BookmarkStoreSnapshot = { bookmarks: [], error: null };
  #listeners = new Set<() => void>();
  #source: BookmarkTreeSource | null = null;
  #unsubscribeSource: (() => void) | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshInFlight = false;
  #refreshQueued = false;
  #measureInitialRead = false;

  constructor(
    sourceFactory: () => BookmarkTreeSource | undefined,
    isBatchOperation: () => boolean,
    debounceMs: number = 50
  )
  {
    this.#sourceFactory = sourceFactory;
    this.#isBatchOperation = isBatchOperation;
    this.#debounceMs = debounceMs;
  }

  getSnapshot = (): BookmarkStoreSnapshot => this.#snapshot;

  subscribe = (onChange: () => void): (() => void) =>
  {
    this.#listeners.add(onChange);
    if (this.#listeners.size === 1)
    {
      this.#start();
    }

    return () =>
    {
      this.#listeners.delete(onChange);
      if (this.#listeners.size === 0)
      {
        this.#stop();
      }
    };
  };

  /** Concurrent calls merge into one refresh that runs after the current one ends. */
  refresh = (): void =>
  {
    const source = this.#source ?? this.#sourceFactory();
    if (!source)
    {
      this.#setSnapshot({ bookmarks: [], error: 'Unable to access browser bookmarks' });
      return;
    }

    if (this.#refreshInFlight)
    {
      this.#refreshQueued = true;
      return;
    }

    this.#refreshInFlight = true;
    source.readTree((tree, error) =>
    {
      this.#refreshInFlight = false;
      if (this.#measureInitialRead)
      {
        this.#measureInitialRead = false;
        performance.mark('sidebar:bookmarks-ready');
        performance.measure('sidebar:bookmarks-load', 'sidebar:bookmarks-start', 'sidebar:bookmarks-ready');
      }
      const bookmarks = !error && tree.length > 0 ? tree[0].children ?? [] : this.#snapshot.bookmarks;
      this.#setSnapshot({ bookmarks, error });

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
      this.#setSnapshot({ bookmarks: [], error: 'Unable to access browser bookmarks' });
      return;
    }

    this.#unsubscribeSource = this.#source.subscribe(this.#handleSourceChange);
    this.#measureInitialRead = performance.getEntriesByName('sidebar:bookmarks-load').length === 0;
    if (this.#measureInitialRead) performance.mark('sidebar:bookmarks-start');
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

  #setSnapshot(next: BookmarkStoreSnapshot): void
  {
    this.#snapshot = next;
    for (const listener of this.#listeners)
    {
      listener();
    }
  }
}
