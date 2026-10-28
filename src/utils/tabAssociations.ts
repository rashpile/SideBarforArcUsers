// Shared functions for tab association storage
// Used by both background.ts and BookmarkTabsContext.tsx

import { TabAssociationBackupStore } from '../stores/tabAssociationBackupStore.ts';
import { TabAssociationSessionStore } from '../stores/tabAssociationSessionStore.ts';
import type {
  TabAssociationBackupEntry,
  WindowAssociationBackup,
} from '../stores/tabAssociationBackupStore.ts';
import { mergeRestoredTabAssociations } from './restoreTabAssociations.ts';
import { getEffectiveTabUrl } from './parkedTabAssociation.ts';
import { isSameSite } from './storedTabMatcher.ts';

export type { TabAssociationBackupEntry, WindowAssociationBackup } from '../stores/tabAssociationBackupStore.ts';

// Storage key helper
const getStorageKey = (windowId: number) => `tabAssociations_${windowId}`;

/** Item key of a bookmark's tab: `bookmark-{bookmarkId}` (a Favorite's is `pinned-{id}`). */
export const BOOKMARK_ITEM_KEY_PREFIX = 'bookmark-';

const tabAssociationSessionStore = new TabAssociationSessionStore({
  get: (key) => chrome.storage.session.get(key),
  set: (values) => chrome.storage.session.set(values),
});

export const WAIT_FOR_TAB_ASSOCIATIONS_READY = 'wait-for-tab-associations-ready';

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

interface StorageChangeEvent
{
  addListener: (listener: StorageChangeListener) => void;
  removeListener: (listener: StorageChangeListener) => void;
}

/** 订阅当前窗口的 session 关联变化，并返回对应的清理函数。 */
export function subscribeToTabAssociationChanges(
  windowId: number,
  onChange: () => void,
  event: StorageChangeEvent = chrome.storage.onChanged
): () => void
{
  const storageKey = getStorageKey(windowId);
  const listener: StorageChangeListener = (changes, areaName) =>
  {
    if (areaName === 'session' && changes[storageKey]) onChange();
  };

  event.addListener(listener);
  return () => event.removeListener(listener);
}

// Get all associations for a window
export async function getTabAssociations(windowId: number): Promise<Record<number, string>>
{
  return tabAssociationSessionStore.read(windowId);
}

// Check if a tab is managed (has an association)
export async function isManagedTab(windowId: number, tabId: number): Promise<boolean>
{
  const associations = await getTabAssociations(windowId);
  return tabId in associations;
}

// Store an association
export async function storeTabAssociation(
  windowId: number,
  tabId: number,
  itemKey: string
): Promise<void>
{
  await tabAssociationSessionStore.save(windowId, tabId, itemKey);
}

// Remove an association
export async function removeTabAssociation(windowId: number, tabId: number): Promise<void>
{
  await tabAssociationSessionStore.remove(windowId, tabId);
}

// Set all associations for a window (used during rebuild)
export async function setTabAssociations(
  windowId: number,
  associations: Record<number, string>
): Promise<void>
{
  await tabAssociationSessionStore.replace(windowId, associations);
}

// =============================================================================
// Local storage backup (persists across browser restarts)
// One storage entry per window + a separate index of all window IDs.
// =============================================================================

const tabAssociationBackupStore = new TabAssociationBackupStore({
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
  remove: (keys) => chrome.storage.local.remove(keys),
});

function getDomain(url: string): string
{
  try
  {
    return new URL(getEffectiveTabUrl(url)).hostname;
  }
  catch
  {
    return '';
  }
}

// Return backup entries whose URL has a parseable domain
function backupEntriesWithDomain(backup: WindowAssociationBackup): [string, TabAssociationBackupEntry][]
{
  return Object.entries(backup).filter(([, e]) => getDomain(e.url) !== '');
}

function formatBackup(backup: WindowAssociationBackup): string
{
  const entries = Object.entries(backup);
  if (entries.length === 0) return '  (empty)';
  return entries.map(([key, e]) => `  ${key}: tabId=${e.tabId}, tabIndex=${e.tabIndex}, url=${e.url}`).join('\n');
}

