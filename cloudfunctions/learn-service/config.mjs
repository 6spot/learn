import { createHash, createHmac, randomUUID } from 'node:crypto';
import { cloneDocument, selectCloudEnvironment } from '../../packages/cloud-runtime/dist/index.js';
import { DEVELOPMENT_ENGINE_VERSION } from '../../packages/paper-core/dist/index.js';
import { FONT_RESOURCES } from '../../packages/font-metrics/dist/index.js';
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '../../packages/pdf-renderer/dist/index.js';

export class DeploymentError extends Error {
  constructor() { super('INVALID_DEPLOYMENT_CONFIG'); this.code = 'INVALID_DEPLOYMENT_CONFIG'; }
}

/** No secret, environment JSON or provider error is included in diagnostics. */
export function readDeployment(environment) {
  try {
    const config = cloneDocument(JSON.parse(environment.LEARN_DEPLOYMENT_CONFIG));
    const keyInput = cloneDocument(JSON.parse(environment.LEARN_SECRET_KEYS));
    if (Object.keys(config).sort().join(',') !== 'fontFetchTimeoutMs,fontUrls,runtime,service') throw new DeploymentError();
    selectCloudEnvironment(config.runtime);
    for (const key of ['developmentEnvironmentId', 'productionEnvironmentId', 'appId']) {
      if (typeof config.runtime[key] !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(config.runtime[key])) throw new DeploymentError();
    }
    if (typeof config.runtime.fileIdPrefix !== 'string' || !/^cloud:\/\/[^/\s]+\/$/.test(config.runtime.fileIdPrefix) ||
        !Array.isArray(config.runtime.missingDocumentCodes) || !config.runtime.missingDocumentCodes.length ||
        !config.runtime.missingDocumentCodes.every(code => typeof code === 'string' && code.length > 0 || Number.isSafeInteger(code))) throw new DeploymentError();
    if (config.service.stage !== config.runtime.stage ||
        (config.runtime.stage === 'production' && config.runtime.platformVerified !== true)) throw new DeploymentError();
    if (!Number.isSafeInteger(config.fontFetchTimeoutMs) || config.fontFetchTimeoutMs < 1000 ||
        config.fontFetchTimeoutMs > 120000) throw new DeploymentError();
    const registry = config.service.registry;
    if (!registry || !Array.isArray(registry.cloudEngineVersions) ||
        registry.cloudEngineVersions.some(version => version !== DEVELOPMENT_ENGINE_VERSION)) throw new DeploymentError();
    // This binary contains one real implementation; listing old labels cannot
    // make it execute old algorithms. A future release must retain old code.
    if (Object.keys(config.fontUrls).sort().join(',') !== FONT_RESOURCES.map(font => font.id).sort().join(',')) throw new DeploymentError();
    for (const value of Object.values(config.fontUrls)) {
      if (typeof value !== 'string') throw new DeploymentError();
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new DeploymentError();
    }
    const generation = config.service.generation;
    if (!generation || generation.maxPdfBytes > MAX_PDF_BYTES || generation.maxPages > MAX_PDF_PAGES) throw new DeploymentError();
    const fileAccess = config.service.fileAccess;
    if (!fileAccess || fileAccess.maxFileBytes < generation.maxPdfBytes || fileAccess.maxFileBytes > MAX_PDF_BYTES) throw new DeploymentError();
    const required = new Set([config.service.identityKeyId, generation.windowKeyId, generation.fingerprintKeyId,
      ...generation.retainedWindowKeyIds, ...generation.retainedFingerprintKeyIds]);
    const keys = new Map();
    if (Object.keys(keyInput).length > 65) throw new DeploymentError();
    for (const [id, value] of Object.entries(keyInput)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof value !== 'string') throw new DeploymentError();
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new DeploymentError();
      keys.set(id, bytes);
    }
    if ([...required].some(id => !keys.has(id))) throw new DeploymentError();
    const crypto = Object.freeze({
      randomId: () => randomUUID(),
      async hmacSha256(id, value) {
        const key = keys.get(id);
        if (!key) throw new DeploymentError();
        return createHmac('sha256', key).update(value, 'utf8').digest('hex');
      },
      async sha256(value) { return createHash('sha256').update(value).digest('hex'); },
    });
    return { config, crypto };
  } catch { throw new DeploymentError(); }
}
