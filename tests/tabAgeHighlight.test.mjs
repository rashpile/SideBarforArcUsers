import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTabAgeHighlightStyle,
  tabAgeGrade,
  tabLastUseForHighlight,
} from '../src/utils/tabAgeHighlight.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = 1_800_000_000_000;

test('each grade includes its upper bound; the next millisecond falls into the next grade', () =>
{
  const bounds = [MINUTE, 5 * MINUTE, 30 * MINUTE, 3 * HOUR];

  bounds.forEach((bound, grade) =>
  {
    assert.equal(tabAgeGrade(NOW - bound, NOW), grade, `exactly ${bound} ms`);
    const next = grade + 1 < bounds.length ? grade + 1 : undefined;
    assert.equal(tabAgeGrade(NOW - bound - 1, NOW), next, `${bound} ms + 1 ms`);
  });
});

test('a tab used more than 3 hours ago has no grade', () =>
{
  assert.equal(tabAgeGrade(NOW - 3 * HOUR, NOW), 3);
  assert.equal(tabAgeGrade(NOW - 3 * HOUR - 1, NOW), undefined);
  assert.equal(tabAgeGrade(NOW - 24 * HOUR, NOW), undefined);
});

test('a tab used just now is the freshest grade, even when its time is in the future', () =>
{
  assert.equal(tabAgeGrade(NOW, NOW), 0);
  assert.equal(tabAgeGrade(NOW + 10 * MINUTE, NOW), 0);
});

test('an unknown last use has no grade', () =>
{
  assert.equal(tabAgeGrade(undefined, NOW), undefined);
});

test('last use is the newer of leaving the tab and Chrome activating it', () =>
{
  assert.equal(tabLastUseForHighlight(NOW - HOUR, NOW - 2 * HOUR), NOW - HOUR);
  assert.equal(tabLastUseForHighlight(NOW - 2 * HOUR, NOW - HOUR), NOW - HOUR);
  assert.equal(tabLastUseForHighlight(NOW - HOUR, undefined), NOW - HOUR);
  assert.equal(tabLastUseForHighlight(undefined, NOW - HOUR), NOW - HOUR);
  assert.equal(tabLastUseForHighlight(undefined, undefined), undefined);
});

test('the setting reads as White when absent or unknown', () =>
{
  for (const style of ['off', 'white', 'accent', 'cooling', 'trail'])
  {
    assert.equal(parseTabAgeHighlightStyle(style), style);
  }
  assert.equal(parseTabAgeHighlightStyle(undefined), 'white');
  assert.equal(parseTabAgeHighlightStyle('rainbow'), 'white');
  assert.equal(parseTabAgeHighlightStyle(1), 'white');
});
