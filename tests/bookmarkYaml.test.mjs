import assert from 'node:assert/strict';
import test from 'node:test';

import { YamlBookmark, YamlBookmarkList, YamlFolder, parseBookmarkYaml } from '../src/utils/bookmarkYaml.ts';

/** Plain structure of a list for deep comparison (lines left out). */
function shape(items)
{
  return items.map(item => item instanceof YamlFolder
    ? { folder: item.title, items: shape(item.items) }
    : { title: item.title, url: item.url });
}

function parseOk(text)
{
  const result = parseBookmarkYaml(text);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.map(String).join('\n'));
  return shape(result.list.items);
}

function parseErrors(text)
{
  const result = parseBookmarkYaml(text);
  assert.equal(result.ok, false);
  assert.equal(result.list, undefined);
  return result.errors.map(error => ({ line: error.line, message: error.message }));
}

test('round trip keeps tricky titles, nesting and empty folders', () =>
{
  const titles = ['a: b', 'C # sharp', 'say "hi"', "it's", 'back\\slash', '- dash', 'Привет 🌍', 'two\nlines', 'tab\there'];
  const nodes = [
    {
      title: 'Tools',
      children: [
        ...titles.map((title, i) => ({ title, url: `https://example.com/${i}?q=a#frag` })),
        { title: 'Empty', children: [] },
        { title: 'Deep: "x"', children: [{ title: '', url: 'https://deep.example' }] },
      ],
    },
    { title: 'Inbox', url: 'https://mail.google.com' },
  ];
  const list = YamlBookmarkList.fromBookmarkNodes(nodes);
  const yaml = list.toYaml();
  assert.ok(yaml.endsWith('\n'));
  assert.match(yaml, /items: \[\]/);

  const parsed = parseOk(yaml);
  assert.deepEqual(parsed, [
    {
      folder: 'Tools',
      items: [
        ...titles.map((title, i) => ({ title, url: `https://example.com/${i}?q=a#frag` })),
        { folder: 'Empty', items: [] },
        // An empty title falls back to the URL on paste
        { folder: 'Deep: "x"', items: [{ title: 'https://deep.example', url: 'https://deep.example' }] },
      ],
    },
    { title: 'Inbox', url: 'https://mail.google.com' },
  ]);
});

test('copy skips system folders at any depth and counts only what is copied', () =>
{
  const nodes = [
    { title: 'asd_Archive', children: [{ title: 'old', url: 'https://old.example' }] },
    { title: 'asd_Favorites', children: [{ title: 'fav', url: 'https://fav.example' }] },
    {
      title: 'Work',
      children: [
        { title: 'Docs', url: 'https://docs.example' },
        { title: 'Nested', children: [{ title: 'asd_Archive', children: [{ title: 'x', url: 'https://x.example' }] }] },
      ],
    },
  ];
  const list = YamlBookmarkList.fromBookmarkNodes(nodes);
  assert.deepEqual(shape(list.items), [
    { folder: 'Work', items: [{ title: 'Docs', url: 'https://docs.example' }, { folder: 'Nested', items: [] }] },
  ]);
  assert.deepEqual(list.counts(), { folders: 2, bookmarks: 1 });
  assert.equal(list.summary(), '2 folders, 1 bookmark');
  assert.doesNotMatch(list.toYaml(), /asd_|old\.example|x\.example/);
});

test('empty list serializes as []', () =>
{
  assert.equal(new YamlBookmarkList([]).toYaml(), '[]\n');
});

test('summary pluralizes', () =>
{
  const list = new YamlBookmarkList([
    new YamlFolder('a', [new YamlBookmark('x', 'https://x'), new YamlBookmark('y', 'https://y')]),
    new YamlFolder('b', []),
    new YamlFolder('c', []),
  ]);
  assert.equal(list.summary(), '3 folders, 2 bookmarks');
});

