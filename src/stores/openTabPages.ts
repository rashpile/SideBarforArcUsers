// OpenTabPages - the page and Space of every open tab, kept so a tab's close can
// still be recorded in Recently Closed.
//
// tabs.onRemoved carries no URL or title, and when a close wakes the sleeping
// service worker the closed tab is already gone from tabs.query and from
// TabSpaceRegistry (its load re-matches live tabs only). The pages are therefore
// kept in chrome.storage.session: it survives worker restarts and is cleared on
// browser restart, the same lifespan as the tab ids it is keyed by.
//
// `associated` is set whenever background sees a bookmark or Favorite association
// for the tab and is never cleared: the sidebar deletes a closed tab's association
// at the same moment background handles the close, so a close-time lookup would
// usually find nothing.
//
// background.ts is the only writer. Writes are serialized through a write tail and
// skipped when nothing changed.

/** What the cache knows about one open tab. */
export interface OpenTabPage
{
  url: string;
  title: string;
  favIconUrl: string;
  incognito: boolean;
  /** The tab's Space as last registered; undefined until it gets one. */
  spaceId?: string;
  /** The tab had a bookmark or Favorite association at some point while open. */
  associated: boolean;
}

/** The fields of chrome.tabs.Tab the cache reads. */
export interface PageTabLike
{
  id?: number;
  url?: string;
  /** The URL a new tab is loading before it commits; url is empty until then. */
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  incognito?: boolean;
}

/** The chrome.storage area the cache lives in (session in background, a fake in tests). */
export interface OpenTabPagesStorageArea
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

interface StoredOpenTabPage extends OpenTabPage
{
  tabId: number;
}

const EMPTY_PAGE: OpenTabPage = { url: '', title: '', favIconUrl: '', incognito: false, associated: false };

function isStoredOpenTabPage(value: unknown): value is StoredOpenTabPage
{
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Number.isInteger(entry.tabId)
    && typeof entry.url === 'string'
    && typeof entry.title === 'string'
    && typeof entry.favIconUrl === 'string'
    && typeof entry.incognito === 'boolean'
    && (entry.spaceId === undefined || (typeof entry.spaceId === 'string' && entry.spaceId !== ''))
    && typeof entry.associated === 'boolean';
}

function samePage(a: OpenTabPage, b: OpenTabPage): boolean
{
  return a.url === b.url
    && a.title === b.title
    && a.favIconUrl === b.favIconUrl
    && a.incognito === b.incognito
    && a.spaceId === b.spaceId
    && a.associated === b.associated;
}

// The tab's page fields over what the cache knew; Space and association flag are kept
function pageOf(tab: PageTabLike, known: OpenTabPage | undefined): OpenTabPage
{
  return {
    url: tab.url || tab.pendingUrl || '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? '',
    incognito: tab.incognito === true,
    spaceId: known?.spaceId,
    associated: known?.associated ?? false,
  };
}

export class OpenTabPages
{
  static readonly STORAGE_KEY = 'openTabPages';

  readonly #storage: OpenTabPagesStorageArea;
  #byTabId = new Map<number, OpenTabPage>();
  #writeTail: Promise<void> = Promise.resolve();

  // Every change waits for load, so an event that arrives while the stored pages are
  // still being read is applied over them instead of being overwritten by them
  #resolveLoaded!: () => void;
  readonly #loaded = new Promise<void>(resolve => { this.#resolveLoaded = resolve; });

  constructor(storage: OpenTabPagesStorageArea)
  {
    this.#storage = storage;
  }

