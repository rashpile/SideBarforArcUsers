import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNoteUrl,
  collectNoteIds,
  isOwnNoteUrl,
  noteIdOfOwnUrl,
  parseNoteUrl,
  rewriteNoteUrl,
} from '../src/utils/noteUrl.ts';

const OWN = 'chrome-extension://ownextensionid';
const OTHER = 'chrome-extension://otherextensionid';

test('parseNoteUrl accepts a note URL of any extension origin', () =>
{
  assert.deepEqual(parseNoteUrl(`${OWN}/note.html?id=abc-123`), { origin: OWN, noteId: 'abc-123' });
  assert.deepEqual(parseNoteUrl(`${OTHER}/note.html?id=XYZ`), { origin: OTHER, noteId: 'XYZ' });
});

test('parseNoteUrl rejects other protocols', () =>
{
  assert.equal(parseNoteUrl('https://example.com/note.html?id=abc'), null);
  assert.equal(parseNoteUrl('moz-extension://ownextensionid/note.html?id=abc'), null);
  assert.equal(parseNoteUrl('file:///note.html?id=abc'), null);
});

test('parseNoteUrl rejects other paths', () =>
{
  assert.equal(parseNoteUrl(`${OWN}/x/note.html?id=abc`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.htm?id=abc`), null);
  assert.equal(parseNoteUrl(`${OWN}/index.html?id=abc`), null);
});

test('parseNoteUrl rejects missing or invalid ids', () =>
{
  assert.equal(parseNoteUrl(`${OWN}/note.html`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.html?id=`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.html?id=a_b`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.html?id=a%2Fb`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.html?id=${'a'.repeat(65)}`), null);
  assert.equal(parseNoteUrl(`${OWN}/note.html?other=abc`), null);
  assert.equal(parseNoteUrl('not a url'), null);
  assert.equal(parseNoteUrl(undefined), null);
});

test('buildNoteUrl round-trips through parseNoteUrl and tolerates a trailing slash', () =>
{
  const noteId = '3f2a1c9e-0b7d-4e55-9a10-2c4b6d8e0f12';
  assert.deepEqual(parseNoteUrl(buildNoteUrl(OWN, noteId)), { origin: OWN, noteId });
  assert.equal(buildNoteUrl(`${OWN}/`, 'abc'), `${OWN}/note.html?id=abc`);
});

test('noteIdOfOwnUrl and isOwnNoteUrl match only this extension', () =>
{
  assert.equal(noteIdOfOwnUrl(`${OWN}/note.html?id=abc`, OWN), 'abc');
  assert.equal(noteIdOfOwnUrl(`${OTHER}/note.html?id=abc`, OWN), null);
  assert.equal(noteIdOfOwnUrl(`${OWN}/index.html`, OWN), null);
  assert.equal(isOwnNoteUrl(`${OWN}/note.html?id=abc`, OWN), true);
  assert.equal(isOwnNoteUrl(`${OTHER}/note.html?id=abc`, OWN), false);
  assert.equal(isOwnNoteUrl('https://example.com/', OWN), false);
});

test('rewriteNoteUrl points a known noteId of another origin at this extension', () =>
{
  const known = new Set(['abc']);
  assert.equal(rewriteNoteUrl(`${OTHER}/note.html?id=abc`, OWN, known), `${OWN}/note.html?id=abc`);
});

test('rewriteNoteUrl leaves own URLs, unknown ids and web URLs unchanged', () =>
{
  const known = new Set(['abc']);
  const ownUrl = `${OWN}/note.html?id=abc`;
  const foreignUnknown = `${OTHER}/note.html?id=someone-elses-page`;
  const foreignOtherPage = `${OTHER}/options.html?id=abc`;
  const webUrl = 'https://example.com/note.html?id=abc';

  assert.equal(rewriteNoteUrl(ownUrl, OWN, known), ownUrl);
  assert.equal(rewriteNoteUrl(foreignUnknown, OWN, known), foreignUnknown);
  assert.equal(rewriteNoteUrl(foreignOtherPage, OWN, known), foreignOtherPage);
  assert.equal(rewriteNoteUrl(webUrl, OWN, known), webUrl);
});

test('collectNoteIds walks nested folders and collects ids of every origin', () =>
{
  const tree = [{
    children: [
      { url: `${OWN}/note.html?id=top` },
      { url: 'https://example.com/' },
      {
        children: [
          { url: `${OTHER}/note.html?id=foreign` },
          { children: [{ url: `${OWN}/note.html?id=deep` }] },
        ],
      },
    ],
  }];

  assert.deepEqual([...collectNoteIds(tree)].sort(), ['deep', 'foreign', 'top']);
});

test('collectNoteIds collects ids inside asd_Archive and asd_Favorites', () =>
{
  const spaceFolder = {
    title: 'Taxes',
    children: [
      { title: 'asd_Archive', children: [{ title: 'Archived note', url: `${OWN}/note.html?id=archived` }] },
      { title: 'asd_Favorites', children: [{ title: 'Favorite note', url: `${OWN}/note.html?id=favorite` }] },
      { title: 'Sub', children: [{ title: 'asd_Archive', children: [{ url: `${OWN}/note.html?id=nested-archived` }] }] },
    ],
  };

  assert.deepEqual([...collectNoteIds([spaceFolder])].sort(), ['archived', 'favorite', 'nested-archived']);
});

test('collectNoteIds of a tree without notes is empty', () =>
{
  assert.equal(collectNoteIds([{ children: [{ url: 'https://example.com/' }, { children: [] }] }]).size, 0);
  assert.equal(collectNoteIds([]).size, 0);
});
