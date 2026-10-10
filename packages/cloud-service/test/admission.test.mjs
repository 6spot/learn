import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { MemoryMetadataStore, ManualClock, MemoryPrivateStorage } from '@learn/cloud-runtime';
import { buildPageGeometry, createLayoutDigest, getDevelopmentPreset } from '@learn/paper-core';
import { CloudService, createPaperPreparer, createRequestId } from '../dist/index.js';
import { settleCreditInTransaction } from '../dist/credits.js';
import { releasePresetInTransaction } from '../dist/presets.js';
import { failJobInTransaction } from '../dist/jobs.js';

const day = 86400000;
const policy = { windowKeyId: 'window_1', retainedWindowKeyIds: ['window_1'], fingerprintKeyId: 'fingerprint_1',
  retainedFingerprintKeyIds: ['fingerprint_1'], fingerprintVersion: 'learn-request-v1', windowTtlMs: 3600000,
  requestRetentionMs: 90 * day, recordRetentionMs: 30 * day, pdfRetentionMs: 7 * day, jobTimeoutMs: 60000,
  maxInputCodeUnits: 1000, maxGraphemes: 1000, maxPages: 5, maxPdfBytes: 1000000, maxConcurrentJobs: 4,
  rateWindowMs: 60000, maxStartsPerWindow: 10 };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixtureLayout(preset, pageCount = 1) {
  return { versions: preset.versions, mode: 'blank', textStyles: preset.textStyles, strokes: preset.strokes,
    pages: Array.from({ length: pageCount }, () => ({ geometry: buildPageGeometry(preset.geometry), lines: [], slots: [], glyphs: [] })) };
}

async function fixture(overrides = {}) {
  const preset = getDevelopmentPreset('essay-grid');
  const store = new MemoryMetadataStore();
  const storage = new MemoryPrivateStorage();
  const clock = new ManualClock(Date.parse('2026-10-11T00:00:00Z'));
  const font = Buffer.from('synthetic-font-bytes');
  let subject = 'trusted_user';
  let prepareHook = async () => {};
  let executeHook;
  let resourceHook = () => {};
  let prepares = 0, executions = 0;
  const dependencies = { store, clock, identity: { current: () => ({ subject, appId: 'trusted_app' }) },
    crypto: { randomId: randomUUID, sha256: async value => createHash('sha256').update(value).digest('hex'),
      hmacSha256: async (keyId, value) => createHmac('sha256', `explicit-test-only-${keyId}`).update(value).digest('hex') },
    resources: { describeBundle: async version => version === preset.versions.fontBundleVersion ? ({ fontBundleVersion: version,
      fonts: [{ id: 'misans-regular', bytes: font.length, sha256: createHash('sha256').update(font).digest('hex'), fontVersion: 'test.1', location: 'local://test-font' }] }) : null,
      readFontBytes: async () => { resourceHook(); return font; } },
    // T14 tests a real core digest over synthetic empty layout. Actual user-text
    // shaping and PDF rendering are integrated by T07/T15, not claimed here.
    preparer: { prepare: async (input, trusted) => {
      prepares++;
      const override = await prepareHook(input, trusted);
      const layout = fixtureLayout(trusted);
      return override ?? { layout, digest: createLayoutDigest(layout) };
    } },
    executor: { execute: async execution => { executions++; return executeHook(execution); } },
  };
  const config = { stage: 'development', monthlyFreeCredits: 20, quotaTimeZone: 'Asia/Shanghai', identityKeyId: 'identity_test_only',
    adminUserIds: [], registry: { cloudEngineVersions: [preset.versions.engineVersion], clientReadyEngineVersions: [preset.versions.engineVersion] },
    generation: { ...policy, ...overrides } };
  const userId = (await new CloudService(dependencies, config).getAccount()).userId;
  const service = new CloudService(dependencies, { ...config, adminUserIds: [userId] });
  const published = await service.publishPreset(preset);
  await service.activatePreset(preset.versions);

  // Explicit executor fixture: transaction settlement validates the T14 handoff.
  // It does not pretend these synthetic bytes are a validated production PDF.
  const complete = async ({ jobId, batchId }) => {
    const fileId = await storage.put(`jobs/${jobId}/${batchId}.pdf`, Buffer.from('%PDF-synthetic'));
    await store.transaction(async tx => {
      const job = await tx.get('generation_jobs', jobId);
      assert.equal(job.status, 'GENERATING');
      assert.equal(job.batchId, batchId);
      assert.ok(clock.now() < job.deadline);
      await settleCreditInTransaction(tx, userId, jobId, 'consumed', clock.now());
      await releasePresetInTransaction(tx, job.registryId, jobId);
      await tx.set('generation_jobs', jobId, { ...job, status: 'SUCCEEDED', finishedAt: clock.now(),
        fileId, fileBytes: 14, fileSha256: createHash('sha256').update('%PDF-synthetic').digest('hex'), fileExpiresAt: clock.now() + policy.pdfRetentionMs });
    });
  };
  executeHook = complete;
  const request = async (input = {}) => ({ requestId: createRequestId((await service.getSubmissionWindow()).windowId, randomUUID()),
    input: { templateId: 'essay-grid', ...input }, versions: { ...preset.versions }, layoutDigest: createLayoutDigest(fixtureLayout(preset)) });
  return { store, storage, clock, dependencies, config, preset, published, userId, service, request, complete,
    counts: () => ({ prepares, executions }), setSubject: value => { subject = value; },
    setPrepare: fn => { prepareHook = fn; }, setExecute: fn => { executeHook = fn; }, setResourceHook: fn => { resourceHook = fn; },
    newService: generation => new CloudService(dependencies, { ...config, adminUserIds: [userId], generation: { ...config.generation, ...generation } }) };
}

