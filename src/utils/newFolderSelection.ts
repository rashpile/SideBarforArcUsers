export interface FolderSelectionNode
{
  id: string;
  parentId?: string;
}

/**
 * With no Space folder, the first item's parent is used, so bookmarks never move unpredictably.
 */
export function resolveNewFolderParentId(
  selectedNodes: readonly FolderSelectionNode[],
  currentSpaceFolderId: string | null
): string | null
{
  const firstParentId = selectedNodes[0]?.parentId;
  if (!firstParentId) return currentSpaceFolderId;

  const shareParent = selectedNodes.every(node => node.parentId === firstParentId);
  if (shareParent) return firstParentId;

  return currentSpaceFolderId ?? firstParentId;
}
