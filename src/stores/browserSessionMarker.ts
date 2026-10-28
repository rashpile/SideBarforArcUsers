// Tells a service-worker restart from a fresh start for code that re-attaches
// records saved per tab to the live tabs.
//
// chrome.storage.session survives worker restarts and is cleared when the
// browser restarts and when the extension is reloaded or updated. The owner
// writes its marker once it has matched its stored records to the live tabs, so
// a later worker start in the same browser session finds it: the stored tab and
// window IDs are exact. Without it the IDs may come from an earlier browser
// session, where Chrome hands out low IDs again, and records must be matched by
// what the tabs show instead.
//
// Each owner keeps its own key: background.ts marks the startup restore of
// Space assignments and associations, TabActivityTracker its last-use records.

export interface BrowserSessionStorage
{
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

export class BrowserSessionMarker
{
  #storage: BrowserSessionStorage;
  #key: string;

  /** `key`: the chrome.storage.session key this marker is stored under. */
  constructor(storage: BrowserSessionStorage, key: string)
  {
    this.#storage = storage;
    this.#key = key;
  }

  /**
   * True when an earlier worker of this browser session already matched the
   * stored records. Read it before the records are rewritten with this
   * worker's matches. An unreadable marker counts as missing (the stricter
   * matching).
   */
  async isSameBrowserSession(): Promise<boolean>
  {
    try
    {
      const result = await this.#storage.get(this.#key);
      return result[this.#key] === true;
    }
    catch (error)
    {
      console.error(`[BrowserSessionMarker] failed to read ${this.#key}:`, error);
      return false;
    }
  }

  /**
   * Mark this browser session: the stored records now carry its tab IDs. Call
   * only after every match that read isSameBrowserSession is done. Never
   * throws - a lost write only makes the next worker start match strictly.
   */
  async mark(): Promise<void>
  {
    try
    {
      await this.#storage.set({ [this.#key]: true });
    }
    catch (error)
    {
      console.error(`[BrowserSessionMarker] failed to write ${this.#key}:`, error);
    }
  }
}