test('full request ID embeds the signed window and a secure UUID; malformed aliases and cross-user windows fail', async () => {
  const f = await fixture();
  const request = await f.request();
  assert.ok(request.requestId.startsWith('r1.w1.window_1.'));
  assert.throws(() => createRequestId(request.requestId.split('.').slice(1, 7).join('.'), 'Math.random'), { code: 'REQUEST_INVALID' });
  const parts = request.requestId.split('.'); parts[3] = `0${parts[3]}`;
  await assert.rejects(f.service.submitGeneration({ ...request, requestId: parts.join('.') }), { code: 'REQUEST_INVALID' });
  f.setSubject('other_user');
  await assert.rejects(f.service.submitGeneration(request), { code: 'REQUEST_INVALID' });
  await assert.rejects(f.service.findJobByRequest(request.requestId), { code: 'REQUEST_INVALID' });
  assert.equal((await f.store.list('generation_jobs')).length, 0);
});

test('input is snapshotted before asynchronous authentication and preserves exact source text', async () => {
  const f = await fixture();
  const request = await f.request({ body: '保留\r\n\r\n  空格 ' });
  const original = structuredClone(request);
  const entered = deferred(), release = deferred();
  const previousHmac = f.dependencies.crypto.hmacSha256;
  let delayed = true;
  f.dependencies.crypto.hmacSha256 = async (...args) => {
    if (delayed) { delayed = false; entered.resolve(); await release.promise; }
    return previousHmac(...args);
  };
  let preparedText;
  f.setPrepare(async input => { preparedText = input.body; });
  const pending = f.service.submitGeneration(request);
  await entered.promise;
  request.input.body = 'changed-after-call';
  request.requestId = 'invalid-after-call';
  release.resolve();
  const result = await pending;
  assert.equal(result.job.requestId, original.requestId);
  assert.equal(preparedText, original.input.body);
  assert.equal((await f.service.submitGeneration(original)).job.jobId, result.job.jobId);
});

test('request snapshot rejects getters, hidden fields and toJSON without executing them', async () => {
  const f = await fixture();
  const request = await f.request();
  let accesses = 0;
  const getter = { templateId: 'essay-grid', get body() { accesses++; return 'private'; } };
  const hidden = { templateId: 'essay-grid' };
  Object.defineProperty(hidden, 'body', { value: 'private', enumerable: false });
  const hook = { templateId: 'essay-grid', toJSON() { accesses++; return {}; } };
  for (const input of [getter, hidden, hook]) await assert.rejects(f.service.submitGeneration({ ...request, input }), { code: 'INVALID_INPUT' });
  assert.equal(accesses, 0);
  assert.equal((await f.store.list('generation_jobs')).length, 0);
});

