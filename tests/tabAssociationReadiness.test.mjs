import assert from 'node:assert/strict';
import test from 'node:test';

import { TabAssociationReadiness } from '../src/utils/tabAssociationReadiness.ts';

function deferred()
{
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('associations are ready only after the manager load and the backup restore both finish', async () =>
{
  const managerLoad = deferred();
  const restore = deferred();
  let restoreStarted = false;
  let ready = false;

  const readiness = new TabAssociationReadiness(
    () => managerLoad.promise,
    () =>
    {
      restoreStarted = true;
      return restore.promise;
    }
  );

  readiness.wait().then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(restoreStarted, false);
  assert.equal(ready, false);

  managerLoad.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(restoreStarted, true);
  assert.equal(ready, false);

  restore.resolve();
  assert.equal(await readiness.wait(), true);
  assert.equal(ready, true);
});

test('a failed init step still settles, but wait() reports the failure and later steps do not run', async () =>
{
  const errors = [];
  let restoreStarted = false;

  const readiness = new TabAssociationReadiness(
    () => Promise.reject(new Error('manager load failed')),
    async () => { restoreStarted = true; },
    (error) => errors.push(error)
  );

  assert.equal(await readiness.wait(), false);
  assert.equal(restoreStarted, false);
  assert.deepEqual(errors.map(error => error.message), ['manager load failed']);
});

test('a failed backup restore step also makes wait() report failure', async () =>
{
  const errors = [];
  const readiness = new TabAssociationReadiness(
    async () => {},
    () => Promise.reject(new Error('restore failed')),
    (error) => errors.push(error)
  );

  assert.equal(await readiness.wait(), false);
  assert.deepEqual(errors.map(error => error.message), ['restore failed']);
});
