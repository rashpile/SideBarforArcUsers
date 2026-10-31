// Copy a bookmark folder to the clipboard as YAML. The bookmarks and clipboard
// APIs are injected, so the module loads under Node without chrome.* or navigator.

import { YamlBookmarkList, type YamlSourceNode } from './bookmarkYaml.ts';

/** The chrome.bookmarks call copyBookmarksAsYaml needs. */
export interface BookmarkSubTreeApi
{
  getSubTree: (id: string) => Promise<YamlSourceNode[]>;
}

/** The navigator.clipboard call copyBookmarksAsYaml needs. */
export interface ClipboardWriter
{
  writeText: (text: string) => Promise<void>;
}

/**
 * Writes the folder (or, with childrenOnly, its children) as YAML to the clipboard
 * and returns the summary of what was copied. System folders are skipped.
 * Throws on a Chrome or clipboard error.
 */
export async function copyBookmarksAsYaml(
  bookmarksApi: BookmarkSubTreeApi,
  clipboard: ClipboardWriter,
  folderId: string,
  { childrenOnly }: { childrenOnly: boolean }
): Promise<string>
{
  const [folder] = await bookmarksApi.getSubTree(folderId);
  if (!folder)
  {
    throw new Error('Folder not found');
  }
  const nodes = childrenOnly ? folder.children ?? [] : [folder];
  const list = YamlBookmarkList.fromBookmarkNodes(nodes);
  await clipboard.writeText(list.toYaml());
  return list.summary();
}
