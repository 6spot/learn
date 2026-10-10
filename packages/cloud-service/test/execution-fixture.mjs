import { createHash, createHmac, randomUUID } from 'node:crypto';
import { MemoryMetadataStore, MemoryPrivateStorage, ManualClock, AwaitedExecutionBridge } from '@learn/cloud-runtime';
import { getDevelopmentPreset } from '@learn/paper-core';
import { CloudService, createPaperPreparer, createGenerationExecutor, createRequestId } from '../dist/index.js';

export const pdfFixture = () => new TextEncoder().encode('%PDF-1.7\nexplicit synthetic execution fixture\n%%EOF\n');
export function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

export async function executionFixture(options = {}) {
  const base = new MemoryMetadataStore(), backend = new MemoryPrivateStorage();
  const clock = new ManualClock(Date.parse('2026-10-11T00:00:00Z'));
  const hooks = {};
  const counts = { render: 0, upload: 0, read: 0, remove: 0, prepare: 0 };
  const store = { get: base.get.bind(base), list: base.list.bind(base), async transaction(work) {
    const writes = [];
    const result = await base.transaction(async tx => {
      const observed = { ...tx,
        set: async (collection, id, value) => { writes.push({ collection, id, value }); return tx.set(collection, id, value); },
        create: async (collection, id, value) => { writes.push({ collection, id, value }); return tx.create(collection, id, value); },
      };
      const value = await work(observed);
      await hooks.beforeCommit?.(writes, tx);
      return value;
    });
    await hooks.afterCommit?.(writes);
    return result;
  } };
  const storage = { resolve: backend.resolve.bind(backend), async put(path, bytes) {
    counts.upload++; await hooks.beforeUpload?.(path, bytes);
    const id = await backend.put(path, bytes); await hooks.afterUpload?.(id, bytes); return id;
  }, async read(id) { counts.read++; await hooks.beforeRead?.(id); const bytes = await backend.read(id);
    return await hooks.afterRead?.(id, bytes) ?? bytes;
  }, async remove(id) { counts.remove++; await hooks.beforeRemove?.(id); await backend.remove(id); await hooks.afterRemove?.(id); } };
  const crypto = { randomId: randomUUID, sha256: async value => createHash('sha256').update(value).digest('hex'),
    hmacSha256: async (id, value) => createHmac('sha256', `execution-test-only-${id}`).update(value).digest('hex') };
  const preset = options.preset ?? getDevelopmentPreset('essay-grid');
  const font = new TextEncoder().encode('synthetic resource for blank core layout');
  const resources = options.resources ?? { describeBundle: async version => ({ fontBundleVersion: version,
    fonts: [{ id: 'misans-regular', bytes: font.length, sha256: await crypto.sha256(font), fontVersion: 'test.1', location: 'local://fixture' }] }),
    readFontBytes: async () => font };
  const day = 86400000;
  const config = { stage: 'development', monthlyFreeCredits: options.monthlyFreeCredits ?? 20, quotaTimeZone: 'Asia/Shanghai', identityKeyId: 'identity', adminUserIds: [],
    registry: { cloudEngineVersions: [preset.versions.engineVersion], clientReadyEngineVersions: [preset.versions.engineVersion] },
    fileAccess: { maxFileBytes: 64 * 1024 * 1024, maxCacheBytes: 64 * 1024 * 1024, cacheTtlMs: 60000, maxListScanRecords: 1000, ...options.fileAccess },
    generation: { windowKeyId: 'window', retainedWindowKeyIds: ['window'], fingerprintKeyId: 'fingerprint', retainedFingerprintKeyIds: ['fingerprint'],
      fingerprintVersion: 'learn-request-v1', windowTtlMs: 3600000, requestRetentionMs: 90 * day, recordRetentionMs: 30 * day,
      pdfRetentionMs: 7 * day, jobTimeoutMs: 60000, maxInputCodeUnits: 10000, maxGraphemes: 10000, maxPages: 5,
      maxPdfBytes: 1000000, maxConcurrentJobs: 4, rateWindowMs: 60000, maxStartsPerWindow: 10, ...options.policy } };
  const metrics = options.metrics ?? { fontBundleVersion: preset.versions.fontBundleVersion, shape() { throw new Error('blank fixture must not shape'); } };
  const shared = createPaperPreparer(async () => metrics);
  let execution;
  const runnerDeps = { store, storage, crypto, clock, bridge: options.bridge ?? new AwaitedExecutionBridge(),
    renderer: { async render(value, limits) { counts.render++; execution = value;
      return hooks.render ? hooks.render(value, limits) : options.render ? options.render(value, limits) : pdfFixture(); } } };
  const runner = createGenerationExecutor(runnerDeps, config);
  const dependencies = { store, storage, clock, crypto, identity: { current: () => ({ subject: 'trusted-test-user', appId: 'trusted-app' }) }, resources,
    preparer: { prepare: async (...args) => { counts.prepare++; return shared.prepare(...args); } }, executor: runner };
  const userId = (await new CloudService(dependencies, config).getAccount()).userId;
  const service = new CloudService(dependencies, { ...config, adminUserIds: [userId] });
  await service.publishPreset(preset); await service.activatePreset(preset.versions);
  const request = async (input = {}) => {
    const value = { templateId: preset.versions.templateId, ...input };
    return { requestId: createRequestId((await service.getSubmissionWindow()).windowId, randomUUID()), input: value,
      versions: preset.versions, layoutDigest: (await shared.prepare(value, preset)).digest };
  };
  return { base, backend, store, storage, clock, crypto, config, hooks, counts, runner, runnerDeps, dependencies, service, userId, request,
    execution: () => execution, job: async () => (await store.list('generation_jobs'))[0]?.value,
    candidate: async () => (await store.list('pdf_candidates'))[0]?.value };
}
