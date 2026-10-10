import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { MemoryMetadataStore, MemoryPrivateStorage, AwaitedExecutionBridge, SystemClock } from '../../packages/cloud-runtime/dist/index.js';
import { CloudService, createGenerationExecutor, createPaperPreparer } from '../../packages/cloud-service/dist/index.js';
import { getDevelopmentPreset, DEVELOPMENT_ENGINE_VERSION } from '../../packages/paper-core/dist/index.js';
import { FONT_RESOURCES, FONT_BUNDLE_VERSION, createFontMetricsProvider } from '../../packages/font-metrics/dist/index.js';
import { renderPdf } from '../../packages/pdf-renderer/dist/index.js';
import { createRpcHandler } from '../../cloudfunctions/learn-service/rpc.mjs';

/** Test-only Node composition. All business decisions remain in CloudService.
 * Identity is chosen by the diagnostic host, never by a miniapp event. */
export async function createLocalService() {
  const secret = randomBytes(32);
  const crypto = { randomId: randomUUID,
    hmacSha256: async (id, value) => createHmac('sha256', secret).update(id).update('\0').update(value).digest('hex'),
    sha256: async value => createHash('sha256').update(value).digest('hex') };
  const manifest = JSON.parse(await readFile(new URL('../../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  const originals = Object.fromEntries(await Promise.all(manifest.fonts.map(async font =>
    [font.id, new Uint8Array(await readFile(new URL(`../../assets/fonts/${font.path}`, import.meta.url)))])));
  const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: originals });
  const resources = {
    describeBundle: async version => version === FONT_BUNDLE_VERSION ? { fontBundleVersion: version,
      fonts: FONT_RESOURCES.map(font => ({ ...font, location: `local://verified/${font.id}` })) } : null,
    readFontBytes: async (id, version) => {
      if (version !== FONT_BUNDLE_VERSION || !originals[id]) throw new Error('INVALID_LOCAL_RESOURCE');
      return new Uint8Array(originals[id]);
    },
  };
  const store = new MemoryMetadataStore(), storage = new MemoryPrivateStorage(), clock = new SystemClock();
  const adminSubject = 'diagnostic-bootstrap';
  const userId = subject => crypto.hmacSha256('identity', JSON.stringify(['learn.identity.v1', 'diagnostic-app', subject])).then(hash => `u_${hash}`);
  const day = 86400000;
  const config = {
    stage: 'development', monthlyFreeCredits: 20, quotaTimeZone: 'Asia/Shanghai', identityKeyId: 'identity', adminUserIds: [await userId(adminSubject)],
    stats: { coverageStartDate: new Date(clock.now() + 8 * 3600000).toISOString().slice(0, 10), pageSize: 50, maxScanRecords: 10000, maxRunMs: 5000 },
    fileAccess: { maxFileBytes: 32 * 1024 * 1024, maxCacheBytes: 32 * 1024 * 1024, cacheTtlMs: 60000, maxListScanRecords: 100 },
    registry: { cloudEngineVersions: [DEVELOPMENT_ENGINE_VERSION], clientReadyEngineVersions: [DEVELOPMENT_ENGINE_VERSION] },
    generation: { windowKeyId: 'window', retainedWindowKeyIds: ['window'], fingerprintKeyId: 'fingerprint', retainedFingerprintKeyIds: ['fingerprint'],
      fingerprintVersion: 'learn-request-v1', windowTtlMs: 3600000, requestRetentionMs: 90 * day, recordRetentionMs: 30 * day,
      pdfRetentionMs: 7 * day, jobTimeoutMs: 120000, maxInputCodeUnits: 10000, maxGraphemes: 10000, maxPages: 10,
      maxPdfBytes: 32 * 1024 * 1024, maxConcurrentJobs: 4, rateWindowMs: 60000, maxStartsPerWindow: 20 },
  };
  const preparer = createPaperPreparer(async () => provider);
  const executor = createGenerationExecutor({ store, storage, clock, crypto, bridge: new AwaitedExecutionBridge(),
    renderer: { render: (execution, { maxOutputBytes }) => renderPdf(execution.layout, provider, { maxBytes: maxOutputBytes }) } }, config);
  const clients = new Map();
  const serviceFor = subject => {
    if (!clients.has(subject)) clients.set(subject, new CloudService({ store, storage, clock, crypto, resources, preparer, executor,
      identity: { current: () => ({ subject, appId: 'diagnostic-app' }) } }, config));
    return clients.get(subject);
  };
  const admin = serviceFor(adminSubject);
  for (const template of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const preset = getDevelopmentPreset(template); await admin.publishPreset(preset); await admin.activatePreset(preset.versions);
  }
  return { serviceFor, rpcFor: subject => createRpcHandler(serviceFor(subject)), provider, preparer, config, store, storage, clock, crypto };
}
