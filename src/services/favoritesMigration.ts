// One-time copy of the legacy global Favorites (`pinnedSites`) into every Space's
// `asd_Favorites` bookmark folder. Runs in background only; chrome APIs are
// injected so the decisions can be tested under Node.
//
// Retried on every trigger until `done`: a Space whose folder can't be found
// yet (bookmark sync still arriving) must not lose the old Favorites.

import type { PinnedSite } from '../managers/shared/pinnedSitesApi.ts';
import { PINNED_SITES_STORAGE_KEY } from '../managers/shared/pinnedSitesApi.ts';
import type { FavoriteIconEntry } from '../managers/shared/favoriteIconsApi.ts';
import { findFolderBySegments } from '../utils/bookmarkFolderLookup.ts';
import { FAVORITES_FOLDER_TITLE, findFavoritesFolder, isBookmarkableUrl } from '../utils/favoritesFolder.ts';
import type { FavoritesBookmarkNode } from '../utils/favoritesFolder.ts';
import type { FavoritesSpace } from '../utils/spaceFavorites.ts';
import { pairFavoritesByUrl } from '../utils/favoritesImport.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

export const FAVORITES_MIGRATION_STORAGE_KEY = 'favoritesMigration';

/** old pin id -> Space id -> the bookmark id of that pin's copy in the Space. */
type RekeyRecord = Record<string, Record<string, string>>;

/**
 * Where each old Favorite went in each Space, so open `pinned-<oldPinId>` tabs
 * can be re-keyed to the copy in their own Space. Immutable.
 */
export class FavoriteRekeyMap
{
  static readonly EMPTY = new FavoriteRekeyMap({});

  readonly #entries: Readonly<RekeyRecord>;

  private constructor(entries: RekeyRecord)
  {
    this.#entries = entries;
  }

  static fromStored(raw: unknown): FavoriteRekeyMap
  {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return FavoriteRekeyMap.EMPTY;

    const entries: RekeyRecord = {};
    for (const [oldPinId, bySpace] of Object.entries(raw as Record<string, unknown>))
    {
      if (!bySpace || typeof bySpace !== 'object') continue;
      const copies: Record<string, string> = {};
      for (const [spaceId, bookmarkId] of Object.entries(bySpace as Record<string, unknown>))
      {
        if (typeof bookmarkId === 'string') copies[spaceId] = bookmarkId;
      }
      entries[oldPinId] = copies;
    }
    return new FavoriteRekeyMap(entries);
  }

  /** True when the old pin id was migrated into at least one Space. */
  hasPin(oldPinId: string): boolean
  {
    return oldPinId in this.#entries;
  }

  /** The bookmark id of the old pin's copy in the Space, if that Space got one. */
  bookmarkIdFor(oldPinId: string, spaceId: string): string | undefined
  {
    return this.#entries[oldPinId]?.[spaceId];
  }

