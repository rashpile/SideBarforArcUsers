export type BookmarkRowVisualState = 'active' | 'selected' | 'default';

export interface BookmarkRowVisualInput
{
  isActive: boolean;
  isSelected: boolean;
  selectionCount: number;
}

/**
 * A single selection from a plain click must not cover Arc's active card; only a real
 * multi-selection shows the selected style.
 */
export function resolveBookmarkRowVisualState({
  isActive,
  isSelected,
  selectionCount,
}: BookmarkRowVisualInput): BookmarkRowVisualState
{
  if (isSelected && selectionCount > 1) return 'selected';
  if (isActive) return 'active';
  return 'default';
}
