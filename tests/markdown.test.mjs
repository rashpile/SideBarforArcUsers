import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarkdown, safeLinkHref } from '../src/utils/markdown.ts';

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'codeBlock', 'list', 'blockquote', 'rule']);
const INLINE_TYPES = new Set(['text', 'strong', 'em', 'code', 'link', 'break']);

/** Every node type in the tree, failing on a block where an inline belongs or the other way round. */
function collectTypes(blocks, types = new Set())
{
  for (const block of blocks)
  {
    assert.ok(BLOCK_TYPES.has(block.type), `unexpected block type ${block.type}`);
    types.add(block.type);
    if (block.type === 'list')
    {
      block.items.forEach(item => collectTypes(item, types));
    }
    else if (block.type === 'blockquote')
    {
      collectTypes(block.children, types);
    }
    else if (block.children)
    {
      collectInlineTypes(block.children, types);
    }
  }
  return types;
}

function collectInlineTypes(nodes, types)
{
  for (const node of nodes)
  {
    assert.ok(INLINE_TYPES.has(node.type), `unexpected inline type ${node.type}`);
    types.add(node.type);
    if (node.children)
    {
      collectInlineTypes(node.children, types);
    }
  }
}

function paragraphOf(text)
{
  return [{ type: 'paragraph', children: [{ type: 'text', text }] }];
}

function nestingDepth(nodes)
{
  let depth = 0;
  for (const node of nodes)
  {
    const nested = node.type === 'list' ? node.items.flat() : node.children ?? [];
    const own = ['list', 'blockquote', 'strong', 'em', 'link'].includes(node.type) ? 1 : 0;
    depth = Math.max(depth, own + nestingDepth(nested));
  }
  return depth;
}

test('raw HTML in a paragraph stays text with the literal characters', () =>
{
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), paragraphOf('<script>alert(1)</script>'));
  assert.deepEqual(parseMarkdown('Say <b>x</b> here'), paragraphOf('Say <b>x</b> here'));
});

test('HTML anywhere in a document gives no node type besides the markdown ones', () =>
{
  const source = [
    '# <img src=x onerror=alert(1)>',
    '<div onclick="alert(1)">',
    '**<iframe src="https://evil.test"></iframe>**',
    '</div>',
    '',
    '- <svg onload=alert(1)>',
    '> <a href="javascript:alert(1)">x</a>',
    '',
    '```html',
    '<script>alert(1)</script>',
    '```',
  ].join('\n');

  const types = collectTypes(parseMarkdown(source));

  assert.deepEqual([...types].sort(), ['blockquote', 'break', 'codeBlock', 'heading', 'list', 'paragraph', 'strong', 'text']);
});

test('links to javascript:, data:, mixed-case schemes and relative URLs keep only their label', () =>
{
  const sources = [
    '[x](javascript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](JaVaScRiPt:alert(1))',
    '[x](  javascript:alert(1)  "title")',
    '[x](<javascript:alert(1)>)',
    '[x](/relative/path)',
    '[x](page.html)',
  ];

  for (const source of sources)
  {
    assert.deepEqual(parseMarkdown(source), paragraphOf('x'), source);
  }
  assert.equal(safeLinkHref('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeLinkHref('https://example.com/a'), 'https://example.com/a');
});

test('images stay text, so a renderer never loads their URL', () =>
{
  assert.deepEqual(parseMarkdown('![pixel](https://evil.test/p.png)'), paragraphOf('![pixel](https://evil.test/p.png)'));
});

test('a document with every supported construct gives the expected tree', () =>
{
  const source = [
    '# Title',
    '',
    'Some **bold**, *italic* and `code` with a [link](https://example.com/docs).',
    'Second line',
    '',
    '```html',
    '<div class="x">hi</div>',
    '```',
    '',
    '- first',
    '- second',
    '  1. one',
    '  2. two',
    '',
    '> quoted **text**',
  ].join('\n');

  const text = value => ({ type: 'text', text: value });
  const paragraph = (...children) => ({ type: 'paragraph', children });

  assert.deepEqual(parseMarkdown(source), [
    { type: 'heading', level: 1, children: [text('Title')] },
    paragraph(
      text('Some '),
      { type: 'strong', children: [text('bold')] },
      text(', '),
      { type: 'em', children: [text('italic')] },
      text(' and '),
      { type: 'code', text: 'code' },
      text(' with a '),
      { type: 'link', href: 'https://example.com/docs', children: [text('link')] },
      text('.'),
      { type: 'break' },
      text('Second line'),
    ),
    { type: 'codeBlock', language: 'html', text: '<div class="x">hi</div>' },
    {
      type: 'list',
      ordered: false,
      start: 1,
      items: [
        [paragraph(text('first'))],
        [
          paragraph(text('second')),
          { type: 'list', ordered: true, start: 1, items: [[paragraph(text('one'))], [paragraph(text('two'))]] },
        ],
      ],
    },
    { type: 'blockquote', children: [paragraph(text('quoted '), { type: 'strong', children: [text('text')] })] },
  ]);
});

test('nesting stops at 8 levels and deeper markers stay text', () =>
{
  const quotes = parseMarkdown(`${'> '.repeat(20)}deep`);
  assert.equal(nestingDepth(quotes), 8);
  assert.equal(JSON.stringify(quotes).includes(JSON.stringify(`${'> '.repeat(12)}deep`)), true);

  const list = parseMarkdown(Array.from({ length: 20 }, (_, level) => `${'  '.repeat(level)}- item ${level}`).join('\n'));
  assert.equal(nestingDepth(list), 8);

  const strong = parseMarkdown(`${'**a '.repeat(20)}x${' a**'.repeat(20)}`);
  assert.equal(nestingDepth(strong), 8);
  assert.equal(strong[0].children[0].text.startsWith('**a **a'), true);
});
