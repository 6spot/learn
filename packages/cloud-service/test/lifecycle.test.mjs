import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudService, createLifecycleService, createRecoveryService } from '../dist/index.js';
import { historyId } from '../dist/history.js';
import { LifecycleRecords } from '../dist/lifecycle-records.js';
import { executionFixture, deferred } from './execution-fixture.mjs';

const day = 86400000;
const lifecycle = { pageSize: 19, maxRecordsPerRun: 1000, maxRunMs: 60000, maxWindowTtlMs: 3600000,
  lateIoProtectionMs: 60000, deletionProtectionMs: 300000, ledgerRetentionMs: 90 * day,
  activityRetentionMs: 7 * day, auditRetentionMs: day, inactiveUserRetentionMs: 90 * day };
async function fixture(overrides = {}) {
  const f = await executionFixture();
  const config = { ...f.config, adminUserIds: [f.userId], lifecycle: { ...lifecycle, ...overrides },
    stats: { coverageStartDate: '2026-10-01', pageSize: 25, maxScanRecords: 10000, maxRunMs: 60000 } };
  const service = new CloudService(f.dependencies, config);
  const maintenance = () => createLifecycleService({ store: f.store, storage: f.storage, clock: f.clock, crypto: f.crypto }, config);
  const put = (collection, id, value) => f.base.transaction(tx => tx.set(collection, id, value));
  async function cycle(limit = 300) {
    const results = [];
    for (let n = 0; n < limit; n++) {
      const result = await maintenance().runSweep(); results.push(result);
      if (result.cycleComplete) return results;
    }
    throw new Error('fixture maintenance failed to finish bounded cycle');
  }
  return { ...f, config, service, maintenance, put, cycle };
}
async function rows(f, collection) { return f.base.list(collection, { limit: 100 }); }
const userKey = n => `u_${n.toString(16).padStart(64, '0')}`;
function assertSafeReport(report) {
  const text = JSON.stringify(report);
  for (const forbidden of ['u_', 'j_', 'private:', 'fingerprint', 'private body', 'private title', 'requestId']) assert.ok(!text.includes(forbidden));
}
async function advanceToReuse(f) {
  const status = await f.service.getDeletionStatus();
  f.clock.advance(Math.max(0, status.earliestReuseAt - f.clock.now()));
}

test('T23 privacy/status authenticate without creating accounts and deletion requires explicit data confirmation', async () => {
  const f = await fixture();
  const deps = { ...f.dependencies, identity: { current: () => ({ subject: 'new-private-subject', appId: 'trusted-app' }) } };
  const service = new CloudService(deps, f.config);
  const before = (await rows(f, 'users')).length;
  assert.equal((await service.getPrivacyInfo()).deletion.state, 'none');
  assert.equal((await service.getDeletionStatus()).state, 'none');
  assert.equal((await service.deleteMyData({ confirm: true })).state, 'none');
  assert.equal((await rows(f, 'users')).length, before);
  for (const value of [null, {}, { confirm: false }, { confirm: true, userId: f.userId }, { get confirm() { throw new Error('private body'); } }]) {
    await assert.rejects(f.service.deleteMyData(value), { code: 'INVALID_ARGUMENT' });
  }
  const noIdentity = new CloudService({ ...deps, identity: { current: () => ({ subject: '', appId: '' }) } }, f.config);
  for (const action of ['getPrivacyInfo', 'getDeletionStatus']) await assert.rejects(noIdentity[action](), { code: 'UNAUTHENTICATED' });
  const info = await f.service.getPrivacyInfo();
  assert.equal(info.retention.pdfMs, 7 * day);
  assert.equal(info.retention.ledgerMs, 90 * day);
  assertSafeReport(info);
});

