import { isArchiveFolder } from './archiveFolder.ts';

interface TabLike
{
  id?: number;
  url?: string;
  active?: boolean;
}

interface BookmarkNodeLike
{
  id: string;
  title?: string;
  url?: string;
  children?: BookmarkNodeLike[];
}

interface PinnedSiteLike
{
  id: string;
  url: string;
}

export interface ParkedTabUrl
{
  sourceTabId: number;
  originalUrl: string;
}

/**
 * 解析外部休眠扩展创建的 park 页面，取回它替换掉的原 Tab ID 和原始网址。
 * 只接受 chrome-extension 的 park.html，避免把普通网页中的同名参数误当成 Tab 身份。
 */
export function parseParkedTabUrl(url?: string): ParkedTabUrl | null
{
  if (!url) return null;

  try
  {
    const parsed = new URL(url);
    if (parsed.protocol !== 'chrome-extension:' || !parsed.pathname.endsWith('/park.html')) return null;

    const sourceTabId = Number(parsed.searchParams.get('tabId'));
    const originalUrl = parsed.searchParams.get('url');
    if (!Number.isSafeInteger(sourceTabId) || sourceTabId < 0 || !originalUrl) return null;

    return { sourceTabId, originalUrl };
  }
  catch
  {
    return null;
  }
}

/** 返回 park 页面代表的真实网址；普通 Tab 原样返回。 */
export function getEffectiveTabUrl(url?: string): string
{
  return parseParkedTabUrl(url)?.originalUrl ?? url ?? '';
}

/** 在当前窗口中寻找替换指定 Tab 的 park 页面。 */
export function findParkedReplacementTab<TTab extends TabLike>(
  tabs: readonly TTab[],
  sourceTabId: number
): TTab | undefined
{
  return tabs.find(tab => parseParkedTabUrl(tab.url)?.sourceTabId === sourceTabId);
}

/**
 * 为丢失关联的 park 页面恢复固定身份。
 * 优先沿用旧 Tab ID 的精确关联；旧关联已经丢失时，才用原始网址匹配 Favorite 或书签。
 */
export function recoverParkedTabAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[] = [],
  pinnedSites: readonly PinnedSiteLike[] = []
): Record<number, string>
{
  return recoverAssociations(tabs, associations, bookmarkRoots, pinnedSites, true);
}

/**
 * 把当前窗口中 URL 已属于书签或 Favorite 的 Chrome Tab 恢复为固定身份。
 * 活跃 Tab 优先，保证侧边栏在首次打开时立即展示正确的 active 状态。
 */
export function recoverFixedTabAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[] = [],
  pinnedSites: readonly PinnedSiteLike[] = []
): Record<number, string>
{
  return recoverAssociations(tabs, associations, bookmarkRoots, pinnedSites, false);
}

function recoverAssociations<TTab extends TabLike>(
  tabs: readonly TTab[],
  associations: Readonly<Record<number, string>>,
  bookmarkRoots: readonly BookmarkNodeLike[],
  pinnedSites: readonly PinnedSiteLike[],
  parkedOnly: boolean
): Record<number, string>
{
  const recovered: Record<number, string> = {};
  const liveTabIds = new Set(
    tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id])
  );
  const claimedItemKeys = new Set(
    Object.entries(associations)
      .filter(([tabId]) => liveTabIds.has(Number(tabId)))
      .map(([, itemKey]) => itemKey)
  );
  const itemKeyByUrl = buildPersistentItemUrlIndex(bookmarkRoots, pinnedSites);

  const orderedTabs = [...tabs].sort((left, right) => Number(right.active) - Number(left.active));

  // Tab 必须拥有真实 ID，且同一个固定项目不能同时恢复给多个 Tab。
  for (const tab of orderedTabs)
  {
    if (tab.id === undefined || associations[tab.id]) continue;

    const parked = parseParkedTabUrl(tab.url);
    if (parkedOnly && !parked) continue;

    const itemKey = (parked ? associations[parked.sourceTabId] : undefined)
      ?? itemKeyByUrl.get(normalizeComparableUrl(getEffectiveTabUrl(tab.url)));
    if (!itemKey || claimedItemKeys.has(itemKey)) continue;

    recovered[tab.id] = itemKey;
    claimedItemKeys.add(itemKey);
  }

  return recovered;
}

/**
 * Favorite 在 Arc 中优先级更高，所以和书签 URL 重复时先保留 Favorite。
 * Archive folders (feature 035) are left out: a tab on an archived URL stays a regular tab.
 */
function buildPersistentItemUrlIndex(
  bookmarkRoots: readonly BookmarkNodeLike[],
  pinnedSites: readonly PinnedSiteLike[]
): Map<string, string>
{
  const itemKeyByUrl = new Map<string, string>();

  for (const site of pinnedSites)
  {
    const comparableUrl = normalizeComparableUrl(site.url);
    if (comparableUrl) itemKeyByUrl.set(comparableUrl, `pinned-${site.id}`);
  }

  const visitBookmarks = (nodes: readonly BookmarkNodeLike[]): void =>
  {
    // 深度遍历 Chrome 书签树，保留第一个出现的书签，和现有 Space 解析假设一致。
    for (const node of nodes)
    {
      if (isArchiveFolder(node)) continue;

      if (node.url)
      {
        const comparableUrl = normalizeComparableUrl(node.url);
        if (comparableUrl && !itemKeyByUrl.has(comparableUrl))
        {
          itemKeyByUrl.set(comparableUrl, `bookmark-${node.id}`);
        }
      }
      if (node.children) visitBookmarks(node.children);
    }
  };

  visitBookmarks(bookmarkRoots);
  return itemKeyByUrl;
}

/** 忽略 hash 和路径末尾斜杠，兼容 Chrome 与书签保存 URL 时的轻微格式差异。 */
export function normalizeComparableUrl(url: string): string
{
  try
  {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1)
    {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.href;
  }
  catch
  {
    return url;
  }
}
