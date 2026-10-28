// Double-click on a bookmark row (Arc mode) or a Favorite: the first click has already
// run the single-click action, so this decides what the double-click adds to it.

export type ItemDoubleClickAction = 'load-url' | 'open' | 'none';

export interface ItemDoubleClickState
{
  hadTabOnPress: boolean;     // the item had a live tab when the first click went down
  singleClickOpens: boolean;  // a single click opens or activates the item's tab
}

export function resolveItemDoubleClick({ hadTabOnPress, singleClickOpens }: ItemDoubleClickState): ItemDoubleClickAction
{
  // The tab was there before: bring the item's page back into it
  if (hadTabOnPress) return 'load-url';

  // The first click has just opened the tab; loading it again would reload a fresh page
  if (singleClickOpens) return 'none';

  return 'open';
}
