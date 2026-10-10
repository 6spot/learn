import test from 'node:test';
import assert from 'node:assert/strict';
import { readMaintenance, createMaintenanceInvocation, createMaintenanceHandler } from '../../learn-maintenance/handler.mjs';
import { createProductionService } from '../service.mjs';
import { MemoryMetadataStore } from '../../../packages/cloud-runtime/dist/index.js';
import { fixture } from './fixtures.mjs';

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

function maintenanceFixture() {
  const store = new MemoryMetadataStore(), f = fixture();
  const hooks = {};
  let context = {};
  const document = (reader, collection, id) => ({
    get: async () => { const value = await reader.get(collection, id); return { data: value ? { _id: id, ...value } : null }; },
    set: async ({ data }) => { await hooks.beforeSet?.(collection, id); return reader.set(collection, id, data); },
    remove: () => reader.delete(collection, id),
  });
  const database = { command: { gt: value => ({ gt: value }) },
    runTransaction: callback => store.transaction(tx => callback({ collection: name => ({ doc: id => document(tx, name, id) }) })),
    collection(name) {
      let where = {}, afterId, limit = 50;
      return { doc: id => document(store, name, id),
        where(filter) { const { _id, ...fields } = filter; where = fields; afterId = _id?.gt; return this; },
        orderBy(field, direction) { assert.equal(field, '_id'); assert.equal(direction, 'asc'); return this; },
        limit(value) { limit = value; return this; },
        get: async () => ({ data: (await store.list(name, { where, limit, ...(afterId ? { afterId } : {}) })).map(row => ({ _id: row.id, ...row.value })) }),
      };
    },
  };
  const sdk = { init() {}, database: () => database, getWXContext: () => context };
  const environment = { ...f.environment(), LEARN_MAINTENANCE_CONFIG: JSON.stringify({
    clientInvocationDenied: true, platformVerified: true,
    recovery: { pageSize: 50, maxRecordsPerRun: 100, maxRunMs: 5000, maxCandidateBytes: 32000000, maxReadBytesPerRun: 64000000 },
  }) };
  return { store, sdk, environment, hooks, setContext(value) { context = value; } };
}

test('actual maintenance composition awaits both recovery and lifecycle through SDK metadata adapters', async () => {
  const { store, sdk, environment, setContext } = maintenanceFixture();
  setContext({ OPENID: 'maintenance-test-user', APPID: 'test-app' });
  const { service } = createProductionService(sdk, environment, () => { throw new Error('Maintenance must not fetch fonts'); });
  await service.getAccount();
  assert.equal((await service.deleteMyData({ confirm: true })).state, 'deleting');
  const main = createMaintenanceHandler(sdk, environment);
  assert.equal((await main({ Type: 'Timer' })).error.code, 'FORBIDDEN');
  setContext({});
  const result = await main({ method: 'deleteMyData', userId: 'untrusted' });
  assert.equal(result.ok, true);
  assert.equal(result.data.lifecycle.recordErrors, 0);
  assert.equal(result.data.lifecycle.checkpointSaved, true);
  assert.equal(result.data.recovery.checkpointSaved, true);
  assert.ok(await store.get('maintenance_cursors', 'lifecycle_v1'));
  assert.ok(!JSON.stringify(result).includes('maintenance-test-user'));
  assert.ok(!JSON.stringify(result).includes('u_'));
});

test('maintenance waits for the recovery checkpoint before starting lifecycle and returning', async () => {
  const { store, sdk, environment, hooks } = maintenanceFixture();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  hooks.beforeSet = async (collection, id) => {
    if (collection === 'maintenance_cursors' && id === 'recovery_v1') { entered(); await gate; }
  };
  let returned = false;
  const pending = createMaintenanceHandler(sdk, environment)().then(value => { returned = true; return value; });
  await waiting;
  assert.equal(returned, false);
  assert.equal(await store.get('maintenance_cursors', 'lifecycle_v1'), null);
  release();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.data.recovery.checkpointSaved, true);
  assert.equal(result.data.lifecycle.checkpointSaved, true);
});

test('maintenance phase failures return only the fixed safe error and never report partial success', async () => {
  for (const failingPhase of ['recovery_v1', 'lifecycle_v1']) {
    const { store, sdk, environment } = maintenanceFixture();
    const get = store.get.bind(store), observed = [];
    store.get = async (collection, id) => {
      if (collection === 'maintenance_cursors') {
        observed.push(id);
        if (id === failingPhase) throw new Error('private body and private file capability');
      }
      return get(collection, id);
    };
    const result = await createMaintenanceHandler(sdk, environment)();
    assert.deepEqual(result, { ok: false, error: { code: 'MAINTENANCE_UNAVAILABLE' } });
    assert.deepEqual(observed, failingPhase === 'recovery_v1' ? [failingPhase] : ['recovery_v1', failingPhase]);
    assert.equal(await get('maintenance_cursors', 'lifecycle_v1'), null);
    assert.equal(Boolean(await get('maintenance_cursors', 'recovery_v1')), failingPhase === 'lifecycle_v1');
  }
});