test('request snapshot cannot turn an inherited array serialization hook into accepted body text', async () => {
  const f = await fixture();
  const request = await f.request();
  let accesses = 0;
  const body = [];
  Object.setPrototypeOf(body, { toJSON() { accesses++; return 'rewritten private body'; } });
  await assert.rejects(f.service.submitGeneration({ ...request, input: { ...request.input, body } }), { code: 'INVALID_INPUT' });
  assert.equal(accesses, 0);
  assert.deepEqual(f.counts(), { prepares: 0, executions: 0 });
  assert.equal((await f.store.list('generation_jobs')).length, 0);
});

test('admission and daily activity work without Object.hasOwn or String.replaceAll', async () => {
  const f = await fixture();
  const request = await f.request();
  const hasOwn = Object.hasOwn;
  const replaceAll = String.prototype.replaceAll;
  try {
    Object.hasOwn = undefined;
    String.prototype.replaceAll = undefined;
    const result = await f.service.submitGeneration(request);
    assert.equal(result.job.status, 'SUCCEEDED');
    assert.equal((await f.service.findJobByRequest(request.requestId)).jobId, result.job.jobId);
    assert.equal((await f.service.submitGeneration(request)).job.jobId, result.job.jobId);
    assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
    const activity = await f.store.list('daily_activity');
    assert.equal(activity.length, 1);
    assert.equal(activity[0].id, `${f.userId}_20261011`);
  } finally {
    Object.hasOwn = hasOwn;
    String.prototype.replaceAll = replaceAll;
  }
});

test('twenty simultaneous duplicate submissions create and prepare/execute exactly once', async () => {
  const f = await fixture();
  const request = await f.request({ title: '私密标题', body: '正文\n\n空 行' });
  const results = await Promise.all(Array.from({ length: 20 }, () => f.service.submitGeneration(request)));
  const ids = new Set(results.map(result => result.job.jobId));
  assert.equal(ids.size, 1);
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
  assert.equal((await f.store.list('generation_requests')).length, 1);
  assert.equal((await f.store.list('credit_reservations')).length, 1);
  assert.equal((await f.service.getAccount()).available, 19);
  const record = (await f.store.list('generation_requests'))[0].value;
  assert.equal(record.fingerprintKeyId, 'fingerprint_1');
  const durable = JSON.stringify(f.store.snapshot());
  for (const secret of ['私密标题', '正文', request.layoutDigest]) assert.equal(durable.includes(secret), false);
  assert.deepEqual(Object.keys((await f.service.findJobByRequest(request.requestId))).sort(),
    ['createdAt', 'errorCode', 'fileExpiresAt', 'finishedAt', 'jobId', 'pageCount', 'requestId', 'startedAt', 'status', 'templateId']);
});

test('pending creator never returns before awaited work; duplicate only reads pending metadata', async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  f.setPrepare(async () => { entered.resolve(); await release.promise; });
  const request = await f.request();
  let returned = false;
  const first = f.service.submitGeneration(request).then(value => { returned = true; return value; });
  await entered.promise;
  const duplicate = await f.service.submitGeneration(request);
  assert.equal(duplicate.submission, 'pending');
  assert.equal(duplicate.job.status, 'RESERVED');
  assert.equal(returned, false);
  assert.equal((await f.store.list('daily_activity')).length, 0);
  release.resolve();
  assert.equal((await first).submission, 'settled');
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
});

