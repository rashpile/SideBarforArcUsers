type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

// Where a bookmark folder lives: its title path plus which storage it belongs to.
// With Chrome's account bookmarks enabled the tree holds two sets of permanent
// folders with identical titles ("Bookmarks Bar" on this device and in the Google
// account), so the title path alone is ambiguous.
export interface BookmarkFolderLocation
{
  segments: string[];
  inAccount?: boolean;  // undefined when Chrome doesn't report storage (before Chrome 134)
}

// Chrome 134+ sets `syncing` on every node: true for account storage, false for
// device-only. @types/chrome doesn't declare it yet.
export function isInAccountStorage(node: BookmarkNode): boolean | undefined
{
  return (node as BookmarkNode & { syncing?: boolean }).syncing;
}

// Walk the tree matching one title per level. Siblings may share a title, so a
// matching folder whose subtree doesn't contain the rest of the path doesn't end
// the search - the next folder with the same title is tried.
function walkSegments(nodes: BookmarkNode[], remaining: string[], isRoot: boolean): BookmarkNode | null
{
  const [head, ...tail] = remaining;

  // Try every folder whose title matches this level
  for (const node of nodes)
  {
    if (node.url) continue;
    // Root-level matched case-insensitively for platform differences
    const matches = isRoot
      ? node.title.toLowerCase() === head.toLowerCase()
      : node.title === head;
    if (!matches) continue;
    if (tail.length === 0) return node;

    const found = walkSegments(node.children || [], tail, false);
    if (found) return found;
  }
  return null;
}

// Find a folder by its segment array (e.g. ["Bookmarks Bar", "A/B"]) among the
// top-level bookmark folders. When inAccount is known, the roots from that storage
// are searched first; the other storage is a fallback so a Space keeps resolving
// if sync settings changed after it was saved.
export function findFolderBySegments(
  roots: BookmarkNode[],
  segments: string[],
  inAccount?: boolean
): BookmarkNode | null
{
  if (!segments || segments.length === 0) return null;
  if (inAccount === undefined) return walkSegments(roots, segments, true);

  const preferredRoots = roots.filter(root => (isInAccountStorage(root) ?? false) === inAccount);
  const otherRoots = roots.filter(root => (isInAccountStorage(root) ?? false) !== inAccount);
  return walkSegments(preferredRoots, segments, true) ?? walkSegments(otherRoots, segments, true);
}

// Chrome's permanent top-level folders
export type RootFolderType = 'bookmarks-bar' | 'other' | 'mobile';

// Device-only permanent folders have these stable IDs. With account bookmarks the
// account copies get other IDs, and Chrome stops reporting the device-only ones
// once they are empty - so these are only a fallback.
const LEGACY_ROOT_IDS: Record<RootFolderType, string> = {
  'bookmarks-bar': '1',
  'other': '2',
  'mobile': '3',
};

// Which permanent folder a top-level node is. Chrome 134+ reports `folderType`
// (@types/chrome doesn't declare it yet); older versions only have the stable IDs.
export function getRootFolderType(node: BookmarkNode): RootFolderType | undefined
{
  const folderType = (node as BookmarkNode & { folderType?: string }).folderType;
  if (folderType !== undefined)
  {
    return folderType in LEGACY_ROOT_IDS ? folderType as RootFolderType : undefined;
  }
  return (Object.keys(LEGACY_ROOT_IDS) as RootFolderType[]).find(type => LEGACY_ROOT_IDS[type] === node.id);
}

// Find a permanent folder among the top-level nodes. When both the device-only
// and the account copy exist, the account one wins - that's where Chrome itself
// saves new bookmarks once account bookmarks are on.
export function findRootFolder(roots: readonly BookmarkNode[], type: RootFolderType): BookmarkNode | undefined
{
  const matching = roots.filter(root => !root.url && getRootFolderType(root) === type);
  return matching.find(root => isInAccountStorage(root) === true) ?? matching[0];
}

// Same as findRootFolder, reading the live bookmark tree - for code outside React hooks
export async function fetchRootFolder(type: RootFolderType): Promise<BookmarkNode | undefined>
{
  const [root] = await chrome.bookmarks.getTree();
  return findRootFolder(root?.children ?? [], type);
}
