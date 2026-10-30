import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { getFaviconUrl, fetchFaviconAsBase64 } from '../utils/favicon';
import { iconToDataUrl } from '../utils/iconify';
import { favoriteIconsManagerProxy } from '../managers/proxies/favoriteIconsManagerProxy';
import type { FavoriteFaviconPatch, FavoriteIconEntry } from '../managers/shared/favoriteIconsApi';
import type { PinnedSite } from '../managers/shared/pinnedSitesApi';
import { SpaceFavorites, favoritesMoveTargets, favoritesSpaceFolder, type FavoritesSpace } from '../utils/spaceFavorites';
import { ensureFavoritesFolder, type FavoritesBookmarksApi } from '../utils/favoritesFolder';
import { bookmarkTreeStore, runBatchOperation } from './useBookmarks';
import { iconRestoresByUrl } from '../utils/favoritesImport';

// Re-export so existing importers (e.g. PinnedIcon) don't break
export { getFaviconUrl, fetchFaviconAsBase64 } from '../utils/favicon';

// The pin type lives in managers/shared, since background.ts must not
// import this React module. Re-exported here because most of the UI imports it
// from the hook.
export type { PinnedSite } from '../managers/shared/pinnedSitesApi';

type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

const chromeFavoritesBookmarks: FavoritesBookmarksApi = {
  getChildren: (id) => chrome.bookmarks.getChildren(id),
  create: (bookmark) => chrome.bookmarks.create(bookmark),
};

/** A Favorite to create: what the bookmark holds and what the icon store holds. */
interface NewFavorite
{
  url: string;
  title: string;
  icons: FavoriteIconEntry;
}

function iconsOf(site: PinnedSite): FavoriteIconEntry
{
  return { favicon: site.favicon, customIconName: site.customIconName, iconColor: site.iconColor, emoji: site.emoji };
}

function hasIcons(icons: FavoriteIconEntry): boolean
{
  return !!(icons.favicon || icons.customIconName || icons.iconColor || icons.emoji);
}

