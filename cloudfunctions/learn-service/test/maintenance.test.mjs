import test from 'node:test';
import assert from 'node:assert/strict';
import { readMaintenance, createMaintenanceInvocation } from '../../learn-maintenance/handler.mjs';

test('maintenance cannot start until actual permission and platform verification is explicit', () => {
  for (const config of [{}, { platformVerified: true, clientInvocationDenied: false, recovery: {} },
    { platformVerified: false, clientInvocationDenied: true, recovery: {} }, { platformVerified: true, clientInvocationDenied: true, recovery: {}, extra: true }]) {
    assert.throws(() => readMaintenance({ LEARN_MAINTENANCE_CONFIG: JSON.stringify(config) }), { code: 'INVALID_DEPLOYMENT_CONFIG' });
  }
  assert.equal(readMaintenance({ LEARN_MAINTENANCE_CONFIG: JSON.stringify({ platformVerified: true, clientInvocationDenied: true, recovery: {} }) }).platformVerified, true);
});

test('maintenance ignores forged timer events and rejects trusted client identities', async () => {
  let runs = 0;
  for (const context of [{ OPENID: 'user' }, { FROM_OPENID: 'user' }, { SOURCE: 'wx_client' }, { SOURCE: 'http' }]) {
    const handler = createMaintenanceInvocation(() => context, async () => { runs++; });
    assert.deepEqual(await handler({ Type: 'Timer', method: 'recoverJob', jobId: 'victim' }), { ok: false, error: { code: 'FORBIDDEN' } });
  }
  assert.equal(runs, 0);
  const handler = createMaintenanceInvocation(() => ({}), async () => { runs++; return { visitedJobs: 0 }; });
  assert.deepEqual(await handler({ jobId: 'ignored' }), { ok: true, data: { visitedJobs: 0 } });
  assert.equal(runs, 1);
  assert.deepEqual(await createMaintenanceInvocation(() => { throw new Error('private'); }, () => {})(), { ok: false, error: { code: 'MAINTENANCE_UNAVAILABLE' } });
});
