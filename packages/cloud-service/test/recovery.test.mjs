import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryService } from '../dist/index.js';
import { failJobInTransaction } from '../dist/jobs.js';
import { cleanupCandidate } from '../dist/artifacts.js';
import { executionFixture, deferred, pdfFixture } from './execution-fixture.mjs';

const policy = { pageSize: 20, maxRecordsPerRun: 100, maxRunMs: 10000, maxCandidateBytes: 1000000, maxReadBytesPerRun: 5000000 };
const makeRecovery = (f, override = {}) => createRecoveryService({ store: f.store, storage: f.storage, clock: f.clock, crypto: f.crypto }, { ...policy, ...override });
async function stageCandidate(f) {
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) throw new Error('injected commit failure'); };
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.hooks.beforeCommit = undefined;
  return (await f.service.findJobByRequest(request.requestId)).jobId;
}
async function stageUnclaimed(f) {
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.executionClaimed)) throw new Error('injected claim failure'); };
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.hooks.beforeCommit = undefined;
  return (await f.service.findJobByRequest(request.requestId)).jobId;
}
async function drain(recovery, limit = 100) {
  const reports = [];
  for (let i = 0; i < limit; i++) { const report = await recovery.runSweep(); reports.push(report); if (report.cycleComplete) return reports; }
  assert.fail('sweep never completed');
}
const balance = async f => { const a = await f.service.getAccount(); return [a.available, a.reserved]; };

test('metadata-only recovery verifies an uploaded candidate and consumes once without any renderer capability', async () => {
  const f = await executionFixture(); const jobId = await stageCandidate(f); const calls = { ...f.counts };
  const recovery = makeRecovery(f);
  const result = await recovery.recoverJob(jobId);
  assert.equal(result.outcome, 'reconciled'); assert.equal(result.status, 'SUCCEEDED');
  assert.equal((await recovery.recoverJob(jobId)).outcome, 'terminal');
  await drain(recovery); await drain(recovery);
  assert.equal(f.counts.render, calls.render); assert.equal(f.counts.prepare, calls.prepare); assert.equal(f.counts.upload, calls.upload);
  assert.deepEqual(await balance(f), [19, 0]); assert.equal(f.backend.fileIds().length, 1);
  assert.deepEqual(Object.keys(result).sort(), ['jobId', 'outcome', 'reason', 'status']);
});

test('RESERVED and GENERATING without files remain pending then atomically time out and release', async () => {
  for (const status of ['RESERVED', 'GENERATING']) {
    const f = await executionFixture(); const jobId = await stageUnclaimed(f);
    await f.store.transaction(async tx => { const job = await tx.get('generation_jobs', jobId); await tx.set('generation_jobs', jobId, { ...job, status }); });
    const recovery = makeRecovery(f);
    assert.equal((await recovery.recoverJob(jobId)).outcome, 'pending'); assert.deepEqual(await balance(f), [19, 1]);
    f.clock.advance(60000);
    const result = await recovery.recoverJob(jobId); assert.equal(result.status, 'FAILED'); assert.equal((await f.job()).errorCode, 'EXECUTION_TIMEOUT');
    await recovery.recoverJob(jobId); await drain(recovery); assert.deepEqual(await balance(f), [20, 0]); assert.equal(f.counts.render, 0);
  }
});

test('missing, temporary read errors and corrupt candidate bytes do not refund before trusted deadline', async () => {
  for (const fault of ['missing', 'unavailable', 'invalid']) {
    const f = await executionFixture(); const jobId = await stageCandidate(f), candidate = await f.candidate();
    if (fault === 'missing') await f.backend.remove(candidate.fileId);
    if (fault === 'unavailable') f.hooks.beforeRead = () => { throw new Error('private provider error'); };
    if (fault === 'invalid') { const bytes = pdfFixture(); bytes[10] ^= 1; await f.backend.put(candidate.path, bytes); }
    const recovery = makeRecovery(f); const result = await recovery.recoverJob(jobId);
    assert.equal(result.outcome, 'pending'); assert.equal(result.status, 'GENERATING'); assert.deepEqual(await balance(f), [19, 1]);
    assert.equal(JSON.stringify(result).includes('provider'), false);
    f.clock.advance(60000); await drain(recovery);
    assert.equal((await f.job()).status, 'FAILED'); assert.deepEqual(await balance(f), [20, 0]); assert.deepEqual(f.backend.fileIds(), []);
  }
});

