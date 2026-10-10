import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeError, SimulatedExecutionBridge } from '@learn/cloud-runtime';
import { cleanupCandidate, settleCandidate, verifyCandidate } from '../dist/artifacts.js';
import { failJobInTransaction } from '../dist/jobs.js';
import { createGenerationExecutor } from '../dist/index.js';
import { executionFixture, deferred, pdfFixture } from './execution-fixture.mjs';

async function fail(f, code = 'EXECUTION_FAILED') {
  const job = await f.job();
  return f.store.transaction(tx => failJobInTransaction(tx, job.jobId, job.batchId, f.clock.now(), code));
}
async function assertBalance(f, success) {
  const account = await f.service.getAccount();
  assert.equal(account.available, success ? 19 : 20); assert.equal(account.reserved, 0);
  const settled = (await f.store.list('credit_ledger')).filter(row => ['CONSUME', 'RELEASE'].includes(row.value.operation));
  assert.equal(settled.length, 1); assert.equal(settled[0].value.operation, success ? 'CONSUME' : 'RELEASE');
  const refs = await f.store.list('preset_uses');
  assert.equal(refs.length, 1); assert.equal(refs[0].value.state, 'released');
  assert.equal((await f.store.list('preset_states'))[0].value.references, 0);
}

test('actual executor registers exact candidate before upload and atomically succeeds once', async () => {
  const f = await executionFixture();
  f.hooks.beforeUpload = async (path, bytes) => {
    const candidate = await f.candidate(), job = await f.job();
    assert.equal(candidate.path, path); assert.equal(job.candidatePath, path);
    assert.equal(candidate.sha256, await f.crypto.sha256(bytes)); assert.equal(candidate.bytes, bytes.length);
    assert.equal(candidate.state, 'pending'); assert.equal(job.fileId, null);
    assert.equal((await f.service.getAccount()).reserved, 1);
  };
  const request = await f.request();
  const response = await f.service.submitGeneration(request);
  assert.equal(response.job.status, 'SUCCEEDED'); assert.equal((await f.candidate()).state, 'committed');
  assert.deepEqual(await f.backend.read((await f.job()).fileId), pdfFixture());
  await Promise.all(Array.from({ length: 8 }, () => f.runner.execute(f.execution())));
  await f.service.submitGeneration(request);
  assert.equal(f.counts.render, 1); assert.equal(f.counts.upload, 1); assert.equal(f.counts.remove, 0);
  await assertBalance(f, true);
});

test('second callback during rendering neither renders nor uploads again; submit still awaits first', async () => {
  const f = await executionFixture(); const entered = deferred(), release = deferred();
  f.hooks.render = async () => { entered.resolve(); await release.promise; return pdfFixture(); };
  let returned = false;
  const submit = f.service.submitGeneration(await f.request()).then(value => { returned = true; return value; });
  await entered.promise; await f.runner.execute(f.execution()); assert.equal(returned, false); assert.equal(f.counts.render, 1);
  release.resolve(); assert.equal((await submit).job.status, 'SUCCEEDED'); await assertBalance(f, true);
});

test('renderer errors, partial bytes and over-limit PDFs fail safely before upload', async () => {
  for (const [render, code] of [
    [async () => { throw new Error('private article or credential'); }, 'EXECUTION_FAILED'],
    [async () => new Uint8Array([1, 2]), 'PDF_INVALID'],
    [async () => { throw { code: 'PDF_RESOURCE_LIMIT', private: 'article' }; }, 'PDF_RESOURCE_LIMIT'],
    [async () => { throw { code: 'PDF_RESOURCE_MISMATCH' }; }, 'RESOURCE_UNAVAILABLE'],
    [async () => pdfFixture(), 'PDF_RESOURCE_LIMIT'],
  ]) {
    const f = await executionFixture({ policy: { maxPdfBytes: 32 } }); f.hooks.render = render;
    const result = await f.service.submitGeneration(await f.request());
    assert.equal(result.job.status, 'FAILED'); assert.equal(result.job.errorCode, code);
    assert.equal(f.counts.upload, 0); assert.equal(await f.candidate(), undefined); await assertBalance(f, false);
    assert.equal(JSON.stringify(f.base.snapshot()).includes('private article'), false);
  }
});

