import type { Space } from './spaceMessages';

// Find the Space that owns a bookmark folder, given the folder's full title path
// (root-to-leaf, as returned by useBookmarks().getBookmarkSegments) and storage
// (device vs Google account, see bookmarkFolderLookup.ts).
//
// A bookmark folder is assumed to belong to at most one Space (see CLAUDE.md
// "Design Assumptions") - if more than one Space's folder segments match, the
// first one found wins. A Space saved for the folder's own storage (or saved
// without storage info) wins over one saved for the other storage.
export function findSpaceForFolderSegments(
  folderSegments: string[],
  spaces: readonly Space[],
  folderInAccount?: boolean
): Space | undefined
{
  const candidates = spaces.filter(space =>
  {
    const spaceSegments = space.bookmarkFolderSegments;
    if (!spaceSegments || spaceSegments.length === 0 || spaceSegments.length > folderSegments.length)
    {
      return false;
    }
    return spaceSegments.every((segment, i) => segment === folderSegments[i]);
  });

  if (folderInAccount === undefined) return candidates[0];
  return candidates.find(space =>
    space.bookmarkFolderInAccount === undefined || space.bookmarkFolderInAccount === folderInAccount
  ) ?? candidates[0];
}