// Read from Chrome, not the sidebar's tree: that tree lags a create by a debounce
async function favoriteNodesIn(folderId: string): Promise<BookmarkNode[]>
{
  const children = await chrome.bookmarks.getChildren(folderId);
  return children
    .filter(child => !!child.url)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function fetchPinFavicon(url: string, faviconUrl?: string): Promise<string | undefined>
{
  // Chrome's _favicon API is the most reliable; the tab's own favicon URL is the fallback
  const favicon = await fetchFaviconAsBase64(getFaviconUrl(url));
  if (favicon || !faviconUrl) return favicon;
  return await fetchFaviconAsBase64(faviconUrl);
}

// Favicon loading strategy: see "Favicon loading" in docs/development.md

/**
 * The Favorites of one Space: the page bookmarks in its `asd_Favorites` folder,
 * merged with the icon side store. List changes are bookmark calls; icon
 * fields go through FavoriteIconsManager.
 */
export const usePinnedSites = (space: FavoritesSpace) =>
{
  const [error, setError] = useState<string | null>(null);

  // The component re-renders only when this Space's Favorites change, not on
  // every bookmark or icon change elsewhere: the snapshot is kept while equal.
  const cachedRef = useRef<SpaceFavorites | null>(null);

  const subscribe = useCallback((onChange: () => void) =>
  {
    const unsubscribeTree = bookmarkTreeStore.subscribe(onChange);
    const unsubscribeIcons = favoriteIconsManagerProxy.store.subscribe(onChange);
    return () =>
    {
      unsubscribeTree();
      unsubscribeIcons();
    };
  }, []);

  // Also what the callbacks below read, so each acts on the stores as they are now
  const readFavorites = useCallback((): SpaceFavorites =>
  {
    const next = SpaceFavorites.resolve(
      bookmarkTreeStore.getSnapshot().bookmarks,
      space,
      favoriteIconsManagerProxy.snapshot
    );
    const cached = cachedRef.current;
    if (cached && cached.sameAs(next)) return cached;
    cachedRef.current = next;
    return next;
  }, [space]);

  const favorites = useSyncExternalStore(subscribe, readFavorites);
  const pinnedSites = favorites.sites;

  const reportFailure = useCallback((context: string, err: unknown) =>
  {
    console.error(`[PinnedSites] ${context} failed:`, err);
    setError(String(err));
  }, []);

  // An icon write that fails leaves the Favorite itself in place; it only loses its icon
  const storeIcons = useCallback(async (id: string, icons: FavoriteIconEntry): Promise<void> =>
  {
    if (!hasIcons(icons)) return;
    try
    {
      await favoriteIconsManagerProxy.restoreIcons(id, icons);
    }
    catch (err)
    {
      reportFailure('store icons', err);
    }
  }, [reportFailure]);

  /**
   * Creates Favorites one after another, from `index` on (grid order) or at the
   * end. One at a time so they keep their order and a new Space gets one
   * `asd_Favorites`, not one per call. Into this Space unless another Space
   * folder is given. Returns what was created before any failure.
   */
  const createFavorites = useCallback(async (
    context: string,
    entries: readonly NewFavorite[],
    atIndex?: number,
    spaceFolderId?: string
  ): Promise<PinnedSite[]> =>
  {
    const targetFolderId = spaceFolderId ?? readFavorites().spaceFolder?.id;
    if (!targetFolderId || entries.length === 0) return [];

    const created: PinnedSite[] = [];
    try
    {
      const folder = await ensureFavoritesFolder(chromeFavoritesBookmarks, targetFolderId);

      // A grid index is a position among the folder's pages; subfolders in it take bookmark indexes too
      let bookmarkIndex = atIndex === undefined
        ? undefined
        : (await favoriteNodesIn(folder.id))[atIndex]?.index;

      for (const entry of entries)
      {
        const node = await chrome.bookmarks.create({
          parentId: folder.id,
          title: entry.title,
          url: entry.url,
          ...(bookmarkIndex !== undefined && { index: bookmarkIndex }),
        });
        if (bookmarkIndex !== undefined) bookmarkIndex++;

        await storeIcons(node.id, entry.icons);
        created.push({ ...entry.icons, id: node.id, url: node.url ?? entry.url, title: node.title });
      }
    }
    catch (err)
    {
      reportFailure(context, err);
    }
    return created;
  }, [readFavorites, storeIcons, reportFailure]);

  const loadIcons = useCallback(async () =>
  {
    const shouldMeasure = performance.getEntriesByName('sidebar:pinned-sites-load').length === 0;
    if (shouldMeasure) performance.mark('sidebar:pinned-sites-start');
    try
    {
      await favoriteIconsManagerProxy.load();
    }
    catch (err)
    {
      reportFailure('load', err);
    }
    finally
    {
      if (shouldMeasure)
      {
        performance.mark('sidebar:pinned-sites-ready');
        performance.measure('sidebar:pinned-sites-load', 'sidebar:pinned-sites-start', 'sidebar:pinned-sites-ready');
      }
    }
  }, [reportFailure]);

  useEffect(() =>
  {
    void loadIcons();
  }, [loadIcons]);

  // Lazy-resolve missing favicons (Scenario 3, 4 above).
  // Runs after import (Arc or our own JSON with missing favicons) and on extension load.
  // - customIconName with no favicon → resolves via Iconify CDN (always works)
  // - no icon/emoji/favicon → tries Chrome's _favicon cache (only works after page visited)
  // Saves back through the manager on success so it only runs once per site.
  // True while a pass is fetching. Without it, every list change would start a
  // second pass on top of the first and re-fetch the same icons.
  const isResolvingRef = useRef(false);

  // Set when a list change arrives while a pass is in flight, so the pass can
  // run once more on the way out instead of that change being dropped.
  //
  // Dropping it is not harmless: a pass whose fetches all come back empty (a
  // pin on a site Chrome has never cached, which is every pin until it is
  // visited) writes nothing, so no re-render follows to pick the work back
  // up, and the icon stays unresolved until something else happens to change
  // the list. See "2026-07-30-shared-storage-multiple-writers progress/
  // step-5-usePinnedSites-icon-resolver-skip.md".
  const resolveRequestedRef = useRef(false);

  // Explicitly typed because the body refers to itself for the retry below,
  // which TypeScript cannot infer a type for on its own.
  const runResolvePass: (sites: readonly PinnedSite[]) => Promise<void> = useCallback(async (sites: readonly PinnedSite[]): Promise<void> =>
  {
    const shouldMeasure = performance.getEntriesByName('sidebar:favicon-resolution').length === 0;
    if (shouldMeasure) performance.mark('sidebar:favicon-resolution-start');
    const finishMeasure = () =>
    {
      if (!shouldMeasure) return;
      performance.mark('sidebar:favicon-resolution-ready');
      performance.measure(
        'sidebar:favicon-resolution',
        'sidebar:favicon-resolution-start',
        'sidebar:favicon-resolution-ready'
      );
    };

    const needsCustomIcon = sites.filter(
      site => site.customIconName && !site.favicon && !site.emoji
    );
    const needsSiteFavicon = sites.filter(
      site => !site.customIconName && !site.emoji && !site.favicon && site.url
    );

    // These traces are what identified the dropped-request bug above, and are
    // the first thing to look at if an icon fails to appear again: they
    // separate "no pass ran", "a pass ran but found nothing to do" and "a pass
    // resolved an icon but the write was dropped".
    if (import.meta.env.DEV)
    {
      console.log(`[PinnedSites] resolve pass: ${sites.length} pins, `
        + `${needsCustomIcon.length} need a custom icon [${needsCustomIcon.map(s => `${s.title}/${s.customIconName}`).join(', ')}], `
        + `${needsSiteFavicon.length} need a site favicon`);
    }

    if (needsCustomIcon.length === 0 && needsSiteFavicon.length === 0)
    {
      finishMeasure();
      return;
    }

    isResolvingRef.current = true;

    try
    {
      // Each patch records what it was resolved FOR, so the manager can drop
      // it if the Favorite changed while these fetches were in flight - see
      // FavoriteFaviconPatch.
      const patches: FavoriteFaviconPatch[] = [];

      // One batch, not two: the custom icons come from the Iconify CDN and the
      // favicons from Chrome's local cache, so neither group has any reason to
      // wait on the other. Pushing into a shared array from both is safe -
      // these callbacks only ever run one at a time on the same thread.
      await Promise.all([
        ...needsCustomIcon.map(async (site) => {
          const dataUrl = await iconToDataUrl(site.customIconName!, site.iconColor);
          if (dataUrl)
          {
            patches.push({ id: site.id, favicon: dataUrl, forCustomIconName: site.customIconName });
          }
        }),
        ...needsSiteFavicon.map(async (site) => {
          const chromeFaviconUrl = getFaviconUrl(site.url);
          const favicon = await fetchFaviconAsBase64(chromeFaviconUrl);
          if (favicon)
          {
            patches.push({ id: site.id, favicon });
          }
        }),
      ]);

      if (patches.length === 0)
      {
        if (import.meta.env.DEV)
        {
          console.log('[PinnedSites] resolve pass produced NO patches - every fetch came back empty');
        }
        return;
      }

      if (import.meta.env.DEV)
      {
        console.log('[PinnedSites] resolve pass writing patches:',
          patches.map(patch => `${patch.id}${patch.forCustomIconName ? ` (icon ${patch.forCustomIconName})` : ' (site favicon)'}`));
      }

      // setFavicons patches only the Favorites it names, on whatever the
      // manager currently holds, so one changed meanwhile is unaffected.
      const stored = await favoriteIconsManagerProxy.setFavicons(patches);

      if (import.meta.env.DEV)
      {
        // A patch listed above but missing here was dropped as stale
        const landed = patches.filter(patch => stored[patch.id]?.favicon === patch.favicon);
        console.log(`[PinnedSites] resolve pass: ${landed.length} of ${patches.length} patches landed`);
      }
    }
    catch (err)
    {
      reportFailure('resolve icons', err);
    }
    finally
    {
      isResolvingRef.current = false;
      finishMeasure();

      // Run the change that arrived mid-pass, against the list as it stands
      // now rather than whatever it was when that change was skipped. Cannot
      // loop: the flag is only ever set by a skipped pass, and this retry
      // returns immediately once nothing is left to resolve.
      if (resolveRequestedRef.current)
      {
        resolveRequestedRef.current = false;
        void runResolvePass(readFavorites().sites);
      }
    }
  }, [reportFailure, readFavorites]);

  useEffect(() =>
  {
    if (isResolvingRef.current)
    {
      resolveRequestedRef.current = true;
      if (import.meta.env.DEV)
      {
        console.log('[PinnedSites] resolve pass DEFERRED - a resolve is still in flight, will re-run when it finishes');
      }
      return;
    }

    void runResolvePass(pinnedSites);
  }, [pinnedSites, runResolvePass]);

  // Scenario 1a: pin a single tab. Tab is open so Chrome's favicon cache is hot.
  // Null when the Space has no bookmark folder: it can't hold Favorites.
  const addPin = useCallback(async (
    url: string,
    title: string,
    faviconUrl?: string,
    atIndex?: number
  ): Promise<PinnedSite | null> =>
  {
    if (!readFavorites().hasFolder) return null;

    const favicon = await fetchPinFavicon(url, faviconUrl);
    const [created] = await createFavorites('addPin', [{ url, title, icons: { favicon } }], atIndex);
    return created ?? null;
  }, [readFavorites, createFavorites]);

  // Scenario 1b: pin multiple tabs at once (e.g. drag a URL group). Same as addPin.
  const addPins = useCallback(async (
    pins: Array<{ url: string; title: string; faviconUrl?: string }>
  ): Promise<PinnedSite[]> =>
  {
    if (!readFavorites().hasFolder) return [];

    const entries: NewFavorite[] = await Promise.all(
      pins.map(async ({ url, title, faviconUrl }) => ({
        url,
        title,
        icons: { favicon: await fetchPinFavicon(url, faviconUrl) },
      }))
    );
    return await runBatchOperation(() => createFavorites('addPins', entries));
  }, [readFavorites, createFavorites]);

  // The icon entry goes with the bookmark: background drops it on bookmarks.onRemoved
  const removePin = useCallback((id: string) =>
  {
    chrome.bookmarks.remove(id).catch(err => reportFailure('removePin', err));
  }, [reportFailure]);

  const updatePin = useCallback((
    id: string,
    title: string,
    url: string,
    favicon?: string,
    customIconName?: string,
    iconColor?: string,
    emoji?: string
  ) =>
  {
    chrome.bookmarks.update(id, { title, url }).catch(err => reportFailure('updatePin', err));
    // The icon fields travel as a set - see FavoriteIconEdit for why absent means
    // cleared for those three but "keep" for favicon.
    favoriteIconsManagerProxy
      .setIcons(id, { favicon, customIconName, iconColor, emoji })
      .catch(err => reportFailure('updatePin icons', err));
  }, [reportFailure]);

  // Checked against the bookmark itself, so a slow AI request can't overwrite a later manual edit
  const renamePinIfUnchanged = useCallback(async (
    id: string,
    expectedTitle: string,
    expectedUrl: string,
    newTitle: string
  ) =>
  {
    let current: BookmarkNode | undefined;
    try
    {
      [current] = await chrome.bookmarks.get(id);
    }
    catch
    {
      // Deleted while the request ran: nothing to rename
      return;
    }
    if (!current || current.title !== expectedTitle || current.url !== expectedUrl) return;

    try
    {
      await chrome.bookmarks.update(id, { title: newTitle });
    }
    catch (err)
    {
      reportFailure('AI rename pin', err);
      throw err;
    }
  }, [reportFailure]);

  // Scenario 6: user explicitly resets to site favicon via "Reset to site icon".
  // Only works if Chrome has the page cached (site visited at least once).
  const resetFavicon = useCallback(async (id: string) =>
  {
    const site = readFavorites().sites.find(s => s.id === id);
    if (!site) return;

    const chromeFaviconUrl = getFaviconUrl(site.url);
    const favicon = await fetchFaviconAsBase64(chromeFaviconUrl);

    try { await favoriteIconsManagerProxy.resetFavicon(id, favicon); }
    catch (err) { reportFailure('resetFavicon', err); }
  }, [readFavorites, reportFailure]);

  const movePin = useCallback((
    activeId: string,
    overId: string,
    position: 'before' | 'after' = 'before'
  ) =>
  {
    if (activeId === overId) return;

    void (async () =>
    {
      try
      {
        const [over] = await chrome.bookmarks.get(overId);
        if (!over?.parentId || over.index === undefined) return;
        // Chrome adjusts the index itself for a move within the same parent
        const index = position === 'after' ? over.index + 1 : over.index;
        await chrome.bookmarks.move(activeId, { parentId: over.parentId, index });
      }
      catch (err)
      {
        reportFailure('movePin', err);
      }
    })();
  }, [reportFailure]);

  /**
   * Copies a Favorite in just after itself. The live tab may have navigated away
   * from the Favorite's page; its favicon only replaces a site favicon, since a
   * custom icon or emoji is the user's explicit choice.
   */
  const duplicatePin = useCallback((id: string, liveUrl?: string, liveTitle?: string, liveFavicon?: string) =>
  {
    void (async () =>
    {
      try
      {
        const [original] = await chrome.bookmarks.get(id);
        if (!original?.url || !original.parentId || original.index === undefined) return;

        const copy = await chrome.bookmarks.create({
          parentId: original.parentId,
          index: original.index + 1,
          url: liveUrl || original.url,
          title: liveTitle || original.title,
        });

        const source = readFavorites().sites.find(site => site.id === id);
        if (liveFavicon && !source?.customIconName && !source?.emoji)
        {
          await storeIcons(copy.id, { favicon: liveFavicon });
        }
        else
        {
          await favoriteIconsManagerProxy.copyIcons(id, copy.id);
        }
      }
      catch (err)
      {
        reportFailure('duplicatePin', err);
      }
    })();
  }, [readFavorites, storeIcons, reportFailure]);

  /** The Spaces a Favorite of this Space can move to, as the bookmark tree is now. */
  const getMoveTargets = useCallback(<S extends FavoritesSpace>(spaces: readonly S[]): S[] =>
  {
    return favoritesMoveTargets(bookmarkTreeStore.getSnapshot().bookmarks, spaces, space);
  }, [space]);

  /**
   * Moves a Favorite to the end of another Space's Favorites. A move keeps the
   * bookmark id, so its icon entry and tab association stay with it. False when
   * nothing moved.
   */
  const movePinToSpace = useCallback(async (id: string, target: FavoritesSpace): Promise<boolean> =>
  {
    const targetFolder = favoritesSpaceFolder(bookmarkTreeStore.getSnapshot().bookmarks, target);
    if (!targetFolder) return false;

    try
    {
      const favoritesFolder = await ensureFavoritesFolder(chromeFavoritesBookmarks, targetFolder.id);
      await chrome.bookmarks.move(id, { parentId: favoritesFolder.id });
      return true;
    }
    catch (err)
    {
      reportFailure('movePinToSpace', err);
      return false;
    }
  }, [reportFailure]);

  // Imports run right after a bulk bookmark rewrite (Replace all bookmarks gives every
  // Space folder a new id), which the sidebar's tree shows only after a debounce
  const readCurrentFavorites = useCallback(async (): Promise<SpaceFavorites> =>
  {
    const roots = (await chrome.bookmarks.getTree())[0]?.children ?? [];
    return SpaceFavorites.resolve(roots, space, favoriteIconsManagerProxy.snapshot);
  }, [space]);

  // Scenario 2a: replace the active Space's Favorites from our own JSON backup.
  // favicon is already embedded as base64 in the backup — no fetch needed.
  // Sites with missing favicon (old backups) are handled by the lazy-resolve effect.
  const replacePinnedSites = useCallback(async (sites: PinnedSite[]): Promise<void> =>
  {
    await runBatchOperation(async () =>
    {
      let spaceFolderId: string;
      try
      {
        const current = await readCurrentFavorites();
        if (!current.spaceFolder) return;
        spaceFolderId = current.spaceFolder.id;
        for (const site of current.sites)
        {
          await chrome.bookmarks.remove(site.id);
        }
      }
      catch (err)
      {
        reportFailure('replacePinnedSites', err);
        return;
      }
      await createFavorites('replacePinnedSites', sites.map(site => ({ url: site.url, title: site.title, icons: iconsOf(site) })), undefined, spaceFolderId);
    });
  }, [readCurrentFavorites, createFavorites, reportFailure]);

  // Scenario 2b / 3: append Favorites from our own JSON backup or Arc import.
  // Same as replacePinnedSites — favicon already in backup, or lazy-resolve handles it.
  const appendPinnedSites = useCallback(async (sites: PinnedSite[]): Promise<void> =>
  {
    await runBatchOperation(async () =>
    {
      let spaceFolderId: string | undefined;
      try
      {
        spaceFolderId = (await readCurrentFavorites()).spaceFolder?.id;
      }
      catch (err)
      {
        reportFailure('appendPinnedSites', err);
        return;
      }
      if (!spaceFolderId) return;
      await createFavorites('appendPinnedSites', sites.map(site => ({ url: site.url, title: site.title, icons: iconsOf(site) })), undefined, spaceFolderId);
    });
  }, [readCurrentFavorites, createFavorites, reportFailure]);

  // Arc import: Top Apps into a Space folder the import just created
  const addPinnedSitesToSpaceFolder = useCallback(async (spaceFolderId: string, sites: PinnedSite[]): Promise<void> =>
  {
    await runBatchOperation(() =>
      createFavorites('addPinnedSitesToSpaceFolder', sites.map(site => ({ url: site.url, title: site.title, icons: iconsOf(site) })), undefined, spaceFolderId)
    );
  }, [createFavorites]);

  /**
   * JSON import whose bookmarks brought this Space's Favorites back: puts the
   * backup's icons onto them by URL and adds no Favorite.
   */
  const restorePinnedSiteIcons = useCallback(async (sites: readonly PinnedSite[]): Promise<void> =>
  {
    try
    {
      const restored = (await readCurrentFavorites()).sites;
      for (const { id, icons } of iconRestoresByUrl(sites, restored))
      {
        await favoriteIconsManagerProxy.restoreIcons(id, icons);
      }
    }
    catch (err)
    {
      reportFailure('restorePinnedSiteIcons', err);
    }
  }, [readCurrentFavorites, reportFailure]);

  return {
    pinnedSites,
    /** The grid explains that this Space has no bookmark folder, so no Favorites. */
    needsFolderHint: favorites.needsFolderHint,
    addPin,
    addPins,
    removePin,
    updatePin,
    renamePinIfUnchanged,
    resetFavicon,
    movePin,
    duplicatePin,
    getMoveTargets,
    movePinToSpace,
    replacePinnedSites,
    appendPinnedSites,
    addPinnedSitesToSpaceFolder,
    restorePinnedSiteIcons,
    refresh: loadIcons,
    error,
  };
};
