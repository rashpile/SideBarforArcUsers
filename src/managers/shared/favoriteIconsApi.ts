// The wire contract for FavoriteIconsManager, owned by neither side.
//
// impl/favoriteIconsManager.ts implements FavoriteIconsApi;
// proxies/favoriteIconsManagerProxy.ts implements Remote<FavoriteIconsApi>.
//
// A Favorite is a bookmark in its Space's asd_Favorites folder. The bookmark
// holds url, title and position; what a bookmark can't hold (custom icon,
// emoji, icon color and the cached favicon) lives here, keyed by bookmark id.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting.ts';

export const FAVORITE_ICONS_STORAGE_KEY = 'favoriteIcons';

/** The icon fields of one Favorite. */
export interface FavoriteIconEntry
{
  favicon?: string;
  customIconName?: string;  // Lucide icon name when using custom icon
  iconColor?: string;       // Custom icon color (hex, e.g., "#ef4444")
  emoji?: string;           // Emoji character (e.g., "😀")
}

/** The stored shape: bookmark id -> icon fields. Also the wire shape of every ack. */
export type FavoriteIconsRecord = Record<string, FavoriteIconEntry>;

/**
 * The new icon of a Favorite being edited.
 *
 * The three icon fields are replaced as a set: whatever is absent here is
 * cleared, because picking an emoji has to remove a custom icon and vice
 * versa. `favicon` is the exception - absent means "leave the stored one
 * alone", since most edits don't touch it.
 */
export type FavoriteIconEdit = FavoriteIconEntry;

/**
 * A resolved icon waiting to be stored on one Favorite.
 *
 * Both kinds of resolution end up in the same `favicon` field, so the patch
 * says which kind it is - the Favorite may have changed while the resolving
 * fetch was in flight, and what counts as "still needs this" differs:
 *
 * - no forCustomIconName: a site favicon, for a Favorite showing no icon at
 *   all. Only applied while it still has no icon of any kind.
 * - forCustomIconName set: a Lucide icon rendered to a data URL. Only applied
 *   while the Favorite still asks for that same icon name, so a patch for an
 *   icon the user has since swapped out is dropped instead of overwriting the
 *   new one.
 */
export interface FavoriteFaviconPatch
{
  id: string;
  favicon: string;
  forCustomIconName?: string;
}

const ICON_FIELDS = ['favicon', 'customIconName', 'iconColor', 'emoji'] as const;

