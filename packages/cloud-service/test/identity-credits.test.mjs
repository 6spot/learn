import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { MemoryMetadataStore, ManualClock, RuntimeError } from '@learn/cloud-runtime';
import { CloudService } from '../dist/index.js';
import { ensureAccountInTransaction, reserveCreditInTransaction, settleCreditInTransaction } from '../dist/credits.js';
import { quotaPeriod } from '../dist/config.js';

const exampleConfig = { stage: 'development', monthlyFreeCredits: 20, quotaTimeZone: 'Asia/Shanghai',
  identityKeyId: 'identity_local_test_only', adminUserIds: [] };

function fixture(overrides = {}) {
  const store = new MemoryMetadataStore();
  const clock = new ManualClock(Date.parse('2026-10-10T00:00:00Z'));
  let subject = 'synthetic_openid_private';
  let appId = 'synthetic_app';
  const crypto = { hmacSha256: async (keyId, value) => createHmac('sha256', `explicit-test-key-${keyId}`).update(value).digest('hex'),
    randomId: randomUUID };
  const dependencies = { store, clock, crypto, identity: { current: () => {
    if (subject === null) throw new RuntimeError('UNAUTHENTICATED');
    return { subject, appId };
  } } };
  const config = { ...exampleConfig, ...overrides };
  const service = new CloudService(dependencies, config);
  const reserve = (userId, reservationId) => store.transaction(async tx => {
    await ensureAccountInTransaction(tx, userId, clock.now(), service.config);
    return reserveCreditInTransaction(tx, userId, reservationId, clock.now());
  });
  const settle = (userId, reservationId, outcome) => store.transaction(tx =>
    settleCreditInTransaction(tx, userId, reservationId, outcome, clock.now()));
  return { store, clock, crypto, dependencies, service, config, reserve, settle,
    setSubject: value => { subject = value; }, setApp: value => { appId = value; } };
}

async function assertLedgerConservation(store) {
  const entries = await store.list('credit_ledger', { limit: 100 });
  const buckets = await store.list('credit_buckets', { limit: 100 });
  for (const { id, value: bucket } of buckets) {
    const ledger = entries.filter(entry => entry.value.bucketId === id).map(entry => entry.value);
    const sum = field => ledger.reduce((total, row) => total + row[field], 0);
    assert.equal(sum('deltaAvailable'), bucket.available);
    assert.equal(sum('deltaReserved'), bucket.reserved);
    assert.equal(sum('deltaConsumed'), bucket.consumed);
    assert.equal(sum('deltaExpired'), bucket.expired);
    assert.equal(bucket.available + bucket.reserved + bucket.consumed + bucket.expired, bucket.granted);
  }
}

test('concurrent signup grants once and returns only safe account fields', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 40 }, () => f.service.getAccount()));
  assert.ok(responses.every(response => response.userId === responses[0].userId));
  assert.deepEqual(Object.keys(responses[0]).sort(), ['available', 'isAdmin', 'monthlyGrant', 'period', 'periodEndsAt', 'reserved', 'userId']);
  assert.equal(responses[0].available, 20);
  assert.equal(responses[0].isAdmin, false);
  assert.equal((await f.store.list('users')).length, 1);
  assert.equal((await f.store.list('credit_ledger')).length, 1);
  assert.equal(JSON.stringify(f.store.snapshot()).includes('synthetic_openid_private'), false);
  await assertLedgerConservation(f.store);
});

test('identity is read each request and ignores caller-provided role/user/balance', async () => {
  const f = fixture();
  const first = await f.service.getAccount({ userId: 'fake', isAdmin: true, available: 9999 });
  f.setSubject('synthetic_other_user');
  const second = await f.service.getAccount({ userId: first.userId });
  assert.notEqual(second.userId, first.userId);
  assert.equal(second.isAdmin, false);
  assert.equal(second.available, 20);
  f.setApp('other_trusted_app');
  assert.notEqual((await f.service.getAccount()).userId, second.userId);
  f.setSubject(null);
  await assert.rejects(f.service.getAccount({ userId: first.userId }), { code: 'UNAUTHENTICATED' });
  assert.equal((await f.store.list('users')).length, 3);
});

test('admin list is server-owned, frozen and based on internal trusted identity', async () => {
  const f = fixture();
  const current = await f.service.getAccount();
  const config = { ...exampleConfig, adminUserIds: [current.userId] };
  const admin = new CloudService(f.dependencies, config);
  config.adminUserIds.length = 0;
  assert.equal((await admin.getAccount()).isAdmin, true);
  f.setSubject('another_user');
  assert.equal((await admin.getAccount({ userId: current.userId, isAdmin: true })).isAdmin, false);
});

