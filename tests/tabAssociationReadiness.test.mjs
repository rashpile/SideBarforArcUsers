import assert from 'node:assert/strict';
import test from 'node:test';

import { TabAssociationReadiness } from '../src/utils/tabAssociationReadiness.ts';

function deferred()
{
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('关联状态只能在 manager 加载和备份恢复都完成后就绪', async () =>
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

test('初始化步骤失败时仍会就绪，但 wait() 报告失败且不再执行后续步骤', async () =>
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

test('备份恢复步骤失败时 wait() 同样报告失败', async () =>
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