test('bridge confirmed before-start fails/releases; lost bridge response finds committed success', async () => {
  for (const fault of ['before-start', 'response-lost']) {
    const f = await executionFixture({ bridge: new SimulatedExecutionBridge(fault) });
    const result = await f.service.submitGeneration(await f.request());
    assert.equal(result.job.status, fault === 'before-start' ? 'FAILED' : 'SUCCEEDED');
    assert.equal(f.counts.render, fault === 'before-start' ? 0 : 1); await assertBalance(f, fault !== 'before-start');
  }
});

test('candidate registration failure never uploads and leaves metadata-only pending recovery', async () => {
  const f = await executionFixture();
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'pdf_candidates')) throw new Error('db unavailable'); };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal(f.counts.upload, 0); assert.equal(await f.candidate(), undefined); assert.equal((await f.job()).status, 'GENERATING');
  f.hooks.beforeCommit = undefined; f.clock.advance(60000); await fail(f, 'EXECUTION_TIMEOUT'); await assertBalance(f, false);
});

test('lost execution-claim acknowledgment never renders on retry and expires without consuming credit', async () => {
  let execution;
  const bridge = { async invoke(input, work) { execution = input; await work(input); } };
  const f = await executionFixture({ bridge }); let once = true;
  f.hooks.afterCommit = writes => {
    if (once && writes.some(w => w.collection === 'generation_jobs' && w.value.executionClaimed)) {
      once = false; throw new Error('claim acknowledgment lost');
    }
  };
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal((await f.job()).executionClaimed, true);
  assert.equal((await f.job()).status, 'GENERATING');
  assert.equal((await f.service.getAccount()).reserved, 1);
  await f.runner.execute(execution);
  assert.equal((await f.service.submitGeneration(request)).submission, 'pending');
  assert.equal(f.counts.prepare, 1); assert.equal(f.counts.render, 0); assert.equal(f.counts.upload, 0);
  assert.equal(await f.candidate(), undefined);
  f.clock.advance(60000); await fail(f, 'EXECUTION_TIMEOUT');
  assert.equal((await f.service.submitGeneration(request)).job.status, 'FAILED');
  assert.deepEqual(f.backend.fileIds(), []); await assertBalance(f, false);
});

test('upload acknowledgment loss is recovered from the preregistered deterministic path', async () => {
  const f = await executionFixture(); f.hooks.afterUpload = () => { throw new Error('response lost'); };
  const result = await f.service.submitGeneration(await f.request());
  assert.equal(result.job.status, 'SUCCEEDED'); assert.equal(f.counts.upload, 1); await assertBalance(f, true);
});

test('upload failure or temporary read failure never fabricates failure or re-executes', async () => {
  for (const phase of ['beforeUpload', 'beforeRead']) {
    const f = await executionFixture(); f.hooks[phase] = () => { throw new RuntimeError('STORAGE_UNAVAILABLE'); };
    const request = await f.request();
    await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
    assert.equal((await f.job()).status, 'GENERATING'); assert.equal((await f.candidate()).state, 'pending');
    assert.equal((await f.service.getAccount()).reserved, 1);
    assert.equal((await f.service.submitGeneration(request)).submission, 'pending'); assert.equal(f.counts.render, 1);
    assert.equal(f.counts.remove, 0);
  }
});

test('corrupted stored PDF fails/releases and removes only its candidate', async () => {
  const f = await executionFixture();
  f.hooks.afterUpload = async () => { const c = await f.candidate(); const wrong = pdfFixture(); wrong[12] ^= 1; await f.backend.put(c.path, wrong); };
  const result = await f.service.submitGeneration(await f.request());
  assert.equal(result.job.errorCode, 'PDF_INVALID'); assert.equal((await f.candidate()).state, 'deleted');
  assert.deepEqual(f.backend.fileIds(), []); await assertBalance(f, false);
});

test('upload success then commit failure preserves PDF for metadata-only verification and settlement', async () => {
  const f = await executionFixture(); let once = true;
  f.hooks.beforeCommit = writes => { if (once && writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) {
    once = false; throw new Error('commit failure');
  } };
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  const candidate = await f.candidate(); assert.equal(candidate.state, 'pending'); assert.equal(f.backend.fileIds().length, 1);
  assert.equal((await f.service.getAccount()).reserved, 1);
  assert.equal(await verifyCandidate(f.runnerDeps, candidate), 'valid');
  await settleCandidate(f.runnerDeps, candidate);
  assert.equal((await f.service.submitGeneration(request)).job.status, 'SUCCEEDED'); assert.equal(f.counts.render, 1);
  await assertBalance(f, true);
});

