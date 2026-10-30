// Sidebar-side client for background.ts's FavoriteIconsManager.
//
// Same mirror pattern pinned sites had: background patches favicons on its own
// and drops entries of removed bookmarks, so
//
// 1. mutations are per-operation, applied optimistically with the same
//    FavoriteIcons transform the manager runs, and
// 2. a foreign broadcast that arrives while this context has writes in flight
//    is held, and the last write out re-reads the store - see #onBroadcast.

import { ManagerId, callManager, CONTEXT_ID } from './messageRouting';
import type { Remote } from './messageRouting';
import { FAVORITE_ICONS_CHANGED, FavoriteIcons } from '../shared/favoriteIconsApi';
import type {
  FavoriteFaviconPatch,
  FavoriteIconEdit,
  FavoriteIconEntry,
  FavoriteIconsApi,
  FavoriteIconsRecord,
} from '../shared/favoriteIconsApi';
import { ExternalStore, ReadableStore } from '../../stores/externalStore';

class FavoriteIconsManagerProxy implements Remote<FavoriteIconsApi>
{
  #store = new ExternalStore<FavoriteIcons>(FavoriteIcons.EMPTY);
  #subscribed = false;
  #pendingWrites = 0;
  #missedBroadcast = false;

  /** Read-only handle on the mirror, for useSyncExternalStore. */
  get store(): ReadableStore<FavoriteIcons>
  {
    return this.#store;
  }

  get snapshot(): FavoriteIcons
  {
    return this.#store.getSnapshot();
  }

  /**
   * Subscribes to the manager's broadcasts and fills the mirror. Safe to call
   * more than once (StrictMode double mount): the listener is added once.
   */
  async load(): Promise<FavoriteIcons>
  {
    this.#subscribeToBroadcasts();
    this.#apply(await this.getIcons());
    return this.snapshot;
  }

  // Never unsubscribed: the proxy is a module singleton that outlives every component
  #subscribeToBroadcasts(): void
  {
    if (this.#subscribed) return;
    this.#subscribed = true;

    chrome.runtime.onMessage.addListener((message) =>
    {
      if (message?.action === FAVORITE_ICONS_CHANGED)
      {
        this.#onBroadcast(message.icons as FavoriteIconsRecord, message.senderId as string | undefined);
      }
    });
  }

  /**
   * Our own echo is dropped: a newer local write may already have moved past
   * it. A foreign broadcast built before background saw our pending write
   * would undo that write in this window, so while writes are in flight it is
   * only recorded, and the drain re-reads.
   */
  #onBroadcast(icons: FavoriteIconsRecord, senderId: string | undefined): void
  {
    if (senderId === CONTEXT_ID) return;

    if (this.#pendingWrites > 0)
    {
      this.#missedBroadcast = true;
      return;
    }

    this.#apply(icons);
  }

  // The single writer of the mirror; an equal store doesn't re-render consumers
  #apply(record: FavoriteIconsRecord): void
  {
    if (JSON.stringify(record) === JSON.stringify(this.snapshot.toStored())) return;
    this.#store.set(FavoriteIcons.fromStored(record));
  }

  async #mutate(
    method: string,
    payload: Record<string, unknown>,
    optimistic: (icons: FavoriteIcons) => FavoriteIcons
  ): Promise<FavoriteIconsRecord>
  {
    const next = optimistic(this.snapshot);
    if (next !== this.snapshot) this.#store.set(next);
    this.#pendingWrites++;

    try
    {
      const result = await callManager<FavoriteIconsRecord>(ManagerId.FAVORITE_ICONS, method, payload);
      this.#pendingWrites--;
      await this.#drain(result);
      return result;
    }
    catch (error)
    {
      // The optimistic write shows a change that never happened. Ask background for the truth
      // rather than rolling back to a remembered store, which could undo a later write.
      this.#pendingWrites--;
      console.error(`[favoriteIconsManagerProxy] ${method} failed, resyncing:`, error);
      this.getIcons()
        .then((current) => { if (this.#pendingWrites === 0) this.#apply(current); })
        .catch(() => {});
      throw error;
    }
  }

  // The last write to come back settles the mirror, re-reading if a broadcast was dropped meanwhile
  async #drain(ack: FavoriteIconsRecord): Promise<void>
  {
    if (this.#pendingWrites > 0 || !this.#missedBroadcast) return;

    this.#missedBroadcast = false;

    try
    {
      const current = await this.getIcons();
      if (this.#pendingWrites > 0) return;
      this.#apply(current);
    }
    catch
    {
      if (this.#pendingWrites === 0) this.#apply(ack);
    }
  }

  /** Plain read - does NOT touch the mirror. */
  async getIcons(): Promise<FavoriteIconsRecord>
  {
    return await callManager<FavoriteIconsRecord>(ManagerId.FAVORITE_ICONS, 'getIcons');
  }

  async setIcons(id: string, fields: FavoriteIconEdit): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('setIcons', { id, fields }, icons => icons.withEdit(id, fields));
  }

  async setFavicons(patches: FavoriteFaviconPatch[]): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('setFavicons', { patches }, icons => icons.withFavicons(patches));
  }

  async resetFavicon(id: string, favicon?: string): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('resetFavicon', { id, favicon }, icons => icons.withFaviconReset(id, favicon));
  }

  async copyIcons(fromId: string, toId: string): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('copyIcons', { fromId, toId }, icons => icons.withCopy(fromId, toId));
  }

  async restoreIcons(id: string, entry: FavoriteIconEntry): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('restoreIcons', { id, entry }, icons => icons.withRestored(id, entry));
  }

  async removeIcons(ids: string[]): Promise<FavoriteIconsRecord>
  {
    return this.#mutate('removeIcons', { ids }, icons => icons.without(ids));
  }
}

export const favoriteIconsManagerProxy = new FavoriteIconsManagerProxy();
