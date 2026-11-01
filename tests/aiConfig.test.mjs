import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMatchingLlmsLink,
  getHostPermissionPattern,
  isSameOriginHttpUrl,
  parseSafeHttpUrl,
} from '../src/utils/aiConfig.ts';

test('isSameOriginHttpUrl accepts the same https origin with another path and query', () =>
{
  assert.equal(isSameOriginHttpUrl('https://a.test/docs/page.md?x=1', 'https://a.test/docs/page?y=2'), true);
});

test('isSameOriginHttpUrl accepts the same http origin with another path', () =>
{
  assert.equal(isSameOriginHttpUrl('http://a.test/other.md', 'http://a.test/page'), true);
});

test('isSameOriginHttpUrl rejects another host', () =>
{
  assert.equal(isSameOriginHttpUrl('https://b.test/page.md', 'https://a.test/page'), false);
  assert.equal(isSameOriginHttpUrl('http://192.168.1.1/admin', 'https://a.test/page'), false);
});

test('isSameOriginHttpUrl rejects another port', () =>
{
  assert.equal(isSameOriginHttpUrl('https://a.test:8443/page.md', 'https://a.test/page'), false);
});

test('isSameOriginHttpUrl rejects another scheme', () =>
{
  assert.equal(isSameOriginHttpUrl('http://a.test/page.md', 'https://a.test/page'), false);
});

test('isSameOriginHttpUrl rejects non-HTTP links', () =>
{
  assert.equal(isSameOriginHttpUrl('javascript:alert(1)', 'https://a.test/page'), false);
  assert.equal(isSameOriginHttpUrl('data:text/markdown,x', 'https://a.test/page'), false);
  assert.equal(isSameOriginHttpUrl('file:///etc/passwd', 'https://a.test/page'), false);
});

test('isSameOriginHttpUrl rejects a file: link on a file: page although both origins are "null"', () =>
{
  assert.equal(isSameOriginHttpUrl('file:///etc/passwd', 'file:///home/user/page.html'), false);
});

test('isSameOriginHttpUrl rejects relative and invalid links', () =>
{
  assert.equal(isSameOriginHttpUrl('/page.md', 'https://a.test/page'), false);
  assert.equal(isSameOriginHttpUrl('not a url', 'https://a.test/page'), false);
});

test('isSameOriginHttpUrl rejects any link when the page URL is invalid', () =>
{
  assert.equal(isSameOriginHttpUrl('https://a.test/page.md', 'not a url'), false);
});

const PAGE_URL = 'https://docs.a.test/guide/setup';
const LLMS_URL = 'https://docs.a.test/guide/llms.txt';

test('findMatchingLlmsLink resolves a relative matching link against the llms.txt URL', () =>
{
  const llmsText = '# Docs\n- [Setup](setup.md): how to set up';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), 'https://docs.a.test/guide/setup.md');
});

test('findMatchingLlmsLink returns an absolute same-origin matching link', () =>
{
  const llmsText = '- [Setup](https://docs.a.test/raw/guide/setup.md)';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), 'https://docs.a.test/raw/guide/setup.md');
});

test('findMatchingLlmsLink skips a matching link on another host', () =>
{
  const llmsText = '- [Setup](https://evil.test/guide/setup.md)';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), undefined);
});

test('findMatchingLlmsLink skips a matching link on localhost', () =>
{
  const llmsText = '- [Setup](http://localhost:8080/guide/setup.md)';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), undefined);
});

test('findMatchingLlmsLink skips a matching link on another port', () =>
{
  const llmsText = '- [Setup](https://docs.a.test:8443/guide/setup.md)';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), undefined);
});

test('findMatchingLlmsLink returns the same-origin match after a cross-origin match listed first', () =>
{
  const llmsText = [
    '- [Setup](http://192.168.1.1/guide/setup.md)',
    '- [Setup](/guide/setup.md)',
  ].join('\n');

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), 'https://docs.a.test/guide/setup.md');
});

test('findMatchingLlmsLink returns undefined for a same-origin link to another page', () =>
{
  const llmsText = '- [Install](/guide/install.md)';

  assert.equal(findMatchingLlmsLink(llmsText, PAGE_URL, LLMS_URL), undefined);
});

const HTTPS_REQUIRED = { message: 'Base URL must use HTTPS (HTTP is allowed only for localhost)' };

test('parseSafeHttpUrl accepts HTTPS for a public host and a LAN address', () =>
{
  assert.equal(parseSafeHttpUrl('https://api.openai.com/v1').href, 'https://api.openai.com/v1');
  assert.equal(parseSafeHttpUrl('https://192.168.1.1:8443/v1').href, 'https://192.168.1.1:8443/v1');
});

test('parseSafeHttpUrl accepts HTTP for loopback hosts', () =>
{
  for (const value of [
    'http://localhost/v1',
    'http://localhost:11434/v1',
    'http://ollama.localhost/v1',
    'http://127.0.0.1:1234/v1',
    'http://127.1.2.3/v1',
    'http://[::1]:11434/v1',
  ])
  {
    assert.equal(parseSafeHttpUrl(value).protocol, 'http:', value);
  }
});

test('parseSafeHttpUrl rejects HTTP for hosts off this computer', () =>
{
  for (const value of [
    'http://api.example.com/v1',
    'http://192.168.1.1/v1',
    'http://10.0.0.1:8080/v1',
    'http://0.0.0.0:11434/v1',
    'http://localhost.example.com/v1',
    'http://127.0.0.1.example.com/v1',
  ])
  {
    assert.throws(() => parseSafeHttpUrl(value), HTTPS_REQUIRED, value);
  }
});

test('parseSafeHttpUrl still rejects schemes other than HTTP and HTTPS', () =>
{
  assert.throws(() => parseSafeHttpUrl('ftp://localhost/v1'), { message: 'Base URL must use HTTP or HTTPS' });
});

test('getHostPermissionPattern applies the HTTPS rule that Validate and every rename run first', () =>
{
  assert.throws(() => getHostPermissionPattern('http://192.168.1.1:8080/v1'), HTTPS_REQUIRED);
  assert.equal(getHostPermissionPattern('http://localhost:11434/v1'), 'http://localhost:11434/*');
});
