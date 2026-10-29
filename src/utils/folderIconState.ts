export type ArcFolderIconState = 'collapsed' | 'expanded' | 'active-peek';

/**
 * Expanded wins over the active peek: when expanded, the active child is already in the full tree.
 */
export function resolveArcFolderIconState(
  isExpanded: boolean,
  hasActivePeek: boolean
): ArcFolderIconState
{
  if (isExpanded) return 'expanded';
  if (hasActivePeek) return 'active-peek';
  return 'collapsed';
}
