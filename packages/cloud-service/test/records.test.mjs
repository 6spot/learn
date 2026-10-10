import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { CloudService, PDF_CHUNK_BYTES } from '../dist/index.js';
import { historyId, indexJobInTransaction } from '../dist/history.js';
import { candidateId } from '../dist/artifacts.js';
import { executionFixture, deferred, pdfFixture } from './execution-fixture.mjs';

async function generate(f) { return (await f.service.submitGeneration(await f.request())).job; }
const largePdf = (size = PDF_CHUNK_BYTES * 2 + 17) => {
  const bytes = new Uint8Array(size).fill(32); bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  bytes.set(new TextEncoder().encode('\n%%EOF\n'), size - 7); return bytes;
};
const fresh = (f, override = {}) => new CloudService(f.dependencies, { ...f.config, fileAccess: { ...f.config.fileAccess, ...override } });
const accountState = async f => { const a = await f.service.getAccount(); return [a.available, a.reserved]; };
async function tombstone(f, id) {
  await f.store.transaction(async tx => { const job = await tx.get('generation_jobs', id), request = await tx.get('generation_requests', job.requestKey);
    await tx.set('generation_requests', job.requestKey, { ...request, deleted: true }); });
}

test('history admission is atomic and lists descending submission time with stable same-time pagination', async () => {
  const f = await executionFixture(); const oldest = await generate(f); f.clock.advance(1000);
  const sameTime = [await generate(f), await generate(f), await generate(f)]; f.clock.advance(1000); const newest = await generate(f);
  const expected = [newest, ...sameTime.sort((a, b) => a.jobId.localeCompare(b.jobId)), oldest].map(job => job.jobId);
  const actual = []; let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await f.service.listJobs({ limit: 2, ...(cursor ? { cursor } : {}) }); actual.push(...page.items.map(job => job.jobId));
    if (!page.nextCursor) break; cursor = page.nextCursor;
  }
  assert.deepEqual(actual, expected); assert.equal((await f.store.list('generation_history')).length, 5);
  const before = await accountState(f);
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_history')) throw new Error('index commit fault'); };
  await assert.rejects(f.service.submitGeneration(await f.request()), { code: 'INTERNAL_ERROR' });
  assert.equal((await f.store.list('generation_history')).length, 5); assert.deepEqual(await accountState(f), before);
});

test('list, detail and PDF metadata expose only safe fields and create no download activity', async () => {
  const f = await executionFixture(); const job = await generate(f); f.clock.advance(86400000);
  const detail = await f.service.getJob(job.jobId), info = await f.service.getPdfInfo(job.jobId);
  const list = await f.service.listJobs(); assert.equal(list.items[0].delivery, 'ready');
  assert.deepEqual(Object.keys(detail).sort(), ['jobId', 'requestId', 'templateId', 'status', 'createdAt', 'startedAt', 'finishedAt', 'pageCount', 'errorCode', 'fileExpiresAt', 'delivery'].sort());
  assert.deepEqual(Object.keys(info).sort(), ['jobId', 'bytes', 'sha256', 'pageCount', 'expiresAt', 'chunkBytes'].sort());
  assert.equal(info.chunkBytes, PDF_CHUNK_BYTES);
  for (const data of [detail, info, list]) assert.equal(JSON.stringify(data).includes('private:'), false);
  assert.equal((await f.store.list('daily_activity')).length, 1); assert.deepEqual(await accountState(f), [19, 0]);
});

test('cross-user IDs, signed cursors and file references never grant access, even for an administrator', async () => {
  const f = await executionFixture(); const one = await generate(f); await generate(f);
  const cursor = (await f.service.listJobs({ limit: 1 })).nextCursor;
  const originalIdentity = f.dependencies.identity.current;
  f.dependencies.identity.current = () => ({ subject: 'other', appId: 'trusted-app' });
  const other = await f.service.getAccount(); const adminOther = new CloudService(f.dependencies, { ...f.config, adminUserIds: [other.userId] });
  assert.deepEqual((await adminOther.listJobs()).items, []);
  for (const operation of [() => adminOther.getJob(one.jobId), () => adminOther.getPdfInfo(one.jobId), () => adminOther.readPdfChunk({ jobId: one.jobId, offset: 0 })])
    await assert.rejects(operation(), { code: 'NOT_FOUND' });
  await assert.rejects(adminOther.listJobs({ cursor }), { code: 'INVALID_ARGUMENT' });
  f.dependencies.identity.current = originalIdentity;
  await assert.rejects(f.service.getPdfInfo((await f.job()).fileId), { code: 'INVALID_ARGUMENT' });
});

