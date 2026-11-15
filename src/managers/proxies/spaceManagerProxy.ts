// Sidebar-side client for background.ts's SpaceManager.
//
// Same shape as spaceWindowStateProxy (step 2), minus the per-window
// filtering: the Space lists are not scoped to a window, so there is exactly
// one mirror of each per context - live Spaces and archived Task Spaces.

import { ManagerId, callManager, CONTEXT_ID, Remote } from './messageRouting';
import { SpaceManagerApi, SPACES_CHANGED } from '../shared/spaceManagerApi';
import { ExternalStore, ReadableStore } from '../../stores/externalStore';
import { Space } from '../../utils/spaceMessages';
import { SpaceLists } from '../../utils/spaceLists';

/**
 * Extends the plain Remote<Api> shape with the pieces this manager has no
 * equivalent for: the local mirror, and the load() entry point that fills it.
 */
class SpaceManagerProxy implements Remote<SpaceManagerApi>
{
  // This context's mirror of the Space list. Private so every write goes
  // through #applySpaces; consumers read it via the store or snapshot getter.
  #store = new ExternalStore<readonly Space[]>([]);

  // This context's mirror of the archived Task Spaces, written only through
  // #applyArchived.
  #archivedStore = new ExternalStore<readonly Space[]>([]);

  // Whether the broadcast listener is already registered - see
  // #subscribeToBroadcasts.
  #subscribed = false;

  /** Read-only handle on the mirror, for useSyncExternalStore. */
  get store(): ReadableStore<readonly Space[]>
  {
    return this.#store;
  }

  /** Read-only handle on the archived Task Spaces mirror, for useSyncExternalStore. */
  get archivedStore(): ReadableStore<readonly Space[]>
  {
    return this.#archivedStore;
  }

  /**
   * The current Space list as this context sees it.
   *
   * Every mutation reads this at call time rather than a value captured
   * during render, which is what lets two back-to-back calls each see the
   * one before. Reading a render-captured list instead would make the second
   * call overwrite the first.
   *
   * Returned readonly on purpose. This is the live array behind the mirror,
   * not a copy, so pushing or splicing it would change what every subscriber
   * sees WITHOUT notifying any of them - the store only fires listeners from
   * set(). Callers build a new list (spread, map, filter) and hand it to
   * updateSpaces, or call restoreTaskSpace / deleteArchivedTaskSpace, which
   * apply their move to both mirrors through #changeLists. Those three are
   * the only supported ways to change this state.
   */
  get snapshot(): readonly Space[]
  {
    return this.#store.getSnapshot();
  }

  /**
   * Subscribes to the manager's broadcasts and fills the store with the
   * current Space list. The mirror-and-subscribe entry point, the analogue
   * of mirrorWindow() - called by the sidebar at mount.
   *
   * Safe to call more than once: React StrictMode double-invokes the mount
   * effect in dev, and re-loading must not stack listeners.
   */
  async load(): Promise<Space[]>
  {
    this.#subscribeToBroadcasts();
    const [spaces, archived] = await Promise.all([this.getSpaces(), this.getArchivedTaskSpaces()]);
    this.#applySpaces(spaces);
    this.#applyArchived(archived);
    return spaces;
  }