  /** Records the copies made in one Space (old pin id -> new bookmark id). */
  withSpaceCopies(spaceId: string, copies: ReadonlyMap<string, string>): FavoriteRekeyMap
  {
    if (copies.size === 0) return this;

    const entries: RekeyRecord = { ...this.#entries };
    for (const [oldPinId, bookmarkId] of copies)
    {
      entries[oldPinId] = { ...entries[oldPinId], [spaceId]: bookmarkId };
    }
    return new FavoriteRekeyMap(entries);
  }

  /**
   * Lists every old pin, those that got no copy anywhere with no Space: the re-key
   * then turns their open tabs into regular tabs instead of leaving them on a key
   * no Favorite has.
   */
  withPins(oldPinIds: readonly string[]): FavoriteRekeyMap
  {
    const missing = oldPinIds.filter(id => !this.hasPin(id));
    if (missing.length === 0) return this;
    return new FavoriteRekeyMap({ ...this.#entries, ...Object.fromEntries(missing.map(id => [id, {}])) });
  }

  toStored(): RekeyRecord
  {
    return Object.fromEntries(Object.entries(this.#entries).map(([id, bySpace]) => [id, { ...bySpace }]));
  }
}

/** The stored `favoritesMigration` record. */
export class FavoritesMigrationState
{
  readonly done: boolean;
  readonly rekey: FavoriteRekeyMap;
  /** Spaces whose asd_Favorites this device's migration created. */
  readonly #createdIn: readonly string[];

  constructor(done: boolean, rekey: FavoriteRekeyMap, createdIn: readonly string[] = [])
  {
    this.done = done;
    this.rekey = rekey;
    this.#createdIn = createdIn;
  }

  static fromStored(raw: unknown): FavoritesMigrationState
  {
    const record = raw && typeof raw === 'object' ? raw as { done?: unknown; rekey?: unknown; createdIn?: unknown } : {};
    const createdIn = Array.isArray(record.createdIn)
      ? record.createdIn.filter((id): id is string => typeof id === 'string')
      : [];
    return new FavoritesMigrationState(record.done === true, FavoriteRekeyMap.fromStored(record.rekey), createdIn);
  }

  /**
   * False for an asd_Favorites that came by sync from a device that migrated first:
   * its bookmarks are already the copies.
   */
  createdFolderIn(spaceId: string): boolean
  {
    return this.#createdIn.includes(spaceId);
  }

  withFolderCreatedIn(spaceId: string): FavoritesMigrationState
  {
    if (this.createdFolderIn(spaceId)) return this;
    return new FavoritesMigrationState(this.done, this.rekey, [...this.#createdIn, spaceId]);
  }

  withSpaceCopies(spaceId: string, copies: ReadonlyMap<string, string>): FavoritesMigrationState
  {
    return new FavoritesMigrationState(this.done, this.rekey.withSpaceCopies(spaceId, copies), this.#createdIn);
  }

  /** Done, with every old pin listed in the rekey map (see FavoriteRekeyMap.withPins). */
  markedDone(oldPinIds: readonly string[] = []): FavoritesMigrationState
  {
    return new FavoritesMigrationState(true, this.rekey.withPins(oldPinIds), this.#createdIn);
  }

  toStored(): { done: boolean; rekey: RekeyRecord; createdIn: string[] }
  {
    return { done: this.done, rekey: this.rekey.toStored(), createdIn: [...this.#createdIn] };
  }
}

/** The chrome APIs and managers the migration uses, injected for tests. */
export interface FavoritesMigrationDeps
{
  bookmarks: {
    getTree: () => Promise<BookmarkNode[]>;
    getChildren: (id: string) => Promise<FavoritesBookmarkNode[]>;
    create: (bookmark: { parentId: string; title: string; url?: string; index?: number }) => Promise<FavoritesBookmarkNode>;
  };
  storage: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
  };
  /** FavoriteIconsManager.restoreIcons: background is the single writer of `favoriteIcons`. */
  restoreIcons: (bookmarkId: string, entry: FavoriteIconEntry) => unknown;
  getSpaces: () => readonly FavoritesSpace[];
}

// Only pins the old list could show; anything malformed is left behind
function readLegacyPins(raw: unknown): PinnedSite[]
{
  if (!Array.isArray(raw)) return [];
  return raw.filter((pin): pin is PinnedSite =>
    !!pin && typeof pin === 'object' && typeof pin.id === 'string' && typeof pin.url === 'string'
    && isBookmarkableUrl(pin.url));
}

function iconEntryOf(pin: PinnedSite): FavoriteIconEntry
{
  return { favicon: pin.favicon, customIconName: pin.customIconName, iconColor: pin.iconColor, emoji: pin.emoji };
}

export class FavoritesMigration
{
  readonly #deps: FavoritesMigrationDeps;
  #tail: Promise<void> = Promise.resolve();
  #queued: Promise<void> | null = null;
  #done = false;

  constructor(deps: FavoritesMigrationDeps)
  {
    this.#deps = deps;
  }

  /**
   * Runs the migration once the previous run finished. Triggers that arrive while
   * a run is already waiting share it: the migration's own bookmark creates fire
   * bookmark events, and one rerun covers all of them.
   */
  run(): Promise<void>
  {
    if (this.#done) return Promise.resolve();
    if (this.#queued) return this.#queued;

    const next = this.#tail.then(() =>
    {
      this.#queued = null;
      return this.#runOnce();
    });
    this.#queued = next;
    this.#tail = next.catch(error => console.error('[FavoritesMigration] failed:', error));
    return next;
  }

  async #runOnce(): Promise<void>
  {
    if (this.#done) return;

    let state = FavoritesMigrationState.fromStored(
      (await this.#deps.storage.get(FAVORITES_MIGRATION_STORAGE_KEY))[FAVORITES_MIGRATION_STORAGE_KEY]);
    if (state.done)
    {
      this.#done = true;
      return;
    }

    const pins = readLegacyPins((await this.#deps.storage.get(PINNED_SITES_STORAGE_KEY))[PINNED_SITES_STORAGE_KEY]);
    if (pins.length === 0)
    {
      await this.#store(state.markedDone());
      this.#done = true;
      return;
    }

    const roots = (await this.#deps.bookmarks.getTree())[0]?.children ?? [];
    const targets = this.#deps.getSpaces()
      .map(space => ({ space, folder: findFolderBySegments(roots, space.bookmarkFolderSegments ?? [], space.bookmarkFolderInAccount) }))
      .filter((target): target is { space: FavoritesSpace; folder: BookmarkNode } => target.folder !== null);
    // Nowhere to put them yet: keep `done` unset so a later trigger tries again
    if (targets.length === 0) return;

    let allSucceeded = true;
    for (const { space, folder } of targets)
    {
      const copies = new Map<string, string>();
      let succeeded = false;
      try
      {
        succeeded = await this.#copyInto(space.id, folder.id, pins, state, copies, async () =>
        {
          state = state.withFolderCreatedIn(space.id);
          await this.#store(state);
        });
      }
      catch (error)
      {
        console.error(`[FavoritesMigration] copying into Space ${space.id} failed:`, error);
      }
      if (!succeeded) allSucceeded = false;
      // Stored right away, even after a failure: the next run resumes from them
      if (copies.size > 0)
      {
        state = state.withSpaceCopies(space.id, copies);
        await this.#store(state);
      }
    }

    if (allSucceeded)
    {
      await this.#store(state.markedDone(pins.map(pin => pin.id)));
      this.#done = true;
    }
  }

  /**
   * Copies the pins this Space has no copy of yet into its asd_Favorites. An
   * asd_Favorites this device didn't create came by sync from a device that
   * migrated first: its bookmarks are the copies, so the pins are matched to them
   * by URL for their local icons and open tabs, and nothing is created. False when
   * a pin couldn't be copied; the next trigger retries it.
   */
  async #copyInto(
    spaceId: string,
    spaceFolderId: string,
    pins: readonly PinnedSite[],
    state: FavoritesMigrationState,
    copies: Map<string, string>,
    onFolderCreated: () => Promise<void>
  ): Promise<boolean>
  {
    const { bookmarks } = this.#deps;
    const { rekey } = state;
    const pending = pins.filter(pin => rekey.bookmarkIdFor(pin.id, spaceId) === undefined);
    if (pending.length === 0) return true;

    let favoritesFolder: FavoritesBookmarkNode | undefined = findFavoritesFolder(await bookmarks.getChildren(spaceFolderId));
    const synced = favoritesFolder !== undefined && !state.createdFolderIn(spaceId);

    let unmatched = pending;
    if (favoritesFolder)
    {
      const claimed = new Set(pins.map(pin => rekey.bookmarkIdFor(pin.id, spaceId)));
      const existing = (await bookmarks.getChildren(favoritesFolder.id))
        .filter((node): node is FavoritesBookmarkNode & { url: string } => !!node.url && !claimed.has(node.id));
      const pairs = pairFavoritesByUrl(pending, existing);
      for (const { saved, favorite } of pairs)
      {
        copies.set(saved.id, favorite.id);
        this.#deps.restoreIcons(favorite.id, iconEntryOf(saved));
      }
      const matched = new Set(pairs.map(({ saved }) => saved.id));
      unmatched = pending.filter(pin => !matched.has(pin.id));
    }
    if (synced || unmatched.length === 0) return true;

    if (!favoritesFolder)
    {
      favoritesFolder = await bookmarks.create({ parentId: spaceFolderId, title: FAVORITES_FOLDER_TITLE });
      await onFolderCreated();
    }
    let allCopied = true;
    for (const pin of unmatched)
    {
      try
      {
        const bookmark = await bookmarks.create({ parentId: favoritesFolder.id, title: pin.title ?? '', url: pin.url });
        copies.set(pin.id, bookmark.id);
        this.#deps.restoreIcons(bookmark.id, iconEntryOf(pin));
      }
      catch (error)
      {
        allCopied = false;
        console.error(`[FavoritesMigration] copying ${pin.url} into Space ${spaceId} failed:`, error);
      }
    }
    return allCopied;
  }

  async #store(state: FavoritesMigrationState): Promise<void>
  {
    await this.#deps.storage.set({ [FAVORITES_MIGRATION_STORAGE_KEY]: state.toStored() });
  }
}
