import assert from 'node:assert/strict';
import test from 'node:test';

import { isSameSite, matchStoredTabs } from '../src/utils/storedTabMatcher.ts';

const record = (tabId, windowId, url, index) => ({ tabId, windowId, url, index });
const tab = (id, windowId, url, index) => ({ id, windowId, url, index });

// Which live tab ID each record ended up with, keyed by the record's stored tab ID
const matchedIds = matches => matches.map(({ record, tab }) => [record.tabId, tab.id]);

// Stored IDs that may come from an earlier browser session, and IDs of the running one
const AFTER_RESTART = { idMatch: 'sameWindowAndSite' };
const SAME_SESSION = { idMatch: 'sameWindow' };

test('browser restart: a record keeps the tab with the same ID in the same window after it navigated within the site', () =>
{
  const records = [record(5, 1, 'https://a.test/start', 0)];
  const tabs = [
    tab(2, 1, 'https://a.test/elsewhere', 0),
    tab(5, 1, 'https://a.test/other', 3),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[5, 5]]);
});

test('browser restart: a tab on the stored URL beats a reused ID on another page of the site', () =>
{
  // document-a reopened as tab 12; Chrome gave the old ID 5 to document-b
  const records = [record(5, 1, 'https://docs.test/document-a', 0)];
  const tabs = [
    tab(5, 1, 'https://docs.test/document-b', 0),
    tab(12, 1, 'https://docs.test/document-a', 1),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[5, 12]]);
});

test('browser restart: an ID on the stored URL is kept before the URL pass', () =>
{
  const records = [record(5, 1, 'https://a.test/doc', 4)];
  const tabs = [
    tab(3, 1, 'https://a.test/doc', 4),
    tab(5, 1, 'https://a.test/doc', 0),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[5, 5]]);
});

test('browser restart: a same-site ID tab another record took by URL is not given twice', () =>
{
  const records = [
    record(5, 1, 'https://a.test/x', 0),
    record(8, 1, 'https://a.test/y', 1),
  ];
  const tabs = [tab(5, 1, 'https://a.test/y', 0)];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[8, 5]]);
});

test('an ID reused by a page of another site is not an exact match (browser restart)', () =>
{
  const records = [record(5, 1, 'https://a.test/', 0)];
  const tabs = [
    tab(5, 1, 'https://b.test/', 0),
    tab(9, 1, 'https://a.test/', 4),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[5, 9]]);
});

test('same browser session: a record keeps the tab with its ID after it moved to another site', () =>
{
  // The worker slept while tab 7 followed a sign-in redirect; another tab still shows the stored page
  const records = [record(7, 1, 'https://mail.test/inbox', 3)];
  const tabs = [
    tab(7, 1, 'https://login.test/sso', 3),
    tab(8, 1, 'https://mail.test/inbox', 4),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, SAME_SESSION)), [[7, 7]]);
});

test('same browser session: the ID counts only in the stored window', () =>
{
  const records = [record(5, 1, 'https://a.test/', 0)];
  const tabs = [
    tab(5, 2, 'https://b.test/', 0),
    tab(9, 1, 'https://a.test/', 2),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, SAME_SESSION)), [[5, 9]]);
});

test('pages without a host are the same site only when the URL is the same', () =>
{
  assert.equal(isSameSite('https://a.test/x', 'https://a.test/y?q=1'), true);
  assert.equal(isSameSite('https://a.test/', 'https://www.a.test/'), false);
  assert.equal(isSameSite('about:blank', 'about:blank'), true);
  assert.equal(isSameSite('file:///tmp/a.html', 'file:///tmp/b.html'), false);
  assert.equal(isSameSite('', 'https://a.test/'), false);
});

test('an ID reused in another window is not an exact match; the record falls back to its URL', () =>
{
  const records = [record(5, 1, 'https://a.test/', 0)];
  const tabs = [
    tab(5, 2, 'https://b.test/', 0),
    tab(8, 2, 'https://a.test/', 1),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[5, 8]]);
});

test('without an ID match the tab on the same URL with the nearest index is taken', () =>
{
  const records = [record(40, 1, 'https://a.test/', 6)];
  const tabs = [
    tab(1, 3, 'https://a.test/', 0),
    tab(2, 3, 'https://other.test/', 6),
    tab(3, 3, 'https://a.test/', 5),
    tab(4, 3, 'https://a.test/', 9),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[40, 3]]);
});

test('two records with the same URL each take their own tab', () =>
{
  const records = [
    record(40, 1, 'https://a.test/', 2),
    record(41, 1, 'https://a.test/', 7),
  ];
  const tabs = [
    tab(1, 3, 'https://a.test/', 8),
    tab(2, 3, 'https://a.test/', 2),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, AFTER_RESTART)), [[40, 2], [41, 1]]);
});

test('a stale URL record listed first does not take the tab of an exact-ID record', () =>
{
  const stale = record(99, 1, 'https://a.test/', 0);
  const exact = record(5, 1, 'https://a.test/', 3);
  const tabs = [tab(5, 1, 'https://a.test/', 3)];

  const matches = matchStoredTabs([stale, exact], tabs, AFTER_RESTART);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].record, exact);
  assert.equal(matches[0].tab.id, 5);
});

test('with idMatch off a reused ID with another URL gets nothing; matching is by URL only', () =>
{
  const records = [
    record(5, 1, 'https://a.test/', 0),
    record(6, 1, 'https://c.test/', 1),
  ];
  const tabs = [
    tab(5, 1, 'https://b.test/', 0),
    tab(9, 1, 'https://c.test/', 1),
  ];
  assert.deepEqual(matchedIds(matchStoredTabs(records, tabs, { idMatch: 'off' })), [[6, 9]]);
});

test('records without a matching tab are dropped and tabs without an ID are ignored', () =>
{
  const records = [
    record(5, 1, 'https://gone.test/', 0),
    record(6, 1, 'https://a.test/', 1),
  ];
  const tabs = [
    { windowId: 1, url: 'https://a.test/', index: 1 },
    tab(7, 1, 'https://b.test/', 2),
  ];
  assert.deepEqual(matchStoredTabs(records, tabs, AFTER_RESTART), []);
});
