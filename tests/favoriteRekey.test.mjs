import assert from 'node:assert/strict';
import test from 'node:test';

import { hasFavoriteAssociationsToRekey, rekeyFavoriteAssociations } from '../src/utils/favoriteRekey.ts';
import { FavoriteRekeyMap } from '../src/services/favoritesMigration.ts';

// Old pin "1700000000000" was copied into Space a as bookmark 11 and into Space b as 21
const rekeyMap = FavoriteRekeyMap.fromStored({
  '1700000000000': { a: '11', b: '21' },
  '1700000000001': { a: '12' },
});

test('an old Favorite tab moves to the copy in its own Space', () =>
{
  const spaces = { 5: 'a', 6: 'b' };
  const result = rekeyFavoriteAssociations(
    { 5: 'pinned-1700000000000', 6: 'pinned-1700000000000' },
    rekeyMap,
    tabId => spaces[tabId]
  );

  assert.deepEqual(result.associations, { 5: 'pinned-11', 6: 'pinned-21' });
  assert.deepEqual(result.moves, [
    { tabId: 5, fromKey: 'pinned-1700000000000', toKey: 'pinned-11' },
    { tabId: 6, fromKey: 'pinned-1700000000000', toKey: 'pinned-21' },
  ]);
});

test('a tab whose Space has no copy, or with no Space, loses the association', () =>
{
  const spaces = { 5: 'b' };
  const result = rekeyFavoriteAssociations(
    { 5: 'pinned-1700000000001', 6: 'pinned-1700000000000' },
    rekeyMap,
    tabId => spaces[tabId]
  );

  assert.deepEqual(result.associations, {});
  assert.deepEqual(result.moves.map(move => move.toKey), [null, null]);
});

test('keys not in the map are left untouched', () =>
{
  const associations = { 5: 'bookmark-1700000000000', 6: 'pinned-11', 7: 'pinned-unknown' };
  const result = rekeyFavoriteAssociations(associations, rekeyMap, () => 'a');

  assert.deepEqual(result.associations, associations);
  assert.equal(result.changed, false);
  assert.equal(hasFavoriteAssociationsToRekey(associations, rekeyMap), false);
  assert.equal(hasFavoriteAssociationsToRekey({ 8: 'pinned-1700000000000' }, rekeyMap), true);
});
