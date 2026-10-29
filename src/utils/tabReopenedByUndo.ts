// Message from the sidebar's Undo (closed tabs, deleted Space) to the background:
// { action, tabId } - a tab it re-created, inactive in an existing window. The tab
// was open before, so it must not keep the unvisited mark onCreated gave it, and
// only the background, the owner of the marks (tabLastUsedAt), can take it off.
// Kept apart from unvisitedTabMarker.ts, which tests import: this one calls chrome.*.

export const TAB_REOPENED_BY_UNDO_ACTION = 'tab-reopened-by-undo';

/** Tell the background that Undo re-created this tab; called right after chrome.tabs.create. */
export function reportTabReopenedByUndo(tabId: number): void
{
  chrome.runtime.sendMessage({ action: TAB_REOPENED_BY_UNDO_ACTION, tabId })
    .catch((error) => console.error('[TabReopenedByUndo] failed to report a reopened tab:', error));
}