// Remove all backup entries for a window
export async function removeWindowAssociationBackup(windowId: number): Promise<void>
{
  await tabAssociationBackupStore.removeWindow(windowId);
  if (import.meta.env.DEV)
  {
    console.log('[TabAssociationBackup] removeWindow', windowId);
  }
}

export async function saveTabAssociationBackup(
  windowId: number,
  itemKey: string,
  entry: TabAssociationBackupEntry
): Promise<void>
{
  await tabAssociationBackupStore.save(windowId, itemKey, entry);
  if (import.meta.env.DEV)
  {
    const windowBackup = await tabAssociationBackupStore.read(windowId);
    console.log(`[TabAssociationBackup] save window=${windowId} ${itemKey}\n${formatBackup(windowBackup)}`);
  }
}

export async function removeTabAssociationBackup(
  windowId: number,
  itemKey: string
): Promise<void>
{
  await tabAssociationBackupStore.remove(windowId, itemKey);
  if (import.meta.env.DEV)
  {
    const windowBackup = await tabAssociationBackupStore.read(windowId);
    console.log(`[TabAssociationBackup] remove window=${windowId} ${itemKey}\n${formatBackup(windowBackup)}`);
  }
}

// Patch tabIndex for multiple entries in one read-modify-write.
// itemKeyToIndex: itemKey → new tabIndex
export async function updateTabAssociationBackupIndices(
  windowId: number,
  itemKeyToIndex: Record<string, number>
): Promise<void>
{
  await tabAssociationBackupStore.updateIndices(windowId, itemKeyToIndex);
  if (import.meta.env.DEV)
  {
    const windowBackup = await tabAssociationBackupStore.read(windowId);
    console.log(`[TabAssociationBackup] updateIndices window=${windowId}\n${formatBackup(windowBackup)}`);
  }
}

type MatchType = 'direct' | 'index+domain' | 'domain';

interface WindowMatch
{
  currentId: number;
  matchType: MatchType;
  // itemKey → tabId for tabs that were matched
  tabMatches: Record<string, number>;
}

export interface BackupMatchOptions
{
  /**
   * True on a worker restart within the browser session that wrote the backup
   * (BrowserSessionMarker): window and tab IDs are exact. False after a browser
   * restart or an extension reload/update, when they may be reused.
   */
  sameBrowserSession: boolean;
  /** Receives each pass's decisions (the caller passes console.log in DEV builds). */
  log?: (message: string) => void;
}

// Shared state threaded through all matching passes
interface MatchContext
{
  result: Map<number, WindowMatch>;
  claimedWindowIds: Set<number>;
  // Pass 1 matches that found only some entries' tabs, held back for pass 3
  partialDirectMatches: Map<number, WindowMatch>;
  backups: Map<number, WindowAssociationBackup>;
  allWindows: chrome.windows.Window[];
  sameBrowserSession: boolean;
  log: (message: string) => void;
}

// One live tab as the passes compare it: effective URL (parked tabs count by their page) and domain
interface ComparedTab
{
  id: number;
  index: number;
  url: string;
  domain: string;
}

/**
 * The live tabs of one window while a backup's entries are placed in it.
 * Each tab goes to one entry at most.
 */
class WindowTabs
{
  #tabs: ComparedTab[];
  #taken = new Set<number>();

