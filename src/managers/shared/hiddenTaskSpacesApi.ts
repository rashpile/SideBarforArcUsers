// The wire contract for HiddenTaskSpacesManager, owned by neither side.
//
// impl/hiddenTaskSpacesManager.ts implements HiddenTaskSpacesApi;
// proxies/hiddenTaskSpacesProxy.ts implements Remote<HiddenTaskSpacesApi>.
//
// The (−) button of a recent Task Spaces row hides that Task Space from the list until it is
// entered again. Shared by every window, so the marks live in background.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting.ts';

export const HIDDEN_TASK_SPACES_STORAGE_KEY = 'hiddenRecentTaskSpaces';

/**
 * The hidden marks, by Space id. Immutable: every change returns a new value, or this same one
 * when nothing changed, so callers can skip a write by identity.
 *
 * A mark hides a Task Space from the recent list only, never from the sandwich (Task Spaces) list.
 */
export class HiddenTaskSpaces
{
  static readonly EMPTY = new HiddenTaskSpaces(new Set());

  readonly #ids: ReadonlySet<string>;

  private constructor(ids: ReadonlySet<string>)
  {
    this.#ids = ids;
  }

  /** Reads a stored or received value; anything but an array reads as empty, non-string items are dropped. */
  static fromStored(raw: unknown): HiddenTaskSpaces
  {
    if (!Array.isArray(raw)) return HiddenTaskSpaces.EMPTY;

    const ids = raw.filter((id): id is string => typeof id === 'string' && id !== '');
    return ids.length > 0 ? new HiddenTaskSpaces(new Set(ids)) : HiddenTaskSpaces.EMPTY;
  }

  isHidden(spaceId: string): boolean
  {
    return this.#ids.has(spaceId);
  }

  with(spaceId: string): HiddenTaskSpaces
  {
    if (this.#ids.has(spaceId)) return this;
    return new HiddenTaskSpaces(new Set([...this.#ids, spaceId]));
  }

  without(spaceId: string): HiddenTaskSpaces
  {
    if (!this.#ids.has(spaceId)) return this;

    const ids = new Set(this.#ids);
    ids.delete(spaceId);
    return new HiddenTaskSpaces(ids);
  }

  /** Keeps only the marks of the given Spaces. */
  retaining(spaceIds: readonly string[]): HiddenTaskSpaces
  {
    const keep = new Set(spaceIds);
    const kept = [...this.#ids].filter(id => keep.has(id));
    if (kept.length === this.#ids.size) return this;
    return new HiddenTaskSpaces(new Set(kept));
  }

  toStored(): string[]
  {
    return [...this.#ids];
  }
}

/**
 * What the sidebar can call. Every method returns the resulting marks, which become the ack
 * payload the proxy resyncs from.
 *
 * Unhiding is not here: background clears a mark when the Space is entered, by any route.
 */
export interface HiddenTaskSpacesApi
{
  getHidden(): string[];
  hide(spaceId: string): string[];
}

/** Broadcast to every listening context when the marks change, with the requester's senderId. */
export const HIDDEN_TASK_SPACES_CHANGED = makeManagerActionId(ManagerId.HIDDEN_TASK_SPACES, 'changed');
