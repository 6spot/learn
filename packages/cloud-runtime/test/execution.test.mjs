import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMetadataStore, MemoryPrivateStorage, ManualClock, SimulatedExecutionBridge } from '../dist/index.js';

// Synthetic proof harness only. T13-T17 own the application job/credit implementation.
// It deliberately persists only the explicit metadata projection below.
async function fixture() {
  const store = new MemoryMetadataStore();
  const storage = new MemoryPrivateStorage();
  const clock = new ManualClock(1000);
  let renders = 0;
  await store.transaction(tx => tx.set('accounts', 'owner', { available: 1, reserved: 0, consumed: 0 }));

  async function reserve() {
    await store.transaction(async tx => {
      const account = await tx.get('accounts', 'owner');
      assert.equal(account.available, 1);
      await tx.create('jobs', 'job', {
        owner: 'owner', state: 'RESERVED', batch: 'batch_1', deadline: 1100,
      });
      await tx.set('accounts', 'owner', { ...account, available: 0, reserved: 1 });
      await tx.create('ledger', 'reserve_job', { kind: 'RESERVE', jobId: 'job' });
    });
  }

  async function settle(outcome, batch = 'batch_1', fileId) {
    return store.transaction(async tx => {
      const job = await tx.get('jobs', 'job');
      if (['SUCCEEDED', 'FAILED'].includes(job.state)) return job.state;
      if (job.batch !== batch) return job.state;
      if (outcome === 'SUCCEEDED' && (clock.now() >= job.deadline || !fileId)) return job.state;
      if (outcome === 'FAILED' && clock.now() < job.deadline) return job.state;
      const account = await tx.get('accounts', 'owner');
      await tx.set('jobs', 'job', { ...job, state: outcome, ...(fileId ? { fileId } : {}) });
      await tx.set('accounts', 'owner', {
        available: account.available + (outcome === 'FAILED' ? 1 : 0), reserved: 0,
        consumed: account.consumed + (outcome === 'SUCCEEDED' ? 1 : 0),
      });
      await tx.create('ledger', 'settle_job', { kind: outcome === 'SUCCEEDED' ? 'CONSUME' : 'RELEASE', jobId: 'job' });
      return outcome;
    });
  }

  async function execute(payload, hooks = {}) {
    await store.transaction(async tx => {
      const job = await tx.get('jobs', 'job');
      if (job.state !== 'RESERVED' || clock.now() >= job.deadline) return;
      await tx.set('jobs', 'job', { ...job, state: 'GENERATING' });
    });
    const job = await store.get('jobs', 'job');
    if (job.state !== 'GENERATING') return job.state;
    const path = 'jobs/job/batch_1.pdf';
    await store.transaction(tx => tx.create('candidates', 'batch_1', { jobId: 'job', batch: 'batch_1', path }));
    await hooks.beforeRender?.();
    renders++;
    assert.equal(typeof payload.article, 'string');
    const fileId = await storage.put(path, new TextEncoder().encode('%PDF-synthetic'));
    await hooks.afterUpload?.();
    await hooks.beforeSettle?.();
    const result = await settle('SUCCEEDED', 'batch_1', fileId);
    if (result !== 'SUCCEEDED') await storage.remove(fileId);
    return result;
  }

  async function recover() {
    const job = await store.get('jobs', 'job');
    if (['SUCCEEDED', 'FAILED'].includes(job.state)) return job.state;
    if (clock.now() >= job.deadline) return settle('FAILED');
    const candidate = await store.get('candidates', 'batch_1');
    if (!candidate || candidate.batch !== job.batch) return job.state;
    const fileId = storage.resolve(candidate.path);
    try { await storage.read(fileId); } catch { return job.state; }
    return settle('SUCCEEDED', candidate.batch, fileId);
  }

  async function download(identity, jobId) {
    const job = await store.get('jobs', jobId);
    if (!job || job.owner !== identity || job.state !== 'SUCCEEDED') throw new Error('NOT_FOUND');
    return storage.read(job.fileId);
  }

  return { store, storage, clock, reserve, execute, settle, recover, download, renders: () => renders };
}

test('metadata is queryable during awaited execution; no article/layout is durable', async () => {
  const f = await fixture();
  await f.reserve();
  const article = 'synthetic-private-input-do-not-persist';
  const result = await new SimulatedExecutionBridge().invoke({ article }, payload => f.execute(payload, {
    beforeRender: async () => {
      assert.equal((await f.store.get('jobs', 'job')).state, 'GENERATING');
      assert.equal(await f.recover(), 'GENERATING');
    },
  }));
  assert.equal(result, 'SUCCEEDED');
  assert.equal(JSON.stringify(f.store.snapshot()).includes(article), false);
  assert.equal(JSON.stringify(f.store.snapshot()).includes('article'), false);
  assert.equal(f.renders(), 1);
  assert.deepEqual(await f.store.get('accounts', 'owner'), { available: 0, reserved: 0, consumed: 1 });
});