test('bounded chunks reassemble exact bytes/hash, use one verified warm read and never consume again', async () => {
  const f = await executionFixture(); const pdf = largePdf(); f.hooks.render = async () => pdf;
  const job = await generate(f), before = { ...f.counts }; f.clock.advance(86400000);
  const info = await f.service.getPdfInfo(job.jobId), parts = []; let offset = 0;
  do {
    const part = await f.service.readPdfChunk({ jobId: job.jobId, offset });
    assert.ok(part.bytes instanceof Uint8Array); assert.ok(part.bytes.length <= PDF_CHUNK_BYTES); assert.equal(part.offset, offset);
    assert.equal(part.totalBytes, pdf.length); parts.push(part.bytes); offset = part.nextOffset;
  } while (offset !== null);
  const combined = new Uint8Array(info.bytes); let at = 0;
  for (const part of parts) { combined.set(part, at); at += part.length; }
  assert.deepEqual(combined, pdf); assert.equal(await f.crypto.sha256(combined), info.sha256);
  await f.service.readPdfChunk({ jobId: job.jobId, offset: 0 });
  assert.equal(f.counts.read, before.read + 1); assert.equal(f.counts.render, before.render); assert.equal(f.counts.prepare, before.prepare);
  assert.deepEqual(await accountState(f), [19, 0]); assert.equal((await f.store.list('daily_activity')).length, 2);
});

test('simultaneous same-file reads share one verified load and return independent byte copies', async () => {
  const f = await executionFixture(); f.hooks.render = async () => largePdf(); const job = await generate(f);
  const entered = deferred(), release = deferred(); f.hooks.beforeRead = async () => { entered.resolve(); await release.promise; };
  const reads = f.counts.read;
  const first = f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }); await entered.promise;
  const second = f.service.readPdfChunk({ jobId: job.jobId, offset: PDF_CHUNK_BYTES }); release.resolve();
  const [a, b] = await Promise.all([first, second]); assert.equal(f.counts.read, reads + 1);
  a.bytes[0] = 0; b.bytes[0] = 0;
  const again = await f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }); assert.equal(again.bytes[0], 37);
});

test('interleaved users share only their own in-flight file loads without duplicate full reads', async () => {
  const f = await executionFixture(); const originalIdentity = f.dependencies.identity.current;
  const firstBytes = largePdf(), secondBytes = largePdf(); firstBytes[9] = 65; secondBytes[9] = 66;
  f.hooks.render = async () => firstBytes; const firstJob = await generate(f);
  f.dependencies.identity.current = () => ({ subject: 'other', appId: 'trusted-app' });
  f.hooks.render = async () => secondBytes; const otherJob = await generate(f);
  const enteredFirst = deferred(), enteredOther = deferred(), release = deferred(); let loads = 0;
  f.hooks.beforeRead = async () => {
    if (++loads === 1) enteredFirst.resolve(); else if (loads === 2) enteredOther.resolve();
    await release.promise;
  };
  const reads = f.counts.read;
  f.dependencies.identity.current = originalIdentity;
  const first = f.service.readPdfChunk({ jobId: firstJob.jobId, offset: 0 }); await enteredFirst.promise;
  f.dependencies.identity.current = () => ({ subject: 'other', appId: 'trusted-app' });
  const other = f.service.readPdfChunk({ jobId: otherJob.jobId, offset: 0 }); await enteredOther.promise;
  await assert.rejects(f.service.readPdfChunk({ jobId: firstJob.jobId, offset: 0 }), { code: 'NOT_FOUND' });
  f.dependencies.identity.current = originalIdentity;
  const repeated = f.service.readPdfChunk({ jobId: firstJob.jobId, offset: 0 });
  await setImmediate(); // Let all in-memory authorization work reach the blocked storage boundary.
  release.resolve();
  const [a, b, again] = await Promise.all([first, other, repeated]);
  assert.equal(f.counts.read, reads + 2); assert.equal(a.bytes[9], 65); assert.equal(b.bytes[9], 66);
  assert.deepEqual(again.bytes, a.bytes); assert.notEqual(again.bytes, a.bytes);
  assert.deepEqual(await accountState(f), [19, 0]);
});

