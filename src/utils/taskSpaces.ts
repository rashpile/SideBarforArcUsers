// Task Spaces: one-click temporary Spaces, kept out of the Space bar strip and
// named after the day they were created (YYYYMMDD-NN).

import type { Space } from './spaceMessages.ts';

// Child folder of Other Bookmarks that holds one subfolder per Task Space.
export const TASK_SPACES_FOLDER_TITLE = 'Tasks Spaces';
export const TASK_SPACE_ICON = 'list-todo';
export const TASK_SPACE_COLOR = 'green';

export function isTaskSpace(space: { task?: unknown }): boolean
{
  return Boolean(space.task);
}

export function regularSpaces<T extends { task?: unknown }>(spaces: readonly T[]): T[]
{
  return spaces.filter(space => !isTaskSpace(space));
}

/** A copy of the Space without the `task` key, so it becomes a regular Space. */
export function withoutTaskMarker(space: Space): Space
{
  const copy = { ...space };
  delete copy.task;
  return copy;
}

/** YYYYMMDD of the local date: a Task Space made just before midnight belongs to that day. */
export function taskSpaceDatePrefix(date: Date): string
{
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * The next free `YYYYMMDD-NN` name for the day: one past the highest number
 * already taken, so a deleted Task Space in the middle never gives its number
 * to a new one. `takenNames` holds live and archived Space names and the
 * folder titles under Tasks Spaces, since a folder outlives its Space.
 */
export function nextTaskSpaceName(date: Date, takenNames: Iterable<string>): string
{
  const prefix = taskSpaceDatePrefix(date);
  // The prefix is digits only, so it needs no escaping.
  const pattern = new RegExp(`^${prefix}-(\\d{2,})$`);
  let highest = 0;
  for (const name of takenNames)
  {
    const match = pattern.exec(name);
    if (match)
    {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `${prefix}-${String(highest + 1).padStart(2, '0')}`;
}
