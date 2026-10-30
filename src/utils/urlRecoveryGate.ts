// Runs the sidebar's URL pass, which binds open tabs to bookmarks and Favorites
// by URL, once per browser session per window.
//
// The pass exists to re-link bookmark pages after their tab IDs were lost: a
// browser restart or an extension reload/update. chrome.storage.session is
// cleared in exactly those cases, so a marker there tells the sidebar the pass
// already ran. Running it on every rebuild would bind tabs the user opened by
// hand on a bookmarked URL, pulling them out of the Tab list; during a session
// associations come only from explicit actions.

import { BrowserSessionMarker } from '../stores/browserSessionMarker.ts';
import type { BrowserSessionStorage } from '../stores/browserSessionMarker.ts';

export class UrlRecoveryGate
{
  static readonly KEY_PREFIX = 'urlRecoveryDone_';

  #marker: BrowserSessionMarker;
  #inFlight = false;

  constructor(storage: BrowserSessionStorage, windowId: number)
  {
    this.#marker = new BrowserSessionMarker(storage, UrlRecoveryGate.keyFor(windowId));
  }

  static keyFor(windowId: number): string
  {
    return `${UrlRecoveryGate.KEY_PREFIX}${windowId}`;
  }

  /**
   * Runs `pass` unless it already finished in this browser session for this
   * window or is running now. Resolves to true when the pass ran. A rejected
   * pass leaves the marker unset and rejects, so the next call retries.
   */
  async runOnce(pass: () => Promise<void>): Promise<boolean>
  {
    if (this.#inFlight)
    {
      return false;
    }
    // Set before the first await so a second rebuild right after can't start another pass
    this.#inFlight = true;
    try
    {
      if (await this.#marker.isSameBrowserSession())
      {
        return false;
      }
      await pass();
      await this.#marker.mark();
      return true;
    }
    finally
    {
      this.#inFlight = false;
    }
  }
}