test('cache TTL, capacity, replacement and cold instances control reuse without changing authority', async () => {
  const f = await executionFixture({ fileAccess: { cacheTtlMs: 5 } }); const one = await generate(f); const two = await generate(f);
  const reads = f.counts.read;
  await f.service.readPdfChunk({ jobId: one.jobId, offset: 0 });
  await f.service.readPdfChunk({ jobId: one.jobId, offset: 0 }); assert.equal(f.counts.read, reads + 1);
  f.clock.advance(5); await f.service.readPdfChunk({ jobId: one.jobId, offset: 0 }); assert.equal(f.counts.read, reads + 2);
  await f.service.readPdfChunk({ jobId: two.jobId, offset: 0 }); await f.service.readPdfChunk({ jobId: one.jobId, offset: 0 });
  assert.equal(f.counts.read, reads + 4);
  const noCache = fresh(f, { maxCacheBytes: 0 });
  await noCache.readPdfChunk({ jobId: one.jobId, offset: 0 }); await noCache.readPdfChunk({ jobId: one.jobId, offset: 0 });
  assert.equal(f.counts.read, reads + 6);
  await fresh(f).readPdfChunk({ jobId: one.jobId, offset: 0 }); assert.equal(f.counts.read, reads + 7);
});

test('malicious offsets, unknown authority fields and getter payloads fail before reading storage', async () => {
  const f = await executionFixture(); const job = await generate(f); const reads = f.counts.read;
  for (const offset of [-1, 1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, PDF_CHUNK_BYTES])
    await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset }), { code: 'INVALID_ARGUMENT' });
  for (const extra of [{ length: 1000000000 }, { userId: f.userId }, { fileId: (await f.job()).fileId }, { role: 'admin' }])
    await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0, ...extra }), { code: 'INVALID_ARGUMENT' });
  let invoked = false;
  await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, get offset() { invoked = true; return 0; } }), { code: 'INVALID_ARGUMENT' });
  for (const request of [{ limit: 0 }, { limit: 51 }, { cursor: 'forged' }, { userId: 'other' }])
    await assert.rejects(f.service.listJobs(request), { code: 'INVALID_ARGUMENT' });
  assert.equal(invoked, false); assert.equal(f.counts.read, reads);
});

test('chunk and list parameters are snapshotted before asynchronous identity lookup', async () => {
  const f = await executionFixture(); const job = await generate(f); await generate(f);
  const original = f.crypto.hmacSha256; const entered = deferred(), release = deferred(); let once = true;
  f.crypto.hmacSha256 = async (...args) => { if (once) { once = false; entered.resolve(); await release.promise; } return original(...args); };
  const request = { jobId: job.jobId, offset: 0 }; const pending = f.service.readPdfChunk(request); await entered.promise;
  request.jobId = 'changed'; request.offset = 123; release.resolve(); assert.equal((await pending).jobId, job.jobId);
  const list = { limit: 1 }; once = true; const gate = deferred();
  f.crypto.hmacSha256 = async (...args) => { if (once) { once = false; await gate.promise; } return original(...args); };
  const page = f.service.listJobs(list); list.limit = 50; gate.resolve(); assert.equal((await page).items.length, 1);
});

test('uncommitted candidates cannot be delivered or add download activity', async () => {
  const f = await executionFixture(); f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) throw new Error('stop'); };
  const request = await f.request(); await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.hooks.beforeCommit = undefined; const job = await f.job(); f.clock.advance(86400000);
  assert.equal((await f.service.getJob(job.jobId)).delivery, 'not-ready');
  await assert.rejects(f.service.getPdfInfo(job.jobId), { code: 'FILE_NOT_READY' });
  await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: 'FILE_NOT_READY' });
  assert.equal((await f.store.list('daily_activity')).length, 1);
});

test('file expiry, visible-record expiry and unfinished-record retention have distinct behavior', async () => {
  const f = await executionFixture(); const job = await generate(f);
  await f.service.readPdfChunk({ jobId: job.jobId, offset: 0 });
  f.clock.advance(f.config.generation.pdfRetentionMs);
  assert.equal((await f.service.getJob(job.jobId)).delivery, 'expired');
  await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: 'FILE_EXPIRED' });
  assert.equal((await f.job()).status, 'SUCCEEDED'); assert.deepEqual(await accountState(f), [19, 0]);
  f.clock.advance(f.config.generation.recordRetentionMs);
  await assert.rejects(f.service.getJob(job.jobId), { code: 'RECORD_EXPIRED' }); assert.deepEqual((await f.service.listJobs()).items, []);
  const pending = await executionFixture(); pending.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.executionClaimed)) throw new Error('stop'); };
  await assert.rejects(pending.service.submitGeneration(await pending.request()), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); pending.hooks.beforeCommit = undefined;
  pending.clock.advance(pending.config.generation.recordRetentionMs + 1); assert.equal((await pending.service.listJobs()).items[0].status, 'GENERATING');
});