// Keeps only the set fields, so an entry compares and serializes the same however it was built
function cleanEntry(entry: FavoriteIconEntry): FavoriteIconEntry | undefined
{
  const clean: FavoriteIconEntry = {};
  for (const field of ICON_FIELDS)
  {
    const value = entry[field];
    if (typeof value === 'string' && value !== '') clean[field] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function sameEntry(a: FavoriteIconEntry | undefined, b: FavoriteIconEntry | undefined): boolean
{
  return ICON_FIELDS.every(field => a?.[field] === b?.[field]);
}

/**
 * The icon side store. Immutable: every change returns a new store, or this
 * same one when nothing changed, so callers can skip a write by identity.
 *
 * Both sides use it: the manager to change the authoritative store, the proxy
 * to apply the same change to its mirror optimistically. One implementation,
 * so an optimistic write can't disagree with what background stores.
 */
export class FavoriteIcons
{
  static readonly EMPTY = new FavoriteIcons({});

  readonly #entries: Readonly<FavoriteIconsRecord>;

  private constructor(entries: FavoriteIconsRecord)
  {
    this.#entries = entries;
  }

  /** Reads a stored or received record; anything malformed is dropped. */
  static fromStored(raw: unknown): FavoriteIcons
  {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return FavoriteIcons.EMPTY;

    const entries: FavoriteIconsRecord = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>))
    {
      if (!value || typeof value !== 'object') continue;
      const entry = cleanEntry(value as FavoriteIconEntry);
      if (entry) entries[id] = entry;
    }
    return new FavoriteIcons(entries);
  }

  entryFor(id: string): FavoriteIconEntry | undefined
  {
    return this.#entries[id];
  }

  hasEntry(id: string): boolean
  {
    return id in this.#entries;
  }

  toStored(): FavoriteIconsRecord
  {
    return { ...this.#entries };
  }

  /** Applies an icon edit (see FavoriteIconEdit). */
  withEdit(id: string, edit: FavoriteIconEdit): FavoriteIcons
  {
    const current = this.#entries[id];
    // emoji and customIconName are mutually exclusive; a color belongs to a custom icon
    return this.#withEntry(id, {
      favicon: edit.favicon !== undefined ? edit.favicon : current?.favicon,
      customIconName: edit.emoji ? undefined : edit.customIconName,
      iconColor: edit.emoji ? undefined : (edit.customIconName ? edit.iconColor : undefined),
      emoji: edit.customIconName ? undefined : edit.emoji,
    });
  }

  /**
   * Stores resolved icons on the Favorites that still want them.
   *
   * Eligibility is re-checked here rather than trusted from the caller,
   * because every caller resolves icons asynchronously: in the time a fetch
   * took, the user can have given the Favorite an emoji or a different custom
   * icon, or another context can have resolved its favicon already. See
   * FavoriteFaviconPatch for the two kinds.
   */
  withFavicons(patches: readonly FavoriteFaviconPatch[]): FavoriteIcons
  {
    return patches.reduce<FavoriteIcons>((icons, patch) => icons.#withFavicon(patch), this);
  }

  #withFavicon(patch: FavoriteFaviconPatch): FavoriteIcons
  {
    const current = this.#entries[patch.id];

    // Already showing something, or waiting on an emoji - either way this patch is stale
    if (current?.favicon || current?.emoji) return this;

    const wanted = patch.forCustomIconName
      ? current?.customIconName === patch.forCustomIconName
      : !current?.customIconName;
    if (!wanted) return this;

    return this.#withEntry(patch.id, { ...current, favicon: patch.favicon });
  }

  /**
   * Puts one Favorite back on the site's own favicon, dropping any custom icon
   * or emoji. An undefined favicon is stored as-is: Chrome had nothing cached
   * for the site, and the Favorite falls back to its letter tile.
   */
  withFaviconReset(id: string, favicon?: string): FavoriteIcons
  {
    return this.#withEntry(id, { favicon });
  }

  /** Gives a duplicated Favorite the icon of the one it was copied from. */
  withCopy(fromId: string, toId: string): FavoriteIcons
  {
    const source = this.#entries[fromId];
    return source ? this.#withEntry(toId, source) : this;
  }

  /** Writes all four fields as given (undo, migration, import): absent fields are cleared. */
  withRestored(id: string, entry: FavoriteIconEntry): FavoriteIcons
  {
    return this.#withEntry(id, entry);
  }

  /** Drops the entries of the given bookmark ids. Unknown ids are ignored. */
  without(ids: readonly string[]): FavoriteIcons
  {
    const present = ids.filter(id => id in this.#entries);
    if (present.length === 0) return this;

    const entries = { ...this.#entries };
    for (const id of present) delete entries[id];
    return new FavoriteIcons(entries);
  }

  #withEntry(id: string, entry: FavoriteIconEntry): FavoriteIcons
  {
    const clean = cleanEntry(entry);
    if (sameEntry(this.#entries[id], clean)) return this;

    const entries = { ...this.#entries };
    if (clean) entries[id] = clean;
    else delete entries[id];
    return new FavoriteIcons(entries);
  }
}

/**
 * What the sidebar can call. Every mutation names the Favorites it touches,
 * so background's favicon patching and the sidebar's edits only collide when
 * they change the same Favorite. See "Per-operation writes" in
 * docs/development.md.
 *
 * Every method returns the resulting store, which becomes the ack payload the
 * proxy uses to resync once its in-flight writes drain.
 */
export interface FavoriteIconsApi
{
  getIcons(): FavoriteIconsRecord;
  setIcons(id: string, fields: FavoriteIconEdit): FavoriteIconsRecord;
  setFavicons(patches: FavoriteFaviconPatch[]): FavoriteIconsRecord;
  resetFavicon(id: string, favicon?: string): FavoriteIconsRecord;
  copyIcons(fromId: string, toId: string): FavoriteIconsRecord;
  restoreIcons(id: string, entry: FavoriteIconEntry): FavoriteIconsRecord;
  removeIcons(ids: string[]): FavoriteIconsRecord;
}

/** Broadcast to every listening context when the store changes, with the requester's senderId. */
export const FAVORITE_ICONS_CHANGED = makeManagerActionId(ManagerId.FAVORITE_ICONS, 'changed');