test('an expired complete PDF cannot revive a task and is cleaned without reading it', async () => {
  const f = await executionFixture(); const jobId = await stageCandidate(f); const reads = f.counts.read;
  f.clock.advance(60000); await drain(makeRecovery(f, { maxCandidateBytes: 16, maxReadBytesPerRun: 16 }));
  assert.equal((await f.store.get('generation_jobs', jobId)).status, 'FAILED'); assert.equal(f.counts.read, reads);
  assert.deepEqual(f.backend.fileIds(), []); assert.deepEqual(await balance(f), [20, 0]);
});

test('a live oversized candidate is deferred and can succeed after maintenance read capacity is corrected', async () => {
  const f = await executionFixture(); const jobId = await stageCandidate(f); const reads = f.counts.read;
  const small = makeRecovery(f, { maxCandidateBytes: 16, maxReadBytesPerRun: 16 });
  const result = await small.recoverJob(jobId); assert.equal(result.reason, 'READ_LIMIT'); assert.equal(f.counts.read, reads);
  const report = await small.runSweep(); assert.equal(report.retryableRecords, 1); assert.equal(report.cycleComplete, true);
  assert.deepEqual(await balance(f), [19, 1]);
  assert.equal((await makeRecovery(f).recoverJob(jobId)).status, 'SUCCEEDED'); assert.deepEqual(await balance(f), [19, 0]);
});

test('deadline and competing terminal transitions are rechecked after PDF read', async () => {
  for (const race of ['timeout', 'failure', 'success']) {
    const f = await executionFixture(); const jobId = await stageCandidate(f);
    let once = true;
    f.hooks.afterRead = async () => {
      if (!once) return; once = false;
      if (race === 'timeout') f.clock.advance(60000);
      if (race === 'failure') { const job = await f.job(); await f.store.transaction(tx => failJobInTransaction(tx, jobId, job.batchId, f.clock.now(), 'EXECUTION_FAILED')); }
      if (race === 'success') await makeRecovery(f).recoverJob(jobId);
    };
    await makeRecovery(f).recoverJob(jobId); await drain(makeRecovery(f));
    assert.equal((await f.job()).status, race === 'success' ? 'SUCCEEDED' : 'FAILED');
    assert.deepEqual(await balance(f), race === 'success' ? [19, 0] : [20, 0]);
    assert.equal(f.backend.fileIds().length, race === 'success' ? 1 : 0);
  }
});

test('simultaneous recovery runs settle once and a losing checkpoint cannot roll progress backward', async () => {
  const f = await executionFixture(); await stageCandidate(f);
  const entered = deferred(), release = deferred(); let first = true;
  f.hooks.beforeRead = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
  const slow = makeRecovery(f).runSweep(); await entered.promise;
  const fast = await makeRecovery(f).runSweep(); release.resolve(); const last = await slow;
  assert.equal(fast.checkpointSaved, true); assert.equal(last.checkpointSaved, false);
  assert.deepEqual(last.nextCursor, fast.nextCursor); assert.equal((await f.store.get('maintenance_cursors', 'recovery_v1')).revision, 1);
  assert.deepEqual(await balance(f), [19, 0]);
  const ledger = await f.store.list('credit_ledger', { where: { operation: 'CONSUME' } }); assert.equal(ledger.length, 1);
});

