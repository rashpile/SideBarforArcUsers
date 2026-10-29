export type ArcTabSectionItem<TTab> =
  | { type: 'new-tab' }
  | { type: 'tab'; tab: TTab };

/**
 * As in Arc, New Tab is a fixed entry of the regular tab list, always before the temporary tabs.
 */
export function getArcTabSectionItems<TTab>(
  tabs: readonly TTab[],
): ArcTabSectionItem<TTab>[]
{
  return [
    { type: 'new-tab' },
    ...tabs.map(tab => ({ type: 'tab' as const, tab })),
  ];
}
