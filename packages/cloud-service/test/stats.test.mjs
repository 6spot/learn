import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudService } from '../dist/index.js';
import { advanceStatsCoverageFloorInTransaction, markStatsCoverageGapInTransaction } from '../dist/stats-coverage.js';
import { shanghaiDate, statsPeriod } from '../dist/stats-date.js';
import { executionFixture, deferred } from './execution-fixture.mjs';

const policy = { coverageStartDate: '2026-10-01', pageSize: 31, maxScanRecords: 10000, maxRunMs: 60000 };
const date = '2026-10-11';
const userKey = n => `u_${n.toString(16).padStart(64, '0')}`;
const jobKey = n => `j_${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
async function fixture(overrides = {}) {
  const f = await executionFixture();
  const config = { ...f.config, adminUserIds: [f.userId], stats: { ...policy, ...overrides } };
  const service = new CloudService(f.dependencies, config);
  const put = (collection, id, value) => f.base.transaction(tx => tx.set(collection, id, value));
  return { ...f, service, config, put };
}
const countAudits = async f => (await f.base.list('admin_audit_logs', { where: { action: 'STATS_READ' }, limit: 100 })).length;
function safeResult(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ['u_', 'j_', 'requestId', 'fileId', 'fingerprint', 'private text', 'private title']) assert.ok(!serialized.includes(forbidden));
}

test('T22 aggregates real successful/failed jobs, immutable consumption and deduplicated valid activity', async () => {
  const f = await fixture();
  const request = await f.request();
  const success = await f.service.submitGeneration(request);
  await f.service.submitGeneration(request);
  await f.service.getJob(success.job.jobId);
  await f.service.getPdfInfo(success.job.jobId);
  await f.service.readPdfChunk({ jobId: success.job.jobId, offset: 0 });
  await f.service.readPdfChunk({ jobId: success.job.jobId, offset: 0 });
  f.hooks.render = () => { throw new Error('private text must never escape'); };
  const failure = await f.service.submitGeneration(await f.request());
  assert.equal(failure.job.status, 'FAILED');
  const result = await f.service.getAdminStats();
  assert.deepEqual(result.metrics, { newUsers: 1, dau: 1, succeeded: 1, failed: 1, failureRate: 0.5, creditsConsumed: 1 });
  assert.deepEqual(result.templates.map(x => x.succeeded), [1, 0, 0, 0]);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.date, date);
  assert.equal(result.generatedAt, f.clock.now());
  safeResult(result);
  await f.service.getAdminStats();
  assert.equal((await f.base.list('daily_activity')).length, 1);
  assert.equal(await countAudits(f), 2);
  const audit = (await f.base.list('admin_audit_logs', { where: { action: 'STATS_READ' } }))[0].value;
  assert.deepEqual(Object.keys(audit).sort(), ['action', 'createdAt', 'date', 'userId']);
});

test('T22 zero terminal denominator is null and administrator reads do not create DAU', async () => {
  const f = await fixture();
  await f.service.getAccount();
  await f.service.getCompatibility({ engineVersion: 'unused' });
  const result = await f.service.getAdminStats();
  assert.deepEqual(result.metrics, { newUsers: 1, dau: 0, succeeded: 0, failed: 0, failureRate: null, creditsConsumed: 0 });
});

test('T22 accepted generation counts DAU before preparation and keeps its admission day across midnight and retries', async () => {
  const f = await fixture();
  f.clock.advance(statsPeriod(date).endsAt - f.clock.now() - 5);
  const request = await f.request();
  const entered = deferred(), resume = deferred();
  const prepare = f.dependencies.preparer.prepare;
  f.dependencies.preparer.prepare = async (...args) => {
    entered.resolve();
    await resume.promise;
    return prepare(...args);
  };
  const pending = f.service.submitGeneration(request);
  await entered.promise;
  assert.equal((await f.job()).status, 'RESERVED');
  assert.equal((await f.service.getAdminStats()).metrics.dau, 1);
  f.clock.advance(10);
  resume.resolve();
  assert.equal((await pending).job.status, 'SUCCEEDED');
  await f.service.submitGeneration(request);
  assert.deepEqual((await f.service.getAdminStats()).metrics,
    { newUsers: 0, dau: 0, succeeded: 1, failed: 0, failureRate: 0, creditsConsumed: 1 });
  assert.deepEqual((await f.service.getAdminStats({ date })).metrics,
    { newUsers: 1, dau: 1, succeeded: 0, failed: 0, failureRate: null, creditsConsumed: 0 });
  const activity = await f.base.list('daily_activity');
  assert.equal(activity.length, 1);
  assert.equal(activity[0].value.firstEventAt, statsPeriod(date).endsAt - 5);
});

test('T22 preparation failure preserves accepted DAU while next-day retries create no new activity or consumption', async () => {
  const f = await fixture();
  const request = await f.request();
  f.dependencies.preparer.prepare = async () => { throw new Error('synthetic preparation failure'); };
  assert.equal((await f.service.submitGeneration(request)).job.status, 'FAILED');
  assert.deepEqual((await f.service.getAdminStats()).metrics,
    { newUsers: 1, dau: 1, succeeded: 0, failed: 1, failureRate: 1, creditsConsumed: 0 });
  f.clock.advance(86400000);
  assert.equal((await f.service.submitGeneration(request)).job.status, 'FAILED');
  assert.deepEqual((await f.service.getAdminStats()).metrics,
    { newUsers: 0, dau: 0, succeeded: 0, failed: 0, failureRate: null, creditsConsumed: 0 });
  assert.equal((await f.service.getAdminStats({ date })).metrics.dau, 1);
  assert.equal((await f.base.list('daily_activity')).length, 1);
});

test('T22 failed admission transaction rolls back its activity fact with task and reservation', async () => {
  const f = await fixture();
  const request = await f.request();
  f.hooks.beforeCommit = writes => {
    if (writes.some(write => write.collection === 'generation_jobs')) throw new Error('synthetic admission rollback');
  };
  await assert.rejects(f.service.submitGeneration(request), { code: 'INTERNAL_ERROR' });
  assert.equal((await f.base.list('daily_activity')).length, 0);
  assert.equal((await f.base.list('generation_jobs')).length, 0);
  assert.equal((await f.base.list('credit_reservations')).length, 0);
  assert.equal((await f.service.getAdminStats()).metrics.dau, 0);
});

test('T22 valid PDF start on another Shanghai day creates that day activity; polls do not', async () => {
  const f = await fixture();
  const bytes = new Uint8Array(512 * 1024).fill(32);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
  bytes.set(new TextEncoder().encode('\n%%EOF\n'), bytes.length - 7);
  f.hooks.render = () => bytes;
  const success = await f.service.submitGeneration(await f.request());
  f.clock.advance(86400000);
  await f.service.getJob(success.job.jobId);
  await f.service.getPdfInfo(success.job.jobId);
  assert.equal((await f.service.getAdminStats()).metrics.dau, 0);
  await f.service.readPdfChunk({ jobId: success.job.jobId, offset: 256 * 1024 });
  assert.equal((await f.service.getAdminStats()).metrics.dau, 0);
  await f.service.readPdfChunk({ jobId: success.job.jobId, offset: 0 });
  await f.service.readPdfChunk({ jobId: success.job.jobId, offset: 0 });
  const result = await f.service.getAdminStats();
  assert.equal(result.metrics.dau, 1);
  assert.equal(result.metrics.succeeded, 0);
  assert.equal(result.metrics.creditsConsumed, 0);
});

test('T22 Shanghai midnight boundaries and aggregation cutoff filter each event source', async () => {
  const f = await fixture();
  const { startsAt, endsAt } = statsPeriod(date);
  const times = [startsAt - 1, startsAt, f.clock.now(), f.clock.now() + 1, endsAt];
  await f.base.transaction(async tx => {
    for (const [i, at] of times.entries()) {
      const userId = userKey(i + 1), jobId = jobKey(i + 1);
      await tx.create('users', userId, { userId, createdAt: at, lastActiveAt: at, status: 'active' });
      await tx.create('generation_jobs', jobId, { jobId, userId, status: 'SUCCEEDED', createdAt: at, finishedAt: at,
        versions: { templateId: i === 1 ? 'pinyin-lines' : 'tian-grid' } });
      await tx.create('credit_ledger', `settle_${jobId}`, { userId, bucketId: `${userId}_202610`, operation: 'CONSUME',
        reservationId: jobId, deltaAvailable: 0, deltaReserved: -1, deltaConsumed: 1, deltaExpired: 0, createdAt: at });
      const activityDate = shanghaiDate(at);
      await tx.create('daily_activity', `${userId}_${activityDate.replaceAll('-', '')}`,
        { userId, date: activityDate, firstEventAt: at, firstEvent: 'generation' });
    }
  });
  const result = await f.service.getAdminStats({ date });
  assert.deepEqual(result.metrics, { newUsers: 3, dau: 2, succeeded: 2, failed: 0, failureRate: 0, creditsConsumed: 2 });
  assert.deepEqual(result.templates.map(x => x.succeeded), [0, 1, 0, 1]);
  assert.equal(result.period.startsAt, Date.parse('2026-10-10T16:00:00Z'));
  assert.equal(result.period.endsAt, Date.parse('2026-10-11T16:00:00Z'));
});

test('T22 complete pagination counts over 100 safe rows, excludes unfinished jobs and counts only successful template use', async () => {
  const f = await fixture({ pageSize: 17 });
  await f.base.transaction(async tx => {
    for (let i = 1; i <= 137; i++) {
      const userId = userKey(i), jobId = jobKey(i);
      await tx.create('users', userId, { userId, status: 'active', createdAt: f.clock.now() });
      await tx.create('daily_activity', `${userId}_20261011`, { userId, date, firstEventAt: f.clock.now(), firstEvent: 'generation' });
      await tx.create('generation_jobs', jobId, { jobId, userId, status: i <= 130 ? 'SUCCEEDED' : 'FAILED', createdAt: f.clock.now(),
        finishedAt: f.clock.now(), versions: { templateId: i <= 130 ? 'mi-grid' : 'tian-grid' } });
      await tx.create('credit_ledger', `settle_${jobId}`, { userId, bucketId: `${userId}_202610`, operation: 'CONSUME', reservationId: jobId,
        createdAt: f.clock.now(), deltaAvailable: 0, deltaReserved: -1, deltaConsumed: 1, deltaExpired: 0 });
    }
    await tx.create('generation_jobs', jobKey(200), { jobId: jobKey(200), userId: f.userId, status: 'GENERATING', finishedAt: null });
  });
  const result = await f.service.getAdminStats();
  assert.deepEqual(result.metrics, { newUsers: 138, dau: 137, succeeded: 130, failed: 7, failureRate: 7 / 137, creditsConsumed: 137 });
  assert.deepEqual(result.templates.map(x => x.succeeded), [0, 0, 130, 0]);
  assert.equal(result.scan.recordsRead, 550);
  assert.ok(result.scan.pagesRead > 32);
});

test('T22 exact scan budget succeeds, overflow fails without metrics or successful read audit', async () => {
  const f = await fixture({ pageSize: 1, maxScanRecords: 1 });
  assert.equal((await f.service.getAdminStats()).scan.recordsRead, 1);
  await f.put('users', userKey(1), { userId: userKey(1), status: 'active', createdAt: f.clock.now() });
  await assert.rejects(f.service.getAdminStats(), { code: 'STATS_LIMIT_EXCEEDED' });
  assert.equal(await countAudits(f), 1);
});

test('T22 soft time budget failure, upstream error, and backwards clock never return partial metrics', async () => {
  for (const scenario of ['time', 'error', 'backwards']) {
    const f = await fixture({ maxRunMs: 5 });
    const list = f.store.list;
    f.store.list = async (...args) => {
      if (scenario === 'error') throw new Error('private text and credentials');
      if (scenario === 'time') f.clock.advance(5);
      else { const past = f.clock.now() - 1; f.clock.now = () => past; }
      return list(...args);
    };
    await assert.rejects(f.service.getAdminStats(), { code: scenario === 'time' ? 'STATS_LIMIT_EXCEEDED' : scenario === 'error' ? 'INTERNAL_ERROR' : 'INVARIANT_VIOLATION' });
    assert.equal(await countAudits(f), 0);
  }
});

test('T22 every call authenticates; hidden page or client role cannot grant admin', async () => {
  const f = await fixture();
  const normal = new CloudService(f.dependencies, { ...f.config, adminUserIds: [] });
  await assert.rejects(normal.getAdminStats(), { code: 'FORBIDDEN' });
  await assert.rejects(normal.getAdminStats({ date, isAdmin: true }), { code: 'INVALID_ARGUMENT' });
  const noIdentity = new CloudService({ ...f.dependencies, identity: { current: () => ({ appId: '', subject: '' }) } }, f.config);
  await assert.rejects(noIdentity.getAdminStats(), { code: 'UNAUTHENTICATED' });
  const user = await f.base.get('users', f.userId);
  await f.put('users', f.userId, { ...user, status: 'disabled' });
  await assert.rejects(f.service.getAdminStats(), { code: 'ACCOUNT_DISABLED' });
  assert.equal(await countAudits(f), 0);
});

test('T22 administrator revocation during scan fails final authorization without leaking stats', async () => {
  const f = await fixture();
  const list = f.store.list;
  let changed = false;
  f.store.list = async (...args) => {
    const rows = await list(...args);
    if (!changed) {
      changed = true;
      const user = await f.base.get('users', f.userId);
      await f.put('users', f.userId, { ...user, status: 'deleted' });
    }
    return rows;
  };
  await assert.rejects(f.service.getAdminStats(), { code: 'ACCOUNT_DISABLED' });
  assert.equal(await countAudits(f), 0);
});

test('T22 validated explicit immutable config and strict selected dates', async () => {
  const f = await fixture();
  for (const value of [{}, { pageSize: 0 }, { pageSize: 101 }, { maxScanRecords: 1000001 }, { maxRunMs: 0 }, { coverageStartDate: '2026-02-30' }]) {
    const stats = Object.keys(value).length ? { ...policy, ...value } : value;
    assert.throws(() => new CloudService(f.dependencies, { ...f.config, stats }), { code: 'INVALID_CONFIG' });
  }
  const without = new CloudService(f.dependencies, { ...f.config, stats: undefined });
  await assert.rejects(without.getAdminStats(), { code: 'STATS_UNAVAILABLE' });
  for (const value of [null, [], '2026-10-11', { date: '2026-02-30' }, { date: '2026-1-01' }, { date: '1999-12-31' }, { date: '2026-10-12' }]) {
    await assert.rejects(f.service.getAdminStats(value), { code: 'INVALID_ARGUMENT' });
  }
  f.config.stats.pageSize = 200;
  assert.equal(f.service.config.stats.pageSize, 31);
  assert.equal((await f.service.getAdminStats({ date: '2024-02-29' })).coverage.complete, false);
});

test('T22 request snapshot survives mutation during trusted identity resolution', async () => {
  const f = await fixture();
  const gate = deferred();
  const crypto = { ...f.crypto, async hmacSha256(...args) { await gate.promise; return f.crypto.hmacSha256(...args); } };
  const service = new CloudService({ ...f.dependencies, crypto }, f.config);
  const input = { date: '2026-10-10' };
  const pending = service.getAdminStats(input);
  input.date = '2026-10-12';
  gate.resolve();
  assert.equal((await pending).date, '2026-10-10');
});

test('T22 non-data request properties are rejected without executing getters or serialization hooks', async () => {
  const f = await fixture();
  let calls = 0;
  for (const value of [{ get date() { calls++; return date; } }, { toJSON() { calls++; return { date }; } },
    Object.defineProperty({}, 'date', { value: date, enumerable: false })]) {
    await assert.rejects(f.service.getAdminStats(value), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(calls, 0);
});

test('T22 source floors and account deletion gaps make only affected metrics unavailable', async () => {
  const f = await fixture();
  await f.base.transaction(async tx => {
    await markStatsCoverageGapInTransaction(tx, 'users', date, 'account-deletion', f.clock.now());
    await markStatsCoverageGapInTransaction(tx, 'jobs', date, 'retention', f.clock.now());
    await advanceStatsCoverageFloorInTransaction(tx, 'credits', '2026-10-12');
  });
  const result = await f.service.getAdminStats();
  assert.deepEqual(result.metrics, { newUsers: null, dau: 0, succeeded: null, failed: null, failureRate: null, creditsConsumed: null });
  assert.equal(result.coverage.sourceStarts.credits, '2026-10-12');
  assert.deepEqual(result.coverage.gaps, [{ source: 'users', reason: 'account-deletion' }, { source: 'jobs', reason: 'retention' },
    { source: 'credits', reason: 'before-coverage-start' }]);
  assert.deepEqual(result.templates.map(x => x.succeeded), [null, null, null, null]);
  safeResult(result);
  const before = await f.service.getAdminStats({ date: '2026-09-30' });
  assert.equal(before.coverage.gaps.length, 4);
  assert.equal(before.scan.recordsRead, 0);
});

test('T22 coverage markers are idempotent, floors monotonic, and state contains no individual facts', async () => {
  const f = await fixture();
  await f.base.transaction(tx => markStatsCoverageGapInTransaction(tx, 'users', date, 'account-deletion', f.clock.now()));
  await f.base.transaction(tx => markStatsCoverageGapInTransaction(tx, 'users', date, 'retention', f.clock.now()));
  assert.equal((await f.base.get('stats_coverage', 'state')).revision, 1);
  await f.base.transaction(tx => advanceStatsCoverageFloorInTransaction(tx, 'users', '2026-10-12'));
  await f.base.transaction(tx => advanceStatsCoverageFloorInTransaction(tx, 'users', '2026-10-10'));
  await f.base.transaction(tx => markStatsCoverageGapInTransaction(tx, 'users', '2026-10-09', 'retention', f.clock.now()));
  assert.deepEqual(await f.base.get('stats_coverage', 'state'), { revision: 2, floors: { users: '2026-10-12' } });
  const gap = (await f.base.list('stats_coverage_gaps'))[0].value;
  assert.deepEqual(Object.keys(gap).sort(), ['date', 'markedAt', 'reason', 'source']);
  for (const source of ['private text', null]) await assert.rejects(f.base.transaction(tx =>
    markStatsCoverageGapInTransaction(tx, source, date, 'account-deletion', f.clock.now())), { code: 'INVALID_ARGUMENT' });
});

test('T22 concurrent deletion/floor change invalidates an otherwise complete aggregation', async () => {
  for (const floor of [false, true]) {
    const f = await fixture();
    const list = f.store.list;
    let changed = false;
    f.store.list = async (...args) => {
      const rows = await list(...args);
      if (!changed) {
        changed = true;
        await f.base.transaction(tx => floor ? advanceStatsCoverageFloorInTransaction(tx, 'jobs', '2026-10-12') :
          markStatsCoverageGapInTransaction(tx, 'users', date, 'account-deletion', f.clock.now()));
      }
      return rows;
    };
    await assert.rejects(f.service.getAdminStats(), { code: 'STATS_CHANGED' });
    assert.equal(await countAudits(f), 0);
  }
});

test('T22 corrupted source/coverage metadata fails safely and never echoes stored strings', async () => {
  const cases = [
    ['users', userKey(1), { userId: 'private text', createdAt: 0, status: 'active' }],
    ['daily_activity', `${userKey(1)}_20261011`, { userId: userKey(1), date, firstEventAt: 0, firstEvent: 'generation' }],
    ['generation_jobs', jobKey(1), { jobId: jobKey(1), userId: userKey(1), status: 'SUCCEEDED', finishedAt: null }],
    ['generation_jobs', jobKey(1), { jobId: jobKey(1), userId: userKey(1), status: 'SUCCEEDED', finishedAt: Date.parse('2026-10-11T00:00:00Z'), createdAt: Date.parse('2026-10-11T00:00:00Z'), versions: { templateId: 'private title' } }],
    ['credit_ledger', `settle_${jobKey(1)}`, { operation: 'CONSUME', reservationId: 'private text', userId: userKey(1) }],
    ['stats_coverage', 'state', { revision: 1, floors: { users: 'private text' } }],
    ['stats_coverage_gaps', 'users_20261011', { source: 'users', date, reason: 'private title', markedAt: 0 }],
  ];
  for (const [collection, id, value] of cases) {
    const f = await fixture();
    await f.put(collection, id, value);
    await assert.rejects(f.service.getAdminStats(), error => error.code === 'INVARIANT_VIOLATION' && error.message === 'INVARIANT_VIOLATION');
    assert.equal(await countAudits(f), 0);
  }
});

test('T22 duplicate or out-of-order pagination cannot inflate counts or spin past the scan budget', async () => {
  const f = await fixture({ pageSize: 1 });
  const list = f.store.list;
  f.store.list = (collection, options) => list(collection, { ...options, afterId: undefined });
  await assert.rejects(f.service.getAdminStats(), { code: 'INVARIANT_VIOLATION' });
});
