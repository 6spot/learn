import { ServiceError, type GenerationConfig, type RecoveryConfig, type ServiceConfig } from './contracts.js';

export function validateRecoveryConfig(config: RecoveryConfig): RecoveryConfig {
  const fields = ['pageSize', 'maxRecordsPerRun', 'maxRunMs', 'maxCandidateBytes', 'maxReadBytesPerRun'] as const;
  if (!config || !fields.every(field => Number.isSafeInteger(config[field]) && config[field] > 0 && config[field] <= 10_000_000_000) ||
      config.pageSize > 100 || config.maxRecordsPerRun > 1000 || config.maxReadBytesPerRun < config.maxCandidateBytes) {
    throw new ServiceError('INVALID_CONFIG');
  }
  return Object.freeze({ pageSize: config.pageSize, maxRecordsPerRun: config.maxRecordsPerRun, maxRunMs: config.maxRunMs,
    maxCandidateBytes: config.maxCandidateBytes, maxReadBytesPerRun: config.maxReadBytesPerRun });
}

function validateGeneration(config: GenerationConfig): GenerationConfig {
  const integerFields = ['windowTtlMs', 'requestRetentionMs', 'recordRetentionMs', 'pdfRetentionMs', 'jobTimeoutMs',
    'maxInputCodeUnits', 'maxGraphemes', 'maxPages', 'maxPdfBytes', 'maxConcurrentJobs', 'rateWindowMs', 'maxStartsPerWindow'] as const;
  const key = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  if (!config || !integerFields.every(field => Number.isSafeInteger(config[field]) && config[field] > 0 && config[field] <= 10_000_000_000) ||
      !key(config.windowKeyId) || !key(config.fingerprintKeyId) || config.fingerprintVersion !== 'learn-request-v1' ||
      !Array.isArray(config.retainedWindowKeyIds) || !Array.isArray(config.retainedFingerprintKeyIds) ||
      ![config.retainedWindowKeyIds, config.retainedFingerprintKeyIds].every(keys => keys.length > 0 && keys.length <= 32 && keys.every(key)) ||
      !config.retainedWindowKeyIds.includes(config.windowKeyId) || !config.retainedFingerprintKeyIds.includes(config.fingerprintKeyId) ||
      config.requestRetentionMs < config.recordRetentionMs || config.requestRetentionMs < config.windowTtlMs + config.jobTimeoutMs ||
      config.recordRetentionMs < config.pdfRetentionMs + config.jobTimeoutMs) throw new ServiceError('INVALID_CONFIG');
  return Object.freeze({ ...Object.fromEntries(integerFields.map(field => [field, config[field]])),
    windowKeyId: config.windowKeyId, fingerprintKeyId: config.fingerprintKeyId, fingerprintVersion: config.fingerprintVersion,
    retainedWindowKeyIds: Object.freeze([...new Set(config.retainedWindowKeyIds)]),
    retainedFingerprintKeyIds: Object.freeze([...new Set(config.retainedFingerprintKeyIds)]),
  }) as GenerationConfig;
}

export function validateConfig(config: ServiceConfig): ServiceConfig {
  if (!config || !['development', 'production'].includes(config.stage) ||
      !Number.isSafeInteger(config.monthlyFreeCredits) || config.monthlyFreeCredits < 0 || config.monthlyFreeCredits > 100000 ||
      config.quotaTimeZone !== 'Asia/Shanghai' || typeof config.identityKeyId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(config.identityKeyId) || !Array.isArray(config.adminUserIds) ||
      !config.adminUserIds.every(id => typeof id === 'string' && /^u_[a-f0-9]{64}$/.test(id))) {
    throw new ServiceError('INVALID_CONFIG');
  }
  if (config.registry && (!Array.isArray(config.registry.cloudEngineVersions) || !config.registry.cloudEngineVersions.length ||
      !Array.isArray(config.registry.clientReadyEngineVersions) ||
      ![...config.registry.cloudEngineVersions, ...config.registry.clientReadyEngineVersions].every(value =>
        typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) ||
      !config.registry.clientReadyEngineVersions.every(value => config.registry!.cloudEngineVersions.includes(value)))) {
    throw new ServiceError('INVALID_CONFIG');
  }
  return Object.freeze({ stage: config.stage, monthlyFreeCredits: config.monthlyFreeCredits,
    quotaTimeZone: config.quotaTimeZone, identityKeyId: config.identityKeyId,
    adminUserIds: Object.freeze([...new Set(config.adminUserIds)]),
    ...(config.registry ? { registry: Object.freeze({
      cloudEngineVersions: Object.freeze([...new Set(config.registry.cloudEngineVersions)]),
      clientReadyEngineVersions: Object.freeze([...new Set(config.registry.clientReadyEngineVersions)]),
    }) } : {}), ...(config.generation ? { generation: validateGeneration(config.generation) } : {}) });
}

/** China standard time has no DST; fixed +08:00 avoids depending on Intl in WeChat. */
export function quotaPeriod(now: number): { period: string; endsAt: number } {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_000_000_000_000_000) throw new ServiceError('INTERNAL_ERROR');
  const offset = 8 * 60 * 60 * 1000;
  const local = new Date(now + offset);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  if (year < 2000 || year > 9999) throw new ServiceError('INTERNAL_ERROR');
  return { period: `${year}-${String(month + 1).padStart(2, '0')}`, endsAt: Date.UTC(year, month + 1, 1) - offset };
}
