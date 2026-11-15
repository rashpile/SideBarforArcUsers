import assert from 'node:assert/strict';
import test from 'node:test';

import { RestoredWindowsWait } from '../src/utils/restoredWindowsWait.ts';

const QUIET_MS = 50;
const MAX_WAIT_MS = 300;

class FakeClock
{
  constructor()
  {
    this.now = 0;
    this.nextHandle = 1;
    this.scheduled = new Map();
  }

  setTimeout(callback, ms)
  {
    const handle = this.nextHandle++;
    this.scheduled.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle)
  {
    this.scheduled.delete(handle);
  }

  advance(ms)
  {
    const target = this.now + ms;
    for (;;)
    {
      const due = [...this.scheduled].filter(([, entry]) => entry.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [handle, entry] = due;
      this.scheduled.delete(handle);
      this.now = entry.at;
      entry.callback();
    }
    this.now = target;
  }
}

class FakeEvent
{
  constructor()
  {
    this.listeners = new Set();
    this.added = [];
    this.removed = [];
  }

  addListener(listener)
  {
    this.listeners.add(listener);
    this.added.push(listener);
  }

  removeListener(listener)
  {
    this.listeners.delete(listener);
    this.removed.push(listener);
  }

  fire()
  {
    for (const listener of [...this.listeners]) listener();
  }
}

function setup({ windowCount = Promise.resolve(0) } = {})
{
  const clock = new FakeClock();
  const windowCreated = new FakeEvent();
  const tabCreated = new FakeEvent();
  const wait = new RestoredWindowsWait({
    countNormalWindows: () => windowCount,
    addWindowCreatedListener: (listener) => windowCreated.addListener(listener),
    removeWindowCreatedListener: (listener) => windowCreated.removeListener(listener),
    addTabCreatedListener: (listener) => tabCreated.addListener(listener),
    removeTabCreatedListener: (listener) => tabCreated.removeListener(listener),
    setTimeout: (callback, ms) => clock.setTimeout(callback, ms),
    clearTimeout: (handle) => clock.clearTimeout(handle),
    quietMs: QUIET_MS,
    maxWaitMs: MAX_WAIT_MS,
  });
  const state = { resolved: false };
  const promise = wait.wait().then(() => { state.resolved = true; });
  return { clock, windowCreated, tabCreated, state, promise };
}

// Lets the window count and the resolve callback run
function settle()
{
  return new Promise((resolve) => setImmediate(resolve));
}

test('with no window at start it waits for the first window event', async () =>
{
  const { clock, windowCreated, state } = setup();
  await settle();

  clock.advance(MAX_WAIT_MS * 10);
  await settle();
  assert.equal(state.resolved, false);
  assert.equal(clock.scheduled.size, 0);

  windowCreated.fire();
  clock.advance(QUIET_MS);
  await settle();
  assert.equal(state.resolved, true);
});

test('a window created while the count is pending is still seen', async () =>
{
  let resolveCount;
  const windowCount = new Promise((resolve) => { resolveCount = resolve; });
  const { clock, windowCreated, state } = setup({ windowCount });

  windowCreated.fire();
  resolveCount(0);
  await settle();

  clock.advance(QUIET_MS);
  await settle();
  assert.equal(state.resolved, true);
});

test('resolves quietMs after the last creation', async () =>
{
  const { clock, windowCreated, tabCreated, state } = setup();
  await settle();

  windowCreated.fire();
  clock.advance(QUIET_MS - 10);
  tabCreated.fire();
  clock.advance(QUIET_MS - 10);
  windowCreated.fire();
  clock.advance(QUIET_MS - 1);
  await settle();
  assert.equal(state.resolved, false);

  clock.advance(1);
  await settle();
  assert.equal(state.resolved, true);
});

test('a tab creation inside the quiet period pushes it out', async () =>
{
  const { clock, windowCreated, tabCreated, state } = setup();
  await settle();

  windowCreated.fire();
  clock.advance(QUIET_MS - 1);
  tabCreated.fire();
  clock.advance(QUIET_MS - 1);
  await settle();
  assert.equal(state.resolved, false);

  clock.advance(1);
  await settle();
  assert.equal(state.resolved, true);
});

test('tab creations before any window do not start the quiet period', async () =>
{
  const { clock, tabCreated, state } = setup();
  await settle();

  tabCreated.fire();
  clock.advance(QUIET_MS);
  tabCreated.fire();
  clock.advance(MAX_WAIT_MS);
  await settle();
  assert.equal(state.resolved, false);
  assert.equal(clock.scheduled.size, 0);
});

test('maxWaitMs after the first window ends it while tabs keep arriving', async () =>
{
  const { clock, windowCreated, tabCreated, state } = setup();
  await settle();

  windowCreated.fire();
  for (let elapsed = 0; elapsed < MAX_WAIT_MS - 10; elapsed += 10)
  {
    clock.advance(10);
    tabCreated.fire();
  }
  await settle();
  assert.equal(state.resolved, false);

  clock.advance(10);
  await settle();
  assert.equal(state.resolved, true);
});

test('windows present at start resolve after quietMs', async () =>
{
  const { clock, state } = setup({ windowCount: Promise.resolve(2) });
  await settle();

  clock.advance(QUIET_MS - 1);
  await settle();
  assert.equal(state.resolved, false);

  clock.advance(1);
  await settle();
  assert.equal(state.resolved, true);
});

test('a failed window count still resolves after quietMs', async () =>
{
  const { clock, state } = setup({ windowCount: Promise.reject(new Error('No current window')) });
  await settle();

  clock.advance(QUIET_MS);
  await settle();
  assert.equal(state.resolved, true);
});

test('a failed window count resolves by maxWaitMs while tabs keep arriving', async () =>
{
  const { clock, tabCreated, state } = setup({ windowCount: Promise.reject(new Error('No current window')) });
  await settle();

  for (let elapsed = 0; elapsed < MAX_WAIT_MS - 10; elapsed += 10)
  {
    clock.advance(10);
    tabCreated.fire();
  }
  await settle();
  assert.equal(state.resolved, false);

  clock.advance(10);
  await settle();
  assert.equal(state.resolved, true);
});

test('after resolving it removes the listeners it added and clears its timers', async () =>
{
  const { clock, windowCreated, tabCreated, state } = setup({ windowCount: Promise.resolve(1) });
  await settle();

  tabCreated.fire();
  clock.advance(QUIET_MS);
  await settle();
  assert.equal(state.resolved, true);

  assert.equal(windowCreated.added.length, 1);
  assert.equal(tabCreated.added.length, 1);
  assert.deepEqual(windowCreated.removed, windowCreated.added);
  assert.deepEqual(tabCreated.removed, tabCreated.added);
  assert.equal(windowCreated.listeners.size, 0);
  assert.equal(tabCreated.listeners.size, 0);
  assert.equal(clock.scheduled.size, 0);
});