test('lost response preserves successful server state and query/re-download never consumes again', async () => {
  const f = await fixture();
  await f.reserve();
  await assert.rejects(new SimulatedExecutionBridge('response-lost').invoke({ article: 'synthetic' }, f.execute), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal(await f.recover(), 'SUCCEEDED');
  await f.download('owner', 'job');
  await f.download('owner', 'job');
  assert.deepEqual(await f.store.get('accounts', 'owner'), { available: 0, reserved: 0, consumed: 1 });
  assert.equal((await f.store.list('ledger')).length, 2);
});

test('invocation failure leaves reservation until trusted deadline then releases exactly once', async () => {
  const f = await fixture();
  await f.reserve();
  await assert.rejects(new SimulatedExecutionBridge('before-start').invoke({ article: 'synthetic' }, f.execute), { code: 'EXECUTION_NOT_STARTED' });
  assert.equal(await f.recover(), 'RESERVED');
  f.clock.advance(100);
  const states = await Promise.all(Array.from({ length: 20 }, () => f.recover()));
  assert.ok(states.every(state => state === 'FAILED'));
  assert.equal(f.renders(), 0);
  assert.deepEqual(await f.store.get('accounts', 'owner'), { available: 1, reserved: 0, consumed: 0 });
  assert.equal((await f.store.list('ledger')).length, 2);
});

test('upload succeeds but final commit fails; metadata-only recovery settles existing candidate', async () => {
  const f = await fixture();
  await f.reserve();
  await assert.rejects(f.execute({ article: 'synthetic' }, { beforeSettle: () => f.store.failNextCommit() }), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal((await f.store.get('jobs', 'job')).state, 'GENERATING');
  assert.equal((await f.store.get('accounts', 'owner')).reserved, 1);
  assert.equal(await f.recover(), 'SUCCEEDED');
  assert.equal(f.renders(), 1);
  assert.equal((await f.store.get('accounts', 'owner')).consumed, 1);
});

test('late upload cannot revive failed job, consume a credit or remain deliverable', async () => {
  const f = await fixture();
  await f.reserve();
  const result = await f.execute({ article: 'synthetic' }, {
    beforeRender: async () => {
      f.clock.advance(100);
      assert.equal(await f.recover(), 'FAILED');
    },
  });
  assert.equal(result, 'FAILED');
  assert.deepEqual(f.storage.fileIds(), []);
  assert.equal((await f.store.get('accounts', 'owner')).consumed, 0);
  await assert.rejects(f.download('owner', 'job'), /NOT_FOUND/);
});

test('crash immediately after upload recovers through pre-registered path without a returned file ID', async () => {
  const f = await fixture();
  await f.reserve();
  await assert.rejects(f.execute({ article: 'synthetic' }, {
    afterUpload: () => { throw new Error('SIMULATED_PROCESS_CRASH'); },
  }), /SIMULATED_PROCESS_CRASH/);
  assert.equal((await f.store.get('jobs', 'job')).fileId, undefined);
  assert.equal((await f.store.get('candidates', 'batch_1')).fileId, undefined);
  assert.equal(await f.recover(), 'SUCCEEDED');
  assert.equal(f.renders(), 1);
  assert.equal((await f.store.get('accounts', 'owner')).consumed, 1);
});

test('deadline is rechecked in settlement transaction and successful terminal state never refunds', async () => {
  const f = await fixture();
  await f.reserve();
  assert.equal(await f.execute({ article: 'synthetic' }), 'SUCCEEDED');
  f.clock.advance(1000);
  await Promise.all([f.settle('FAILED'), f.recover(), f.settle('SUCCEEDED', 'stale_batch', 'fake_file')]);
  assert.equal((await f.store.get('jobs', 'job')).state, 'SUCCEEDED');
  assert.deepEqual(await f.store.get('accounts', 'owner'), { available: 0, reserved: 0, consumed: 1 });
});

test('knowing a job/file identifier never authorizes another user', async () => {
  const f = await fixture();
  await f.reserve();
  await assert.rejects(f.download('owner', 'job'), /NOT_FOUND/);
  await f.execute({ article: 'synthetic' });
  await assert.rejects(f.download('other_user', 'job'), /NOT_FOUND/);
  const fileId = (await f.store.get('jobs', 'job')).fileId;
  await assert.rejects(f.download('other_user', fileId), { code: 'INVALID_ARGUMENT' });
  assert.equal(new TextDecoder().decode(await f.download('owner', 'job')), '%PDF-synthetic');
});
