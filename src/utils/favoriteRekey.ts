// Re-keys open Favorite tabs after the one-time migration: a tab associated with
// `pinned-<oldPinId>` of the legacy global list moves to `pinned-<bookmarkId>` of
// the copy in its own Space. Pure, so the decision can be tested under Node.

import { FAVORITE_ITEM_KEY_PREFIX } from './tabAssociations.ts';

/** The part of FavoriteRekeyMap (services/favoritesMigration.ts) the re-key reads. */
export interface FavoriteRekeyLookup
{
  hasPin(oldPinId: string): boolean;
  bookmarkIdFor(oldPinId: string, spaceId: string): string | undefined;
}

/** One association the re-key changed. `toKey` is null when the tab became a regular tab. */
export interface FavoriteRekeyMove
{
  tabId: number;
  fromKey: string;
  toKey: string | null;
}

export class FavoriteRekeyResult
{
  readonly associations: Record<number, string>;
  readonly moves: readonly FavoriteRekeyMove[];

  constructor(associations: Record<number, string>, moves: FavoriteRekeyMove[])
  {
    this.associations = associations;
    this.moves = moves;
  }

  get changed(): boolean
  {
    return this.moves.length > 0;
  }
}

function oldPinIdOf(itemKey: string, rekeyMap: FavoriteRekeyLookup): string | null
{
  if (!itemKey.startsWith(FAVORITE_ITEM_KEY_PREFIX)) return null;
  const pinId = itemKey.slice(FAVORITE_ITEM_KEY_PREFIX.length);
  return rekeyMap.hasPin(pinId) ? pinId : null;
}

/** Cheap check before the caller fetches the tabs' Spaces. */
export function hasFavoriteAssociationsToRekey(
  associations: Readonly<Record<number, string>>,
  rekeyMap: FavoriteRekeyLookup
): boolean
{
  return Object.values(associations).some(itemKey => oldPinIdOf(itemKey, rekeyMap) !== null);
}

/**
 * Every Space got its own copy of each old Favorite, so only the tab's own Space can
 * say which copy it is. A tab with no Space, or whose Space got no copy, loses the
 * association rather than taking another Space's Favorite.
 */
export function rekeyFavoriteAssociations(
  associations: Readonly<Record<number, string>>,
  rekeyMap: FavoriteRekeyLookup,
  spaceOfTab: (tabId: number) => string | undefined
): FavoriteRekeyResult
{
  const result: Record<number, string> = {};
  const moves: FavoriteRekeyMove[] = [];
  const pending: { tabId: number; fromKey: string; oldPinId: string }[] = [];
  const claimedItemKeys = new Set<string>();

  for (const [tabIdText, itemKey] of Object.entries(associations))
  {
    const tabId = Number(tabIdText);
    const oldPinId = oldPinIdOf(itemKey, rekeyMap);
    if (oldPinId === null)
    {
      result[tabId] = itemKey;
      claimedItemKeys.add(itemKey);
    }
    else
    {
      pending.push({ tabId, fromKey: itemKey, oldPinId });
    }
  }

  for (const { tabId, fromKey, oldPinId } of pending)
  {
    const spaceId = spaceOfTab(tabId);
    const bookmarkId = spaceId === undefined ? undefined : rekeyMap.bookmarkIdFor(oldPinId, spaceId);
    const toKey = bookmarkId === undefined ? null : `${FAVORITE_ITEM_KEY_PREFIX}${bookmarkId}`;

    // An item key stays on one tab; a copy already open in another tab keeps that tab
    if (toKey !== null && !claimedItemKeys.has(toKey))
    {
      result[tabId] = toKey;
      claimedItemKeys.add(toKey);
      moves.push({ tabId, fromKey, toKey });
    }
    else
    {
      moves.push({ tabId, fromKey, toKey: null });
    }
  }

  return new FavoriteRekeyResult(result, moves);
}