test('same ID with any meaningful parameter or text/Unicode difference conflicts; explicit defaults match', async () => {
  const f = await fixture();
  const request = await f.request({ title: '标题', body: 'ü\n\n A ', tracing: false });
  await f.service.submitGeneration(request);
  const changes = [ { title: '标题2' }, { body: 'u\u0308\n\n A ' }, { body: 'ü\r\n\r\n A ' }, { body: 'ü\n A ' },
    { body: 'ü\n\n A' }, { tracing: true }, { options: { titleAlign: 'left' } }, { options: { bodyIndent: 'none' } } ];
  for (const change of changes) await assert.rejects(f.service.submitGeneration({ ...request, input: { ...request.input, ...change } }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.submitGeneration({ ...request, versions: { ...request.versions, templateVersion: 'changed' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.submitGeneration({ ...request, layoutDigest: `learn-layout-v1:sha256:${'0'.repeat(64)}` }), { code: 'IDEMPOTENCY_CONFLICT' });
  const retry = await f.service.submitGeneration({ ...request, input: { ...request.input, options: { titleAlign: 'center', bodyIndent: 'default' } } });
  assert.equal(retry.job.status, 'SUCCEEDED');
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
});

test('concurrent different parameters under one ID select one task and reject the other', async () => {
  const f = await fixture();
  const request = await f.request({ body: 'first' });
  const results = await Promise.allSettled([f.service.submitGeneration(request), f.service.submitGeneration({ ...request, input: { ...request.input, body: 'second' } })]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.store.list('generation_jobs')).length, 1);
  assert.equal((await f.service.getAccount()).available, 19);
});

test('old request survives window expiry, retired presets and key/limit changes using its original fingerprint rules', async () => {
  const f = await fixture();
  const request = await f.request({ body: 'original body exceeding five units' });
  const original = await f.service.submitGeneration(request);
  await f.store.transaction(async tx => {
    const state = await tx.get('preset_states', f.published.registryId);
    await tx.set('preset_states', f.published.registryId, { ...state, state: 'retired' });
  });
  f.clock.advance(policy.windowTtlMs + 1);
  const rotated = f.newService({ windowKeyId: 'window_2', retainedWindowKeyIds: ['window_2'], fingerprintKeyId: 'fingerprint_2',
    retainedFingerprintKeyIds: ['fingerprint_1', 'fingerprint_2'], maxInputCodeUnits: 5, maxGraphemes: 5 });
  assert.equal((await rotated.submitGeneration(request)).job.jobId, original.job.jobId);
  const missingKey = f.newService({ fingerprintKeyId: 'fingerprint_2', retainedFingerprintKeyIds: ['fingerprint_2'] });
  await assert.rejects(missingKey.submitGeneration(request), { code: 'KEY_UNAVAILABLE' });
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
});

test('retained signing keys allow unexpired old windows while unknown fingerprint versions never reopen tasks', async () => {
  const f = await fixture();
  const request = await f.request();
  const rotated = f.newService({ windowKeyId: 'window_2', retainedWindowKeyIds: ['window_1', 'window_2'],
    fingerprintKeyId: 'fingerprint_2', retainedFingerprintKeyIds: ['fingerprint_1', 'fingerprint_2'] });
  await rotated.submitGeneration(request);
  const record = (await f.store.list('generation_requests'))[0];
  assert.equal(record.value.fingerprintKeyId, 'fingerprint_2');
  await f.store.transaction(tx => tx.set('generation_requests', record.id, { ...record.value, fingerprintVersion: 'unknown-canonical-version' }));
  await assert.rejects(rotated.submitGeneration(request), { code: 'FINGERPRINT_UNSUPPORTED' });
  assert.equal((await f.store.list('generation_jobs')).length, 1);
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
});

test('missing executor blocks new reservation while previous successful requests remain queryable', async () => {
  const f = await fixture();
  const existing = await f.request();
  const succeeded = await f.service.submitGeneration(existing);
  f.dependencies.executor = undefined;
  const newRequest = await f.request();
  assert.equal(await f.service.findJobByRequest(newRequest.requestId), null);
  await assert.rejects(f.service.submitGeneration(newRequest), { code: 'EXECUTION_UNAVAILABLE' });
  assert.equal((await f.service.submitGeneration(existing)).job.jobId, succeeded.job.jobId);
  assert.equal((await f.store.list('generation_jobs')).length, 1);
});

test('unknown expired full ID is rejected after cleanup; refreshed window cannot renew the old ID', async () => {
  const f = await fixture();
  const request = await f.request();
  await f.service.submitGeneration(request);
  const record = (await f.store.list('generation_requests'))[0];
  f.clock.advance(policy.windowTtlMs + 1);
  await f.store.transaction(async tx => { await tx.delete('generation_requests', record.id); await tx.delete('generation_jobs', record.value.jobId); });
  await assert.rejects(f.service.submitGeneration(request), { code: 'REQUEST_EXPIRED' });
  const fresh = await f.service.getSubmissionWindow();
  await assert.rejects(f.service.submitGeneration({ ...request, window: fresh }), { code: 'INVALID_INPUT' });
  const newId = createRequestId(fresh.windowId, request.requestId.split('.').at(-1));
  assert.notEqual(newId, request.requestId);
  await f.service.submitGeneration({ ...request, requestId: newId });
  assert.equal((await f.service.getAccount()).available, 18);
});

test('deleted records retain fingerprint tombstones and never regenerate on replay', async () => {
  const f = await fixture();
  const request = await f.request();
  await f.service.submitGeneration(request);
  const record = (await f.store.list('generation_requests'))[0];
  await f.store.transaction(tx => tx.set('generation_requests', record.id, { ...record.value, deleted: true }));
  await assert.rejects(f.service.submitGeneration(request), { code: 'RECORD_EXPIRED' });
  await assert.rejects(f.service.findJobByRequest(request.requestId), { code: 'RECORD_EXPIRED' });
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
  assert.equal((await f.service.getAccount()).available, 19);
});

test('unknown fields, geometry injection, bad options and oversized inputs fail before reservation', async () => {
  const f = await fixture({ maxInputCodeUnits: 10, maxGraphemes: 10 });
  const request = await f.request();
  for (const input of [{ ...request.input, geometry: {} }, { ...request.input, options: { titleAlign: 'justify' } },
    { ...request.input, body: '\ud800' }]) await assert.rejects(f.service.submitGeneration({ ...request, input }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.submitGeneration({ ...request, input: { ...request.input, body: 'long'.repeat(10) } }), { code: 'INPUT_LIMIT_EXCEEDED' });
  await assert.rejects(f.service.submitGeneration({ ...request, fingerprint: 'client_fingerprint' }), { code: 'INVALID_INPUT' });
  assert.equal((await f.store.list('credit_reservations')).length, 0);
});

test('new request limits apply atomically; pending jobs reserve concurrency and retries do not spend rate', async () => {
  const f = await fixture({ maxConcurrentJobs: 1, maxStartsPerWindow: 1 });
  const entered = deferred(), release = deferred();
  f.setPrepare(async () => { entered.resolve(); await release.promise; });
  const firstRequest = await f.request();
  const first = f.service.submitGeneration(firstRequest);
  await entered.promise;
  await f.service.submitGeneration(firstRequest);
  const nextRequest = await f.request();
  await assert.rejects(f.service.submitGeneration(nextRequest), { code: 'CONCURRENCY_LIMITED' });
  release.resolve(); await first;
  await assert.rejects(f.service.submitGeneration(nextRequest), { code: 'RATE_LIMITED' });
  f.clock.advance(policy.rateWindowMs);
  await f.service.submitGeneration(nextRequest);
  assert.equal((await f.store.list('generation_jobs')).length, 2);
});

test('reservation commit failure rolls back job/request/credit/reference/rate together', async () => {
  const f = await fixture();
  const request = await f.request();
  f.setResourceHook(() => f.store.failNextCommit());
  await assert.rejects(f.service.submitGeneration(request), { code: 'INTERNAL_ERROR' });
  for (const name of ['generation_jobs', 'generation_requests', 'credit_reservations', 'preset_uses', 'generation_rate']) {
    assert.equal((await f.store.list(name)).length, 0, name);
  }
  assert.equal((await f.service.getAccount()).available, 20);
  assert.equal((await f.store.get('preset_states', f.published.registryId)).references, 0);
  assert.deepEqual(f.counts(), { prepares: 0, executions: 0 });
});

test('preparation exceptions are safe failed tasks, released atomically, and never prepared on retry', async () => {
  const f = await fixture();
  f.setPrepare(async () => { throw new Error('synthetic body and secret'); });
  const request = await f.request({ body: 'private-original' });
  const result = await f.service.submitGeneration(request);
  assert.equal(result.submission, 'settled');
  assert.equal(result.job.status, 'FAILED');
  assert.equal(result.job.errorCode, 'PREPARATION_FAILED');
  assert.equal((await f.service.getAccount()).available, 20);
  assert.equal((await f.store.get('preset_states', f.published.registryId)).references, 0);
  assert.equal((await f.store.list('daily_activity')).length, 0);
  await f.service.submitGeneration(request);
  assert.deepEqual(f.counts(), { prepares: 1, executions: 0 });
  assert.equal(JSON.stringify(f.store.snapshot()).includes('private-original'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('digest and page count are validated against actual prepared layout before executor runs', async () => {
  const f = await fixture({ maxPages: 1 });
  const wrongDigest = await f.request(); wrongDigest.layoutDigest = `learn-layout-v1:sha256:${'f'.repeat(64)}`;
  assert.equal((await f.service.submitGeneration(wrongDigest)).job.errorCode, 'LAYOUT_MISMATCH');
  const twoPages = fixtureLayout(f.preset, 2);
  f.setPrepare(async () => ({ layout: twoPages, digest: createLayoutDigest(twoPages) }));
  const long = await f.request(); long.layoutDigest = createLayoutDigest(twoPages);
  assert.equal((await f.service.submitGeneration(long)).job.errorCode, 'PAGE_LIMIT_EXCEEDED');
  const normal = await f.request();
  const changed = fixtureLayout(f.preset); changed.pages[0].geometry.segments[0].from.x += 1;
  f.setPrepare(async () => ({ layout: changed, digest: normal.layoutDigest }));
  assert.equal((await f.service.submitGeneration(normal)).job.errorCode, 'LAYOUT_MISMATCH');
  assert.equal(f.counts().executions, 0);
  assert.equal((await f.service.getAccount()).available, 20);
});

test('expired during prepare releases reservation and never starts the executor', async () => {
  const f = await fixture();
  f.setPrepare(async () => { f.clock.advance(policy.jobTimeoutMs); });
  const result = await f.service.submitGeneration(await f.request());
  assert.equal(result.job.errorCode, 'EXECUTION_TIMEOUT');
  assert.equal(f.counts().executions, 0);
  assert.equal((await f.service.getAccount()).reserved, 0);
});

test('uncertain executor failure never refunds or re-executes; metadata deadline recovery settles later', async () => {
  const f = await fixture();
  f.setExecute(async () => { throw new Error('provider secret'); });
  const request = await f.request();
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN', message: 'EXECUTION_OUTCOME_UNKNOWN' });
  const retry = await f.service.submitGeneration(request);
  assert.equal(retry.submission, 'pending');
  assert.equal(retry.job.status, 'GENERATING');
  assert.equal((await f.service.getAccount()).reserved, 1);
  f.clock.advance(policy.jobTimeoutMs);
  const job = await f.store.get('generation_jobs', retry.job.jobId);
  await f.store.transaction(tx => failJobInTransaction(tx, job.jobId, job.batchId, f.clock.now(), 'EXECUTION_TIMEOUT'));
  assert.equal((await f.service.submitGeneration(request)).job.status, 'FAILED');
  assert.deepEqual(f.counts(), { prepares: 1, executions: 1 });
});

test('executor returning before terminal is not reported accepted, while lost response after terminal is recovered', async () => {
  const f = await fixture();
  f.setExecute(async () => {});
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.setExecute(async execution => { await f.complete(execution); throw new Error('lost response'); });
  const completed = await f.service.submitGeneration(await f.request());
  assert.equal(completed.job.status, 'SUCCEEDED');
  assert.equal(completed.submission, 'settled');
});

test('D-049 activity is one fact per user/day, unrelated queries and retries add no activity', async () => {
  const f = await fixture();
  const first = await f.request();
  await f.service.getAccount();
  await f.service.getCompatibility({ engineVersion: f.preset.versions.engineVersion });
  assert.equal((await f.store.list('daily_activity')).length, 0);
  await f.service.submitGeneration(first);
  await f.service.findJobByRequest(first.requestId);
  await f.service.submitGeneration(first);
  await f.service.submitGeneration(await f.request());
  assert.equal((await f.store.list('daily_activity')).length, 1);
  f.clock.advance(day);
  await f.service.submitGeneration(await f.request());
  assert.equal((await f.store.list('daily_activity')).length, 2);
});

test('generation configuration requires explicit keys/limits and retention order', async () => {
  const f = await fixture();
  for (const invalid of [{ fingerprintKeyId: 'unknown' }, { requestRetentionMs: 100 },
    { recordRetentionMs: policy.pdfRetentionMs }, { fingerprintVersion: 'unknown' }, { maxPages: 0 }]) {
    assert.throws(() => f.newService(invalid), { code: 'INVALID_CONFIG' });
  }
});

test('production preparer factory uses actual shared layout and digest for all four blank templates', async () => {
  let loads = 0;
  const preparer = createPaperPreparer(async preset => {
    loads++;
    return { fontBundleVersion: preset.versions.fontBundleVersion, shape() { throw new Error('blank paper must not shape text'); } };
  });
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const preset = getDevelopmentPreset(templateId);
    const result = await preparer.prepare({ templateId, title: '', body: '', tracing: false, options: {} }, preset);
    assert.equal(result.layout.mode, 'blank');
    assert.equal(result.layout.pages.length, 1);
    assert.equal(result.layout.pages[0].geometry.templateId, templateId);
    assert.equal(result.digest, createLayoutDigest(result.layout));
  }
  assert.equal(loads, 4);
});
