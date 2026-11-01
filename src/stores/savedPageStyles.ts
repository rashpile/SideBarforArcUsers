// Saved page styles - the page agent's CSS saved to a bookmark or Favorite, in the form
// PageStyleManager keeps in chrome.storage.local, so the background can put it back on the page
// whenever a page of the same site loads in the bookmark's tab, also after a browser restart.
//
// Background and side panel derive the inserted text from the same record: removeCSS matches by
// exact text, and the marker id tells the panel the sheet on the page is the saved one.

import { withMarker } from '../utils/pageAgentCss.ts';
import { BOOKMARK_ITEM_KEY_PREFIX, FAVORITE_ITEM_KEY_PREFIX } from '../utils/tabAssociations.ts';

const SAVED_APPLIED_ID_PREFIX = 'saved-';

/** One saved style as chrome.storage.local holds it. */
export interface StoredPageStyle
{
  css: string;
  autoApply: boolean;
  origin: string;
  rev: string;
}

/** The value of the `bookmarkPageStyles` key: saved styles by bookmark id. */
export type StoredPageStyles = Record<string, StoredPageStyle>;

/** The origin of an http(s) URL; null for any other scheme or a URL that doesn't parse. */
export function httpOriginOf(url: string): string | null
{
  let parsed: URL;
  try
  {
    parsed = new URL(url);
  }
  catch
  {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.origin;
}

/**
 * The bookmark (or Favorite, whose id is its bookmark node id) a tab association belongs to:
 * the id of `bookmark-<id>` and `pinned-<id>`, null for any other item key.
 */
export function bookmarkIdFromItemKey(itemKey: string | null | undefined): string | null
{
  if (!itemKey) return null;
  for (const prefix of [BOOKMARK_ITEM_KEY_PREFIX, FAVORITE_ITEM_KEY_PREFIX])
  {
    if (itemKey.startsWith(prefix))
    {
      const id = itemKey.slice(prefix.length);
      return id === '' ? null : id;
    }
  }
  return null;
}

/** The CSS saved to one bookmark, for pages on the origin it was saved on. */
export class SavedPageStyle
{
  /** The sanitized stylesheet, without the marker rule. */
  readonly css: string;
  readonly autoApply: boolean;
  /** The http(s) origin of the page the style was saved on. */
  readonly origin: string;
  /** New on every save, so a page keeps the sheet of an older save apart from the current one. */
  readonly rev: string;

  constructor(css: string, autoApply: boolean, origin: string, rev: string)
  {
    this.css = css;
    this.autoApply = autoApply;
    this.origin = origin;
    this.rev = rev;
    Object.freeze(this);
  }

  /** The marker id the inserted sheet carries. */
  get appliedId(): string
  {
    return SAVED_APPLIED_ID_PREFIX + this.rev;
  }

  /** The exact text inserted into the page, and the text removeCSS needs to take it off. */
  get insertedText(): string
  {
    return withMarker(this.css, this.appliedId);
  }

  /** Whether the style belongs on this page: an http(s) page on the saved origin. */
  appliesTo(url: string): boolean
  {
    return httpOriginOf(url) === this.origin;
  }

  withAutoApply(on: boolean): SavedPageStyle
  {
    return on === this.autoApply ? this : new SavedPageStyle(this.css, on, this.origin, this.rev);
  }

  equals(other: SavedPageStyle): boolean
  {
    return this.css === other.css
      && this.autoApply === other.autoApply
      && this.origin === other.origin
      && this.rev === other.rev;
  }

  toStored(): StoredPageStyle
  {
    return { css: this.css, autoApply: this.autoApply, origin: this.origin, rev: this.rev };
  }

  /** The record of a stored entry; null when the entry is malformed or not for an http(s) origin. */
  static fromStoredEntry(value: unknown): SavedPageStyle | null
  {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (typeof entry.css !== 'string' || typeof entry.autoApply !== 'boolean') return null;
    if (typeof entry.rev !== 'string' || entry.rev === '') return null;
    // A stored origin must be one httpOriginOf would produce: an applier comparing against a
    // non-normalized or non-web origin would never match, or match the wrong pages.
    if (typeof entry.origin !== 'string' || httpOriginOf(entry.origin) !== entry.origin) return null;
    return new SavedPageStyle(entry.css, entry.autoApply, entry.origin, entry.rev);
  }
}

/**
 * Saved styles by bookmark id. Immutable: every change returns a new collection, and a change that
 * changes nothing returns this same instance, so a caller can skip the storage write.
 */
export class SavedPageStyles
{
  readonly #byBookmarkId: ReadonlyMap<string, SavedPageStyle>;

  constructor(byBookmarkId: ReadonlyMap<string, SavedPageStyle> = new Map())
  {
    this.#byBookmarkId = byBookmarkId;
  }

  /**
   * Parse the stored value. Throws when the value as a whole isn't an object (the caller decides
   * whether to treat the key as unreadable); single malformed entries are dropped.
   */
  static fromStored(value: unknown): SavedPageStyles
  {
    if (value === undefined) return new SavedPageStyles();
    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
      throw new Error(`expected an object, got ${Array.isArray(value) ? 'an array' : typeof value}`);
    }

    const byBookmarkId = new Map<string, SavedPageStyle>();
    for (const [bookmarkId, entry] of Object.entries(value))
    {
      const style = SavedPageStyle.fromStoredEntry(entry);
      if (bookmarkId !== '' && style) byBookmarkId.set(bookmarkId, style);
    }
    return new SavedPageStyles(byBookmarkId);
  }

  toStored(): StoredPageStyles
  {
    return Object.fromEntries(Array.from(this.#byBookmarkId, ([id, style]) => [id, style.toStored()]));
  }

  styleFor(bookmarkId: string): SavedPageStyle | null
  {
    return this.#byBookmarkId.get(bookmarkId) ?? null;
  }

  /** The same bookmarks with equal records, in any order. */
  equals(other: SavedPageStyles): boolean
  {
    if (this === other) return true;
    if (this.#byBookmarkId.size !== other.#byBookmarkId.size) return false;
    for (const [bookmarkId, style] of this.#byBookmarkId)
    {
      const theirs = other.#byBookmarkId.get(bookmarkId);
      if (!theirs || !theirs.equals(style)) return false;
    }
    return true;
  }

  /**
   * Save new CSS to the bookmark. An update keeps the bookmark's Auto-apply choice; a new record
   * starts with Auto-apply on.
   */
  withSaved(bookmarkId: string, css: string, origin: string, rev: string): SavedPageStyles
  {
    const autoApply = this.#byBookmarkId.get(bookmarkId)?.autoApply ?? true;
    return this.#with(bookmarkId, new SavedPageStyle(css, autoApply, origin, rev));
  }

  withAutoApply(bookmarkId: string, on: boolean): SavedPageStyles
  {
    const style = this.#byBookmarkId.get(bookmarkId);
    if (!style || style.autoApply === on) return this;
    return this.#with(bookmarkId, style.withAutoApply(on));
  }

  /**
   * Put a record back as it was, Auto-apply and rev included: Undo of a delete recreates the
   * bookmark under a new id, and the page in a Favorite's tab still carries the sheet of that rev.
   */
  withRestored(bookmarkId: string, style: SavedPageStyle): SavedPageStyles
  {
    const current = this.#byBookmarkId.get(bookmarkId);
    if (current && current.equals(style)) return this;
    return this.#with(bookmarkId, style);
  }

  /** The styles without those of the given bookmarks; this same instance when none of them had one. */
  without(bookmarkIds: Iterable<string>): SavedPageStyles
  {
    const remaining = new Map(this.#byBookmarkId);
    let changed = false;
    for (const id of bookmarkIds)
    {
      changed = remaining.delete(id) || changed;
    }
    return changed ? new SavedPageStyles(remaining) : this;
  }

  #with(bookmarkId: string, style: SavedPageStyle): SavedPageStyles
  {
    const next = new Map(this.#byBookmarkId);
    next.set(bookmarkId, style);
    return new SavedPageStyles(next);
  }
}
