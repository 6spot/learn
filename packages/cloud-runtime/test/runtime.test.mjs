import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryMetadataStore, MemoryPrivateStorage, ManualClock, AwaitedExecutionBridge,
  CloudBaseIdentityProvider, StaticIdentityProvider, selectCloudEnvironment,
} from '../dist/index.js';

test('concurrent reservations serialize and never overdraw a single credit', async () => {
  const store = new MemoryMetadataStore();
  await store.transaction(tx => tx.set('accounts', 'user', { available: 1, reserved: 0 }));
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => store.transaction(async tx => {
    const account = await tx.get('accounts', 'user');
    if (!account.available) return false;
    await tx.set('accounts', 'user', { available: 0, reserved: 1 });
    await tx.create('jobs', `job_${index}`, { owner: 'user', state: 'RESERVED' });
    return true;
  })));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await store.list('jobs')).length, 1);
  assert.deepEqual(await store.get('accounts', 'user'), { available: 0, reserved: 1 });
});

test('rollback includes all writes and failure does not poison following transactions', async () => {
  const store = new MemoryMetadataStore();
  store.failNextCommit();
  await assert.rejects(store.transaction(async tx => {
    await tx.create('jobs', 'job', { state: 'RESERVED' });
    await tx.create('ledger', 'reserve', { jobId: 'job' });
  }), { code: 'DATABASE_UNAVAILABLE' });
  assert.deepEqual(store.snapshot(), {});
  const domainError = new Error('synthetic domain failure');
  await assert.rejects(store.transaction(async tx => {
    await tx.create('jobs', 'job', { state: 'RESERVED' });
    throw domainError;
  }), error => error === domainError);
  assert.deepEqual(store.snapshot(), {});
  await store.transaction(tx => tx.create('jobs', 'job', { state: 'RESERVED' }));
  await assert.rejects(store.transaction(tx => tx.create('jobs', 'job', {})), { code: 'ALREADY_EXISTS' });
  assert.equal((await store.get('jobs', 'job')).state, 'RESERVED');
});

test('reads are isolated, uncommitted writes stay invisible and transaction capability expires', async () => {
  const store = new MemoryMetadataStore();
  let captured;
  const data = { nested: { count: 1 } };
  await store.transaction(async tx => {
    captured = tx;
    await tx.create('jobs', 'job', data);
    data.nested.count = 5;
    assert.equal(await store.get('jobs', 'job'), null);
    assert.equal((await tx.get('jobs', 'job')).nested.count, 1);
  });
  const read = await store.get('jobs', 'job');
  read.nested.count = 9;
  assert.equal((await store.get('jobs', 'job')).nested.count, 1);
  await assert.rejects(captured.set('jobs', 'late', {}), { code: 'TRANSACTION_CLOSED' });
});