test('failed and deleted candidate tombstones are swept again after late upload while successful files stay protected', async () => {
  const f = await executionFixture(); await stageCandidate(f); f.clock.advance(60000);
  const recovery = makeRecovery(f); await drain(recovery);
  const candidate = await f.candidate(); assert.equal(candidate.state, 'deleted');
  await f.backend.put(candidate.path, pdfFixture()); assert.equal(f.backend.fileIds().length, 1);
  const reports = await drain(recovery); assert.ok(reports.some(report => report.cleanedCandidates > 0));
  assert.deepEqual(f.backend.fileIds(), []); assert.equal(f.counts.render, 1); assert.deepEqual(await balance(f), [20, 0]);
});

test('old-batch and orphan candidates are cleaned without touching a live current batch reservation', async () => {
  for (const orphan of [false, true]) {
    const f = await executionFixture(); const jobId = await stageCandidate(f);
    await f.store.transaction(async tx => {
      const job = await tx.get('generation_jobs', jobId);
      if (orphan) await tx.delete('generation_jobs', jobId);
      else await tx.set('generation_jobs', jobId, { ...job, batchId: `x_${f.crypto.randomId()}`, candidatePath: null });
    });
    await drain(makeRecovery(f)); assert.deepEqual(f.backend.fileIds(), []);
    assert.deepEqual(await balance(f), [19, 1]); // This test never invents a release basis for a missing job/new live batch.
  }
});

test('delete I/O failures report retryable and a later sweep resumes the deleting tombstone', async () => {
  const f = await executionFixture(); await stageCandidate(f); f.clock.advance(60000);
  f.hooks.beforeRemove = () => { throw new Error('delete unavailable'); };
  const report = await makeRecovery(f).runSweep(); assert.equal(report.retryableRecords, 1); assert.equal((await f.candidate()).state, 'deleting');
  f.hooks.beforeRemove = undefined; await drain(makeRecovery(f)); assert.equal((await f.candidate()).state, 'deleted');
  assert.deepEqual(f.backend.fileIds(), []); assert.deepEqual(await balance(f), [20, 0]);
});

test('corrupt candidate location cannot cause unrelated storage deletion and reports a safe error', async () => {
  const f = await executionFixture(); await stageCandidate(f); f.clock.advance(60000);
  const other = await f.backend.put('unrelated/result.pdf', pdfFixture());
  await f.store.transaction(async tx => { const candidate = await f.candidate(); await tx.set('pdf_candidates', candidate.candidateId, { ...candidate, fileId: other }); });
  const report = await makeRecovery(f).runSweep(); assert.equal(report.recordErrors, 1);
  assert.ok(f.backend.fileIds().includes(other)); assert.equal(f.counts.remove, 0);
});

test('pagination visits more than 100 jobs across restarts, including both unfinished phases', async () => {
  const f = await executionFixture({ monthlyFreeCredits: 200, policy: { maxConcurrentJobs: 200, maxStartsPerWindow: 200 } });
  for (let i = 0; i < 107; i++) { const id = await stageUnclaimed(f);
    if (i % 2 === 0) await f.store.transaction(async tx => { const job = await tx.get('generation_jobs', id); await tx.set('generation_jobs', id, { ...job, status: 'RESERVED' }); });
  }
  f.clock.advance(60000);
  const reports = [];
  for (let i = 0; i < 20; i++) {
    const report = await makeRecovery(f, { pageSize: 7, maxRecordsPerRun: 13 }).runSweep(); reports.push(report);
    assert.ok(report.visitedJobs + report.visitedCandidates <= 13);
    if (report.cycleComplete) break;
  }
  assert.equal(reports.at(-1).cycleComplete, true); assert.equal(reports.reduce((sum, report) => sum + report.visitedJobs, 0), 107);
  assert.deepEqual(await balance(f), [200, 0]); assert.equal((await f.store.list('generation_jobs', { where: { status: 'RESERVED' } })).length, 0);
  assert.equal((await f.store.list('generation_jobs', { where: { status: 'GENERATING' } })).length, 0);
});

