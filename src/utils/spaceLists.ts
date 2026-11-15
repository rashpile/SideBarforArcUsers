// The two lists SpaceManager owns: live Spaces (`spaces`) and archived Task Spaces
// (`archivedTaskSpaces`). A Space id is in at most one of them.

import type { Space, TaskSpaceInfo } from './spaceMessages.ts';
import { isTaskSpace } from './taskSpaces.ts';

function hasTaskMarker(space: Space): space is Space & { task: TaskSpaceInfo }
{
  return isTaskSpace(space);
}

function withoutArchivedAt(space: Space): Space
{
  if (!space.task) return space;
  const task = { ...space.task };
  delete task.archivedAt;
  return { ...space, task };
}

/**
 * Live Spaces and archived Task Spaces. Every change returns a new instance, so the
 * manager swaps it in after a change and the proxy applies the same move to its mirrors.
 */
export class SpaceLists
{
  readonly live: readonly Space[];
  readonly archived: readonly Space[];

  constructor(live: readonly Space[], archived: readonly Space[])
  {
    this.live = live;
    this.archived = archived;
  }

  static empty(): SpaceLists
  {
    return new SpaceLists([], []);
  }

  /**
   * Takes a whole-list write of the live Spaces. A context whose mirror missed an archive
   * still lists the archived Space and would bring it back, so archived ids are dropped.
   */
  withLive(spaces: readonly Space[]): SpaceLists
  {
    const archivedIds = new Set(this.archived.map(space => space.id));
    return new SpaceLists(spaces.filter(space => !archivedIds.has(space.id)), this.archived);
  }

  /** Moves the live Task Spaces with these ids to the end of the archived list. */
  archive(ids: Iterable<string>, now: number): SpaceLists
  {
    const wanted = new Set(ids);
    const moving = this.live.filter(hasTaskMarker).filter(space => wanted.has(space.id));
    if (moving.length === 0) return this;

    const movingIds = new Set(moving.map(space => space.id));
    const stamped = moving.map(space => ({ ...space, task: { ...space.task, archivedAt: now } }));
    return new SpaceLists(
      this.live.filter(space => !movingIds.has(space.id)),
      [...this.archived, ...stamped]
    );
  }

  /** Moves the archived record back to the end of the live list. */
  restore(id: string): SpaceLists
  {
    const record = this.archived.find(space => space.id === id);
    if (!record) return this;

    return new SpaceLists(
      [...this.live.filter(space => space.id !== id), withoutArchivedAt(record)],
      this.archived.filter(space => space.id !== id)
    );
  }

  forgetArchived(id: string): SpaceLists
  {
    if (!this.archived.some(space => space.id === id)) return this;
    return new SpaceLists(this.live, this.archived.filter(space => space.id !== id));
  }

  /** Ids of every Task Space, live and archived. */
  taskSpaceIds(): string[]
  {
    return [...this.live.filter(hasTaskMarker), ...this.archived].map(space => space.id);
  }
}
