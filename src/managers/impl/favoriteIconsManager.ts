// FavoriteIconsManager - owns the Favorites' icon side store (load, mutate, save).
//
// Background-side implementation of shared/favoriteIconsApi.ts. The sidebar
// reaches it through proxies/favoriteIconsManagerProxy.ts. Single writer of
// the `favoriteIcons` key - see "Shared state" in docs/development.md:
// background's favicon patching, the bookmark-removal cleanup, the sidebar's
// edits and its lazy icon resolver all change it.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import {
  FAVORITE_ICONS_CHANGED,
  FAVORITE_ICONS_STORAGE_KEY,
  FavoriteIcons,
} from '../shared/favoriteIconsApi.ts';
import type {
  FavoriteFaviconPatch,
  FavoriteIconEdit,
  FavoriteIconEntry,
  FavoriteIconsApi,
  FavoriteIconsRecord,
} from '../shared/favoriteIconsApi.ts';

/** The chrome APIs the manager uses, injected so tests run under Node. */
export interface FavoriteIconsManagerDeps
{
  storage: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
  };
  broadcast: (message: Record<string, unknown>) => Promise<unknown>;
}

export class FavoriteIconsManager implements RoutedManager, FavoriteIconsApi
{
  readonly managerId = ManagerId.FAVORITE_ICONS;

  readonly #deps: FavoriteIconsManagerDeps;
  #icons = FavoriteIcons.EMPTY;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(deps: FavoriteIconsManagerDeps)
  {
    this.#deps = deps;
  }

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    // The calling context's CONTEXT_ID, echoed on the broadcast so it can skip its own echo
    const originId = message.senderId as string | undefined;

    switch (method)
    {
      case 'getIcons':
        return this.getIcons();

      case 'setIcons':
        return this.setIcons(message.id as string, message.fields as FavoriteIconEdit, originId);

      case 'setFavicons':
        return this.setFavicons(message.patches as FavoriteFaviconPatch[], originId);

      case 'resetFavicon':
        return this.resetFavicon(message.id as string, message.favicon as string | undefined, originId);

      case 'copyIcons':
        return this.copyIcons(message.fromId as string, message.toId as string, originId);

      case 'restoreIcons':
        return this.restoreIcons(message.id as string, message.entry as FavoriteIconEntry, originId);

      case 'removeIcons':
        return this.removeIcons(message.ids as string[], originId);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  async load(): Promise<void>
  {
    const result = await this.#deps.storage.get(FAVORITE_ICONS_STORAGE_KEY);
    this.#icons = FavoriteIcons.fromStored(result[FAVORITE_ICONS_STORAGE_KEY]);
  }

  /** The current store, for background callers that need the class rather than the wire record. */
  get icons(): FavoriteIcons
  {
    return this.#icons;
  }

  getIcons(): FavoriteIconsRecord
  {
    return this.#icons.toStored();
  }

  setIcons(id: string, fields: FavoriteIconEdit, originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.withEdit(id, fields), originId);
  }

  setFavicons(patches: FavoriteFaviconPatch[], originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.withFavicons(patches), originId);
  }

  resetFavicon(id: string, favicon?: string, originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.withFaviconReset(id, favicon), originId);
  }

  copyIcons(fromId: string, toId: string, originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.withCopy(fromId, toId), originId);
  }

  restoreIcons(id: string, entry: FavoriteIconEntry, originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.withRestored(id, entry), originId);
  }

  /** Also called by background for a removed bookmark and everything under a removed folder. */
  removeIcons(ids: string[], originId?: string): FavoriteIconsRecord
  {
    return this.#commit(this.#icons.without(ids), originId);
  }

  /**
   * Stores one already-computed store: in memory, then to storage, then out to
   * every listening context. An unchanged store (same instance) is neither
   * written nor broadcast, so removing an unrelated bookmark costs nothing.
   *
   * originId is absent for background-internal callers (favicon patching,
   * bookmark removal), whose broadcasts are news to everyone.
   */
  #commit(next: FavoriteIcons, originId?: string): FavoriteIconsRecord
  {
    const record = next.toStored();
    if (next === this.#icons) return record;

    this.#icons = next;
    this.#write();

    this.#deps.broadcast({
      action: FAVORITE_ICONS_CHANGED,
      icons: record,
      senderId: originId,
    }).catch(() =>
    {
      // No sidebar open
    });

    return record;
  }

  // Writes run one at a time and each takes the store from memory when it runs,
  // so an older write can't land after a newer one
  #write(): void
  {
    this.#writeTail = this.#writeTail
      .then(() => this.#deps.storage.set({ [FAVORITE_ICONS_STORAGE_KEY]: this.#icons.toStored() }))
      .catch(error => console.error('[FavoriteIconsManager] failed to store favorite icons:', error));
  }

  /** Resolves once every write started so far has finished (tests, and callers that must see storage settle). */
  async flushWrites(): Promise<void>
  {
    await this.#writeTail;
  }
}