test('production has no implicit free credits or timezone defaults', () => {
  const f = fixture();
  for (const invalid of [{ stage: 'production' }, { ...exampleConfig, monthlyFreeCredits: -1 },
    { ...exampleConfig, monthlyFreeCredits: 1.5 }, { ...exampleConfig, quotaTimeZone: 'UTC' },
    { ...exampleConfig, identityKeyId: '' }, { ...exampleConfig, adminUserIds: ['OPENID'] }]) {
    assert.throws(() => new CloudService(f.dependencies, invalid), { code: 'INVALID_CONFIG' });
  }
  assert.doesNotThrow(() => new CloudService(f.dependencies, { ...exampleConfig, stage: 'production', monthlyFreeCredits: 0 }));
});

test('signup transaction failure creates no partial user, balance or ledger', async () => {
  const f = fixture();
  f.store.failNextCommit();
  await assert.rejects(f.service.getAccount(), { code: 'INTERNAL_ERROR' });
  assert.deepEqual(f.store.snapshot(), {});
  assert.equal((await f.service.getAccount()).available, 20);
});

test('disabled or deleted account cannot receive a new grant', async () => {
  for (const status of ['disabled', 'deleted']) {
    const f = fixture();
    const current = await f.service.getAccount();
    await f.store.transaction(async tx => {
      const user = await tx.get('users', current.userId);
      await tx.set('users', current.userId, { ...user, status });
    });
    f.clock.advance(40 * 24 * 60 * 60 * 1000);
    await assert.rejects(f.service.getAccount(), { code: 'ACCOUNT_DISABLED' });
    assert.equal((await f.store.list('credit_ledger')).length, 1);
  }
});

test('Asia/Shanghai calendar boundaries cover leap year and year transition', () => {
  assert.deepEqual(quotaPeriod(Date.parse('2024-02-29T15:59:59.999Z')),
    { period: '2024-02', endsAt: Date.parse('2024-02-29T16:00:00Z') });
  assert.deepEqual(quotaPeriod(Date.parse('2024-02-29T16:00:00Z')),
    { period: '2024-03', endsAt: Date.parse('2024-03-31T16:00:00Z') });
  assert.equal(quotaPeriod(Date.parse('2026-12-31T16:00:00Z')).period, '2027-01');
});

test('concurrent month rollover expires old available and never grants skipped months', async () => {
  const f = fixture();
  const current = await f.service.getAccount();
  f.clock.advance(Date.parse('2027-02-01T00:00:00Z') - f.clock.now());
  const responses = await Promise.all(Array.from({ length: 40 }, () => f.service.getAccount()));
  assert.ok(responses.every(response => response.period === '2027-02' && response.available === 20));
  const buckets = await f.store.list('credit_buckets');
  assert.equal(buckets.length, 2);
  assert.equal(buckets.find(row => row.value.period === '2026-10').value.expired, 20);
  assert.equal((await f.store.list('credit_ledger')).length, 3);
  assert.equal(responses[0].userId, current.userId);
  await assertLedgerConservation(f.store);
});

test('same-month config change cannot duplicate or top up a grant; next month uses new explicit value', async () => {
  const f = fixture();
  await f.service.getAccount();
  const changed = new CloudService(f.dependencies, { ...exampleConfig, monthlyFreeCredits: 35 });
  assert.equal((await changed.getAccount()).monthlyGrant, 20);
  f.clock.advance(Date.parse('2026-11-01T00:00:00Z') - f.clock.now());
  assert.equal((await changed.getAccount()).monthlyGrant, 35);
  await assertLedgerConservation(f.store);
});

test('concurrent reservations and settlement preserve balance and immutable operation IDs', async () => {
  const f = fixture({ monthlyFreeCredits: 1 });
  const { userId } = await f.service.getAccount();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => f.reserve(userId, `job_${i}`)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const reservation = results.find(result => result.status === 'fulfilled').value;
  await Promise.all(Array.from({ length: 20 }, () => f.reserve(userId, reservation.reservationId)));
  const settlements = await Promise.all([f.settle(userId, reservation.reservationId, 'consumed'), f.settle(userId, reservation.reservationId, 'released')]);
  assert.ok(settlements.every(result => result.state === 'consumed'));
  assert.equal((await f.service.getAccount()).available, 0);
  assert.equal((await f.service.getAccount()).reserved, 0);
  assert.equal((await f.store.list('credit_ledger')).length, 3);
  await assertLedgerConservation(f.store);
});