test('T23 repeated deletion immediately revokes all user capabilities and preserves current-month protection', async () => {
  const f = await fixture();
  const request = await f.request(), submitted = await f.service.submitGeneration(request);
  await f.service.readPdfChunk({ jobId: submitted.job.jobId, offset: 0 });
  const first = await f.service.deleteMyData({ confirm: true });
  assert.equal(first.state, 'deleting');
  assert.equal(first.earliestReuseAt, Date.parse('2026-10-31T16:00:00Z'));
  assert.deepEqual(await f.service.deleteMyData({ confirm: true }), first);
  for (const attempt of [() => f.service.getAccount(), () => f.service.getSubmissionWindow(), () => f.service.submitGeneration(request),
    () => f.service.findJobByRequest(request.requestId), () => f.service.listJobs(), () => f.service.getJob(submitted.job.jobId),
    () => f.service.getPdfInfo(submitted.job.jobId), () => f.service.readPdfChunk({ jobId: submitted.job.jobId, offset: 0 })]) {
    await assert.rejects(attempt(), { code: 'ACCOUNT_DELETING' });
  }
  assert.equal((await f.base.get('credit_accounts', f.userId)).available, 19);
  const before = f.base.snapshot();
  await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'deleting');
  assert.equal((await f.base.get('generation_jobs', submitted.job.jobId)).status, 'SUCCEEDED');
  assert.equal((await f.base.get('generation_jobs', submitted.job.jobId)).fileId, null);
  assert.equal((await rows(f, 'credit_ledger')).filter(x => x.value.operation === 'CONSUME').length, 1);
  assert.ok(before.users[f.userId]);
});

test('T23 complete finite deletion removes old individual facts and permits one new next-month grant', async () => {
  const f = await fixture();
  const request = await f.request();
  const submitted = await f.service.submitGeneration(request);
  const candidate = await f.candidate();
  await f.service.deleteMyData({ confirm: true });
  await f.cycle();
  const tombstone = (await rows(f, 'generation_requests'))[0].value;
  assert.deepEqual(Object.keys(tombstone).sort(), ['createdAt', 'deleted', 'jobId', 'requestId', 'retainUntil', 'userId', 'windowExpiresAt']);
  await advanceToReuse(f);
  await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
  assert.equal((await f.service.getPrivacyInfo()).deletion.state, 'none');
  await assert.rejects(f.backend.read(candidate.fileId), { code: 'NOT_FOUND' });
  assert.ok(!JSON.stringify(f.base.snapshot()).includes(f.userId));
  assert.equal(await f.base.get('generation_jobs', submitted.job.jobId), null);
  const account = await f.service.getAccount();
  assert.equal(account.period, '2026-11'); assert.equal(account.available, 20);
  assert.equal((await f.service.getAccount()).available, 20);
  await assert.rejects(f.service.submitGeneration(request), { code: 'REQUEST_EXPIRED' });
  assert.equal((await f.service.getAccount()).available, 20);
});

test('T23 admitted in-flight job still settles once after deletion; pending reservation blocks cleanup', async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  f.hooks.render = async () => { entered.resolve(); await release.promise; return new TextEncoder().encode('%PDF-1.7\nprivate body\n%%EOF\n'); };
  const pending = f.service.submitGeneration(await f.request());
  await entered.promise;
  await f.service.deleteMyData({ confirm: true });
  await f.cycle();
  assert.equal((await f.base.get('credit_accounts', f.userId)).reserved, 1);
  assert.equal((await rows(f, 'credit_reservations'))[0].value.state, 'pending');
  assert.equal((await rows(f, 'generation_requests'))[0].value.fingerprint, undefined);
  release.resolve();
  const result = await pending;
  assert.equal(result.job.status, 'SUCCEEDED');
  assert.equal((await f.base.get('credit_accounts', f.userId)).reserved, 0);
  assert.equal((await rows(f, 'credit_ledger')).filter(x => x.value.operation === 'CONSUME').length, 1);
  await advanceToReuse(f); await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
});

test('T23 a deleted user pending job times out under recovery before its protection is released', async () => {
  const f = await fixture();
  f.hooks.beforeUpload = () => { throw new Error('transient storage failure'); };
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  await f.service.deleteMyData({ confirm: true });
  await advanceToReuse(f); await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'deleting');
  const recovery = createRecoveryService({ store: f.store, storage: f.storage, clock: f.clock, crypto: f.crypto },
    { pageSize: 30, maxRecordsPerRun: 100, maxRunMs: 60000, maxCandidateBytes: 1000000, maxReadBytesPerRun: 1000000 });
  await recovery.runSweep();
  assert.equal((await rows(f, 'generation_jobs'))[0].value.status, 'FAILED');
  f.clock.advance(lifecycle.deletionProtectionMs);
  await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
});

