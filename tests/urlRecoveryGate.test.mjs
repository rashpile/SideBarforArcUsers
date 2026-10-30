import assert from 'node:assert/strict';
import test from 'node:test';

import { UrlRecoveryGate } from '../src/utils/urlRecoveryGate.ts';

const WINDOW_ID = 7;

// In-memory chrome.storage.session stand-in
function memoryStorage()
{
  const values = {};
  return {
    values,
    get: async (key) => (key in values ? { [key]: values[key] } : {}),
    set: async (entries) => { Object.assign(values, entries); },
    clear: () =>
    {
      for (const key of Object.keys(values))
      {
        delete values[key];
      }
    },
  };
}

function countingPass()
{
  const pass = async () => { pass.runs += 1; };
  pass.runs = 0;
  return pass;
}

test('the pass runs once per browser session, also across sidebar reopens', async () =>
{
  const storage = memoryStorage();
  const pass = countingPass();
  const gate = new UrlRecoveryGate(storage, WINDOW_ID);

  assert.equal(await gate.runOnce(pass), true);
  assert.equal(pass.runs, 1);
  assert.equal(storage.values[UrlRecoveryGate.keyFor(WINDOW_ID)], true);

  // Later rebuilds in the same sidebar
  assert.equal(await gate.runOnce(pass), false);
  // The sidebar was closed and reopened: a new gate over the same session storage
  assert.equal(await new UrlRecoveryGate(storage, WINDOW_ID).runOnce(pass), false);
  assert.equal(pass.runs, 1);
});

test('cleared session storage (browser restart, extension reload) runs the pass again', async () =>
{
  const storage = memoryStorage();
  const pass = countingPass();

  assert.equal(await new UrlRecoveryGate(storage, WINDOW_ID).runOnce(pass), true);
  storage.clear();
  assert.equal(await new UrlRecoveryGate(storage, WINDOW_ID).runOnce(pass), true);
  assert.equal(pass.runs, 2);
});

test('a failed pass leaves the marker unset and the next call retries', async () =>
{
  const storage = memoryStorage();
  const gate = new UrlRecoveryGate(storage, WINDOW_ID);

  await assert.rejects(gate.runOnce(async () => { throw new Error('getTree failed'); }), /getTree failed/);
  assert.equal(UrlRecoveryGate.keyFor(WINDOW_ID) in storage.values, false);

  const pass = countingPass();
  assert.equal(await gate.runOnce(pass), true);
  assert.equal(pass.runs, 1);
});

test('a call while the pass is in flight does not start a second pass', async () =>
{
  const storage = memoryStorage();
  const gate = new UrlRecoveryGate(storage, WINDOW_ID);
  let release;
  let runs = 0;
  const slowPass = () =>
  {
    runs += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = gate.runOnce(slowPass);
  assert.equal(await gate.runOnce(slowPass), false);

  // Let the first pass reach its await on the marker read and start
  while (!release)
  {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(await gate.runOnce(slowPass), false);
  release();
  assert.equal(await first, true);
  assert.equal(runs, 1);
});

test('each window has its own marker', async () =>
{
  const storage = memoryStorage();
  const pass = countingPass();

  assert.equal(await new UrlRecoveryGate(storage, 1).runOnce(pass), true);
  assert.equal(await new UrlRecoveryGate(storage, 2).runOnce(pass), true);
  assert.equal(await new UrlRecoveryGate(storage, 1).runOnce(pass), false);
  assert.equal(pass.runs, 2);
});
