import { UndoableAction } from './types';
import { truncateTitle } from '../utils/truncateTitle';
import { PinnedSite } from '../managers/shared/pinnedSitesApi';
import type { FavoriteIconEntry } from '../managers/shared/favoriteIconsApi';
import { favoriteIconsManagerProxy } from '../managers/proxies/favoriteIconsManagerProxy';
import { runBatchOperation } from '../hooks/useBookmarks';

interface FavoriteSnapshot
{
  pin: PinnedSite;
  /** The asd_Favorites folder the bookmark was in. */
  parentId: string;
  /** Bookmark index inside that folder, not the grid position. */
  index: number;
  tabId?: number;
}

function iconsOf(pin: PinnedSite): FavoriteIconEntry
{
  return { favicon: pin.favicon, customIconName: pin.customIconName, iconColor: pin.iconColor, emoji: pin.emoji };
}

function hasIcons(icons: FavoriteIconEntry): boolean
{
  return !!(icons.favicon || icons.customIconName || icons.iconColor || icons.emoji);
}

/**
 * Unpin removes the Favorite's bookmark and keeps the Chrome tab open as a
 * regular tab. Undo creates the bookmark anew, so it comes back under a new id:
 * icons and the tab association (if the tab still exists) move to that id.
 */
export class DeletePinnedSiteAction implements UndoableAction
{
  description = '';
  private pinnedIds: string[];
  private snapshots: FavoriteSnapshot[] = [];
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
    const idSet = new Set(this.pinnedIds);

    // The icon fields are taken now: background prunes the side-store entry once
    // the bookmark is gone, so undo can't read them back from there.
    this.snapshots = [];
    for (const pin of this.getCurrentPins())
    {
      if (!idSet.has(pin.id)) continue;

      let node: chrome.bookmarks.BookmarkTreeNode | undefined;
      try
      {
        [node] = await chrome.bookmarks.get(pin.id);
      }
      catch
      {
        // Already removed elsewhere: nothing to delete or restore
        continue;
      }
      if (!node?.parentId || node.index === undefined) continue;

      const snapshot: FavoriteSnapshot = {
        pin: { ...pin },
        parentId: node.parentId,
        index: node.index,
      };

      const tabId = this.getTabIdForPinned?.(pin.id);
      if (tabId !== undefined)
      {
        snapshot.tabId = tabId;
      }

      this.snapshots.push(snapshot);
    }

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
      console.log(`[DeletePinnedSiteAction] do: removing ${this.snapshots.length} Favorites:`,
        this.snapshots.map(s => `"${s.pin.title}" (id=${s.pin.id}, parent=${s.parentId}, idx=${s.index}, tabId=${s.tabId ?? 'none'})`));
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

    await runBatchOperation(async () =>
    {
      for (const snapshot of this.snapshots)
      {
        try
        {
          await chrome.bookmarks.remove(snapshot.pin.id);
        }
        catch (err)
        {
          console.error(`[DeletePinnedSiteAction] remove failed for ${snapshot.pin.id}:`, err);
        }
      }
    });
  }

  async undo(): Promise<void>
  {
    if (import.meta.env.DEV)
    {
      console.log(`[DeletePinnedSiteAction] undo: restoring ${this.snapshots.length} Favorites`);
    }

    // Ascending index per folder, so each one lands where it was: creating a later
    // index first would shift it, or fail as out of bounds.
    const sorted = [...this.snapshots].sort((a, b) =>
    {
      if (a.parentId !== b.parentId) return a.parentId.localeCompare(b.parentId);
      return a.index - b.index;
    });

    await runBatchOperation(async () =>
    {
      for (const snapshot of sorted)
      {
        await this.restore(snapshot);
      }
    });

    if (import.meta.env.DEV)
    {
      console.log('[DeletePinnedSiteAction] undo: complete');
    }
  }

  private async restore(snapshot: FavoriteSnapshot): Promise<void>
  {
    let created: chrome.bookmarks.BookmarkTreeNode;
    try
    {
      // Other bookmarks may have left the folder since; past its end Chrome throws
      const children = await chrome.bookmarks.getChildren(snapshot.parentId);
      created = await chrome.bookmarks.create({
        parentId: snapshot.parentId,
        index: Math.min(snapshot.index, children.length),
        title: snapshot.pin.title,
        url: snapshot.pin.url,
      });
    }
    catch (err)
    {
      // The asd_Favorites folder itself was deleted: there is nowhere to put it back
      console.error(`[DeletePinnedSiteAction] undo: could not recreate "${snapshot.pin.title}":`, err);
      return;
    }

    const icons = iconsOf(snapshot.pin);
    if (hasIcons(icons))
    {
      try
      {
        await favoriteIconsManagerProxy.restoreIcons(created.id, icons);
      }
      catch (err)
      {
        console.error(`[DeletePinnedSiteAction] undo: icons of "${snapshot.pin.title}" not restored:`, err);
      }
    }

    if (this.restoreItemAssociation && snapshot.tabId !== undefined)
    {
      try
      {
        await chrome.tabs.get(snapshot.tabId);
        await this.restoreItemAssociation(snapshot.tabId, `pinned-${created.id}`);
      }
      catch
      {
        // The tab was closed; there is no association to restore.
      }
    }

    // A later do() on this action targets the Favorite as it exists now
    this.pinnedIds = this.pinnedIds.map(id => id === snapshot.pin.id ? created.id : id);
    snapshot.pin = { ...snapshot.pin, id: created.id };
  }
}