test('logical deletion and disabled or deleted accounts revoke even an already verified cached file', async () => {
  for (const revoke of ['binding', 'disabled', 'deleted']) {
    const f = await executionFixture(); const job = await generate(f); await f.service.readPdfChunk({ jobId: job.jobId, offset: 0 });
    if (revoke === 'binding') await tombstone(f, job.jobId);
    else await f.store.transaction(async tx => { const user = await tx.get('users', f.userId); await tx.set('users', f.userId, { ...user, status: revoke }); });
    await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: revoke === 'binding' ? 'RECORD_EXPIRED' : 'ACCOUNT_DISABLED' });
    if (revoke === 'binding') assert.deepEqual((await f.service.listJobs()).items, []);
    assert.equal((await f.job()).status, 'SUCCEEDED');
  }
});

test('authorization and expiry are rechecked after awaited bytes/hash work', async () => {
  for (const revoke of ['expiry', 'binding', 'user']) {
    const f = await executionFixture(); const job = await generate(f);
    f.hooks.afterRead = async () => {
      if (revoke === 'expiry') f.clock.advance(f.config.generation.pdfRetentionMs);
      if (revoke === 'binding') await tombstone(f, job.jobId);
      if (revoke === 'user') await f.store.transaction(async tx => { const user = await tx.get('users', f.userId); await tx.set('users', f.userId, { ...user, status: 'deleted' }); });
    };
    await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: revoke === 'expiry' ? 'FILE_EXPIRED' : revoke === 'binding' ? 'RECORD_EXPIRED' : 'ACCOUNT_DISABLED' });
    assert.equal((await f.store.list('daily_activity')).length, 1); assert.equal((await f.job()).status, 'SUCCEEDED');
  }
});

test('missing, corrupt, mismatched and over-budget files return safe failures without refund', async () => {
  for (const fault of ['missing', 'corrupt', 'candidate', 'limit']) {
    const f = await executionFixture(); const job = await generate(f), candidate = await f.candidate();
    if (fault === 'missing') await f.backend.remove(candidate.fileId);
    if (fault === 'corrupt') { const bytes = pdfFixture(); bytes[12] ^= 1; await f.backend.put(candidate.path, bytes); }
    if (fault === 'candidate') await f.store.transaction(tx => tx.set('pdf_candidates', candidate.candidateId, { ...candidate, state: 'pending' }));
    const service = fault === 'limit' ? fresh(f, { maxFileBytes: 16 }) : f.service;
    await assert.rejects(service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: fault === 'limit' ? 'FILE_LIMIT_EXCEEDED' : 'FILE_UNAVAILABLE' });
    assert.equal((await f.job()).status, 'SUCCEEDED'); assert.deepEqual(await accountState(f), [19, 0]);
  }
});

test('a valid candidate copied under another job key cannot authorize that job to deliver its bytes', async () => {
  const f = await executionFixture(); const first = await generate(f), second = await generate(f);
  const a = await f.store.get('generation_jobs', first.jobId), b = await f.store.get('generation_jobs', second.jobId);
  const other = await f.store.get('pdf_candidates', candidateId(b.jobId, b.batchId));
  await f.store.transaction(async tx => {
    await tx.set('generation_jobs', a.jobId, { ...a, candidatePath: b.candidatePath, fileId: b.fileId,
      fileBytes: b.fileBytes, fileSha256: b.fileSha256, pageCount: b.pageCount });
    await tx.set('pdf_candidates', candidateId(a.jobId, a.batchId), other);
  });
  const reads = f.counts.read;
  assert.equal((await f.service.getJob(a.jobId)).delivery, 'unavailable');
  await assert.rejects(f.service.getPdfInfo(a.jobId), { code: 'FILE_UNAVAILABLE' });
  await assert.rejects(f.service.readPdfChunk({ jobId: a.jobId, offset: 0 }), { code: 'FILE_UNAVAILABLE' });
  assert.equal(f.counts.read, reads); assert.deepEqual(await accountState(f), [18, 0]);
  assert.equal((await f.service.getJob(b.jobId)).delivery, 'ready');
});

test('scan limits expose short pages with resumable cursors after filtering deleted records', async () => {
  const f = await executionFixture({ fileAccess: { maxListScanRecords: 2 } });
  const jobs = []; for (let i = 0; i < 5; i++) { jobs.push(await generate(f)); f.clock.advance(1000); }
  await tombstone(f, jobs[4].jobId); await tombstone(f, jobs[3].jobId);
  const first = await f.service.listJobs({ limit: 5 }); assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
  const second = await f.service.listJobs({ limit: 5, cursor: first.nextCursor }); assert.equal(second.items.length, 2); assert.ok(second.nextCursor);
  const third = await f.service.listJobs({ limit: 5, cursor: second.nextCursor }); assert.equal(third.items.length, 1); assert.equal(third.nextCursor, null);
});

