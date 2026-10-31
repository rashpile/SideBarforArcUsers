// Decides whether a closed tab goes into its Space's Recently Closed list, and which
// Space that is. Pure: background gathers the inputs at tabs.onRemoved time.

import type { OpenTabPage } from '../stores/openTabPages.ts';
import type { ClosedTabRecord } from '../stores/recentlyClosedTabs.ts';
import { getEffectiveTabUrl } from './parkedTabAssociation.ts';

export interface ClosedTabInput
{
  /** The closed tab's entry from the page cache; undefined when the cache never saw it. */
  page?: OpenTabPage;
  /** The tab's Space from TabSpaceRegistry; undefined when a worker wake lost it. */
  registrySpaceId?: string;
  existingSpaceIds: ReadonlySet<string>;
  /** The tab was closed by auto-archive or the Archive action; it is already in the Archive. */
  closedByArchive: boolean;
  now: number;
  id: string;
}

export interface ClosedTabDecision
{
  spaceId: string;
  record: ClosedTabRecord;
}

// Pages the user can't usefully reopen from a list, or that belong to the browser itself
const INTERNAL_URL_PREFIXES: readonly string[] = [
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
];

function isInternalUrl(url: string): boolean
{
  if (url === '') return true;
  const lower = url.toLowerCase();
  return INTERNAL_URL_PREFIXES.some(prefix => lower.startsWith(prefix));
}

export function closedTabRecord(input: ClosedTabInput): ClosedTabDecision | null
{
  const { page, registrySpaceId, existingSpaceIds, closedByArchive, now, id } = input;
  if (!page || closedByArchive || page.incognito || page.associated) return null;

  // The registry is current within the session; the cached Space covers a worker wake,
  // when the registry was rebuilt from live tabs and no longer knows the closed one.
  const spaceId = registrySpaceId ?? page.spaceId;
  if (spaceId === undefined || !existingSpaceIds.has(spaceId)) return null;

  // A parked tab is recorded by the page it stands for, so reopening it loads that page
  const url = getEffectiveTabUrl(page.url);
  if (isInternalUrl(url)) return null;

  return {
    spaceId,
    record: { id, url, title: page.title, favIconUrl: page.favIconUrl, closedAt: now },
  };
}