  /**
   * Subscribes to the manager's "changed" broadcasts, at most once for the
   * life of this context. Deliberately never unsubscribed - the proxy is a
   * module singleton that outlives every component that loads through it.
   *
   * Registered on first load() rather than at module scope so a context that
   * never loads doesn't wake up for broadcasts it would only discard.
   */
  #subscribeToBroadcasts(): void
  {
    if (this.#subscribed) return;
    this.#subscribed = true;

    // The broadcast's real job is the OTHER windows' writes. Our own come
    // back here too, and must be skipped: an echo describes the list at the
    // time its message was handled, which a newer local write may already
    // have moved past. See CONTEXT_ID in messageRouting.ts for the worked
    // example.
    //
    // `migrated` is the one deliberate exception: SpaceManager.updateSpaces()
    // sets it when what got stored differs from what THIS context
    // optimistically wrote (see #applySpaces call in updateSpaces() below).
    // Applying it despite the matching senderId is safe in both cases that
    // set it:
    // - Background resolved missing bookmarkFolderSegments. The one caller
    //   that can hit this - spaces import - awaits the write before the UI
    //   allows another space edit in this window, so there is no newer
    //   optimistic write here for it to clobber. See the shared-storage
    //   decision doc, section 4.
    // - Background dropped an archived Task Space. Any whole-list write - a
    //   reorder, an edit, createSpace - sends one back when it was built before
    //   the archive broadcast reached this mirror. Newer writes may follow, but
    //   each one built from the same stale mirror still holds the archived
    //   Space, so it gets its own migrated broadcast, which corrects the mirror
    //   again. Only a write made in the milliseconds between the archive
    //   broadcast and this one arriving gets no migrated broadcast of its own,
    //   so this one overwrites it in the mirror; a race next to an archive
    //   run, left as is.
    chrome.runtime.onMessage.addListener((message) =>
    {
      if (message?.action === SPACES_CHANGED && (message.senderId !== CONTEXT_ID || message.migrated === true))
      {
        this.#applySpaces(message.spaces);
        if (Array.isArray(message.archived)) this.#applyArchived(message.archived);
      }
    });
  }

  /**
   * The single writer of the mirror. Skips a list equal to the one already
   * held, so a no-op write doesn't re-render every consumer.
   *
   * The JSON comparison is deliberate and scoped to this use: these are
   * short, flat, JSON-derived objects that just came off the message
   * channel. It is not a general deep-equality utility.
   */
  #applySpaces(spaces: readonly Space[]): void
  {
    if (JSON.stringify(spaces) === JSON.stringify(this.#store.getSnapshot())) return;

    this.#store.set(spaces);
  }

  /** The single writer of the archived mirror, with the same no-op skip. */
  #applyArchived(archived: readonly Space[]): void
  {
    if (JSON.stringify(archived) === JSON.stringify(this.#archivedStore.getSnapshot())) return;

    this.#archivedStore.set(archived);
  }

  #applyLists(lists: SpaceLists): void
  {
    this.#applySpaces(lists.live);
    this.#applyArchived(lists.archived);
  }

  /**
   * After a failed call the optimistic write is showing a change that never
   * happened. Ask background what the truth is rather than rolling back to a
   * remembered list, which could undo a LATER write that did succeed. A
   * failed resync means the worker is gone and this page is about to be torn
   * down anyway, so there is nothing further to do.
   */
  #resync(): void
  {
    Promise.all([this.getSpaces(), this.getArchivedTaskSpaces()])
      .then(([spaces, archived]) => this.#applyLists(new SpaceLists(spaces, archived)))
      .catch(() => {});
  }

  /**
   * Plain read - does NOT touch the mirror. This is what DeleteSpaceAction
   * uses, since it doesn't keep one.
   */
  async getSpaces(): Promise<Space[]>
  {
    return await callManager<Space[]>(ManagerId.SPACES, 'getSpaces');
  }

  /** Plain read of the archived Task Spaces - does NOT touch the mirror. */
  async getArchivedTaskSpaces(): Promise<Space[]>
  {
    return await callManager<Space[]>(ManagerId.SPACES, 'getArchivedTaskSpaces');
  }

  /**
   * Writes the full Space list.
   *
   * The mirror is updated before the message goes out, so a synchronous
   * caller sees its own write - SpacesContext.createSpace depends on this,
   * since it hands the new Space back to its caller immediately. The ack is
   * NOT applied to the mirror: we already know the resulting list because we
   * chose it, and applying a reply that a newer write may have superseded
   * would only move the mirror backwards. The one exception is when
   * background stored something other than what we sent - it resolved
   * missing bookmarkFolderSegments, or dropped a Task Space archived since
   * our mirror last heard - and the mirror gets corrected for that via the
   * broadcast's `migrated` flag (see #subscribeToBroadcasts), not via this
   * method applying its own ack.
   *
   * The promise still resolves with the manager's reply, for callers that
   * need the write to have actually landed - DeleteSpaceAction waits on it,
   * because an undo straight afterwards reads the list back from background.
   * The seven CRUD callbacks in SpacesContext ignore it.
   */
  async updateSpaces(spaces: Space[]): Promise<Space[]>
  {
    this.#applySpaces(spaces);

    try
    {
      return await callManager<Space[]>(ManagerId.SPACES, 'updateSpaces', { spaces });
    }
    catch (error)
    {
      console.error('[spaceManagerProxy] updateSpaces failed, resyncing:', error);
      this.#resync();
      throw error;
    }
  }

  /**
   * Moves an archived Task Space back to the end of the live list. Applied to
   * both mirrors before the message goes out, so a caller that switches to
   * the Space right afterwards finds it in the live list.
   */
  async restoreTaskSpace(spaceId: string): Promise<void>
  {
    await this.#changeLists('restoreTaskSpace', spaceId, lists => lists.restore(spaceId));
  }

  /** Removes an archived Task Space for good; its bookmark folder stays. */
  async deleteArchivedTaskSpace(spaceId: string): Promise<void>
  {
    await this.#changeLists('deleteArchivedTaskSpace', spaceId, lists => lists.forgetArchived(spaceId));
  }

  // Optimistic like updateSpaces: the manager makes the same move on its own lists, and
  // our echo is skipped
  async #changeLists(method: string, spaceId: string, change: (lists: SpaceLists) => SpaceLists): Promise<void>
  {
    this.#applyLists(change(new SpaceLists(this.#store.getSnapshot(), this.#archivedStore.getSnapshot())));

    try
    {
      await callManager<void>(ManagerId.SPACES, method, { spaceId });
    }
    catch (error)
    {
      console.error(`[spaceManagerProxy] ${method} failed, resyncing:`, error);
      this.#resync();
      throw error;
    }
  }
}

export const spaceManagerProxy = new SpaceManagerProxy();
