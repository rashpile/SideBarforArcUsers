import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { runUserScriptCommand } from '../src/services/pageAgent/userScriptRuntime.ts';

// The runtime is what Undo relies on to take a script off the page: when it breaks, a listener or timer
// the agent added keeps acting on the page after the user removed the change.

const LIMITS = { maxValueChars: 12000, maxErrors: 5, timeoutMs: 1000 };

class FakeMutationObserver
{
  static instances = [];

  constructor(callback)
  {
    this.callback = callback;
    this.observed = [];
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }

  observe(target, options)
  {
    this.observed.push({ target, options });
  }

  disconnect()
  {
    this.disconnected = true;
  }
}

function apply(code, limits = LIMITS)
{
  return runUserScriptCommand({ kind: 'apply', code }, limits);
}

function check(code, limits = LIMITS)
{
  return runUserScriptCommand({ kind: 'check', code }, limits);
}

function undo()
{
  return runUserScriptCommand({ kind: 'undo' }, LIMITS);
}

function ping()
{
  globalThis.__testTarget.dispatchEvent(new Event('ping'));
}

function wait(ms)
{
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeEach(() =>
{
  globalThis.__testLog = [];
  globalThis.__testTarget = new EventTarget();
  FakeMutationObserver.instances = [];
  globalThis.MutationObserver = FakeMutationObserver;
});

afterEach(async () =>
{
  // Clears the timers a test left registered, so the test run can end.
  await undo();
  delete globalThis.__sidebarPageAgent;
  delete globalThis.__testLog;
  delete globalThis.__testTarget;
  delete globalThis.__testRelease;
  delete globalThis.MutationObserver;
});

test('apply undoes the previous script before running the new code', async () =>
{
  await apply(`agent.onUndo(() => globalThis.__testLog.push('undo A'));`);
  const result = await apply(`globalThis.__testLog.push('run B'); return 'B';`);

  assert.deepEqual(result, { ok: true, compiled: true, value: '"B"', errors: [] });
  assert.deepEqual(globalThis.__testLog, ['undo A', 'run B']);
});

test('a script that does not compile keeps the running script and its listeners', async () =>
{
  await apply(`agent.on(globalThis.__testTarget, 'ping', () => globalThis.__testLog.push('A'));`);

  const result = await apply('this is not javascript (');

  assert.equal(result.ok, false);
  assert.equal(result.compiled, false);
  assert.match(result.error, /^SyntaxError: /);
  ping();
  assert.deepEqual(globalThis.__testLog, ['A']);
});

test('undo removes listeners, clears timers, disconnects observers and removes added nodes', async () =>
{
  const node = { removed: false, remove() { this.removed = true; } };
  globalThis.__testNode = node;
  await apply(`
    const log = globalThis.__testLog;
    agent.on(globalThis.__testTarget, 'ping', () => log.push('listener'));
    agent.setInterval(() => log.push('interval'), 5);
    agent.setTimeout(() => log.push('timeout'), 20);
    agent.observe(globalThis.__testTarget, { childList: true }, () => log.push('observer'));
    agent.add(globalThis.__testNode);
  `);
  delete globalThis.__testNode;

  const result = await undo();
  const logAtUndo = [...globalThis.__testLog];
  ping();
  await wait(50);

  assert.deepEqual(result, { ok: true, compiled: true, value: 'null', errors: [] });
  assert.deepEqual(globalThis.__testLog, logAtUndo);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].disconnected, true);
  assert.equal(node.removed, true);
});

test('a script that never settles returns the timeout error and keeps what it registered until undo', async () =>
{
  const result = await apply(`
    agent.on(globalThis.__testTarget, 'ping', () => globalThis.__testLog.push('A'));
    await new Promise(() => {});
  `, { ...LIMITS, timeoutMs: 20 });

  assert.equal(result.ok, false);
  assert.equal(result.compiled, true);
  assert.match(result.error, /still running after 0\.02 s; what it registered stays, Undo removes it/);
  ping();
  assert.deepEqual(globalThis.__testLog, ['A']);

  await undo();
  ping();
  assert.deepEqual(globalThis.__testLog, ['A']);
});

test('a timed-out script that registers after undo has that registration undone at once', async () =>
{
  await apply(`
    await new Promise(resolve => { globalThis.__testRelease = resolve; });
    agent.on(globalThis.__testTarget, 'ping', () => globalThis.__testLog.push('late'));
  `, { ...LIMITS, timeoutMs: 20 });
  await undo();

  globalThis.__testRelease();
  await wait(0);
  ping();

  assert.deepEqual(globalThis.__testLog, []);
});

test('a check undoes its own listener when it returns and leaves the applied script alone', async () =>
{
  await apply(`agent.on(globalThis.__testTarget, 'ping', () => globalThis.__testLog.push('script'));`);

  const result = await check(`
    agent.on(globalThis.__testTarget, 'ping', () => globalThis.__testLog.push('check'));
    globalThis.__testTarget.dispatchEvent(new Event('ping'));
    return globalThis.__testLog.length;
  `);
  assert.deepEqual(result, { ok: true, compiled: true, value: '2', errors: [] });

  globalThis.__testLog.length = 0;
  ping();
  assert.deepEqual(globalThis.__testLog, ['script']);
});

test('an error thrown in a registered listener comes back with the next command', async () =>
{
  await apply(`agent.on(globalThis.__testTarget, 'ping', () => { throw new TypeError('boom'); });`);
  ping();

  const result = await check('return 1;');

  assert.deepEqual(result, { ok: true, compiled: true, value: '1', errors: ['TypeError: boom'] });
  assert.deepEqual((await check('return 2;')).errors, []);
});
