// Which tabs a manual archive (row button, context menu, drop on the Archive
// section) closes. One decision for all entry points, so they cannot drift apart.

import { isEmptyPage, tabPageUrl } from './autoArchivePolicy.ts';
import type { ArchivableTab } from './tabArchiveBatch.ts';

// chrome.tabGroups.TAB_GROUP_ID_NONE: the tab is in no group
const TAB_GROUP_ID_NONE = -1;

/** The fields of chrome.tabs.Tab the decision reads. */
export interface ArchiveCandidateTabLike
{
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  groupId?: number;
}

export class TabArchiveCandidates
{
  #spaceTabs: readonly ArchiveCandidateTabLike[];
  #spaceTabIds: ReadonlySet<number>;
  #isMarked: (tabId: number) => boolean;

  /**
   * @param spaceTabs the active Space's tabs as the Tab list shows them; tabs outside it
   *   (another Space, managed, closed) are never archived
   * @param isMarked marked tabs stay open
   */
  constructor(spaceTabs: readonly ArchiveCandidateTabLike[], isMarked: (tabId: number) => boolean)
  {
    this.#spaceTabs = spaceTabs;
    this.#spaceTabIds = new Set(
      spaceTabs.map(tab => tab.id).filter((id): id is number => id !== undefined)
    );
    this.#isMarked = isMarked;
  }

  /**
   * True when the row of this tab offers Archive. An empty page has nothing to
   * archive, so the button would only close it.
   */
  canArchiveRow(tab: ArchiveCandidateTabLike): boolean
  {
    return this.#isArchivable(tab) && !isEmptyPage(tabPageUrl(tab));
  }

  /**
   * The tabs to archive for the listed tabs and groups, in Space-list order. Empty
   * pages stay in: the batch closes them without an archive item, as the bulk
   * Archive does.
   */
  pick(tabIds: readonly number[], groupIds: readonly number[]): ArchivableTab[]
  {
    const listedTabIds = new Set(tabIds);
    const listedGroupIds = new Set(groupIds.filter(id => id !== TAB_GROUP_ID_NONE));
    const picked: ArchivableTab[] = [];
    for (const tab of this.#spaceTabs)
    {
      if (tab.id === undefined || !this.#isArchivable(tab))
      {
        continue;
      }
      const inListedGroup = tab.groupId !== undefined && listedGroupIds.has(tab.groupId);
      if (listedTabIds.has(tab.id) || inListedGroup)
      {
        picked.push({ id: tab.id, title: tab.title, url: tab.url, pendingUrl: tab.pendingUrl });
      }
    }
    return picked;
  }

  #isArchivable(tab: ArchiveCandidateTabLike): boolean
  {
    return tab.id !== undefined && this.#spaceTabIds.has(tab.id) && !this.#isMarked(tab.id);
  }
}
