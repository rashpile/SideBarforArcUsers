// HiddenTaskSpacesManager - owns the marks that hide Task Spaces from the recent list.
//
// Background-side implementation of shared/hiddenTaskSpacesApi.ts. The sidebar reaches it
// through proxies/hiddenTaskSpacesProxy.ts. Single writer of the `hiddenRecentTaskSpaces` key -
// see "Shared state" in docs/development.md: a sidebar's (−) hides, background unhides the Space
// a window enters and drops the marks of Spaces that are no longer live Task Spaces.

import { ManagerId } from '../proxies/messageRouting.ts';
import type { RoutedManager } from '../proxies/messageRouting.ts';
import {
  HIDDEN_TASK_SPACES_CHANGED,
  HIDDEN_TASK_SPACES_STORAGE_KEY,
  HiddenTaskSpaces,
} from '../shared/hiddenTaskSpacesApi.ts';
import type { HiddenTaskSpacesApi } from '../shared/hiddenTaskSpacesApi.ts';

/** The chrome APIs the manager uses, injected so tests run under Node. */
export interface HiddenTaskSpacesManagerDeps
{
  storage: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
  };
  broadcast: (message: Record<string, unknown>) => Promise<unknown>;
}

export class HiddenTaskSpacesManager implements RoutedManager, HiddenTaskSpacesApi
{
  readonly managerId = ManagerId.HIDDEN_TASK_SPACES;

  readonly #deps: HiddenTaskSpacesManagerDeps;
  #hidden = HiddenTaskSpaces.EMPTY;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(deps: HiddenTaskSpacesManagerDeps)
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
      case 'getHidden':
        return this.getHidden();

      case 'hide':
        return this.hide(message.spaceId as string, originId);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  /**
   * Never rejects: an unreadable key must not turn stateReady false. The marks only hide rows of
   * a list, so a failed read starts with none hidden.
   */
  async load(): Promise<void>
  {
    try
    {
      const result = await this.#deps.storage.get(HIDDEN_TASK_SPACES_STORAGE_KEY);
      this.#hidden = HiddenTaskSpaces.fromStored(result[HIDDEN_TASK_SPACES_STORAGE_KEY]);
    }
    catch (error)
    {
      console.error('[HiddenTaskSpacesManager] failed to load the hidden Task Spaces:', error);
    }
  }

  getHidden(): string[]
  {
    return this.#hidden.toStored();
  }

  hide(spaceId: string, originId?: string): string[]
  {
    if (typeof spaceId !== 'string' || spaceId === '')
    {
      throw new Error(`${this.managerId}: hide needs a Space id`);
    }
    return this.#commit(this.#hidden.with(spaceId), originId);
  }

  /** Background calls it when a window enters the Space, by any route. */
  unhide(spaceId: string): void
  {
    this.#commit(this.#hidden.without(spaceId));
  }

  /** Drops the marks of Spaces that are no longer live Task Spaces (archived, deleted, converted). */
  retain(liveTaskSpaceIds: readonly string[]): void
  {
    this.#commit(this.#hidden.retaining(liveTaskSpaceIds));
  }

  /**
   * Stores one already-computed value: in memory, then to storage, then out to every listening
   * context. An unchanged value (same instance) is neither written nor broadcast, so entering a
   * Space that isn't hidden costs nothing.
   *
   * originId is absent for background-internal callers (unhide, retain), whose broadcasts are
   * news to everyone.
   */
  #commit(next: HiddenTaskSpaces, originId?: string): string[]
  {
    const hidden = next.toStored();
    if (next === this.#hidden) return hidden;

    this.#hidden = next;
    this.#write();

    this.#deps.broadcast({
      action: HIDDEN_TASK_SPACES_CHANGED,
      hidden,
      senderId: originId,
    }).catch(() =>
    {
      // No sidebar open
    });

    return hidden;
  }

  // Writes run one at a time and each takes the value from memory when it runs, so an older
  // write can't land after a newer one
  #write(): void
  {
    this.#writeTail = this.#writeTail
      .then(() => this.#deps.storage.set({ [HIDDEN_TASK_SPACES_STORAGE_KEY]: this.#hidden.toStored() }))
      .catch(error => console.error('[HiddenTaskSpacesManager] failed to store the hidden Task Spaces:', error));
  }

  /** Resolves once every write started so far has finished (tests). */
  async flushWrites(): Promise<void>
  {
    await this.#writeTail;
  }
}
