// Sidebar-side client for background.ts's AttentionMarkManager.
//
// Same mirror pattern as pinnedSitesManagerProxy: optimistic writes, own echo
// skipped, foreign broadcasts held while this context has writes in flight.
// Background changes marks on its own (tab closed, bookmark deleted), so the
// mutations are per-operation, never a whole new state.

import { ManagerId, callManager, CONTEXT_ID, Remote } from './messageRouting';
import { AttentionMarkApi, AttentionMarksState, ATTENTION_MARKS_CHANGED } from '../shared/attentionMarkApi';
import { ExternalStore, ReadableStore } from '../../stores/externalStore';

/** One context's view of the marks. A new object per change, so useSyncExternalStore sees it. */
export class AttentionMarksMirror
{
  readonly #tabIds: ReadonlySet<number>;
  readonly #bookmarkIds: ReadonlySet<string>;

  constructor(tabIds: Iterable<number> = [], bookmarkIds: Iterable<string> = [])
  {
    this.#tabIds = new Set(tabIds);
    this.#bookmarkIds = new Set(bookmarkIds);
  }

  static fromState(state: AttentionMarksState): AttentionMarksMirror
  {
    return new AttentionMarksMirror(state.tabIds, state.bookmarkIds);
  }

  isTabMarked(tabId: number): boolean
  {
    return this.#tabIds.has(tabId);
  }

  isBookmarkMarked(id: string): boolean
  {
    return this.#bookmarkIds.has(id);
  }

  withTabs(tabIds: readonly number[], marked: boolean): AttentionMarksMirror
  {
    const next = new Set(this.#tabIds);
    for (const tabId of tabIds)
    {
      if (marked) next.add(tabId);
      else next.delete(tabId);
    }
    return new AttentionMarksMirror(next, this.#bookmarkIds);
  }

  withBookmarks(ids: readonly string[], marked: boolean): AttentionMarksMirror
  {
    const next = new Set(this.#bookmarkIds);
    for (const id of ids)
    {
      if (marked) next.add(id);
      else next.delete(id);
    }
    return new AttentionMarksMirror(this.#tabIds, next);
  }

  equals(other: AttentionMarksMirror): boolean
  {
    return sameMembers(this.#tabIds, other.#tabIds) && sameMembers(this.#bookmarkIds, other.#bookmarkIds);
  }
}

function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean
{
  if (a.size !== b.size) return false;
  for (const value of a)
  {
    if (!b.has(value)) return false;
  }
  return true;
}

class AttentionMarkProxy implements Remote<AttentionMarkApi>
{
  #store = new ExternalStore<AttentionMarksMirror>(new AttentionMarksMirror());
  #subscribed = false;
  #pendingWrites = 0;
  #missedBroadcast = false;

  /** Read-only handle on the mirror, for useSyncExternalStore. */
  get store(): ReadableStore<AttentionMarksMirror>
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

  #subscribeToBroadcasts(): void
  {
    if (this.#subscribed) return;
    this.#subscribed = true;

    chrome.runtime.onMessage.addListener((message) =>
    {
      if (message?.action === ATTENTION_MARKS_CHANGED)
      {
        this.#onBroadcast(message.state as AttentionMarksState, message.senderId as string | undefined);
      }
    });
  }

  // A foreign broadcast that arrives while our writes are in flight was built before background
  // saw them; applying it would undo them on screen. The last write out re-reads instead.
  #onBroadcast(state: AttentionMarksState, senderId: string | undefined): void
  {
    if (senderId === CONTEXT_ID) return;

    if (this.#pendingWrites > 0)
    {
      this.#missedBroadcast = true;
      return;
    }

    this.#apply(state);
  }

  #apply(state: AttentionMarksState): void
  {
    this.#applyMirror(AttentionMarksMirror.fromState(state));
  }

  #applyMirror(next: AttentionMarksMirror): void
  {
    if (next.equals(this.#store.getSnapshot())) return;
    this.#store.set(next);
  }

  async #mutate(
    method: string,
    payload: Record<string, unknown>,
    optimistic: (mirror: AttentionMarksMirror) => AttentionMarksMirror
  ): Promise<AttentionMarksState>
  {
    this.#applyMirror(optimistic(this.#store.getSnapshot()));
    this.#pendingWrites++;

    try
    {
      const result = await callManager<AttentionMarksState>(ManagerId.ATTENTION_MARKS, method, payload);
      this.#pendingWrites--;
      await this.#drain(result);
      return result;
    }
    catch (error)
    {
      // Re-read rather than roll back: a rollback could undo a later write that did succeed
      this.#pendingWrites--;
      console.error(`[attentionMarkProxy] ${method} failed, resyncing:`, error);
      this.getState()
        .then((current) => { if (this.#pendingWrites === 0) this.#apply(current); })
        .catch(() => {});
      throw error;
    }
  }

  // The last write back settles the mirror. Its ack is applied, unlike pinned sites: markTabs
  // skips closed and incognito tabs, so the optimistic mirror can hold a mark background refused.
  // With no foreign broadcast held back, no newer state than the ack can have reached this context.
  async #drain(ack: AttentionMarksState): Promise<void>
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
  async getState(): Promise<AttentionMarksState>
  {
    return await callManager<AttentionMarksState>(ManagerId.ATTENTION_MARKS, 'getState');
  }

  async markTabs(tabIds: number[]): Promise<AttentionMarksState>
  {
    return this.#mutate('markTabs', { tabIds }, mirror => mirror.withTabs(tabIds, true));
  }

  async clearTabs(tabIds: number[]): Promise<AttentionMarksState>
  {
    return this.#mutate('clearTabs', { tabIds }, mirror => mirror.withTabs(tabIds, false));
  }

  async markBookmarks(ids: string[]): Promise<AttentionMarksState>
  {
    return this.#mutate('markBookmarks', { ids }, mirror => mirror.withBookmarks(ids, true));
  }

  async clearBookmarks(ids: string[]): Promise<AttentionMarksState>
  {
    return this.#mutate('clearBookmarks', { ids }, mirror => mirror.withBookmarks(ids, false));
  }
}

export const attentionMarkProxy = new AttentionMarkProxy();