test('history reads remain usable without generation compatibility resources or an executor', async () => {
  const f = await executionFixture(); const job = await generate(f);
  const { generation, registry, ...config } = f.config; const { executor, preparer, resources, ...dependencies } = f.dependencies;
  const historical = new CloudService(dependencies, config);
  assert.equal((await historical.getJob(job.jobId)).delivery, 'ready'); assert.equal((await historical.listJobs()).items.length, 1);
  assert.deepEqual((await historical.readPdfChunk({ jobId: job.jobId, offset: 0 })).bytes, pdfFixture());
});

test('metadata projection rejects corrupted status/error/template strings instead of returning them', async () => {
  for (const field of ['status', 'errorCode', 'versions']) {
    const f = await executionFixture(); const job = await generate(f);
    await f.store.transaction(async tx => { const stored = await tx.get('generation_jobs', job.jobId);
      await tx.set('generation_jobs', job.jobId, { ...stored, [field]: field === 'versions' ? { ...stored.versions, templateId: 'private article' } : 'private article' }); });
    await assert.rejects(f.service.getJob(job.jobId), error => error.code === 'INVARIANT_VIOLATION' && !error.message.includes('private'));
    await assert.rejects(f.service.listJobs(), { code: 'INVARIANT_VIOLATION' });
  }
});

test('legacy records require explicit idempotent history backfill rather than silent unordered scanning', async () => {
  const f = await executionFixture(); const job = await generate(f);
  await f.store.transaction(tx => tx.delete('generation_history', historyId(job.createdAt, job.jobId)));
  assert.deepEqual((await f.service.listJobs()).items, []); assert.equal((await f.service.getJob(job.jobId)).status, 'SUCCEEDED');
  for (let i = 0; i < 2; i++) await f.store.transaction(async tx => indexJobInTransaction(tx, await tx.get('generation_jobs', job.jobId)));
  assert.equal((await f.service.listJobs()).items.length, 1); assert.equal((await f.store.list('generation_history')).length, 1);
});

test('file access resource configuration must be explicit and valid', async () => {
  const f = await executionFixture();
  for (const override of [{ maxFileBytes: 0 }, { maxCacheBytes: -1 }, { cacheTtlMs: NaN }, { maxListScanRecords: 1001 }])
    assert.throws(() => fresh(f, override), { code: 'INVALID_CONFIG' });
  const { fileAccess, ...config } = f.config; const disabled = new CloudService(f.dependencies, config);
  await assert.rejects(disabled.listJobs(), { code: 'FILE_ACCESS_UNAVAILABLE' });
});

test('more than 100 history entries paginate without duplicates or omitted records', async () => {
  const f = await executionFixture({ monthlyFreeCredits: 200, policy: { maxStartsPerWindow: 200 } });
  const expected = [];
  for (let i = 0; i < 103; i++) { expected.unshift((await generate(f)).jobId); f.clock.advance(1); }
  const actual = []; let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await f.service.listJobs({ limit: 17, ...(cursor ? { cursor } : {}) }); actual.push(...page.items.map(item => item.jobId));
    if (!page.nextCursor) break; cursor = page.nextCursor;
  }
  assert.deepEqual(actual, expected); assert.equal(new Set(actual).size, 103);
});

test('missing trusted identity rejects metadata and bytes before any storage access', async () => {
  const f = await executionFixture(); const job = await generate(f), reads = f.counts.read;
  f.dependencies.identity.current = () => ({ subject: '', appId: 'trusted-app' });
  for (const operation of [() => f.service.listJobs(), () => f.service.getJob(job.jobId), () => f.service.getPdfInfo(job.jobId),
    () => f.service.readPdfChunk({ jobId: job.jobId, offset: 0 })]) await assert.rejects(operation(), { code: 'UNAUTHENTICATED' });
  assert.equal(f.counts.read, reads);
});

test('changed formal file binding after read blocks delivery and failed authorization never adds activity', async () => {
  const f = await executionFixture(); const job = await generate(f); f.clock.advance(86400000);
  f.hooks.afterRead = async () => { await f.store.transaction(async tx => { const current = await tx.get('generation_jobs', job.jobId);
    await tx.set('generation_jobs', job.jobId, { ...current, fileSha256: '0'.repeat(64) }); }); };
  await assert.rejects(f.service.readPdfChunk({ jobId: job.jobId, offset: 0 }), { code: 'FILE_UNAVAILABLE' });
  assert.equal((await f.store.list('daily_activity')).length, 1); assert.equal((await f.job()).status, 'SUCCEEDED');
});
