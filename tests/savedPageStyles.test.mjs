import assert from 'node:assert/strict';
import test from 'node:test';

import { SavedPageStyles } from '../src/stores/savedPageStyles.ts';

const entry = (css, autoApply, origin, rev) => ({ css, autoApply, origin, rev });

test('saving new CSS keeps Auto-apply off when the user switched it off', () =>
{
  const styles = new SavedPageStyles()
    .withSaved('10', 'video { width: 100% !important; }', 'https://videos.test', 'r1')
    .withAutoApply('10', false)
    .withSaved('10', 'video { width: 90% !important; }', 'https://videos.test', 'r2');

  const style = styles.styleFor('10');
  assert.equal(style.autoApply, false);
  assert.equal(style.css, 'video { width: 90% !important; }');
  assert.equal(style.rev, 'r2');
});

test('a first save turns Auto-apply on', () =>
{
  const styles = new SavedPageStyles().withSaved('10', 'a {}', 'https://videos.test', 'r1');

  assert.equal(styles.styleFor('10').autoApply, true);
});

test('without drops only the given bookmarks and returns the same instance when none had a style', () =>
{
  const styles = SavedPageStyles.fromStored({
    10: entry('a {}', true, 'https://a.test', 'r1'),
    11: entry('b {}', false, 'https://b.test', 'r2'),
    12: entry('c {}', true, 'https://c.test', 'r3'),
  });

  const remaining = styles.without(['10', '12', '99']);

  assert.equal(remaining.styleFor('10'), null);
  assert.equal(remaining.styleFor('12'), null);
  assert.deepEqual(remaining.toStored(), { 11: entry('b {}', false, 'https://b.test', 'r2') });
  assert.equal(styles.without(['98', '99']), styles);
});

test('appliesTo accepts pages on the saved origin and refuses other origins and non-http(s) URLs', () =>
{
  const style = new SavedPageStyles().withSaved('10', 'a {}', 'https://videos.test', 'r1').styleFor('10');

  assert.equal(style.appliesTo('https://videos.test/u/1?t=3'), true);
  assert.equal(style.appliesTo('https://other.test/u/1'), false);
  assert.equal(style.appliesTo('http://videos.test/u/1'), false);
  assert.equal(style.appliesTo('https://videos.test:8443/u/1'), false);
  assert.equal(style.appliesTo('https://sub.videos.test/u/1'), false);
  assert.equal(style.appliesTo('chrome://settings'), false);
  assert.equal(style.appliesTo('not a url'), false);
});

test('fromStored drops malformed entries and non-http(s) origins and throws on a value that is not an object', () =>
{
  const styles = SavedPageStyles.fromStored({
    10: entry('a {}', true, 'https://a.test', 'r1'),
    11: entry('b {}', 'yes', 'https://b.test', 'r2'),
    12: entry('c {}', true, 'chrome-extension://abc', 'r3'),
    13: entry('d {}', true, 'https://d.test/path', 'r4'),
    14: entry('e {}', true, 'https://e.test', ''),
    15: 'f {}',
  });

  assert.deepEqual(styles.toStored(), { 10: entry('a {}', true, 'https://a.test', 'r1') });
  assert.deepEqual(SavedPageStyles.fromStored(undefined).toStored(), {});
  assert.throws(() => SavedPageStyles.fromStored('broken'));
  assert.throws(() => SavedPageStyles.fromStored([]));
  assert.throws(() => SavedPageStyles.fromStored(null));
});
