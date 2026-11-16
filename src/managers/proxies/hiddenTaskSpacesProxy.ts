// Sidebar-side client for background.ts's HiddenTaskSpacesManager.
//
// Same mirror pattern as favoriteIconsManagerProxy: the hide is applied optimistically with the
// same HiddenTaskSpaces transform the manager runs, our own echo is skipped, and a foreign
// broadcast that arrives while a hide is in flight is held and the last hide out re-reads.
// Background unhides on its own (a window entered the Space, a Space stopped being a live Task
// Space), so every window follows its broadcasts.

import { ManagerId, callManager, CONTEXT_ID } from './messageRouting';
import type { Remote } from './messageRouting';
import { HIDDEN_TASK_SPACES_CHANGED, HiddenTaskSpaces } from '../shared/hiddenTaskSpacesApi';
import type { HiddenTaskSpacesApi } from '../shared/hiddenTaskSpacesApi';
import { ExternalStore, ReadableStore } from '../../stores/externalStore';

class HiddenTaskSpacesProxy implements Remote<HiddenTaskSpacesApi>
{
  #store = new ExternalStore<HiddenTaskSpaces>(HiddenTaskSpaces.EMPTY);
  #subscribed = false;
  #pendingWrites = 0;
  #missedBroadcast = false;

  /** Read-only handle on the mirror, for useSyncExternalStore. */
  get store(): ReadableStore<HiddenTaskSpaces>
  {
    return this.#store;
  }

  get snapshot(): HiddenTaskSpaces
  {
    return this.#store.getSnapshot();
  }

  /** Subscribes to broadcasts and fills the mirror. Safe to call more than once (StrictMode, several hooks). */
  async load(): Promise<void>
  {
    this.#subscribeToBroadcasts();
    const hidden = await this.getHidden();
    if (this.#pendingWrites === 0) this.#apply(hidden);
  }

  // Never unsubscribed: the proxy is a module singleton that outlives every component
  #subscribeToBroadcasts(): void
  {
    if (this.#subscribed) return;
    this.#subscribed = true;

    chrome.runtime.onMessage.addListener((message) =>
    {
      if (message?.action === HIDDEN_TASK_SPACES_CHANGED)
      {
        this.#onBroadcast(message.hidden, message.senderId as string | undefined);
      }
    });
  }

  // A foreign broadcast that arrives while our hide is in flight was built before background saw
  // it; applying it would show the hidden row again. The last hide back re-reads instead.
  #onBroadcast(hidden: unknown, senderId: string | undefined): void
  {
    if (senderId === CONTEXT_ID) return;

    if (this.#pendingWrites > 0)
    {
      this.#missedBroadcast = true;
      return;
    }

    this.#apply(hidden);
  }

  // The single writer of the mirror; equal marks don't re-render consumers
  #apply(hidden: unknown): void
  {
    const next = HiddenTaskSpaces.fromStored(hidden);
    if (next.equals(this.snapshot)) return;
    this.#store.set(next);
  }

  /** Plain read - does not touch the mirror. */
  async getHidden(): Promise<string[]>
  {
    return await callManager<string[]>(ManagerId.HIDDEN_TASK_SPACES, 'getHidden');
  }

  async hide(spaceId: string): Promise<string[]>
  {
    const next = this.snapshot.with(spaceId);
    if (next !== this.snapshot) this.#store.set(next);
    this.#pendingWrites++;

    try
    {
      const result = await callManager<string[]>(ManagerId.HIDDEN_TASK_SPACES, 'hide', { spaceId });
      this.#pendingWrites--;
      await this.#drain(result);
      return result;
    }
    catch (error)
    {
      // Re-read rather than roll back: a rollback could undo a later hide that did succeed
      this.#pendingWrites--;
      console.error('[hiddenTaskSpacesProxy] hide failed, resyncing:', error);
      this.getHidden()
        .then((current) => { if (this.#pendingWrites === 0) this.#apply(current); })
        .catch(() => {});
      throw error;
    }
  }

  // The last hide to come back settles the mirror, re-reading if a broadcast was dropped meanwhile
  async #drain(ack: string[]): Promise<void>
  {
    if (this.#pendingWrites > 0 || !this.#missedBroadcast) return;

    this.#missedBroadcast = false;

    try
    {
      const current = await this.getHidden();
      if (this.#pendingWrites > 0) return;
      this.#apply(current);
    }
    catch
    {
      if (this.#pendingWrites === 0) this.#apply(ack);
    }
  }
}

export const hiddenTaskSpacesProxy = new HiddenTaskSpacesProxy();
