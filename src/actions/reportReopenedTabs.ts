import { TABS_REOPENED_BY_UNDO_ACTION } from '../utils/unvisitedTabMarker';

/**
 * Tell the background that Undo re-created these tabs. Chrome reports them as
 * new tabs opened in the background, and the background owns the unvisited
 * marks (tabLastUsedAt), so only it can take the mark off again.
 */
export function reportTabsReopenedByUndo(tabIds: readonly number[]): void
{
  if (tabIds.length === 0) return;
  chrome.runtime.sendMessage({ action: TABS_REOPENED_BY_UNDO_ACTION, tabIds })
    .catch((error) => console.error('[Undo] failed to report reopened tabs:', error));
}