test('T23 signed-window issuance rechecks deletion after awaited signing, and late admission cannot reserve', async () => {
  const f = await fixture();
  const gate = deferred(), entered = deferred();
  const crypto = { ...f.crypto, async hmacSha256(key, value) {
    if (key === 'window') { entered.resolve(); await gate.promise; }
    return f.crypto.hmacSha256(key, value);
  } };
  const service = new CloudService({ ...f.dependencies, crypto }, f.config);
  const pending = service.getSubmissionWindow(); await entered.promise;
  await f.service.deleteMyData({ confirm: true }); gate.resolve();
  await assert.rejects(pending, { code: 'ACCOUNT_DELETING' });
  assert.equal((await rows(f, 'generation_jobs')).length, 0);
});

test('T23 final file authorization rejects bytes read before a concurrent deletion', async () => {
  const f = await fixture();
  const submitted = await f.service.submitGeneration(await f.request());
  f.hooks.afterRead = async (_id, bytes) => { await f.service.deleteMyData({ confirm: true }); return bytes; };
  await assert.rejects(f.service.readPdfChunk({ jobId: submitted.job.jobId, offset: 0 }), { code: 'ACCOUNT_DISABLED' });
});

test('T23 natural PDF expiry revokes the reference and deletes object without changing success or credits', async () => {
  const f = await fixture();
  const submitted = await f.service.submitGeneration(await f.request());
  const candidate = await f.candidate();
  f.clock.advance(7 * day);
  const reports = await f.cycle(); reports.forEach(assertSafeReport);
  const job = await f.base.get('generation_jobs', submitted.job.jobId);
  assert.equal(job.status, 'SUCCEEDED'); assert.equal(job.fileId, null);
  assert.equal((await f.service.getJob(job.jobId)).delivery, 'expired');
  await assert.rejects(f.backend.read(candidate.fileId), { code: 'NOT_FOUND' });
  assert.equal((await f.service.getAccount()).available, 19);
  assert.equal((await rows(f, 'credit_ledger')).filter(x => x.value.operation === 'CONSUME').length, 1);
});

test('T23 unknown storage deletion preserves retryable metadata; later success allows complete cleanup', async () => {
  const f = await fixture();
  await f.service.submitGeneration(await f.request());
  const candidate = await f.candidate();
  await f.service.deleteMyData({ confirm: true });
  f.hooks.afterRemove = () => { throw new Error('private body provider response lost'); };
  await advanceToReuse(f);
  const reports = await f.cycle();
  assert.ok(reports.some(x => x.retryableRecords > 0 && x.alerts.includes('CLEANUP_RETRY')));
  assert.equal((await f.service.getDeletionStatus()).state, 'deleting');
  assert.equal((await f.base.get('pdf_candidates', candidate.candidateId)).state, 'deleting');
  f.hooks.afterRemove = undefined;
  await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
});

test('T23 tombstones re-delete late uploads until the explicit I/O protection boundary', async () => {
  const f = await fixture({ lateIoProtectionMs: day });
  await f.service.submitGeneration(await f.request());
  const candidate = await f.candidate(), bytes = await f.backend.read(candidate.fileId);
  await f.service.deleteMyData({ confirm: true });
  await f.cycle();
  assert.equal((await f.base.get('pdf_candidates', candidate.candidateId)).state, 'deleted');
  await f.backend.put(candidate.path, bytes);
  await f.cycle();
  await assert.rejects(f.backend.read(candidate.fileId), { code: 'NOT_FOUND' });
  assert.ok(await f.base.get('pdf_candidates', candidate.candidateId));
  await advanceToReuse(f); await f.cycle();
  assert.equal(await f.base.get('pdf_candidates', candidate.candidateId), null);
});

