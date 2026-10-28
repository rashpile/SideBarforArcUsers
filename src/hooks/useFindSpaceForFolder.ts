import { useCallback } from 'react';
import { Space } from '../utils/spaceMessages';
import { findSpaceForFolderSegments } from '../utils/spaceFolderMatch';
import { BookmarkFolderLocation } from '../utils/bookmarkFolderLookup';

// Resolve which Space owns a bookmark folder, given its id. Takes the caller's
// existing getBookmarkFolderLocation (from useBookmarks()) and spaces (from
// useSpacesContext()) instead of fetching them itself, so callers that already
// hold both don't end up with a second set of listeners/state for the same data.
export const useFindSpaceForFolder = (
  getBookmarkFolderLocation: (bookmarkId: string) => Promise<BookmarkFolderLocation>,
  spaces: readonly Space[]
) =>
{
  return useCallback(async (folderId: string): Promise<Space | undefined> =>
  {
    const { segments, inAccount } = await getBookmarkFolderLocation(folderId);
    return findSpaceForFolderSegments(segments, spaces, inAccount);
  }, [getBookmarkFolderLocation, spaces]);
};
