import { UndoableAction } from './types';
import { truncateTitle } from '../utils/truncateTitle';
import { PinnedSite } from '../managers/shared/pinnedSitesApi';
import { pinnedSitesManagerProxy } from '../managers/proxies/pinnedSitesManagerProxy';

interface PinnedSnapshot
{
  pin: PinnedSite;
  index: number;
  tabId?: number;
}

/**
 * Unpin keeps the Chrome tab open as a regular tab. If that tab still exists on Undo,
 * its association is restored along with the Favorite data.
 */
export class DeletePinnedSiteAction implements UndoableAction
{
  description = '';
  private pinnedIds: string[];
  private snapshots: PinnedSnapshot[] = [];
  private getCurrentPins: () => readonly PinnedSite[];
  private getTabIdForPinned?: (pinnedId: string) => number | undefined;
  private deassociatePinnedTab?: (pinnedId: string) => Promise<void> | void;
  private restoreItemAssociation?: (tabId: number, itemKey: string) => Promise<void>;

  constructor(
    pinnedIds: string[],
    getCurrentPins: () => readonly PinnedSite[],
    getTabIdForPinned?: (pinnedId: string) => number | undefined,
    deassociatePinnedTab?: (pinnedId: string) => Promise<void> | void,
    restoreItemAssociation?: (tabId: number, itemKey: string) => Promise<void>
  )
  {
    this.pinnedIds = pinnedIds;
    this.getCurrentPins = getCurrentPins;
    this.getTabIdForPinned = getTabIdForPinned;
    this.deassociatePinnedTab = deassociatePinnedTab;
    this.restoreItemAssociation = restoreItemAssociation;
  }

  async do(): Promise<void>
  {
    const currentPins = this.getCurrentPins();
    const idSet = new Set(this.pinnedIds);

    // Snapshot each target pin with its index and tab association
    this.snapshots = [];
    for (let i = 0; i < currentPins.length; i++)
    {
      const pin = currentPins[i];
      if (idSet.has(pin.id))
      {
        const snapshot: PinnedSnapshot = {
          pin: { ...pin },
          index: i,
        };

        if (this.getTabIdForPinned)
        {
          const tabId = this.getTabIdForPinned(pin.id);
          if (tabId !== undefined)
          {
            snapshot.tabId = tabId;
          }
        }

        this.snapshots.push(snapshot);
      }
    }

    // Build description
    if (this.snapshots.length === 1)
    {
      const name = this.snapshots[0].pin.title || this.snapshots[0].pin.url;
      this.description = `Unpinned "${truncateTitle(name)}"`;

    }
    else
    {
      this.description = `Unpinned ${this.snapshots.length} sites`;
    }

    if (import.meta.env.DEV)
    {
      console.log(`[DeletePinnedSiteAction] do: removing ${this.snapshots.length} pins:`,
        this.snapshots.map(s => `"${s.pin.title}" (id=${s.pin.id}, idx=${s.index}, tabId=${s.tabId ?? 'none'})`));
    }

    if (this.deassociatePinnedTab)
    {
      for (const snapshot of this.snapshots)
      {
        if (snapshot.tabId !== undefined)
        {
          await this.deassociatePinnedTab(snapshot.pin.id);
        }
      }
    }

    // Remove the pins, routed through PinnedSitesManager so it stays the only
    // writer of the list (Case 2 - see the shared-storage decision doc). Naming
    // the ids rather than sending a filtered list means a favicon background
    // resolved in the meantime survives this delete.
    await pinnedSitesManagerProxy.removePins(this.pinnedIds);
  }

  async undo(): Promise<void>
  {
    if (import.meta.env.DEV)
    {
      console.log(`[DeletePinnedSiteAction] undo: restoring ${this.snapshots.length} pins`);
    }

    // Put each pin back at the index it was deleted from. The manager does the
    // splicing against its own list, so this needs no read-then-write of the
    // whole array.
    await pinnedSitesManagerProxy.insertPins(
      this.snapshots.map(snapshot => ({ pin: snapshot.pin, index: snapshot.index }))
    );

    if (this.restoreItemAssociation)
    {
      for (const snapshot of this.snapshots)
      {
        if (snapshot.tabId === undefined) continue;
        try
        {
          await chrome.tabs.get(snapshot.tabId);
          await this.restoreItemAssociation(snapshot.tabId, `pinned-${snapshot.pin.id}`);
        }
        catch
        {
          // The tab was closed; there is no association to restore.
        }
      }
    }

    if (import.meta.env.DEV)
    {
      console.log('[DeletePinnedSiteAction] undo: complete');
    }
  }
}
