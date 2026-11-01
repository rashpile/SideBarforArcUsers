// Sidebar-side client for background.ts's PageStyleManager.
//
// Same mirror pattern as attentionMarkProxy: own echo skipped, foreign broadcasts held while this
// context has writes in flight, and the last write's ack settles the mirror. Background changes
// styles on its own (a bookmark deleted), so toggle and remove are per-operation optimistic
// writes through the SavedPageStyles operations the manager runs. Save is not optimistic: the
// manager makes the rev, so the mirror can only learn the new record from the response. Restore
// isn't either: the manager may refuse the record, and Undo needs no instant brush.

import { ManagerId, callManager, CONTEXT_ID } from './messageRouting';
import type { Remote } from './messageRouting';
import { PAGE_STYLES_CHANGED } from '../shared/pageStyleApi';
import type { PageStyleApi, PageStylesState } from '../shared/pageStyleApi';
import { SavedPageStyles } from '../../stores/savedPageStyles';
import type { StoredPageStyle } from '../../stores/savedPageStyles';
import { ExternalStore, ReadableStore } from '../../stores/externalStore';

class PageStyleProxy implements Remote<PageStyleApi>
{
  #store = new ExternalStore<SavedPageStyles>(new SavedPageStyles());
  #subscribed = false;
  #pendingWrites = 0;
  #missedBroadcast = false;

  /**
   * Read-only handle on the mirror: for useSyncExternalStore, and `store.getSnapshot()` for code
   * outside React that needs the styles at call time. Empty until load() has run once.
   */
  get store(): ReadableStore<SavedPageStyles>
  {
    return this.#store;
  }

  /** Subscribes to broadcasts and fills the mirror. Safe to call more than once (StrictMode, several hooks). */
  async load(): Promise<void>
  {
    this.#subscribeToBroadcasts();
    const state = await this.getState();
    if (this.#pendingWrites === 0) this.#apply(state);
  }

  // Never unsubscribed: the proxy is a module singleton that outlives every component
  #subscribeToBroadcasts(): void
  {
    if (this.#subscribed) return;
    this.#subscribed = true;

    chrome.runtime.onMessage.addListener((message) =>
    {
      if (message?.action === PAGE_STYLES_CHANGED)
      {
        this.#onBroadcast(message.state as PageStylesState, message.senderId as string | undefined);
      }
    });
  }

  // A foreign broadcast that arrives while our writes are in flight was built before background
  // saw them; applying it would undo them on screen. The last write out re-reads instead.
  #onBroadcast(state: PageStylesState, senderId: string | undefined): void
  {
    if (senderId === CONTEXT_ID) return;

    if (this.#pendingWrites > 0)
    {
      this.#missedBroadcast = true;
      return;
    }

    this.#apply(state);
  }

  #apply(state: PageStylesState): void
  {
    this.#applyStyles(SavedPageStyles.fromStored(state.styles));
  }

  // An equal collection keeps the old instance, so consumers don't re-render for an ack that
  // only confirms the optimistic write
  #applyStyles(next: SavedPageStyles): void
  {
    if (next.equals(this.#store.getSnapshot())) return;
    this.#store.set(next);
  }

  async #mutate(
    method: string,
    payload: Record<string, unknown>,
    optimistic: (styles: SavedPageStyles) => SavedPageStyles = styles => styles
  ): Promise<PageStylesState>
  {
    this.#applyStyles(optimistic(this.#store.getSnapshot()));
    this.#pendingWrites++;

    let result: PageStylesState;
    try
    {
      result = await callManager<PageStylesState>(ManagerId.PAGE_STYLES, method, payload);
    }
    catch (error)
    {
      // Re-read rather than roll back: a rollback could undo a later write that did succeed
      this.#pendingWrites--;
      console.error(`[pageStyleProxy] ${method} failed, resyncing:`, error);
      this.getState()
        .then((current) => { if (this.#pendingWrites === 0) this.#apply(current); })
        .catch(() => {});
      throw error;
    }

    this.#pendingWrites--;
    await this.#drain(result);
    return result;
  }

  // The last write back settles the mirror with its ack: that is how a save's new record (and
  // rev) reaches it. With no foreign broadcast held back, no newer state than the ack can have
  // reached this context.
  async #drain(ack: PageStylesState): Promise<void>
  {
    if (this.#pendingWrites > 0) return;

    if (!this.#missedBroadcast)
    {
      this.#apply(ack);
      return;
    }

    this.#missedBroadcast = false;

    try
    {
      const current = await this.getState();
      if (this.#pendingWrites > 0) return;
      this.#apply(current);
    }
    catch
    {
      if (this.#pendingWrites === 0) this.#apply(ack);
    }
  }

  /** Plain read - does not touch the mirror. */
  async getState(): Promise<PageStylesState>
  {
    return await callManager<PageStylesState>(ManagerId.PAGE_STYLES, 'getState');
  }

  async save(bookmarkId: string, css: string, pageUrl: string): Promise<PageStylesState>
  {
    return this.#mutate('save', { bookmarkId, css, pageUrl });
  }

  async setAutoApply(bookmarkId: string, on: boolean): Promise<PageStylesState>
  {
    return this.#mutate('setAutoApply', { bookmarkId, on }, styles => styles.withAutoApply(bookmarkId, on));
  }

  async remove(bookmarkId: string): Promise<PageStylesState>
  {
    return this.#mutate('remove', { bookmarkId }, styles => styles.without([bookmarkId]));
  }

  async restore(bookmarkId: string, style: StoredPageStyle): Promise<PageStylesState>
  {
    return this.#mutate('restore', { bookmarkId, style });
  }

  /** The styles background holds now, also before load() filled the mirror. Does not touch the mirror. */
  async readStyles(): Promise<SavedPageStyles>
  {
    return SavedPageStyles.fromStored((await this.getState()).styles);
  }
}

export const pageStyleProxy = new PageStyleProxy();