  /**
   * Read the stored pages. Never rejects: a failed read or a malformed value starts
   * the cache empty, which loses only the pages of tabs closed while the worker slept.
   */
  async load(): Promise<void>
  {
    try
    {
      const result = await this.#storage.get(OpenTabPages.STORAGE_KEY);
      const stored = result[OpenTabPages.STORAGE_KEY];
      if (Array.isArray(stored))
      {
        for (const entry of stored)
        {
          if (!isStoredOpenTabPage(entry)) continue;
          const { tabId, url, title, favIconUrl, incognito, spaceId, associated } = entry;
          this.#byTabId.set(tabId, { url, title, favIconUrl, incognito, spaceId, associated });
        }
      }
    }
    catch
    {
      this.#byTabId.clear();
    }
    finally
    {
      this.#resolveLoaded();
    }
  }

  /** The cached page of an open tab, for tests and diagnostics. */
  page(tabId: number): OpenTabPage | undefined
  {
    const page = this.#byTabId.get(tabId);
    return page ? { ...page } : undefined;
  }

  /** The tab's page changed (created, navigated, retitled, new icon). Keeps its Space and flag. */
  async update(tab: PageTabLike): Promise<void>
  {
    if (tab.id === undefined) return;
    const tabId = tab.id;
    await this.#loaded;
    this.#put(tabId, pageOf(tab, this.#byTabId.get(tabId)));
    await this.#writeTail;
  }

  /** The tab was registered in a Space. */
  async assignSpace(tabId: number, spaceId: string): Promise<void>
  {
    await this.#loaded;
    const known = this.#byTabId.get(tabId) ?? EMPTY_PAGE;
    this.#put(tabId, { ...known, spaceId });
    await this.#writeTail;
  }

  /** These tabs have a bookmark or Favorite association; the flag is never cleared. */
  async markAssociated(tabIds: Iterable<number>): Promise<void>
  {
    await this.#loaded;
    for (const tabId of tabIds)
    {
      const known = this.#byTabId.get(tabId) ?? EMPTY_PAGE;
      this.#put(tabId, { ...known, associated: true });
    }
    await this.#writeTail;
  }

  /** The closed tab's page, removed from the cache; undefined when the cache never saw it. */
  async take(tabId: number): Promise<OpenTabPage | undefined>
  {
    await this.#loaded;
    const page = this.#byTabId.get(tabId);
    if (!page) return undefined;
    this.#byTabId.delete(tabId);
    this.#scheduleWrite();
    await this.#writeTail;
    return { ...page };
  }

  /**
   * Bring the cache up to date with the live tabs at worker start. Entries of tabs that
   * are not live are kept: one of them may be the tab whose close woke the worker, and
   * its onRemoved is handled after this. A live tab keeps its cached Space when
   * `spaceOf` doesn't know it.
   */
  async seed(
    liveTabs: readonly PageTabLike[],
    spaceOf: (tabId: number) => string | undefined,
    associatedTabIds: Iterable<number> = [],
  ): Promise<void>
  {
    await this.#loaded;
    const associated = new Set(associatedTabIds);
    for (const tab of liveTabs)
    {
      if (tab.id === undefined) continue;
      const page = pageOf(tab, this.#byTabId.get(tab.id));
      page.spaceId = spaceOf(tab.id) ?? page.spaceId;
      page.associated = page.associated || associated.has(tab.id);
      this.#put(tab.id, page);
    }
    await this.#writeTail;
  }

  #put(tabId: number, page: OpenTabPage): void
  {
    const known = this.#byTabId.get(tabId);
    if (known && samePage(known, page)) return;
    this.#byTabId.set(tabId, page);
    this.#scheduleWrite();
  }

  // The write stores the cache as it is when the write runs, so a burst of changes
  // ends with the latest state; a failed write is retried by the next change
  #scheduleWrite(): void
  {
    this.#writeTail = this.#writeTail
      .then(() => this.#storage.set({ [OpenTabPages.STORAGE_KEY]: this.#toStored() }))
      .catch(() => undefined);
  }

  #toStored(): StoredOpenTabPage[]
  {
    return [...this.#byTabId].map(([tabId, page]) =>
    {
      const entry: StoredOpenTabPage = { tabId, ...page };
      if (entry.spaceId === undefined) delete entry.spaceId;
      return entry;
    });
  }
}
