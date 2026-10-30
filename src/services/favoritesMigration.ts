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
import { FAVORITES_FOLDER_TITLE, findFavoritesFolder } from '../utils/favoritesFolder.ts';
import type { FavoritesBookmarkNode } from '../utils/favoritesFolder.ts';
import type { FavoritesSpace } from '../utils/spaceFavorites.ts';

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

  constructor(done: boolean, rekey: FavoriteRekeyMap)
  {
    this.done = done;
    this.rekey = rekey;
  }

  static fromStored(raw: unknown): FavoritesMigrationState
  {
    const record = raw && typeof raw === 'object' ? raw as { done?: unknown; rekey?: unknown } : {};
    return new FavoritesMigrationState(record.done === true, FavoriteRekeyMap.fromStored(record.rekey));
  }

  withSpaceCopies(spaceId: string, copies: ReadonlyMap<string, string>): FavoritesMigrationState
  {
    return new FavoritesMigrationState(this.done, this.rekey.withSpaceCopies(spaceId, copies));
  }

  markedDone(): FavoritesMigrationState
  {
    return new FavoritesMigrationState(true, this.rekey);
  }

  toStored(): { done: boolean; rekey: RekeyRecord }
  {
    return { done: this.done, rekey: this.rekey.toStored() };
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
    !!pin && typeof pin === 'object' && typeof pin.id === 'string' && typeof pin.url === 'string' && pin.url !== '');
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
      try
      {
        await this.#copyInto(folder.id, pins, copies);
      }
      catch (error)
      {
        allSucceeded = false;
        console.error(`[FavoritesMigration] copying into Space ${space.id} failed:`, error);
      }
      // Stored right away, even after a failure: the next run skips this Space
      // because its asd_Favorites exists, so these entries would never be written
      if (copies.size > 0)
      {
        state = state.withSpaceCopies(space.id, copies);
        await this.#store(state);
      }
    }

    if (allSucceeded)
    {
      await this.#store(state.markedDone());
      this.#done = true;
    }
  }

  // A Space that already has asd_Favorites is skipped: a synced device migrated it
  // first, or an earlier run here did
  async #copyInto(spaceFolderId: string, pins: readonly PinnedSite[], copies: Map<string, string>): Promise<void>
  {
    const { bookmarks } = this.#deps;
    if (findFavoritesFolder(await bookmarks.getChildren(spaceFolderId))) return;

    const favoritesFolder = await bookmarks.create({ parentId: spaceFolderId, title: FAVORITES_FOLDER_TITLE });
    for (const pin of pins)
    {
      const bookmark = await bookmarks.create({ parentId: favoritesFolder.id, title: pin.title ?? '', url: pin.url });
      copies.set(pin.id, bookmark.id);
      this.#deps.restoreIcons(bookmark.id, iconEntryOf(pin));
    }
  }

  async #store(state: FavoritesMigrationState): Promise<void>
  {
    await this.#deps.storage.set({ [FAVORITES_MIGRATION_STORAGE_KEY]: state.toStored() });
  }
}