test('T23 record expiry scrubs fingerprints and removes job/history together; old request never regenerates', async () => {
  const f = await fixture();
  const request = await f.request(), result = await f.service.submitGeneration(request);
  const job = await f.job();
  f.clock.advance(30 * day); await f.service.getAccount(); await f.cycle();
  assert.equal(await f.base.get('generation_jobs', job.jobId), null);
  assert.equal(await f.base.get('generation_history', historyId(job.createdAt, job.jobId)), null);
  assert.equal((await rows(f, 'generation_requests'))[0].value.fingerprint, undefined);
  await assert.rejects(f.service.submitGeneration(request), { code: 'RECORD_EXPIRED' });
  f.clock.advance(61 * day); await f.service.getAccount(); await f.cycle();
  assert.equal((await rows(f, 'generation_requests')).length, 0);
  await assert.rejects(f.service.submitGeneration(request), { code: 'REQUEST_EXPIRED' });
  assert.equal(f.counts.render, 1);
  assert.ok(result.job.jobId);
});

test('T23 old missing history is backfilled once and orphan indexes are removed', async () => {
  const f = await fixture();
  await f.service.submitGeneration(await f.request());
  const job = await f.job(), id = historyId(job.createdAt, job.jobId);
  await f.base.transaction(tx => tx.delete('generation_history', id));
  const report = await f.maintenance().runSweep();
  assert.equal(report.indexedJobs, 1);
  assert.equal((await f.service.listJobs()).items.length, 1);
  assert.equal((await f.maintenance().runSweep()).indexedJobs, 0);
  const orphan = { userId: f.userId, jobId: 'j_11111111-0000-4000-8000-000000000000', createdAt: job.createdAt };
  const orphanId = historyId(orphan.createdAt, orphan.jobId);
  await f.put('generation_history', orphanId, orphan);
  await f.cycle(); assert.equal(await f.base.get('generation_history', orphanId), null);
});

test('T23 terminal cleanup counts only records that still exist when history is missing', async () => {
  const f = await fixture();
  f.hooks.render = async () => { throw new Error('render failed'); };
  await f.service.submitGeneration(await f.request());
  const job = await f.job();
  await f.base.transaction(tx => tx.delete('generation_history', historyId(job.createdAt, job.jobId)));
  f.clock.advance(30 * day);
  const work = new LifecycleRecords(f.dependencies, f.config);
  const report = await work.jobs({ id: job.jobId, value: job });
  assert.equal(report.deletedRecords, 2); // The job and its released preset-use record.
  assert.equal(await f.base.get('generation_jobs', job.jobId), null);
  assert.equal(await f.base.get('preset_uses', job.jobId), null);
  assert.deepEqual(await work.jobs({ id: job.jobId, value: job }), {});
});

test('T23 batches over 100 records resume from durable cursors across service instances', async () => {
  const f = await fixture({ pageSize: 13, maxRecordsPerRun: 17 });
  await f.base.transaction(async tx => {
    for (let n = 1; n <= 127; n++) {
      const userId = userKey(n);
      await tx.create('daily_activity', `${userId}_20261001`, { userId, date: '2026-10-01', firstEventAt: Date.parse('2026-10-01T00:00:00Z'), firstEvent: 'generation' });
    }
  });
  const results = await f.cycle();
  assert.ok(results.length > 7);
  assert.ok(results.every(x => x.visitedRecords <= 17));
  assert.ok(results.some(x => x.budgetExhausted));
  assert.equal((await rows(f, 'daily_activity')).length, 0);
  results.forEach(assertSafeReport);
});

test('T23 soft budget waits for current deletion and saves a safe resumable checkpoint', async () => {
  const f = await fixture({ maxRunMs: 5 });
  await f.service.submitGeneration(await f.request());
  await f.service.deleteMyData({ confirm: true });
  f.hooks.afterRemove = () => { f.clock.advance(10); };
  const first = await f.maintenance().runSweep();
  assert.equal(first.removedFiles, 1); assert.equal(first.budgetExhausted, true); assert.equal(first.checkpointSaved, true);
  assert.equal((await f.candidate()).state, 'deleted');
  f.hooks.afterRemove = undefined;
  await advanceToReuse(f); await f.cycle(); await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
});

test('T23 cleanup failure can replay, concurrent checkpoint writers cannot roll progress backward', async () => {
  const f = await fixture({ maxRecordsPerRun: 2 });
  const reports = await Promise.all([f.maintenance().runSweep(), f.maintenance().runSweep()]);
  assert.equal(reports.filter(x => x.checkpointSaved).length, 1);
  await f.cycle();
  let fail = true;
  f.hooks.beforeCommit = writes => {
    if (fail && writes.some(x => x.collection === 'maintenance_cursors' && x.id === 'lifecycle_v1')) { fail = false; throw new Error('private body'); }
  };
  await assert.rejects(f.maintenance().runSweep(), { code: 'INTERNAL_ERROR' });
  await f.cycle();
});

