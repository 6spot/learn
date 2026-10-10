import { FONT_RESOURCES } from '../../../packages/font-metrics/dist/index.js';
import { DEVELOPMENT_ENGINE_VERSION } from '../../../packages/paper-core/dist/index.js';

// All numbers and keys here are explicit local test values, never deployment defaults.
export function fixture() {
  const day = 86400000;
  const config = {
    runtime: { stage: 'development', developmentEnvironmentId: 'test-dev', productionEnvironmentId: 'test-prod', appId: 'test-app',
      fileIdPrefix: 'cloud://test-dev.bucket/', missingDocumentCodes: ['TEST_MISSING'], platformVerified: false },
    service: { stage: 'development', monthlyFreeCredits: 20, quotaTimeZone: 'Asia/Shanghai', identityKeyId: 'identity', adminUserIds: [],
      stats: { coverageStartDate: '2026-01-01', pageSize: 50, maxScanRecords: 10000, maxRunMs: 5000 },
      lifecycle: { pageSize: 50, maxRecordsPerRun: 1000, maxRunMs: 5000, maxWindowTtlMs: 3600000, lateIoProtectionMs: 300000,
        deletionProtectionMs: day, ledgerRetentionMs: 90 * day, activityRetentionMs: 30 * day, auditRetentionMs: 90 * day, inactiveUserRetentionMs: 90 * day },
      fileAccess: { maxFileBytes: 32000000, maxCacheBytes: 32000000, cacheTtlMs: 60000, maxListScanRecords: 100 },
      registry: { cloudEngineVersions: [DEVELOPMENT_ENGINE_VERSION], clientReadyEngineVersions: [DEVELOPMENT_ENGINE_VERSION] },
      generation: { windowKeyId: 'window', retainedWindowKeyIds: ['window'], fingerprintKeyId: 'fingerprint', retainedFingerprintKeyIds: ['fingerprint'],
        fingerprintVersion: 'learn-request-v1', windowTtlMs: 3600000, requestRetentionMs: 90 * day, recordRetentionMs: 30 * day,
        pdfRetentionMs: 7 * day, jobTimeoutMs: 60000, maxInputCodeUnits: 10000, maxGraphemes: 10000, maxPages: 5,
        maxPdfBytes: 32000000, maxConcurrentJobs: 4, rateWindowMs: 60000, maxStartsPerWindow: 10 } },
    fontUrls: Object.fromEntries(FONT_RESOURCES.map(font => [font.id, `https://fonts.example.invalid/${font.id}.ttf`])), fontFetchTimeoutMs: 1000,
  };
  const keys = Object.fromEntries(['identity', 'window', 'fingerprint'].map((key, index) => [key, Buffer.alloc(32, index + 1).toString('base64')]));
  const environment = () => ({ LEARN_DEPLOYMENT_CONFIG: JSON.stringify(config), LEARN_SECRET_KEYS: JSON.stringify(keys) });
  return { config, keys, environment };
}