test('prior-month release expires in its original bucket and never tops up the new month', async () => {
  const f = fixture();
  const { userId } = await f.service.getAccount();
  await f.reserve(userId, 'old_job');
  f.clock.advance(Date.parse('2026-11-01T00:00:00Z') - f.clock.now());
  const next = await f.service.getAccount();
  assert.equal(next.available, 20);
  assert.equal(next.reserved, 1);
  await f.reserve(userId, 'new_job');
  await f.settle(userId, 'old_job', 'released');
  const after = await f.service.getAccount();
  assert.equal(after.available, 19);
  assert.equal(after.reserved, 1);
  const release = await f.store.get('credit_ledger', 'settle_old_job');
  assert.equal(release.deltaAvailable, 0);
  assert.equal(release.deltaExpired, 1);
  await assertLedgerConservation(f.store);
});

test('invalid settlement outcomes cannot remove credits or write a terminal reservation', async () => {
  const f = fixture({ monthlyFreeCredits: 1 });
  const { userId } = await f.service.getAccount();
  await f.reserve(userId, 'job');
  const before = f.store.snapshot();
  for (const outcome of ['failed', 'pending', 'SUCCEEDED', null, undefined]) {
    await assert.rejects(f.settle(userId, 'job', outcome), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual(f.store.snapshot(), before);
  }
  await f.settle(userId, 'job', 'consumed');
  await assertLedgerConservation(f.store);
});

test('old-month settlement before the next account read preserves bucket conservation', async () => {
  const f = fixture({ monthlyFreeCredits: 2 });
  const { userId } = await f.service.getAccount();
  await f.reserve(userId, 'old_job');
  f.clock.advance(Date.parse('2026-11-01T00:00:00Z') - f.clock.now());
  await f.settle(userId, 'old_job', 'released');
  const old = (await f.store.list('credit_buckets'))[0].value;
  assert.equal(old.available, 1);
  assert.equal(old.expired, 1);
  assert.equal(old.reserved, 0);
  const next = await f.service.getAccount();
  assert.equal(next.available, 2);
  assert.equal(next.reserved, 0);
  await assertLedgerConservation(f.store);
});

test('prior-month success consumes original reserved bucket while current grant stays intact', async () => {
  const f = fixture();
  const { userId } = await f.service.getAccount();
  await f.reserve(userId, 'old_job');
  f.clock.advance(Date.parse('2026-11-01T00:00:00Z') - f.clock.now());
  await f.service.getAccount();
  await f.settle(userId, 'old_job', 'consumed');
  assert.equal((await f.service.getAccount()).available, 20);
  const bucket = (await f.store.list('credit_buckets')).find(row => row.value.period === '2026-10').value;
  assert.equal(bucket.consumed, 1);
  assert.equal(bucket.expired, 19);
  await assertLedgerConservation(f.store);
});

test('same-month release restores one credit, cross-user reservation collision and settlement are refused', async () => {
  const f = fixture();
  const first = await f.service.getAccount();
  await f.reserve(first.userId, 'job');
  f.setSubject('other_user');
  const other = await f.service.getAccount();
  await assert.rejects(f.reserve(other.userId, 'job'), { code: 'RESERVATION_CONFLICT' });
  await assert.rejects(f.settle(other.userId, 'job', 'released'), { code: 'NOT_FOUND' });
  await f.settle(first.userId, 'job', 'released');
  assert.equal((await f.store.get('credit_accounts', first.userId)).available, 20);
  await assertLedgerConservation(f.store);
});

test('zero quota is explicit and changing original config cannot mutate service settings', async () => {
  const f = fixture({ monthlyFreeCredits: 0 });
  f.config.monthlyFreeCredits = 999;
  const account = await f.service.getAccount();
  assert.equal(account.available, 0);
  await assert.rejects(f.reserve(account.userId, 'job'), { code: 'QUOTA_EXHAUSTED' });
  await assertLedgerConservation(f.store);
});

test('unknown provider and cryptographic errors never expose raw identity or credentials', async () => {
  const f = fixture();
  f.crypto.hmacSha256 = async () => { throw new Error('synthetic_openid_private secret'); };
  await assert.rejects(f.service.getAccount(), error => error.code === 'INTERNAL_ERROR' && error.message === 'INTERNAL_ERROR' && error.cause === undefined);
  assert.deepEqual(f.store.snapshot(), {});
  f.dependencies.identity.current = () => { throw new Error('synthetic credential'); };
  await assert.rejects(f.service.getAccount(), { message: 'INTERNAL_ERROR' });
});
