import assert from 'node:assert/strict';
import test from 'node:test';

import { closedTabRecord } from '../src/utils/closedTabRecording.ts';

const SPACES = new Set(['work', 'home']);

function page(overrides = {})
{
  return {
    url: 'https://example.com/a',
    title: 'Example A',
    favIconUrl: 'https://example.com/favicon.ico',
    incognito: false,
    associated: false,
    ...overrides,
  };
}

function decide(overrides = {})
{
  return closedTabRecord({
    page: page(),
    existingSpaceIds: SPACES,
    closedByArchive: false,
    now: 1000,
    id: 'r1',
    ...overrides,
  });
}

test('the registry Space wins over the cached Space', () =>
{
  const result = decide({ page: page({ spaceId: 'home' }), registrySpaceId: 'work' });
  assert.equal(result.spaceId, 'work');
});

test('the cached Space is used when the registry lost the tab after a worker wake', () =>
{
  const result = decide({ page: page({ spaceId: 'home' }), registrySpaceId: undefined });
  assert.deepEqual(result, {
    spaceId: 'home',
    record: {
      id: 'r1',
      url: 'https://example.com/a',
      title: 'Example A',
      favIconUrl: 'https://example.com/favicon.ico',
      closedAt: 1000,
    },
  });
});

test('tabs of one window closed together each land in their own Space', () =>
{
  const registry = new Map([[1, 'work'], [2, 'home']]);
  const pages = new Map([
    [1, page({ url: 'https://work.example/', spaceId: 'work' })],
    [2, page({ url: 'https://home.example/', spaceId: 'home' })],
    // Registry rebuilt by a worker wake doesn't know tab 3; its cached Space still applies
    [3, page({ url: 'https://other.example/', spaceId: 'home' })],
  ]);

  const results = [1, 2, 3].map(tabId => decide({
    page: pages.get(tabId),
    registrySpaceId: registry.get(tabId),
    id: `r${tabId}`,
  }));

  assert.deepEqual(results.map(r => [r.spaceId, r.record.url]), [
    ['work', 'https://work.example/'],
    ['home', 'https://home.example/'],
    ['home', 'https://other.example/'],
  ]);
});

test('a tab with no Space is not recorded', () =>
{
  assert.equal(decide({ page: page(), registrySpaceId: undefined }), null);
  assert.equal(decide({ page: undefined, registrySpaceId: 'work' }), null);
});

test('a tab of a deleted Space is not recorded', () =>
{
  assert.equal(decide({ registrySpaceId: 'gone' }), null);
  assert.equal(decide({ page: page({ spaceId: 'gone' }) }), null);
});

test('an incognito tab is not recorded', () =>
{
  assert.equal(decide({ page: page({ incognito: true }), registrySpaceId: 'work' }), null);
});

test('internal pages and the new tab page are not recorded', () =>
{
  for (const url of [
    '',
    'chrome://newtab/',
    'chrome://settings/',
    'chrome-extension://abc/sidebar.html',
    'chrome-search://local-ntp/local-ntp.html',
    'edge://settings/',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com/',
  ])
  {
    assert.equal(decide({ page: page({ url }), registrySpaceId: 'work' }), null, url);
  }
});

test('a tab that had a bookmark or Favorite association is not recorded', () =>
{
  assert.equal(decide({ page: page({ associated: true }), registrySpaceId: 'work' }), null);
});

test('an archived tab is not recorded', () =>
{
  assert.equal(decide({ registrySpaceId: 'work', closedByArchive: true }), null);
});

test('a parked tab is recorded by its original URL', () =>
{
  const parked = `chrome-extension://suspender/park.html?tabId=7&url=${encodeURIComponent('https://example.com/docs')}`;
  const result = decide({ page: page({ url: parked }), registrySpaceId: 'work' });
  assert.equal(result.record.url, 'https://example.com/docs');
});
