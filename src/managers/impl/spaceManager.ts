// SpaceManager - owns Space definitions (load, migrate, save): the live list
// (`spaces`) and archived Task Spaces (`archivedTaskSpaces`).
//
// Background-side implementation of shared/spaceManagerApi.ts. The sidebar
// reaches it through proxies/spaceManagerProxy.ts; the routing vocabulary is
// in proxies/messageRouting.ts.

import { ManagerId, RoutedManager } from '../proxies/messageRouting';
import { SpaceManagerApi, SPACES_CHANGED } from '../shared/spaceManagerApi';
import { ARCHIVED_TASK_SPACES_STORAGE_KEY, SPACES_STORAGE_KEY, Space } from '../../utils/spaceMessages';
import { SpaceLists } from '../../utils/spaceLists';

// Walk bookmark tree matching path string as a prefix chain to build segment array.
// Returns the title segments (one per folder level) or null if not found.
// Handles folder names containing '/' by treating each node title as an atomic segment.
function findFolderSegmentsByPath(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  path: string,
  isRoot: boolean = true
): string[] | null
{
  for (const node of nodes)
  {
    if (node.url) continue;

    // Root-level folders matched case-insensitively for platform differences
    const matches = isRoot
      ? path.toLowerCase().startsWith(node.title.toLowerCase())
      : path.startsWith(node.title);
    if (!matches) continue;

    const after = path.slice(node.title.length);
    // Ensure match is a complete segment boundary, not a partial name match
    if (after !== '' && !after.startsWith('/')) continue;

    if (after === '') return [node.title];

    const childSegments = findFolderSegmentsByPath(node.children || [], after.slice(1), false);
    if (childSegments) return [node.title, ...childSegments];
  }
  return null;
}

export interface SpaceManagerDeps
{
  /** A Task Space came back from the archived list. */
  onRestored?(spaceId: string): void;
}

export class SpaceManager implements RoutedManager, SpaceManagerApi
{
  readonly managerId = ManagerId.SPACES;

  private lists = SpaceLists.empty();
  private readonly deps: SpaceManagerDeps;

  constructor(deps: SpaceManagerDeps = {})
  {
    this.deps = deps;
  }

  /** See RoutedManager.dispatch. */
  async dispatch(method: string, message: Record<string, unknown>): Promise<unknown>
  {
    switch (method)
    {
      case 'getSpaces':
        return this.getSpaces();

      case 'getArchivedTaskSpaces':
        return this.getArchivedTaskSpaces();

      case 'updateSpaces':
        return this.updateSpaces(message.spaces as Space[], message.senderId as string | undefined);

      case 'restoreTaskSpace':
        return this.restoreTaskSpace(message.spaceId as string, message.senderId as string | undefined);

      case 'deleteArchivedTaskSpace':
        return this.deleteArchivedTaskSpace(message.spaceId as string, message.senderId as string | undefined);

      default:
        throw new Error(`${this.managerId}: unknown method "${method}"`);
    }
  }

  async load(): Promise<void>
  {
    const result = await chrome.storage.local.get([SPACES_STORAGE_KEY, ARCHIVED_TASK_SPACES_STORAGE_KEY]);
    let spaces: Space[] = result[SPACES_STORAGE_KEY] || [];
    spaces = await this.migrate(spaces);
    const archived = result[ARCHIVED_TASK_SPACES_STORAGE_KEY];
    this.lists = new SpaceLists(spaces, Array.isArray(archived) ? archived : []);
  }

  /**
   * Populate bookmarkFolderSegments for any space that only has
   * bookmarkFolderPath, by walking the current bookmark tree. Pure - returns
   * the resolved list plus whether anything actually changed, and leaves
   * persisting/broadcasting to the two callers below, which need different
   * things to happen next.
   *
   * This is also the self-heal for Arc import and any backup that predates
   * bookmarkFolderSegments: both hand updateSpaces() a space shaped exactly
   * like this (path set, no segments).
   */
  private async resolveMissingSegments(spaces: Space[]): Promise<{ spaces: Space[]; changed: boolean }>
  {
    const needsResolution = spaces.some(s => s.bookmarkFolderPath && !s.bookmarkFolderSegments);
    if (!needsResolution) return { spaces, changed: false };

    const tree = await chrome.bookmarks.getTree();
    const roots = tree[0]?.children || [];

    const resolved = spaces.map(space =>
    {
      if (!space.bookmarkFolderPath || space.bookmarkFolderSegments) return space;
      const segments = findFolderSegmentsByPath(roots, space.bookmarkFolderPath);
      return segments ? { ...space, bookmarkFolderSegments: segments } : space;
    });

    // Per-item comparison, not just "resolved !== spaces" - map() always
    // returns a new array even when every element comes back unchanged (e.g.
    // a bookmarkFolderPath that no longer matches any folder), and callers
    // need to know whether anything actually changed, not just whether a new
    // array was allocated.
    const changed = resolved.some((s, i) => s !== spaces[i]);

    // DEV-only: confirms exactly what the self-heal did for each space that
    // needed it - whether a matching folder was actually found, and what
    // segments it resolved to. This is the thing to check in DevTools after
    // an Arc import or a backup import to confirm segments came back right.
    if (import.meta.env.DEV)
    {
      for (let i = 0; i < spaces.length; i++)
      {
        const before = spaces[i];
        if (!before.bookmarkFolderPath || before.bookmarkFolderSegments) continue;
        const after = resolved[i];
        console.log(
          after.bookmarkFolderSegments
            ? `[SpaceManager] resolved segments for "${before.name}": ${JSON.stringify(after.bookmarkFolderSegments)}`
            : `[SpaceManager] could NOT resolve segments for "${before.name}" (path "${before.bookmarkFolderPath}") - no matching folder found`
        );
      }
    }

    return { spaces: resolved, changed };
  }

