import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { UserScriptRunner, UserScriptWorld } from '../src/services/pageAgent/userScriptRunner.ts';

// The world's CSP is what keeps an agent script, written after reading a possibly prompt-injected page,
// from sending the page's data to another site; the runner must never run a script outside that world.

const DID_NOT_RUN = 'the script did not run; the page may still be loading or not allow scripts';

class FakeUserScripts
{
  constructor({ execute, getScripts } = {})
  {
    this.calls = [];
    this.executeImpl = execute ?? (injection => [{ frameId: 0, result: (0, eval)(injection.js[0].code) }]);
    this.getScriptsImpl = getScripts ?? (() => Promise.resolve([]));
  }

  async configureWorld(properties)
  {
    this.calls.push({ method: 'configureWorld', properties });
  }

  async execute(injection)
  {
    this.calls.push({ method: 'execute', injection });
    const results = this.executeImpl(injection);
    return Promise.all(results.map(async entry => ({ ...entry, result: await entry.result })));
  }

  getScripts()
  {
    return this.getScriptsImpl();
  }
}

function cspDirectives(csp)
{
  return new Map(csp.split(';').map(part =>
  {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }));
}

afterEach(() =>
{
  delete globalThis.__sidebarPageAgent;
});

test('the world CSP lets network reach only the page origin', () =>
{
  const origin = 'https://www.youtube.com:8443';
  const world = UserScriptWorld.forUrl(`${origin}/watch?v=abc#t=10`);

  assert.equal(world.worldId, `page-agent:${origin}`);
  const directives = cspDirectives(world.csp);
  assert.deepEqual([...directives.keys()].sort(), [
    'connect-src', 'default-src', 'font-src', 'img-src', 'media-src', 'script-src', 'style-src',
  ]);
  assert.deepEqual(directives.get('default-src'), ["'none'"]);
  assert.deepEqual(directives.get('connect-src'), [origin]);
  const local = new Set(["'none'", "'self'", "'unsafe-eval'", "'unsafe-inline'", 'data:', 'blob:']);
  for (const [name, sources] of directives)
  {
    const remote = sources.filter(source => !local.has(source));
    const expected = ['connect-src', 'img-src', 'media-src', 'font-src', 'style-src'].includes(name) ? [origin] : [];
    assert.deepEqual(remote, expected, name);
  }
});

test('pages other than http(s), and origins the CSP cannot name, get no world and run rejects', async () =>
{
  const api = new FakeUserScripts();
  const runner = new UserScriptRunner(() => api);

  for (const url of ['chrome://extensions/', 'file:///Users/me/page.html', 'about:blank', 'not a url', '', 'http://a;b.com/'])
  {
    assert.equal(UserScriptWorld.forUrl(url), null, url);
    await assert.rejects(runner.run(1, url, { kind: 'undo' }), Error, url);
  }
  assert.deepEqual(api.calls, []);
});

test('run rejects when user scripts are unavailable', async () =>
{
  const runner = new UserScriptRunner(() => undefined);

  await assert.rejects(runner.run(1, 'https://example.com/', { kind: 'undo' }), /Allow User Scripts/);
});

test('run configures the page origin world before executing the runtime in it', async () =>
{
  const api = new FakeUserScripts();
  const runner = new UserScriptRunner(() => api);

  const result = await runner.run(7, 'https://example.com/a/b?c=d', { kind: 'apply', code: 'return 6 * 7;' });

  assert.deepEqual(result, { ok: true, compiled: true, value: '42', errors: [] });
  assert.deepEqual(api.calls.map(call => call.method), ['configureWorld', 'execute']);
  const [configure, execute] = api.calls;
  const world = UserScriptWorld.forUrl('https://example.com/');
  assert.deepEqual(configure.properties, { worldId: world.worldId, csp: world.csp });
  assert.equal(execute.injection.worldId, world.worldId);
  assert.deepEqual(execute.injection.target, { tabId: 7 });
});

test('a missing result becomes the did-not-run error', async () =>
{
  for (const results of [[{ frameId: 0, result: null }], [], [{ frameId: 0, result: 'text' }]])
  {
    const runner = new UserScriptRunner(() => new FakeUserScripts({ execute: () => results }));

    const result = await runner.run(1, 'https://example.com/', { kind: 'undo' });

    assert.deepEqual(result, { ok: false, compiled: false, error: DID_NOT_RUN, errors: [] });
  }
});

test('available() is false without the API, without execute, or while getScripts throws', () =>
{
  const noExecute = new FakeUserScripts();
  noExecute.execute = undefined;
  const toggleOff = new FakeUserScripts({ getScripts: () => { throw new Error('Allow User Scripts is off'); } });

  assert.equal(new UserScriptRunner(() => undefined).available(), false);
  assert.equal(new UserScriptRunner(() => noExecute).available(), false);
  assert.equal(new UserScriptRunner(() => toggleOff).available(), false);
  // A rejected getScripts promise must be handled: node:test fails the file on an unhandled rejection.
  const rejecting = new FakeUserScripts({ getScripts: () => Promise.reject(new Error('later')) });
  assert.equal(new UserScriptRunner(() => rejecting).available(), true);
});