test('commit acknowledgment loss returns the durable success and never removes its file', async () => {
  const f = await executionFixture(); let once = true;
  f.hooks.afterCommit = writes => { if (once && writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) {
    once = false; throw new Error('ack lost');
  } };
  assert.equal((await f.service.submitGeneration(await f.request())).job.status, 'SUCCEEDED');
  assert.equal(f.backend.fileIds().length, 1); assert.equal(f.counts.remove, 0); await assertBalance(f, true);
});

test('deadline reached during render prevents upload; during upload rejects success and cleans late PDF', async () => {
  for (const phase of ['render', 'afterUpload']) {
    const f = await executionFixture(); f.hooks[phase] = () => { f.clock.advance(60000); return pdfFixture(); };
    const result = await f.service.submitGeneration(await f.request()); assert.equal(result.job.errorCode, 'EXECUTION_TIMEOUT');
    assert.equal(f.counts.upload, phase === 'render' ? 0 : 1); assert.deepEqual(f.backend.fileIds(), []); await assertBalance(f, false);
  }
});

test('competing failure cannot be reversed by late upload; cleanup-before-upload is safely repeated', async () => {
  const f = await executionFixture(); const entered = deferred(), release = deferred();
  f.hooks.beforeUpload = async () => { entered.resolve(); await release.promise; };
  const submit = f.service.submitGeneration(await f.request()); await entered.promise;
  const candidate = await f.candidate(); await fail(f);
  assert.equal(await cleanupCandidate(f.runnerDeps, candidate.candidateId), true);
  assert.equal((await f.candidate()).state, 'deleted');
  release.resolve(); assert.equal((await submit).job.status, 'FAILED'); assert.equal(f.counts.remove, 2);
  assert.deepEqual(f.backend.fileIds(), []); await assertBalance(f, false);
});

test('cleanup cannot claim a live candidate or delete a successful reference; late timeout stays succeeded', async () => {
  const f = await executionFixture();
  f.hooks.afterUpload = async () => { assert.equal(await cleanupCandidate(f.runnerDeps, (await f.candidate()).candidateId), false); };
  await f.service.submitGeneration(await f.request());
  f.clock.advance(60000); await fail(f, 'EXECUTION_TIMEOUT');
  assert.equal(await cleanupCandidate(f.runnerDeps, (await f.candidate()).candidateId), false);
  assert.equal((await f.job()).status, 'SUCCEEDED'); assert.equal(f.backend.fileIds().length, 1); await assertBalance(f, true);
});

test('obsolete batch upload cannot settle the current batch and only its obsolete candidate is removed', async () => {
  const f = await executionFixture();
  f.hooks.afterUpload = async () => { const job = await f.job(); await f.store.transaction(tx => tx.set('generation_jobs', job.jobId,
    { ...job, batchId: `x_${f.crypto.randomId()}`, candidatePath: null, executionClaimed: false })); };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal((await f.job()).status, 'GENERATING'); assert.equal((await f.service.getAccount()).reserved, 1);
  assert.deepEqual(f.backend.fileIds(), []); assert.equal((await f.candidate()).state, 'deleted');
});

test('deletion failure retains a retryable claim without changing failed settlement', async () => {
  const f = await executionFixture();
  f.hooks.afterUpload = () => { f.clock.advance(60000); };
  f.hooks.beforeRemove = () => { throw new RuntimeError('STORAGE_UNAVAILABLE'); };
  assert.equal((await f.service.submitGeneration(await f.request())).job.status, 'FAILED');
  const candidate = await f.candidate(); assert.equal(candidate.state, 'deleting'); assert.equal(f.backend.fileIds().length, 1);
  f.hooks.beforeRemove = undefined;
  assert.equal(await cleanupCandidate(f.runnerDeps, candidate.candidateId), true);
  assert.equal((await f.candidate()).state, 'deleted'); assert.deepEqual(f.backend.fileIds(), []); await assertBalance(f, false);
});