test('structural errors report the line and return no list', () =>
{
  const cases = [
    ['- title: a\n\turl: https://a', 2, /Tabs/],
    ['- title: a\n  link: https://a', 2, /Unknown key "link"/],
    ['- title: a\n  title: b\n  url: https://a', 2, /Duplicate key/],
    ['- folder: a\n  url: https://a', 1, /both "url" and "folder"/],
    ['- title: a\n- title: b\n  url: https://b', 1, /needs "url"/],
    ['- title: "unterminated\n  url: https://a', 1, /Unterminated quote/],
    ['- title: \'open\n  url: https://a', 1, /Unterminated quote/],
    ['- title: "a" b\n  url: https://a', 1, /after the closing quote/],
    ['folder: Tools\nitems: []', 1, /top level must be a list/],
    ['', 1, /Nothing to paste/],
    ['# only a comment\n\n', 1, /Nothing to paste/],
    ['[]', 1, /Nothing to paste/],
    ['- title: a\n    url: https://a', 2, /Bad indentation/],
    ['- folder: a\n  items:\n    - title: x\n      url: https://x\n   - title: y\n     url: https://y', 5, /Bad indentation/],
  ];
  for (const [text, line, message] of cases)
  {
    const errors = parseErrors(text);
    assert.equal(errors.length, 1, text);
    assert.equal(errors[0].line, line, text);
    assert.match(errors[0].message, message, text);
  }
});

test('system folder titles are rejected', () =>
{
  const errors = parseErrors('- folder: Work\n  items:\n    - folder: asd_Archive\n- folder: asd_Favorites');
  assert.deepEqual(errors.map(error => error.line), [3, 4]);
  assert.match(errors[0].message, /reserved/);
});

test('every invalid URL is reported with its line', () =>
{
  const errors = parseErrors([
    '- title: ok',
    '  url: https://ok.example',
    '- title: bad one',
    '  url: "not a url"',
    '- folder: F',
    '  items:',
    '    - title: bad two',
    '      url: "http://exa mple.com"',
    '    - title: empty',
    '      url: ""',
  ].join('\n'));
  assert.deepEqual(errors.map(error => error.line), [3, 7, 9]);
});

test('scheme-less URL is normalized and a missing title falls back to the URL', () =>
{
  assert.deepEqual(parseOk('- url: github.com\n- title: ""\n  url: mailto:a@b.c'), [
    { title: 'https://github.com', url: 'https://github.com' },
    { title: 'mailto:a@b.c', url: 'mailto:a@b.c' },
  ]);
});

test('hand-written plain and single-quoted input parses', () =>
{
  const text = [
    '﻿# my links',
    '- folder: Tools   # comment',
    '  items:',
    '    - title: GitHub',
    "      url: 'https://github.com'",
    "    - title: 'It''s here' # trailing",
    '      url: https://example.com/#anchor',
    '',
    '    - folder: "Empty"',
    '      items: [] # nothing yet',
    '- title: Foo: bar',
    '  url: https://foo.example',
  ].join('\r\n');
  assert.deepEqual(parseOk(text), [
    {
      folder: 'Tools',
      items: [
        { title: 'GitHub', url: 'https://github.com' },
        { title: "It's here", url: 'https://example.com/#anchor' },
        { folder: 'Empty', items: [] },
      ],
    },
    { title: 'Foo: bar', url: 'https://foo.example' },
  ]);
});

test('items: followed by a same-indent sequence parses (PyYAML style)', () =>
{
  const text = [
    '- folder: Outer',
    '  items:',
    '  - title: A',
    '    url: https://a.example',
    '  - folder: Inner',
    '    items:',
    '    - url: https://b.example',
    '- title: After',
    '  url: https://after.example',
  ].join('\n');
  assert.deepEqual(parseOk(text), [
    {
      folder: 'Outer',
      items: [
        { title: 'A', url: 'https://a.example' },
        { folder: 'Inner', items: [{ title: 'https://b.example', url: 'https://b.example' }] },
      ],
    },
    { title: 'After', url: 'https://after.example' },
  ]);
});

test('PyYAML style: a key after the nested list belongs to the parent item', () =>
{
  const text = [
    '- items:',
    '  - url: https://a.example',
    '  folder: Late name',
  ].join('\n');
  assert.deepEqual(parseOk(text), [
    { folder: 'Late name', items: [{ title: 'https://a.example', url: 'https://a.example' }] },
  ]);
});

test('double-quoted escapes decode', () =>
{
  assert.deepEqual(parseOk('- title: "a\\\\b \\"q\\" \\/ \\u00e9\\n"\n  url: https://x.example'), [
    { title: 'a\\b "q" / é\n', url: 'https://x.example' },
  ]);
});