test('T23 corrupt file binding cannot remove an unrelated object and only safe telemetry escapes', async () => {
  const f = await fixture();
  await f.service.submitGeneration(await f.request());
  const candidate = await f.candidate();
  await f.put('pdf_candidates', candidate.candidateId, { ...candidate, fileId: 'private:unrelated/private.pdf' });
  await f.service.deleteMyData({ confirm: true }); await advanceToReuse(f);
  const reports = await f.cycle();
  assert.ok(reports.some(x => x.recordErrors > 0 && x.alerts.includes('CLEANUP_ERROR')));
  assert.ok(await f.backend.read(candidate.fileId));
  assert.equal((await f.service.getDeletionStatus()).state, 'deleting');
  reports.forEach(assertSafeReport);
});

test('T23 natural inactivity and finite audit retention use configured bounds', async () => {
  const f = await fixture({ inactiveUserRetentionMs: day, auditRetentionMs: 40 * day });
  f.clock.advance(day);
  await f.cycle();
  let status = await f.service.getDeletionStatus();
  assert.equal(status.state, 'deleting');
  assert.equal(status.earliestReuseAt, Date.parse('2026-11-20T00:00:00Z'));
  await advanceToReuse(f); await f.cycle();
  assert.equal((await f.service.getDeletionStatus()).state, 'none');
});

test('T23 deletion covers source gaps without keeping individual statistics or old publishers', async () => {
  const f = await fixture();
  await f.service.submitGeneration(await f.request());
  await f.service.deleteMyData({ confirm: true }); await advanceToReuse(f); await f.cycle();
  const snapshot = f.base.snapshot();
  assert.ok(!JSON.stringify(snapshot).includes(f.userId));
  assert.ok(Object.values(snapshot.preset_versions).every(x => x.publishedBy === null));
  assert.ok(Object.values(snapshot.stats_coverage_gaps).every(x => Object.keys(x).every(k => ['source', 'date', 'reason', 'markedAt'].includes(k))));
  assert.ok(snapshot.stats_coverage.state.revision > 0);
});