test('a duplicate bridge that never starts cannot fail another already running invocation', async () => {
  const f = await executionFixture(); const entered = deferred(), release = deferred();
  f.hooks.render = async () => { entered.resolve(); await release.promise; return pdfFixture(); };
  const submit = f.service.submitGeneration(await f.request()); await entered.promise;
  const duplicate = createGenerationExecutor({ ...f.runnerDeps, bridge: new SimulatedExecutionBridge('before-start') }, f.config);
  await duplicate.execute(f.execution());
  assert.equal((await f.job()).status, 'GENERATING'); assert.equal((await f.service.getAccount()).reserved, 1);
  release.resolve(); assert.equal((await submit).job.status, 'SUCCEEDED'); await assertBalance(f, true);
});

test('a bridge error after entry cannot invent a pre-start failure and refund', async () => {
  const bridge = { async invoke(input, work) { await work(input); throw new RuntimeError('EXECUTION_NOT_STARTED'); } };
  const f = await executionFixture({ bridge });
  f.hooks.beforeRead = () => { throw new RuntimeError('NOT_FOUND'); };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal((await f.job()).status, 'GENERATING'); assert.equal((await f.service.getAccount()).reserved, 1);
});

test('settlement refuses an already settled reservation under a nonterminal job', async () => {
  const f = await executionFixture();
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) throw new Error('stop'); };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.hooks.beforeCommit = undefined;
  const job = await f.job(), candidate = await f.candidate();
  await f.store.transaction(async tx => { const reservation = await tx.get('credit_reservations', job.jobId);
    await tx.set('credit_reservations', job.jobId, { ...reservation, state: 'consumed' }); });
  await assert.rejects(settleCandidate(f.runnerDeps, candidate), { code: 'INVARIANT_VIOLATION' });
  assert.equal((await f.job()).status, 'GENERATING'); assert.equal((await f.candidate()).state, 'pending');
});

test('an unexpected upload reference is never exposed or blindly deleted and remains recoverable', async () => {
  const f = await executionFixture();
  const originalPut = f.storage.put;
  f.storage.put = async (...args) => { await originalPut(...args); return 'unrelated-private-file'; };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  const candidate = await f.candidate();
  assert.equal(candidate.state, 'pending'); assert.equal(f.counts.remove, 0);
  assert.equal(await verifyCandidate(f.runnerDeps, candidate), 'valid');
  await settleCandidate(f.runnerDeps, candidate); await assertBalance(f, true);
});

test('registration acknowledgment lost prevents upload and its metadata is still recoverable', async () => {
  const f = await executionFixture(); let once = true;
  f.hooks.afterCommit = writes => { if (once && writes.some(w => w.collection === 'pdf_candidates')) {
    once = false; throw new Error('registration ack lost');
  } };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.equal(f.counts.upload, 0); assert.equal((await f.candidate()).state, 'pending');
  assert.equal(await verifyCandidate(f.runnerDeps, await f.candidate()), 'unavailable');
  assert.equal((await f.service.getAccount()).reserved, 1);
  f.clock.advance(60000); await fail(f, 'EXECUTION_TIMEOUT');
  await cleanupCandidate(f.runnerDeps, (await f.candidate()).candidateId); await assertBalance(f, false);
});

test('success and failure transactions race to one immutable settlement and protect any winning PDF', async () => {
  for (const successFirst of [true, false]) {
    const f = await executionFixture(); let block = true;
    f.hooks.beforeCommit = writes => { if (block && writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) throw new Error('defer'); };
    await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
    block = false;
    const candidate = await f.candidate(), job = await f.job();
    const succeed = () => settleCandidate(f.runnerDeps, candidate);
    const failed = () => f.store.transaction(tx => failJobInTransaction(tx, job.jobId, job.batchId, f.clock.now(), 'EXECUTION_FAILED'));
    await Promise.all(successFirst ? [succeed(), failed()] : [failed(), succeed()]);
    await cleanupCandidate(f.runnerDeps, candidate.candidateId);
    assert.equal((await f.job()).status, successFirst ? 'SUCCEEDED' : 'FAILED');
    assert.equal(f.backend.fileIds().length, successFirst ? 1 : 0); await assertBalance(f, successFirst);
  }
});