test('read budget stops before an unread candidate and persisted cursor resumes it on the next invocation', async () => {
  const f = await executionFixture(); await stageCandidate(f); await stageCandidate(f);
  const bytes = pdfFixture().length;
  const recovery = makeRecovery(f, { maxCandidateBytes: bytes, maxReadBytesPerRun: bytes });
  const first = await recovery.runSweep(); assert.equal(first.expectedReadBytes, bytes); assert.equal(first.visitedJobs, 1); assert.equal(first.cycleComplete, false);
  const second = await recovery.runSweep(); assert.equal(second.expectedReadBytes, bytes); assert.equal(second.reconciledJobs, 1);
  assert.deepEqual(await balance(f), [18, 0]); await drain(recovery);
});

test('soft time budget finishes an in-flight record before checkpointing and leaves the next record for later', async () => {
  const f = await executionFixture(); await stageUnclaimed(f); await stageUnclaimed(f); f.clock.advance(60000);
  const get = f.store.get; let advancing = true;
  f.store.get = async (...args) => { if (advancing && args[0] === 'generation_jobs') f.clock.advance(6); return get(...args); };
  const recovery = makeRecovery(f, { maxRunMs: 5 });
  const first = await recovery.runSweep(); assert.equal(first.visitedJobs, 1); assert.equal(first.cycleComplete, false);
  assert.equal(first.reconciledJobs, 1); assert.equal(first.finishedAt - first.startedAt, 6);
  assert.deepEqual(await balance(f), [19, 1]);
  advancing = false; await drain(recovery); assert.deepEqual(await balance(f), [20, 0]);
});

test('checkpoint commit failure safely repeats durable work and single-record errors do not block later jobs', async () => {
  const f = await executionFixture(); const one = await stageCandidate(f); const two = await stageCandidate(f);
  let checkpointFault = true;
  f.hooks.beforeCommit = writes => { if (checkpointFault && writes.some(w => w.collection === 'maintenance_cursors')) throw new Error('private checkpoint fault'); };
  await assert.rejects(makeRecovery(f).runSweep(), error => error.code === 'INTERNAL_ERROR' && error.message === 'INTERNAL_ERROR');
  assert.equal(await f.store.get('maintenance_cursors', 'recovery_v1'), null); assert.deepEqual(await balance(f), [18, 0]);
  checkpointFault = false; await drain(makeRecovery(f)); assert.equal(f.counts.render, 2);
  assert.equal((await f.store.get('generation_jobs', one)).status, 'SUCCEEDED'); assert.equal((await f.store.get('generation_jobs', two)).status, 'SUCCEEDED');
});

test('a record read error is counted and retried next cycle while later records still progress', async () => {
  const f = await executionFixture(); const bad = await stageUnclaimed(f); await stageUnclaimed(f); f.clock.advance(60000);
  const original = f.store.get; let broken = true;
  f.store.get = async (collection, id) => { if (broken && collection === 'generation_jobs' && id === bad) throw new Error('private outage'); return original(collection, id); };
  const report = await makeRecovery(f).runSweep(); assert.equal(report.recordErrors, 1); assert.equal(report.reconciledJobs, 1);
  assert.equal(report.cycleComplete, true); broken = false; await drain(makeRecovery(f)); assert.deepEqual(await balance(f), [20, 0]);
});

test('list failure does not claim a complete scan or advance the checkpoint', async () => {
  const f = await executionFixture(); f.store.list = async () => { throw new Error('provider includes credential'); };
  await assert.rejects(makeRecovery(f).runSweep(), error => error.code === 'INTERNAL_ERROR' && !error.message.includes('credential'));
  assert.equal(await f.store.get('maintenance_cursors', 'recovery_v1'), null);
});

