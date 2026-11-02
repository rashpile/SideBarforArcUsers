import type { DropPosition } from './dragDrop.ts';

type DropPlacementPosition = NonNullable<DropPosition>;

/** The fields of chrome.bookmarks.BookmarkTreeNode the placement reads. */
export interface DropTargetNode
{
  parentId?: string;
  index?: number;
}

function isSpaceFolder(targetId: string, spaceFolderId: string | null | undefined): boolean
{
  return spaceFolderId !== null && spaceFolderId !== undefined && spaceFolderId === targetId;
}

/**
 * The position to use for a drop on `targetId`.
 *
 * The Space folder has no row of its own; the only drop target with its id is
 * the Space root target under the last top-level bookmark. A `before` or
 * `after` there would put the item next to the Space folder, in its parent,
 * outside the Space; `intoFirst` would put it at the top though the target
 * sits at the bottom. So every drop on it means "append to the Space folder".
 */
export function spaceRootDropPosition(
  targetId: string,
  position: DropPlacementPosition,
  spaceFolderId: string | null | undefined
): DropPlacementPosition
{
  return isSpaceFolder(targetId, spaceFolderId) ? 'into' : position;
}

/** Where a bookmark created by a drop goes: its parent folder and its index there. */
export class BookmarkDropPlacement
{
  parentId: string;
  // undefined appends at the end: Chrome appends when the index is omitted
  index: number | undefined;

  constructor(parentId: string, index: number | undefined)
  {
    this.parentId = parentId;
    this.index = index;
  }

  static resolve(
    targetId: string,
    targetNode: DropTargetNode | null,
    position: DropPlacementPosition,
    isFolder: boolean,
    spaceFolderId: string | null | undefined
  ): BookmarkDropPlacement
  {
    // Checked before isFolder so the Space root never depends on the caller's flag
    if (isSpaceFolder(targetId, spaceFolderId))
    {
      return new BookmarkDropPlacement(targetId, undefined);
    }
    if (position === 'into' && isFolder)
    {
      return new BookmarkDropPlacement(targetId, undefined);
    }
    if (position === 'intoFirst')
    {
      return new BookmarkDropPlacement(targetId, 0);
    }
    if (targetNode?.parentId !== undefined && targetNode.index !== undefined)
    {
      const index = position === 'before' ? targetNode.index : targetNode.index + 1;
      return new BookmarkDropPlacement(targetNode.parentId, index);
    }
    return new BookmarkDropPlacement(targetId, undefined);
  }
}
