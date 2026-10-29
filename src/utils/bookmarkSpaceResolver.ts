import type { Space } from './spaceMessages.ts';
import { isInAccountStorage } from './bookmarkFolderLookup.ts';
import { findSpaceForFolderSegments } from './spaceFolderMatch.ts';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

// Finds the Space that owns a bookmark from the folders above it, for code with
// no bookmark tree loaded (background.ts). A folder belongs to at most one Space
// (CLAUDE.md "Design Assumptions"), so a bookmark's tab belongs to that Space.
export class BookmarkSpaceResolver
{
  #getNode: (id: string) => Promise<BookmarkNode | undefined>;
  #getSpaces: () => readonly Space[];

  // getNode is chrome.bookmarks.get for one ID, undefined when the node is gone
  constructor(getNode: (id: string) => Promise<BookmarkNode | undefined>, getSpaces: () => readonly Space[])
  {
    this.#getNode = getNode;
    this.#getSpaces = getSpaces;
  }

  // The owning Space's ID, or undefined for a bookmark outside every Space folder
  async findSpaceId(bookmarkId: string): Promise<string | undefined>
  {
    const bookmark = await this.#getNode(bookmarkId);
    const folder = bookmark?.parentId ? await this.#getNode(bookmark.parentId) : undefined;
    if (!folder) return undefined;

    const segments = await this.#folderSegments(folder);
    return findSpaceForFolderSegments(segments, this.#getSpaces(), isInAccountStorage(folder))?.id;
  }

  // The folder's title path from its root folder down, as useBookmarks' getBookmarkSegments builds it
  async #folderSegments(folder: BookmarkNode): Promise<string[]>
  {
    const segments: string[] = [];
    let node: BookmarkNode | undefined = folder;
    while (node)
    {
      // The tree root (ID "0") has no title
      if (node.id !== '0' && node.title) segments.unshift(node.title);
      node = node.parentId ? await this.#getNode(node.parentId) : undefined;
    }
    return segments;
  }
}
