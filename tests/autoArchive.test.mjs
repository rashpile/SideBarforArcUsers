import assert from 'node:assert/strict';
import test from 'node:test';

import { autoArchivePeriodMs, autoArchiveSwitch, parseAutoArchivePeriod } from '../src/utils/autoArchive.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('every period has its length; Never has none', () =>
{
  const expected = {
    never: null,
    '1m': MINUTE,
    '12h': 12 * HOUR,
    '24h': 24 * HOUR,
    '3d': 3 * DAY,
    '7d': 7 * DAY,
    '30d': 30 * DAY,
  };

  // Check each stored value round-trips through parsing and maps to its length
  for (const [period, ms] of Object.entries(expected))
  {
    assert.equal(parseAutoArchivePeriod(period, true), period);
    assert.equal(autoArchivePeriodMs(period), ms);
  }
});

test('unknown values read as Never, and the 1-minute period only in DEV builds', () =>
{
  assert.equal(parseAutoArchivePeriod(undefined), 'never');
  assert.equal(parseAutoArchivePeriod('2h'), 'never');
  assert.equal(parseAutoArchivePeriod(12), 'never');
  assert.equal(parseAutoArchivePeriod('1m'), 'never');
  assert.equal(parseAutoArchivePeriod('1m', true), '1m');
});

test('switching from Never starts the grace, switching to Never turns it off, period to period keeps it', () =>
{
  assert.equal(autoArchiveSwitch({ oldValue: 'never', newValue: '12h' }), 'on');
  assert.equal(autoArchiveSwitch({ oldValue: undefined, newValue: '7d' }), 'on');
  assert.equal(autoArchiveSwitch({ oldValue: '12h', newValue: '7d' }), 'unchanged');
  assert.equal(autoArchiveSwitch({ oldValue: '7d', newValue: 'never' }), 'off');
  assert.equal(autoArchiveSwitch({ oldValue: undefined, newValue: 'never' }), 'off');
});

test('a 1-minute value left from a DEV build counts as Never in a release build', () =>
{
  assert.equal(autoArchiveSwitch({ oldValue: '1m', newValue: '12h' }), 'on');
  assert.equal(autoArchiveSwitch({ oldValue: '12h', newValue: '1m' }), 'off');
  assert.equal(autoArchiveSwitch({ oldValue: '1m', newValue: '12h' }, true), 'unchanged');
});