test('configuration is explicit and snapshotted, bad checkpoints and IDs fail safely', async () => {
  const f = await executionFixture();
  for (const override of [{ pageSize: 101 }, { maxRecordsPerRun: 1001 }, { maxRunMs: 0 }, { maxReadBytesPerRun: 1 }, { maxCandidateBytes: NaN }])
    assert.throws(() => makeRecovery(f, override), { code: 'INVALID_CONFIG' });
  assert.throws(() => createRecoveryService(f.runnerDeps, {}), { code: 'INVALID_CONFIG' });
  const config = { ...policy, maxRecordsPerRun: 1 }, recovery = createRecoveryService(f.runnerDeps, config); config.maxRecordsPerRun = 500;
  await stageUnclaimed(f); await stageUnclaimed(f); assert.equal((await recovery.runSweep()).visitedJobs, 1);
  await assert.rejects(recovery.recoverJob('../file'), { code: 'INVALID_ARGUMENT' });
  assert.equal((await recovery.recoverJob(`j_${f.crypto.randomId()}`)).outcome, 'missing');
  await f.store.transaction(tx => tx.set('maintenance_cursors', 'recovery_v1', { schemaVersion: 1, revision: 1, phase: 'unknown', afterId: null, updatedAt: f.clock.now() }));
  await assert.rejects(recovery.runSweep(), { code: 'INTERNAL_ERROR' });
});

test('invalid stored task statuses never escape the safe recovery result or change credits', async () => {
  const f = await executionFixture(); const jobId = await stageUnclaimed(f);
  const job = await f.job(), calls = { ...f.counts };
  for (const status of ['private article or credential', { body: 'private article' }, 1, null]) {
    await f.store.transaction(tx => tx.set('generation_jobs', jobId, { ...job, status }));
    const result = await makeRecovery(f).recoverJob(jobId);
    assert.deepEqual(result, { jobId, status: null, outcome: 'retryable', reason: 'OPERATION_FAILED' });
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(await balance(f), [19, 1]);
  }
  assert.equal(f.counts.render, calls.render); assert.equal(f.counts.read, calls.read); assert.equal(f.counts.remove, calls.remove);
});

test('checkpoint commit acknowledgment loss resumes the saved position instead of restarting it', async () => {
  const f = await executionFixture(); await stageUnclaimed(f); await stageUnclaimed(f); f.clock.advance(60000);
  let once = true;
  f.hooks.afterCommit = writes => { if (once && writes.some(w => w.collection === 'maintenance_cursors')) { once = false; throw new Error('ack lost'); } };
  const recovery = makeRecovery(f, { maxRecordsPerRun: 1 });
  await assert.rejects(recovery.runSweep(), { code: 'INTERNAL_ERROR' });
  const checkpoint = await f.store.get('maintenance_cursors', 'recovery_v1'); assert.equal(checkpoint.revision, 1); assert.ok(checkpoint.afterId);
  const second = await recovery.runSweep(); assert.equal(second.reconciledJobs, 1);
  await drain(recovery); assert.deepEqual(await balance(f), [20, 0]);
});

test('records inserted behind a saved cursor are covered by the next complete cycle', async () => {
  const f = await executionFixture(); let sequence = 0;
  f.crypto.randomId = () => `ffffffff-ffff-4fff-8fff-${String(++sequence).padStart(12, '0')}`;
  await stageUnclaimed(f); await stageUnclaimed(f);
  const recovery = makeRecovery(f, { maxRecordsPerRun: 1 }); const first = await recovery.runSweep();
  assert.ok(first.nextCursor.afterId);
  f.crypto.randomId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const newId = await stageUnclaimed(f); assert.ok(newId < first.nextCursor.afterId);
  f.clock.advance(60000); await drain(recovery);
  assert.equal((await f.store.get('generation_jobs', newId)).status, 'GENERATING');
  await drain(recovery); assert.deepEqual(await balance(f), [20, 0]);
});
