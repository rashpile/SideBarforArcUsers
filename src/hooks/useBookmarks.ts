import { useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { createChromeErrorHandler } from '../utils/chromeError';
import { BookmarkTreeSource, SharedBookmarkStore } from '../stores/sharedBookmarkStore';
import {
  BookmarkFolderLocation,
  RootFolderType,
  findFolderBySegments as findFolderBySegmentsInTree,
  findRootFolder,
  isInAccountStorage,
} from '../utils/bookmarkFolderLookup';
import { isSystemFolder } from '../utils/archiveFolder';

export type SortOption = 'none' | 'name' | 'dateAdded';

// Module-level flag shared across all hook instances
let isBatchOperation = false;

const createChromeBookmarkSource = (): BookmarkTreeSource | undefined =>
{
  if (typeof chrome === 'undefined' || !chrome.bookmarks) return undefined;

  return {
    readTree: (onResult) =>
    {
      chrome.bookmarks.getTree((tree) =>
      {
        onResult(tree, chrome.runtime.lastError?.message ?? null);
      });
    },
    subscribe: (onChange) =>
    {
      const onCreated = () => onChange();
      const onRemoved = () => onChange();
      const onChanged = () => onChange();
      const onMoved = () => onChange();
      const onChildrenReordered = () => onChange();

      chrome.bookmarks.onCreated.addListener(onCreated);
      chrome.bookmarks.onRemoved.addListener(onRemoved);
      chrome.bookmarks.onChanged.addListener(onChanged);
      chrome.bookmarks.onMoved.addListener(onMoved);
      chrome.bookmarks.onChildrenReordered.addListener(onChildrenReordered);

      return () =>
      {
        chrome.bookmarks.onCreated.removeListener(onCreated);
        chrome.bookmarks.onRemoved.removeListener(onRemoved);
        chrome.bookmarks.onChanged.removeListener(onChanged);
        chrome.bookmarks.onMoved.removeListener(onMoved);
        chrome.bookmarks.onChildrenReordered.removeListener(onChildrenReordered);
      };
    },
  };
};

const sharedBookmarkStore = new SharedBookmarkStore(
  createChromeBookmarkSource,
  () => isBatchOperation
);

const refreshAll = () => sharedBookmarkStore.refresh();

/**
 * Read handle on the shared tree, for a hook that derives a small part of it and
 * should not re-render its component on every bookmark change (usePinnedSites).
 */
export const bookmarkTreeStore: Pick<SharedBookmarkStore, 'subscribe' | 'getSnapshot'> = sharedBookmarkStore;

export { refreshAll as refreshAllBookmarks };

// Wrap an async operation in batch mode to suppress intermediate refetches
export async function runBatchOperation<T>(fn: () => Promise<T>): Promise<T>
{
  isBatchOperation = true;
  try
  {
    return await fn();
  }
  finally
  {
    isBatchOperation = false;
    refreshAll();
  }
}

export const useBookmarks = () => {
  const bookmarkSnapshot = useSyncExternalStore(
    sharedBookmarkStore.subscribe,
    sharedBookmarkStore.getSnapshot,
    sharedBookmarkStore.getSnapshot
  );
  const bookmarks = bookmarkSnapshot.bookmarks;
  const [error, setError] = useState<string | null>(null);

  const handleError = useMemo(() => createChromeErrorHandler('Bookmark', setError), []);

  // const removeBookmark = useCallback((id: string) => {
  //   chrome.bookmarks.removeTree(id, () => {
  //     handleError('remove');
  //   });
  // }, [handleError]);

  const createFolder = useCallback((
    parentId: string,
    title: string,
    callback?: (node: chrome.bookmarks.BookmarkTreeNode) => void
  ) => {
    chrome.bookmarks.create({ parentId, title }, (node) => {
      if (!handleError('create folder') && node && callback) {
        callback(node);
      }
    });
  }, [handleError]);

  const updateBookmark = useCallback((id: string, title: string, url?: string) => {
    const changes: chrome.bookmarks.BookmarkChangesArg = { title };
    if (url !== undefined) {
      changes.url = url;
    }
    chrome.bookmarks.update(id, changes, () => {
      handleError('update');
    });
  }, [handleError]);

  // URL only: sending the title too would overwrite a rename made since the tree was read.
  const updateBookmarkUrl = useCallback((id: string, url: string) =>
  {
    chrome.bookmarks.update(id, { url }, () =>
    {
      handleError('update url');
    });
  }, [handleError]);

  const sortBookmarks = useCallback((folderId: string, sortBy: SortOption) => {
    if (sortBy === 'none') return;

    chrome.bookmarks.getChildren(folderId, async (children) => {
      if (handleError('get children') || !children) return;

      // Separate folders and bookmarks
      const folders = children.filter(c => !c.url);
      const bookmarkItems = children.filter(c => c.url);

      // Sort each group
      const sortFn = (a: chrome.bookmarks.BookmarkTreeNode, b: chrome.bookmarks.BookmarkTreeNode) => {
        if (sortBy === 'name') {
          return a.title.localeCompare(b.title);
        } else if (sortBy === 'dateAdded') {
          return (a.dateAdded || 0) - (b.dateAdded || 0);
        }
        return 0;
      };

      folders.sort(sortFn);
      bookmarkItems.sort(sortFn);

      // Folders first, then bookmarks
      const sorted = [...folders, ...bookmarkItems];

      // Batch mode: suppress listener-triggered refetches during moves
      isBatchOperation = true;
      try {
        // Move each item to its new position
        for (const [index, item] of sorted.entries()) {
          await new Promise<void>((resolve) => {
            chrome.bookmarks.move(item.id, { parentId: folderId, index }, () => {
              handleError('sort move');
              resolve();
            });
          });
        }
      } finally {
        isBatchOperation = false;
        refreshAll();
      }
    });
  }, [handleError]);

  const moveBookmark = useCallback(async (
    sourceId: string,
    destinationId: string,
    position: 'before' | 'after' | 'into' | 'intoFirst'
  ): Promise<chrome.bookmarks.BookmarkTreeNode | null> => {
    if (position === 'into') {
      // Move into folder at the end
      const children = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
        chrome.bookmarks.getChildren(destinationId, (result) => {
          if (handleError('get children')) {
            resolve([]);
            return;
          }
          resolve(result || []);
        });
      });
      const index = children.length;
      return new Promise((resolve) => {
        chrome.bookmarks.move(sourceId, { parentId: destinationId, index }, (result) => {
          handleError('move');
          resolve(result || null);
        });
      });
    } else if (position === 'intoFirst') {
      // Move into folder at the beginning (for expanded folders, bottom 25% zone)
      return new Promise((resolve) => {
        chrome.bookmarks.move(sourceId, { parentId: destinationId, index: 0 }, (result) => {
          handleError('move');
          resolve(result || null);
        });
      });
    } else {
      // Move before/after destination item
      const dest = await new Promise<chrome.bookmarks.BookmarkTreeNode | null>((resolve) => {
        chrome.bookmarks.get(destinationId, (results) => {
          if (handleError('get destination') || !results || results.length === 0) {
            resolve(null);
            return;
          }
          resolve(results[0]);
        });
      });

      if (!dest || !dest.parentId || dest.index === undefined) {
        return null;
      }

      let targetIndex = dest.index;
      if (position === 'after') {
        targetIndex += 1;
      }

      // Chrome's move API handles same-parent index adjustment internally
      return new Promise((resolve) => {
        chrome.bookmarks.move(sourceId, { parentId: dest.parentId!, index: targetIndex }, (result) => {
          handleError('move');
          resolve(result || null);
        });
      });
    }
  }, [handleError]);

  // Find a folder by name under a specific parent folder
  const findFolderInParent = useCallback((
    parentId: string,
    folderName: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode | null> =>
  {
    return new Promise((resolve) =>
    {
      chrome.bookmarks.getChildren(parentId, (children) =>
      {
        if (handleError('find folder') || !children)
        {
          resolve(null);
          return;
        }
        const folder = children.find(child => !child.url && child.title === folderName);
        resolve(folder || null);
      });
    });
  }, [handleError]);

  // Create a single bookmark (with URL) at optional index position
  // Returns { node, error } - error is the Chrome API error message if creation failed
  const createBookmark = useCallback((
    parentId: string,
    title: string,
    url: string,
    index?: number
  ): Promise<{ node: chrome.bookmarks.BookmarkTreeNode | null; error: string | null }> =>
  {
    return new Promise((resolve) =>
    {
      const createArg: chrome.bookmarks.BookmarkCreateArg = { parentId, title, url };
      if (index !== undefined)
      {
        createArg.index = index;
      }
      chrome.bookmarks.create(createArg, (node) =>
      {
        const lastError = chrome.runtime.lastError;
        if (lastError)
        {
          // Not handleError: the caller shows this error (New Bookmark dialog), and the
          // hook's error state would stick under the Bookmarks tree after the dialog closes
          console.error('Bookmark create bookmark error:', lastError.message);
          resolve({ node: null, error: lastError.message || 'Unknown error' });
          return;
        }
        resolve({ node: node || null, error: null });
      });
    });
  }, []);

  // Get a single bookmark by ID
  const getBookmark = useCallback((
    bookmarkId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode | null> =>
  {
    return new Promise((resolve) =>
    {
      chrome.bookmarks.get(bookmarkId, (results) =>
      {
        if (handleError('get bookmark') || !results || results.length === 0)
        {
          resolve(null);
          return;
        }
        resolve(results[0]);
      });
    });
  }, [handleError]);

  // Get children of a folder (promise-based)
  const getChildren = useCallback((
    folderId: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode[]> =>
  {
    return new Promise((resolve) =>
    {
      chrome.bookmarks.getChildren(folderId, (children) =>
      {
        if (handleError('get children'))
        {
          resolve([]);
          return;
        }
        resolve(children || []);
      });
    });
  }, [handleError]);

  // Remove all children from a folder, for Importing
  const clearFolder = useCallback(async (folderId: string): Promise<void> =>
  {
    const children = await getChildren(folderId);

    if (children.length === 0) return;

    // Batch mode: suppress listener-triggered refetches during removals
    isBatchOperation = true;
    try
    {
      for (const child of children)
      {
        await new Promise<void>((resolve) =>
        {
          chrome.bookmarks.removeTree(child.id, () =>
          {
            handleError('clear folder');
            resolve();
          });
        });
      }
    }
    finally
    {
      isBatchOperation = false;
      refreshAll();
    }
  }, [getChildren, handleError]);

  // Batch create multiple bookmarks with single refetch at end
  const createBookmarksBatch = useCallback(async (
    parentId: string,
    items: Array<{ title: string; url: string }>
  ): Promise<void> =>
  {
    if (items.length === 0) return;

    isBatchOperation = true;
    try
    {
      for (const item of items)
      {
        await createBookmark(parentId, item.title, item.url);
      }
    }
    finally
    {
      isBatchOperation = false;
      refreshAll();
    }
  }, [createBookmark]);

  // Get the folder path as an array of title segments (e.g. ["Other Bookmarks", "FolderA", "FolderB"])
  // Each segment is the exact folder title, so folder names containing '/' are unambiguous
  const getBookmarkSegments = useCallback(async (bookmarkId: string): Promise<string[]> =>
  {
    const segments: string[] = [];
    let currentId: string | undefined = bookmarkId;

    while (currentId)
    {
      const node = await getBookmark(currentId);
      if (!node) break;

      // Skip the root node (id "0") which has no title
      if (node.id !== '0' && node.title)
      {
        segments.unshift(node.title);
      }

      currentId = node.parentId;
    }

    return segments;
  }, [getBookmark]);

  // Get the folder's title path plus its storage (device vs Google account), which
  // together identify the folder when both storages have same-titled folders
  const getBookmarkFolderLocation = useCallback(async (bookmarkId: string): Promise<BookmarkFolderLocation> =>
  {
    const node = await getBookmark(bookmarkId);
    const segments = await getBookmarkSegments(bookmarkId);
    return { segments, inAccount: node ? isInAccountStorage(node) : undefined };
  }, [getBookmark, getBookmarkSegments]);

  // Duplicate a bookmark (not folder) right after the original
  const duplicateBookmark = useCallback(async (bookmarkId: string, liveUrl?: string, liveTitle?: string): Promise<void> =>
  {
    const original = await getBookmark(bookmarkId);
    if (!original || !original.url || !original.parentId || original.index === undefined) return;

    // Use live tab URL/title if available (e.g. tab navigated away from bookmarked URL)
    const url = liveUrl || original.url;
    const title = liveTitle || original.title;
    await createBookmark(original.parentId, title, url, original.index + 1);
  }, [getBookmark, createBookmark]);

  // Get a permanent top-level folder ("Other Bookmarks" etc.) - by type, not by
  // the legacy '1'/'2'/'3' IDs, which are missing when only account bookmarks exist
  const getRootFolder = useCallback((type: RootFolderType): chrome.bookmarks.BookmarkTreeNode | undefined =>
  {
    return findRootFolder(bookmarks, type);
  }, [bookmarks]);

  // Find a folder by its segment array (e.g. ["Bookmarks Bar", "A/B"])
  // Pass inAccount (from the Space) to pick between same-titled device and account folders
  const findFolderBySegments = useCallback((
    segments: string[],
    inAccount?: boolean
  ): chrome.bookmarks.BookmarkTreeNode | null =>
  {
    return findFolderBySegmentsInTree(bookmarks, segments, inAccount);
  }, [bookmarks]);

  // Get all bookmarks recursively from a folder (including nested subfolders).
  // System folders (archive, Favorites) are skipped: their items are not part of the Space's bookmarks
  const getAllBookmarksInFolder = useCallback(async (
    folderId: string
  ): Promise<Array<{ id: string; title: string; url: string }>> =>
  {
    const results: Array<{ id: string; title: string; url: string }> = [];

    const collectRecursive = async (id: string): Promise<void> =>
    {
      const children = await getChildren(id);
      // Depth-first: pages are collected, subfolders other than the system folders are walked
      for (const child of children)
      {
        if (child.url)
        {
          results.push({ id: child.id, title: child.title, url: child.url });
        }
        else if (!isSystemFolder(child))
        {
          await collectRecursive(child.id);
        }
      }
    };

    await collectRecursive(folderId);
    return results;
  }, [getChildren]);

  return {
    bookmarks,
    //removeBookmark,
    createFolder,
    updateBookmark,
    updateBookmarkUrl,
    sortBookmarks,
    moveBookmark,
    findFolderInParent,
    findFolderBySegments,
    getRootFolder,
    createBookmark,
    createBookmarksBatch,
    getBookmark,
    getChildren,
    clearFolder,
    getBookmarkSegments,
    getBookmarkFolderLocation,
    duplicateBookmark,
    getAllBookmarksInFolder,
    error: error ?? bookmarkSnapshot.error
  };
};