  constructor(win: chrome.windows.Window)
  {
    this.#tabs = (win.tabs ?? []).flatMap(tab => tab.id === undefined ? [] : [{
      id: tab.id,
      index: tab.index,
      url: getEffectiveTabUrl(tab.url),
      domain: getDomain(tab.url ?? ''),
    }]);
  }

  /** The effective URL of the window's tab with this ID; undefined when there is none. */
  urlOf(tabId: number): string | undefined
  {
    return this.#tabs.find(tab => tab.id === tabId)?.url;
  }

  /** Take the tab if the window has it and no entry took it yet. */
  take(tabId: number): boolean
  {
    if (this.#taken.has(tabId) || !this.#tabs.some(tab => tab.id === tabId)) return false;
    this.#taken.add(tabId);
    return true;
  }

  /** Take the free tab showing exactly this page, nearest to the index. */
  takeShowingPage(url: string, index: number): number | undefined
  {
    if (!url) return undefined;
    return this.#takeNearest(index, tab => tab.url === url);
  }

  /** Take the free tab on this domain nearest to the index. */
  takeOnDomain(domain: string, index: number): number | undefined
  {
    if (!domain) return undefined;
    return this.#takeNearest(index, tab => tab.domain === domain);
  }

  // The free tab passing the test closest to the index; the leftmost one wins a tie
  #takeNearest(index: number, accepts: (tab: ComparedTab) => boolean): number | undefined
  {
    let best: ComparedTab | undefined;

    // Keep the closest free tab that passes the test
    for (const tab of this.#tabs)
    {
      if (this.#taken.has(tab.id) || !accepts(tab)) continue;
      if (!best || Math.abs(tab.index - index) < Math.abs(best.index - index)) best = tab;
    }
    if (!best) return undefined;
    this.#taken.add(best.id);
    return best.id;
  }
}

/**
 * Give backup entries tabs of the window their backup was matched to. An entry
 * takes, in this order: its candidate (the tab a pass picked by ID or index)
 * when that tab shows the entry's exact page; a free tab showing its exact page
 * (the backup URL follows navigations and Chrome restores exact URLs), so a
 * reused tab ID or a stale index can't hand a Favorite to another page of its
 * site; its candidate on another page of the site. Without candidates (domain
 * overlap) an entry falls back to the free tab on its domain nearest its old
 * index. With candidates, entries that have none get nothing.
 */
function placeEntries(
  entries: Array<[string, TabAssociationBackupEntry]>,
  tabs: WindowTabs,
  candidates?: ReadonlyMap<string, number>
): Record<string, number>
{
  const placed: Record<string, number> = {};
  const toPlace = candidates ? entries.filter(([itemKey]) => candidates.has(itemKey)) : entries;

  // Round 1: candidates already on the entry's exact page
  for (const [itemKey, entry] of toPlace)
  {
    const candidate = candidates?.get(itemKey);
    if (candidate !== undefined && tabs.urlOf(candidate) === entry.url && tabs.take(candidate))
    {
      placed[itemKey] = candidate;
    }
  }

  // Round 2: a free tab showing the entry's exact page
  for (const [itemKey, entry] of toPlace)
  {
    if (itemKey in placed) continue;
    const tabId = tabs.takeShowingPage(entry.url, entry.tabIndex);
    if (tabId !== undefined) placed[itemKey] = tabId;
  }

  // Round 3: the candidate on another page of its site, or without candidates the nearest tab on the domain
  for (const [itemKey, entry] of toPlace)
  {
    if (itemKey in placed) continue;
    const candidate = candidates?.get(itemKey);

    // With candidates every entry here has one; it may have gone to another entry's exact page
    if (candidate !== undefined)
    {
      if (tabs.take(candidate)) placed[itemKey] = candidate;
      continue;
    }
    const tabId = tabs.takeOnDomain(getDomain(entry.url), entry.tabIndex);
    if (tabId !== undefined) placed[itemKey] = tabId;
  }

  return placed;
}

// Pass 1: direct match — the backup's window ID still exists.
// Same browser session (worker restart): window and tab IDs are exact, so the
// window is claimed and each entry keeps the tab with its stored ID, whatever
// page it shows now (its stored URL may lag a navigation made while the worker
// slept); an entry whose tab is gone (closed while the worker slept) is dropped.
// Otherwise (browser restart, extension reload or update) see matchDirectOnSite.
function matchDirect(ctx: MatchContext, backupIds: number[]): void
{
  const currentIds = new Set(ctx.allWindows.map(w => w.id!));

  // Try each backup window — if its ID still exists, match tabs by stored tabId
  for (const backupId of backupIds)
  {
    // Skip backups whose window ID no longer exists (needs fuzzy matching in later passes)
    if (!currentIds.has(backupId))
    {
      ctx.log(`[matchBackup] pass1: backup=${backupId} — window ID not found`);
      continue;
    }

    const backup = ctx.backups.get(backupId)!;
    const win = ctx.allWindows.find(w => w.id === backupId)!;
    if (ctx.sameBrowserSession)
    {
      claimWindowById(ctx, backupId, backup, win);
    }
    else
    {
      matchDirectOnSite(ctx, backupId, backup, win);
    }
  }
}

// Pass 1 within the same browser session: claim the window, keep each entry's tab by ID
function claimWindowById(
  ctx: MatchContext,
  backupId: number,
  backup: WindowAssociationBackup,
  win: chrome.windows.Window
): void
{
  const currentTabIds = new Set((win.tabs ?? []).map(t => t.id!));
  const tabMatches: Record<string, number> = {};
  const logLines: string[] = [];

  // Check each backup entry's stored tabId against the window's current tab IDs
  for (const [itemKey, entry] of Object.entries(backup))
  {
    if (currentTabIds.has(entry.tabId))
    {
      tabMatches[itemKey] = entry.tabId;
      logLines.push(`  ${itemKey}: tabId=${entry.tabId} ✓`);
    }
    else
    {
      logLines.push(`  ${itemKey}: tabId=${entry.tabId} — tab gone ✗`);
    }
  }

  ctx.result.set(backupId, { currentId: backupId, matchType: 'direct', tabMatches });
  ctx.claimedWindowIds.add(backupId);
  ctx.log(`[matchBackup] pass1: backup=${backupId} → direct, same browser session (${Object.keys(tabMatches).length}/${Object.keys(backup).length} tabs)\n${logLines.join('\n')}`);
}

// Pass 1 after a browser restart or an extension reload/update: the backup takes
// its old window ID only when every entry's stored tab ID is still in it, on the
// entry's site (on a reload IDs are kept and the backup URL follows navigations).
// After a browser restart Chrome hands out low window and tab IDs again, so the
// old window ID often exists again with unrelated tabs under the stored IDs. Such
// a backup stays unclaimed, and so does its window, for the index+domain and
// domain passes. When some entries matched and the others' tabs are simply gone
// (closed or dragged to another window while the extension wasn't running), the
// ID matches are held back for pass 3. Within the window an entry prefers a tab
// showing its exact page over its ID's tab on another page (placeEntries).
function matchDirectOnSite(
  ctx: MatchContext,
  backupId: number,
  backup: WindowAssociationBackup,
  win: chrome.windows.Window
): void
{
  const tabs = new WindowTabs(win);
  const candidates = new Map<string, number>();
  const logLines: string[] = [];
  let otherSiteCount = 0;

  // Check each backup entry's stored tabId against the window's current tabs and their sites
  for (const [itemKey, entry] of Object.entries(backup))
  {
    const currentUrl = tabs.urlOf(entry.tabId);
    if (currentUrl !== undefined && isSameSite(entry.url, currentUrl))
    {
      candidates.set(itemKey, entry.tabId);
      logLines.push(`  ${itemKey}: tabId=${entry.tabId} ✓`);
    }
    else
    {
      if (currentUrl !== undefined) otherSiteCount++;
      logLines.push(`  ${itemKey}: tabId=${entry.tabId} — ${currentUrl === undefined ? 'tab gone' : 'other site'} ✗`);
    }
  }

  const entryCount = Object.keys(backup).length;
  const allFound = candidates.size === entryCount;
  let outcome = 'left for passes 2-4';

  // Every entry found its tab, or some tabs are gone but none was taken by another site
  if (allFound || (candidates.size > 0 && otherSiteCount === 0))
  {
    const tabMatches = placeEntries(Object.entries(backup), tabs, candidates);
    const match: WindowMatch = { currentId: backupId, matchType: 'direct', tabMatches };

    // Every entry found its tab: the same window as before, claim it now
    if (allFound)
    {
      ctx.result.set(backupId, match);
      ctx.claimedWindowIds.add(backupId);
      outcome = 'direct';
    }
    // Otherwise keep the ID matches in case pass 2 finds nothing
    else
    {
      ctx.partialDirectMatches.set(backupId, match);
      outcome = 'partial, held for pass 3';
    }
  }
  ctx.log(`[matchBackup] pass1: backup=${backupId} → ${outcome} (${candidates.size}/${entryCount} tabs)\n${logLines.join('\n')}`);
}

// Pass 2: index+domain matching.
// Matches when a current window has a tab at the same index whose domain matches
// for every backup entry. Catches Chrome restoring tabs in the same positions
// with new IDs. Within the window an entry prefers a tab showing its exact page
// (placeEntries).
function matchByIndexAndDomain(ctx: MatchContext, backupIds: number[]): void
{
  const unmatched = backupIds.filter(id => !ctx.result.has(id));
  if (unmatched.length === 0) return;

  // Pre-compute index → { domain, tabId } for each unclaimed current window
  const windowTabsByIndex = new Map<number, Map<number, { domain: string; tabId: number }>>();
  for (const win of ctx.allWindows)
  {
    if (ctx.claimedWindowIds.has(win.id!))
      continue;

    const indexMap = new Map<number, { domain: string; tabId: number }>();
    for (const tab of win.tabs ?? [])
    {
      const domain = getDomain(tab.url ?? '');
      if (domain) indexMap.set(tab.index, { domain, tabId: tab.id! });
    }
    windowTabsByIndex.set(win.id!, indexMap);
  }

  // Try each unmatched backup against all unclaimed windows
  for (const backupId of unmatched)
  {
    const backup = ctx.backups.get(backupId)!;
    const entries = backupEntriesWithDomain(backup);
    if (entries.length === 0) continue;

    // Compare this backup's entries against each candidate window
    for (const [winId, indexMap] of windowTabsByIndex)
    {
      if (ctx.claimedWindowIds.has(winId)) continue;

      const candidates = new Map<string, number>();
      const matchLines: string[] = [];
      const mismatchLines: string[] = [];

      // Check if every backup entry has a tab at the same index with matching domain
      for (const [itemKey, entry] of entries)
      {
        const backupDomain = getDomain(entry.url);
        const current = indexMap.get(entry.tabIndex);
        if (current && current.domain === backupDomain)
        {
          candidates.set(itemKey, current.tabId);
          matchLines.push(`  [${entry.tabIndex}] ${backupDomain} → tabId=${current.tabId} ✓`);
        }
        else
        {
          mismatchLines.push(`  [${entry.tabIndex}] backup=${backupDomain} current=${current?.domain ?? '(none)'} ✗`);
        }
      }

      const allMatch = mismatchLines.length === 0;
      ctx.log(`[matchBackup] pass2: backup=${backupId} vs window=${winId} — ${allMatch ? 'MATCH' : 'no match'}\n${[...matchLines, ...mismatchLines].join('\n')}`);

      // All entries matched — claim this window and move to next backup
      if (allMatch)
      {
        const win = ctx.allWindows.find(w => w.id === winId)!;
        const tabMatches = placeEntries(entries, new WindowTabs(win), candidates);
        ctx.result.set(backupId, { currentId: winId, matchType: 'index+domain', tabMatches });
        ctx.claimedWindowIds.add(winId);
        break;
      }
    }
  }
}

// Pass 3: partial direct match. A backup that pass 1 matched only in part (some
// tabs gone, none on another site) and pass 2 didn't place keeps its ID matches
// if its window is still free; the entries whose tabs are gone are dropped.
// Typical case: an extension reload while the backup still listed a closed or
// dragged-away tab. Runs before pass 4, so the other tabs keep their exact
// associations instead of a guess by domain.
function matchPartialDirect(ctx: MatchContext, backupIds: number[]): void
{
  // Take each held-back pass 1 match whose backup and window are both still unmatched
  for (const backupId of backupIds)
  {
    const match = ctx.partialDirectMatches.get(backupId);
    if (!match || ctx.result.has(backupId) || ctx.claimedWindowIds.has(match.currentId)) continue;

    ctx.result.set(backupId, match);
    ctx.claimedWindowIds.add(match.currentId);
    ctx.log(`[matchBackup] pass3: backup=${backupId} → direct (${Object.keys(match.tabMatches).length}/${Object.keys(ctx.backups.get(backupId)!).length} tabs)`);
  }
}

// Pass 4: domain-based matching for remaining backup windows.
// For each unmatched backup, scores current windows by domain overlap count.
// The window with the most overlapping domains wins. Each entry then takes the
// free tab showing its exact page, else the free tab on its domain nearest its
// old index (placeEntries).
function matchByDomainOverlap(ctx: MatchContext, backupIds: number[]): void
{
  const unmatched = backupIds.filter(id => !ctx.result.has(id));
  if (unmatched.length === 0) return;

  const unclaimed = ctx.allWindows.filter(w => !ctx.claimedWindowIds.has(w.id!));
  if (unclaimed.length === 0) return;

  // Pre-compute the domains present in each unclaimed current window
  const windowDomains = new Map<number, Set<string>>();
  for (const win of unclaimed)
  {
    const domains = new Set((win.tabs ?? []).map(tab => getDomain(tab.url ?? '')).filter(domain => domain !== ''));
    windowDomains.set(win.id!, domains);
  }

  // Try each unmatched backup — find the unclaimed window with the most domain overlap
  for (const backupId of unmatched)
  {
    const backup = ctx.backups.get(backupId)!;
    const entries = backupEntriesWithDomain(backup);
    if (entries.length === 0) continue;

    const backupDomains = new Set(entries.map(([, e]) => getDomain(e.url)));

    // Score each unclaimed window by counting how many backup domains appear in its tabs
    let bestWindow: chrome.windows.Window | undefined;
    let bestScore = 0;

    for (const win of unclaimed)
    {
      if (ctx.claimedWindowIds.has(win.id!)) continue;
      const domains = windowDomains.get(win.id!)!;

      let overlap = 0;
      for (const domain of backupDomains)
      {
        if (domains.has(domain)) overlap++;
      }

      ctx.log(`[matchBackup] pass4: backup=${backupId} vs window=${win.id!} — overlap=${overlap}/${backupDomains.size}`);

      if (overlap > bestScore)
      {
        bestScore = overlap;
        bestWindow = win;
      }
    }

    // No window had any domain overlap — this backup can't be matched
    if (!bestWindow)
    {
      ctx.log(`[matchBackup] pass4: backup=${backupId} — no matching window found`);
      continue;
    }

    // Best window found — now give each backup entry a tab in it
    const tabMatches = placeEntries(entries, new WindowTabs(bestWindow));
    const logLines = entries.map(([itemKey, entry]) => itemKey in tabMatches
      ? `  ${itemKey}: ${entry.url} → tabId=${tabMatches[itemKey]} ✓`
      : `  ${itemKey}: ${getDomain(entry.url)} — no matching tab ✗`);

    ctx.log(`[matchBackup] pass4: backup=${backupId} → window=${bestWindow.id!} (${bestScore}/${backupDomains.size} domains, ${Object.keys(tabMatches).length}/${entries.length} tabs)\n${logLines.join('\n')}`);
    ctx.result.set(backupId, { currentId: bestWindow.id!, matchType: 'domain', tabMatches });
    ctx.claimedWindowIds.add(bestWindow.id!);
  }
}

/**
 * Match backed-up windows to current windows using four passes:
 * 1. Direct window ID match: by tab ID within the same browser session; after a
 *    browser restart or extension reload/update only when every entry's tab ID is
 *    still there on its site
 * 2. Index+domain match (browser restart — tabs at same positions)
 * 3. Partial direct match (pass 1 ID matches of a window where some tabs are gone)
 * 4. Domain overlap match (tabs may have shifted positions)
 */
export function matchBackupWindows(
  backupIds: number[],
  backups: Map<number, WindowAssociationBackup>,
  allWindows: chrome.windows.Window[],
  options: BackupMatchOptions
): Map<number, WindowMatch>
{
  const ctx: MatchContext = {
    result: new Map(),
    claimedWindowIds: new Set(),
    partialDirectMatches: new Map(),
    backups,
    allWindows,
    sameBrowserSession: options.sameBrowserSession,
    log: options.log ?? (() => {}),
  };

  matchDirect(ctx, backupIds);
  matchByIndexAndDomain(ctx, backupIds);
  matchPartialDirect(ctx, backupIds);
  matchByDomainOverlap(ctx, backupIds);

  return ctx.result;
}

/** 用当前真实 Tab 信息重建可持久化 backup，顺便修复旧 tabId 和 index。 */
function buildBackupFromAssociations(
  associations: Record<number, string>,
  tabs: chrome.tabs.Tab[]
): WindowAssociationBackup
{
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
  const backup: WindowAssociationBackup = {};

  // 只保留具备 URL、id 和 index 的真实 Tab。
  for (const [tabIdText, itemKey] of Object.entries(associations))
  {
    const tabId = Number(tabIdText);
    const tab = tabsById.get(tabId);
    if (!tab?.url || tab.id === undefined || tab.index === undefined) continue;
    backup[itemKey] = { tabId: tab.id, url: getEffectiveTabUrl(tab.url), tabIndex: tab.index };
  }
  return backup;
}

// Restore tab associations from local backup on extension startup.
// Matches backup windows to current windows, restores session associations
// for matched tabs, and cleans up unmatched backup data.
// sameBrowserSession: true on a worker restart within the browser session that
// wrote the backup (BrowserSessionMarker), when its tab and window IDs are exact.
export async function restoreTabAssociationBackup(sameBrowserSession: boolean): Promise<void>
{
  const backupWindowIds = await tabAssociationBackupStore.windowIds();
  if (backupWindowIds.length === 0)
  {
    if (import.meta.env.DEV)
    {
      console.log('[TabAssociationBackup] restore — no backup data');
    }
    return;
  }

  // Pre-fetch all data in parallel
  const [allWindows, ...backupValues] = await Promise.all([
    chrome.windows.getAll({ populate: true }),
    ...backupWindowIds.map(id => tabAssociationBackupStore.read(id)),
  ]);

  const backups = new Map<number, WindowAssociationBackup>();
  backupWindowIds.forEach((id, i) => backups.set(id, backupValues[i]));

  // Log backup data
  for (const [windowId, backup] of backups)
  {
    if (import.meta.env.DEV)
    {
      console.log(`[TabAssociationBackup] backup window=${windowId}\n${formatBackup(backup)}`);
    }
  }

  // Log current windows
  for (const win of allWindows)
  {
    const tabs = win.tabs ?? [];
    const tabLines = tabs.map(t => `  [${t.index}] id=${t.id} ${t.url}`).join('\n');
    if (import.meta.env.DEV)
    {
      console.log(`[TabAssociationBackup] current window=${win.id} (${tabs.length} tabs)\n${tabLines}`);
    }
  }

  // The matching passes report their decisions in DEV builds only
  let logMatch = (_message: string): void => {};
  if (import.meta.env.DEV)
  {
    logMatch = (message) => console.log(message);
  }

  // Match windows and restore associations
  const matches = matchBackupWindows(backupWindowIds, backups, allWindows, { sameBrowserSession, log: logMatch });

  const restoredBackups = new Map<number, WindowAssociationBackup>();

  for (const [backupId, { currentId, matchType, tabMatches }] of matches)
  {
    const matchedCount = Object.keys(tabMatches).length;
    if (import.meta.env.DEV)
    {
      console.log(`[TabAssociationBackup] restoring: backup=${backupId} → window=${currentId} (${matchType}, ${matchedCount} tabs)`);
    }

    const backupAssociations: Record<number, string> = {};
    for (const [itemKey, tabId] of Object.entries(tabMatches))
    {
      backupAssociations[tabId] = itemKey;
    }

    const currentWindow = allWindows.find(window => window.id === currentId);
    const currentTabs = currentWindow?.tabs ?? [];
    const validTabIds = new Set(
      currentTabs
        .map(tab => tab.id)
        .filter((tabId): tabId is number => tabId !== undefined)
    );
    const sessionAssociations = await getTabAssociations(currentId);
    const mergedAssociations = mergeRestoredTabAssociations(
      sessionAssociations,
      backupAssociations,
      validTabIds
    );
    await setTabAssociations(currentId, mergedAssociations);

    const healedBackup = buildBackupFromAssociations(mergedAssociations, currentTabs);
    if (Object.keys(healedBackup).length > 0)
    {
      restoredBackups.set(currentId, healedBackup);
    }
  }

  // Clean up unmatched backup windows
  const unmatched = backupWindowIds.filter(id => !matches.has(id));
  for (const backupId of unmatched)
  {
    if (import.meta.env.DEV)
    {
      console.log(`[TabAssociationBackup] removing unmatched backup window=${backupId}`);
    }
  }

  await tabAssociationBackupStore.replaceAll(restoredBackups);
}