  // Startup-only migration: resolve segments and persist immediately if
  // anything changed. Runs inside load(), before stateReady resolves, so it
  // must NOT broadcast - no sidebar has asked for anything yet.
  private async migrate(spaces: Space[]): Promise<Space[]>
  {
    const { spaces: resolved, changed } = await this.resolveMissingSegments(spaces);
    if (changed)
    {
      await chrome.storage.local.set({ [SPACES_STORAGE_KEY]: resolved });
    }
    return resolved;
  }

  getSpaces(): readonly Space[]
  {
    return this.lists.live;
  }

  getArchivedTaskSpaces(): readonly Space[]
  {
    return this.lists.archived;
  }

  /** Background-internal: ids of every Task Space, live and archived. */
  getTaskSpaceIds(): string[]
  {
    return this.lists.taskSpaceIds();
  }

  /**
   * originId identifies the context that asked for this change, so the
   * broadcast below can be recognised as an echo by whoever sent it. Absent
   * for background-internal callers, whose broadcasts are news to everyone.
   *
   * Resolves any missing bookmarkFolderSegments before storing (see
   * resolveMissingSegments above), so the value actually stored/broadcast can
   * differ from what the caller sent. The broadcast's `migrated` flag tells
   * the ORIGINATING proxy to apply it despite the matching senderId (which
   * would normally mean "my own echo, skip it") - safe only because the one
   * caller that can actually hit this (spaces import) awaits the write before
   * the UI allows another space edit in the same window, so there is no
   * newer optimistic write here for this to clobber. See the shared-storage
   * decision doc, section 4, for the general hazard this sidesteps.
   *
   * It is also set when the list still held an archived Task Space, which a
   * mirror that missed the archive broadcast sends back; the Space is dropped
   * and the sender's mirror needs correcting the same way.
   */
  async updateSpaces(spaces: Space[], originId?: string): Promise<readonly Space[]>
  {
    const { spaces: resolved, changed: segmentsResolved } = await this.resolveMissingSegments(spaces);

    // After the await: an archive that landed while the bookmark tree was read must
    // still keep its Space out of the live list
    this.lists = this.lists.withLive(resolved);
    const live = this.lists.live;
    const migrated = segmentsResolved || live.length !== resolved.length;

    chrome.storage.local.set({ [SPACES_STORAGE_KEY]: live });

    // DEV-only: confirms background actually applied this update to its own
    // in-memory list, at the moment it happens - for manually verifying the
    // fix for a deleted Space staying in background's list, without
    // a sendMessage round trip, which can't reach background from its own
    // console (a context's runtime.sendMessage doesn't loop back to itself).
    if (import.meta.env.DEV)
    {
      console.log('[SpaceManager] updateSpaces applied:', live.map(s => `${s.name} (${s.id})`));
    }

    // migrated tells the originating proxy this is NOT a plain echo of what
    // it sent, apply it - see broadcast().
    this.broadcast(originId, migrated);

    return live;
  }

  /**
   * Background-internal: moves live Task Spaces to the archived list, stamped
   * with `now`. Regular Spaces and unknown ids are ignored. Resolves once both
   * lists are stored, so the caller can close the Space's tabs afterwards.
   */
  async archiveTaskSpaces(ids: Iterable<string>, now: number): Promise<void>
  {
    const next = this.lists.archive(ids, now);
    if (next === this.lists) return;

    this.lists = next;
    await this.storeBothLists();
    this.broadcast(undefined, false);
  }

  async restoreTaskSpace(spaceId: string, originId?: string): Promise<void>
  {
    const next = this.lists.restore(spaceId);
    if (next === this.lists) return;

    this.lists = next;
    await this.storeBothLists();
    this.broadcast(originId, false);
    this.deps.onRestored?.(spaceId);
  }

  async deleteArchivedTaskSpace(spaceId: string, originId?: string): Promise<void>
  {
    const next = this.lists.forgetArchived(spaceId);
    if (next === this.lists) return;

    this.lists = next;
    await chrome.storage.local.set({ [ARCHIVED_TASK_SPACES_STORAGE_KEY]: next.archived });
    this.broadcast(originId, false);
  }

  // One set() call, so a Space moving between the lists is never stored in both or neither
  private async storeBothLists(): Promise<void>
  {
    await chrome.storage.local.set({
      [SPACES_STORAGE_KEY]: this.lists.live,
      [ARCHIVED_TASK_SPACES_STORAGE_KEY]: this.lists.archived,
    });
  }

  /**
   * Tells every sidebar both lists changed. senderId is echoed back so the
   * context that requested the change can ignore its own echo - see
   * CONTEXT_ID in proxies/messageRouting.ts. Absent for background-internal
   * changes, whose broadcasts are news to everyone.
   */
  private broadcast(originId: string | undefined, migrated: boolean): void
  {
    chrome.runtime.sendMessage({
      action: SPACES_CHANGED,
      spaces: this.lists.live,
      archived: this.lists.archived,
      senderId: originId,
      migrated,
    }).catch(() =>
    {
      // Sidepanel may not be open - ignore error
    });
  }
}
