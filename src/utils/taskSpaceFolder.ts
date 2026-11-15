// Bookmark folder of a new Task Space: Other Bookmarks / Tasks Spaces / YYYYMMDD-NN.

import { findRootFolder } from './bookmarkFolderLookup.ts';
import { nextTaskSpaceName, TASK_SPACES_FOLDER_TITLE } from './taskSpaces.ts';

/** The fields of a bookmark node createTaskSpaceFolder reads. */
export interface TaskSpaceFolderNode
{
  id: string;
  title: string;
  url?: string;
}

/** The chrome.bookmarks calls createTaskSpaceFolder needs (injected for tests). */
export interface TaskSpaceFolderBookmarksApi
{
  getChildren: (id: string) => Promise<TaskSpaceFolderNode[]>;
  create: (bookmark: { parentId: string; title: string }) => Promise<TaskSpaceFolderNode>;
}

export interface CreatedTaskSpaceFolder
{
  name: string;
  folderId: string;
}

/**
 * Creates the folder of a new Task Space and picks its name. The folder titles
 * already under Tasks Spaces count as taken, since a folder outlives a deleted
 * Task Space and two Spaces must not share one folder.
 *
 * `roots` are the top-level bookmark folders; the Other root is found by type,
 * so a profile with only account bookmarks (no ids '1'/'2') works too.
 */
export async function createTaskSpaceFolder(
  bookmarks: TaskSpaceFolderBookmarksApi,
  roots: readonly chrome.bookmarks.BookmarkTreeNode[],
  date: Date,
  takenNames: Iterable<string>
): Promise<CreatedTaskSpaceFolder>
{
  const otherRoot = findRootFolder(roots, 'other');
  if (!otherRoot)
  {
    throw new Error('"Other Bookmarks" folder not found');
  }

  const tasksFolder = await findOrCreateTasksFolder(bookmarks, otherRoot.id);
  const folderTitles = (await bookmarks.getChildren(tasksFolder.id))
    .filter(child => !child.url)
    .map(child => child.title);
  const name = nextTaskSpaceName(date, [...takenNames, ...folderTitles]);
  const folder = await bookmarks.create({ parentId: tasksFolder.id, title: name });
  return { name, folderId: folder.id };
}

async function findOrCreateTasksFolder(
  bookmarks: TaskSpaceFolderBookmarksApi,
  otherRootId: string
): Promise<TaskSpaceFolderNode>
{
  const children = await bookmarks.getChildren(otherRootId);
  return children.find(child => !child.url && child.title === TASK_SPACES_FOLDER_TITLE)
    ?? await bookmarks.create({ parentId: otherRootId, title: TASK_SPACES_FOLDER_TITLE });
}
