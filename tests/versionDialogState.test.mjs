import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVersionDialogState } from '../src/utils/versionDialogState.ts';

test('no welcome or upgrade dialog opens before the version storage loads', () =>
{
  assert.deepEqual(resolveVersionDialogState({
    isLoaded: false,
    lastSeenVersion: '',
    currentVersion: '1.0.344',
  }), {
    isNewInstall: false,
    hasVersionChanged: false,
  });
});

test('after loading, an empty version means a fresh install', () =>
{
  assert.deepEqual(resolveVersionDialogState({
    isLoaded: true,
    lastSeenVersion: '',
    currentVersion: '1.0.344',
  }), {
    isNewInstall: true,
    hasVersionChanged: false,
  });
});

test('after loading, an older version means the upgrade notes are shown', () =>
{
  assert.deepEqual(resolveVersionDialogState({
    isLoaded: true,
    lastSeenVersion: '1.0.300',
    currentVersion: '1.0.344',
  }), {
    isNewInstall: false,
    hasVersionChanged: true,
  });
});