test('T23 configuration is explicit, immutable and rejects unsafe historical window caps', async () => {
  const f = await fixture();
  for (const overrides of [{ pageSize: 101 }, { maxRecordsPerRun: 1001 }, { maxWindowTtlMs: 1 }, { lateIoProtectionMs: 0 }, { auditRetentionMs: -1 }]) {
    assert.throws(() => new CloudService(f.dependencies, { ...f.config, lifecycle: { ...lifecycle, ...overrides } }), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => new CloudService(f.dependencies, { ...f.config, generation: undefined }), { code: 'INVALID_CONFIG' });
  const service = new CloudService(f.dependencies, { ...f.config, lifecycle: undefined });
  await assert.rejects(service.getPrivacyInfo(), { code: 'PRIVACY_UNAVAILABLE' });
  await assert.rejects(service.deleteMyData({ confirm: true }), { code: 'PRIVACY_UNAVAILABLE' });
  const instance = f.maintenance(); f.config.lifecycle.pageSize = 10000;
  assert.equal((await instance.runSweep()).recordErrors, 0);
});

test('T23 repeated and concurrent deletion sweeps count a logical removed candidate only once', async () => {
  const f = await fixture({ lateIoProtectionMs: day });
  await f.service.submitGeneration(await f.request());
  const candidate = await f.candidate();
  await f.service.deleteMyData({ confirm: true });
  const reports = await Promise.all([f.maintenance().runSweep(), f.maintenance().runSweep()]);
  assert.equal(reports.reduce((sum, x) => sum + x.removedFiles, 0), 1);
  assert.equal(reports.reduce((sum, x) => sum + x.removedFileBytes, 0), candidate.bytes);
  const again = await f.cycle();
  assert.equal(again.reduce((sum, x) => sum + x.removedFiles, 0), 0);
  assert.equal(again.reduce((sum, x) => sum + x.removedFileBytes, 0), 0);
});

test('T23 deleting one user preserves another user’s private file, quota and records', async () => {
  const f = await fixture();
  const { createRequestId } = await import('../dist/index.js');
  const other = new CloudService({ ...f.dependencies, identity: { current: () => ({ subject: 'other-user', appId: 'trusted-app' }) } }, f.config);
  const otherAccount = await other.getAccount();
  const own = await f.service.submitGeneration(await f.request());
  const otherRequest = await f.request();
  otherRequest.requestId = createRequestId((await other.getSubmissionWindow()).windowId, f.crypto.randomId());
  const theirs = await other.submitGeneration(otherRequest);
  await f.service.deleteMyData({ confirm: true }); await f.cycle();
  assert.equal((await f.base.get('generation_jobs', own.job.jobId)).fileId, null);
  const otherJob = await f.base.get('generation_jobs', theirs.job.jobId);
  assert.ok(otherJob.fileId); assert.ok(await f.backend.read(otherJob.fileId));
  assert.equal((await other.listJobs()).items.length, 1);
  assert.equal((await other.getAccount()).available, otherAccount.available - 1);
  assert.equal((await other.getDeletionStatus()).state, 'active');
});

test('T23 request lookup rechecks account after a deletion races its metadata read', async () => {
  const f = await fixture();
  const request = await f.request(); await f.service.submitGeneration(request);
  const get = f.store.get;
  let once = true;
  f.store.get = async (collection, id) => {
    const value = await get(collection, id);
    if (once && collection === 'generation_requests') { once = false; await f.service.deleteMyData({ confirm: true }); }
    return value;
  };
  await assert.rejects(f.service.findJobByRequest(request.requestId), { code: 'ACCOUNT_DELETING' });
});

test('T23 an unused request lookup rechecks account after a deletion races its metadata read', async () => {
  const f = await fixture();
  const request = await f.request();
  const get = f.store.get;
  let once = true;
  f.store.get = async (collection, id) => {
    const value = await get(collection, id);
    if (once && collection === 'generation_requests') { once = false; await f.service.deleteMyData({ confirm: true }); }
    return value;
  };
  await assert.rejects(f.service.findJobByRequest(request.requestId), { code: 'ACCOUNT_DELETING' });
  assert.equal((await rows(f, 'generation_jobs')).length, 0);
  assert.equal((await rows(f, 'credit_reservations')).length, 0);
});

test('T23 late administrative mutation cannot recreate publisher/audit after deletion', async () => {
  const f = await fixture();
  const gate = deferred(), entered = deferred();
  const resources = { ...f.dependencies.resources, async readFontBytes(...args) {
    entered.resolve(); await gate.promise; return f.dependencies.resources.readFontBytes(...args);
  } };
  const service = new CloudService({ ...f.dependencies, resources }, f.config);
  const request = await f.request();
  const pending = service.activatePreset(request.versions); await entered.promise;
  await f.service.deleteMyData({ confirm: true }); gate.resolve();
  await assert.rejects(pending, { code: 'ACCOUNT_DISABLED' });
  assert.equal((await rows(f, 'admin_audit_logs')).length, 2);
});

test('T23 natural credit cleanup preserves the active bucket and original-month settlement invariants', async () => {
  const f = await fixture({ ledgerRetentionMs: day });
  await f.service.submitGeneration(await f.request());
  const old = await f.base.get('credit_accounts', f.userId);
  f.clock.advance(35 * day);
  const account = await f.service.getAccount();
  await f.cycle(); await f.cycle();
  assert.equal(await f.base.get('credit_buckets', old.bucketId), null);
  const current = await f.base.get('credit_accounts', f.userId);
  assert.equal((await f.base.get('credit_buckets', current.bucketId)).available, account.available);
  assert.equal((await f.service.getAccount()).available, 20);
});

test('T23 list errors do not claim a complete cycle or advance the durable checkpoint', async () => {
  const f = await fixture();
  const list = f.store.list;
  f.store.list = async () => { throw new Error('private body provider failure'); };
  await assert.rejects(f.maintenance().runSweep(), { code: 'INTERNAL_ERROR' });
  assert.equal(await f.base.get('maintenance_cursors', 'lifecycle_v1'), null);
  f.store.list = list;
  assert.equal((await f.maintenance().runSweep()).cycleComplete, true);
});