test('bounded metadata pagination applies owner filter and stable cursor', async () => {
  const store = new MemoryMetadataStore();
  await store.transaction(async tx => {
    for (const [id, owner] of [['b', 'me'], ['a', 'other'], ['d', 'me'], ['c', 'me']]) {
      await tx.set('jobs', id, { owner });
    }
  });
  assert.deepEqual((await store.list('jobs', { where: { owner: 'me' }, limit: 2 })).map(x => x.id), ['b', 'c']);
  assert.deepEqual((await store.list('jobs', { where: { owner: 'me' }, afterId: 'c', limit: 2 })).map(x => x.id), ['d']);
  await assert.rejects(store.list('jobs', { limit: 101 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(store.list('jobs', { where: { '_id': 'x' } }), { code: 'INVALID_ARGUMENT' });
});

test('metadata rejects non-JSON values instead of silently losing or coercing fields', async () => {
  const store = new MemoryMetadataStore();
  const cycle = {}; cycle.self = cycle;
  for (const invalid of [{ value: undefined }, { value: Infinity }, { value: new Date() }, cycle,
    JSON.parse('{"__proto__": {"owner":"attacker"}}'), { value: [, 1] }, { _id: 'spoof' }]) {
    await assert.rejects(store.transaction(tx => tx.set('jobs', 'job', invalid)), { code: 'INVALID_ARGUMENT' });
  }
  assert.deepEqual(store.snapshot(), {});
});

test('metadata rejects serialization hooks and hidden array fields without invoking them', async () => {
  const store = new MemoryMetadataStore();
  let invoked = false;
  const getter = Object.defineProperty({}, 'owner', {
    enumerable: true, get() { invoked = true; return 'owner'; },
  });
  const hook = Object.defineProperty({}, 'toJSON', {
    value() { invoked = true; return { owner: 'changed' }; },
  });
  const array = ['known']; array.owner = 'silently-lost';
  const arrayGetter = Object.defineProperty([], '0', {
    enumerable: true, get() { invoked = true; return 'owner'; },
  });
  for (const invalid of [getter, hook, { items: array }, { items: arrayGetter },
    Object.defineProperty({}, 'owner', { value: 'silently-lost' })]) {
    await assert.rejects(store.transaction(tx => tx.set('jobs', 'job', invalid)), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(invoked, false);
  assert.deepEqual(store.snapshot(), {});
});

test('private storage copies buffers and validates candidate paths', async () => {
  const files = new MemoryPrivateStorage();
  const source = Buffer.from('%PDF-synthetic');
  const fileId = await files.put('jobs/job_1/attempt_1.pdf', source);
  source[0] = 0;
  const received = await files.read(fileId);
  assert.equal(received[0], 37);
  received[0] = 0;
  assert.equal((await files.read(fileId))[0], 37);
  await assert.rejects(files.put('../public.pdf', source), { code: 'INVALID_ARGUMENT' });
  await files.remove(fileId);
  await files.remove(fileId);
  await assert.rejects(files.read(fileId), { code: 'NOT_FOUND' });
});

test('trusted context requires matching app and ignores identities from event objects', () => {
  const sdk = { getWXContext: () => ({ OPENID: 'trusted_subject', APPID: 'expected_app' }) };
  const identity = new CloudBaseIdentityProvider(sdk, 'expected_app');
  assert.deepEqual(identity.current({ OPENID: 'spoof', userId: 'admin' }), { subject: 'trusted_subject', appId: 'expected_app' });
  assert.throws(() => new CloudBaseIdentityProvider(sdk, 'other_app').current(), { code: 'UNAUTHENTICATED' });
  assert.throws(() => new CloudBaseIdentityProvider({ getWXContext: () => ({}) }, 'expected_app').current(), { code: 'UNAUTHENTICATED' });
  assert.throws(() => new StaticIdentityProvider(null).current(), { code: 'UNAUTHENTICATED' });
});

test('environment selection is explicit and rejects development/production overlap', () => {
  const config = { stage: 'development', developmentEnvironmentId: 'dev_example', productionEnvironmentId: 'prod_example', appId: 'app_example' };
  assert.deepEqual(selectCloudEnvironment(config), { env: 'dev_example', appId: 'app_example' });
  assert.equal(selectCloudEnvironment({ ...config, stage: 'production' }).env, 'prod_example');
  assert.throws(() => selectCloudEnvironment({ ...config, productionEnvironmentId: 'dev_example' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => selectCloudEnvironment({ ...config, stage: 'unknown' }), { code: 'INVALID_ARGUMENT' });
});

test('execution does not resolve before work completes and clock never moves backwards', async () => {
  const clock = new ManualClock(1000);
  clock.advance(50);
  assert.equal(clock.now(), 1050);
  assert.throws(() => clock.advance(-1), { code: 'INVALID_ARGUMENT' });
  let finish;
  let returned = false;
  const execution = new AwaitedExecutionBridge().invoke('transient', async input => {
    await new Promise(resolve => { finish = resolve; });
    return input.length;
  }).then(result => { returned = true; return result; });
  await Promise.resolve();
  assert.equal(returned, false);
  finish();
  assert.equal(await execution, 9);
});
