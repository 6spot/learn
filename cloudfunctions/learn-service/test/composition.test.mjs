import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FONT_RESOURCES, FONT_BUNDLE_VERSION } from '../../../packages/font-metrics/dist/index.js';
import { ServiceError } from '../../../packages/cloud-service/dist/index.js';
import { RuntimeError } from '../../../packages/cloud-runtime/dist/index.js';
import { readDeployment } from '../config.mjs';
import { createHostedFonts } from '../resources.mjs';
import { createProductionService } from '../service.mjs';
import { createRpcHandler } from '../rpc.mjs';

import { fixture } from './fixtures.mjs';

const safeConfigError = { code: 'INVALID_DEPLOYMENT_CONFIG', message: 'INVALID_DEPLOYMENT_CONFIG' };

test('deployment selects explicit environment and retains actual cryptographic keys privately', async () => {
  const f = fixture(), value = readDeployment(f.environment());
  assert.equal(value.config.runtime.stage, 'development');
  const expected = createHmac('sha256', Buffer.from(f.keys.window, 'base64')).update('test').digest('hex');
  assert.equal(await value.crypto.hmacSha256('window', 'test'), expected);
  assert.match(value.crypto.randomId(), /^[0-9a-f-]{36}$/);
  assert.equal(await value.crypto.sha256(new Uint8Array([1, 2])), createHash('sha256').update(new Uint8Array([1, 2])).digest('hex'));
  await assert.rejects(value.crypto.hmacSha256('absent', 'test'), safeConfigError);
  assert.ok(!JSON.stringify(value).includes(f.keys.window));
});

test('malformed, mixed, unverified, unsupported or incomplete deployments fail safely', () => {
  for (const change of [
    f => { f.config.runtime.developmentEnvironmentId = f.config.runtime.productionEnvironmentId; },
    f => { f.config.runtime.appId = {}; },
    f => { f.config.runtime.fileIdPrefix = 'public'; },
    f => { f.config.runtime.missingDocumentCodes = []; },
    f => { f.config.service.stage = 'production'; },
    f => { f.config.runtime.stage = f.config.service.stage = 'production'; },
    f => { f.config.runtime.stage = f.config.service.stage = 'production'; f.config.runtime.platformVerified = true; delete f.config.service.lifecycle; },
    f => { f.config.runtime.stage = f.config.service.stage = 'production'; f.config.runtime.platformVerified = true; delete f.config.service.stats; },
    f => { f.config.service.registry.cloudEngineVersions.push('not-implemented'); },
    f => { f.config.fontFetchTimeoutMs = 0; },
    f => { f.config.fontUrls['misans-regular'] = 'http://example.invalid/font'; },
    f => { f.config.fontUrls['misans-regular'] = 'https://secret@example.invalid/font'; },
    f => { f.config.fontUrls['misans-regular'] = 'https://example.invalid/font#fragment'; },
    f => { delete f.config.fontUrls['misans-regular']; },
    f => { delete f.keys.window; },
    f => { f.keys.identity = 'secret'; },
    f => { f.keys.identity += '\n'; },
    f => { f.config.service.generation.maxPdfBytes = 100000000; },
    f => { f.config.service.generation.maxPages = 51; },
    f => { f.config.extra = 'secret'; },
  ]) { const f = fixture(); change(f); assert.throws(() => readDeployment(f.environment()), safeConfigError); }
  for (const input of [{}, { LEARN_DEPLOYMENT_CONFIG: '{secret' }, { LEARN_DEPLOYMENT_CONFIG: '[]', LEARN_SECRET_KEYS: '{}' }]) {
    assert.throws(() => readDeployment(input), safeConfigError);
  }
});

test('actual production composition constructs SDK adapters and validates service config', async () => {
  const f = fixture(), calls = [];
  const sdk = { init: value => calls.push(value), database: () => ({}), getWXContext: () => ({ OPENID: 'test-user', APPID: 'wrong-app' }) };
  const composition = createProductionService(sdk, f.environment(), () => { throw new Error('must not fetch during composition'); });
  assert.deepEqual(calls, [{ env: 'test-dev' }]);
  await assert.rejects(composition.service.getAccount(), { code: 'UNAUTHENTICATED' });
  f.config.service.monthlyFreeCredits = -1;
  assert.throws(() => createProductionService(sdk, f.environment()), { code: 'INVALID_CONFIG' });
});

test('production composition rejects incomplete privacy and statistics values after section presence checks', () => {
  const sdk = { init() {}, database: () => ({}), getWXContext: () => ({}) };
  const production = () => {
    const f = fixture();
    f.config.runtime.stage = f.config.service.stage = 'production';
    f.config.runtime.platformVerified = true;
    f.config.runtime.fileIdPrefix = 'cloud://test-prod.bucket/';
    return f;
  };
  assert.doesNotThrow(() => createProductionService(sdk, production().environment()));
  for (const section of ['stats', 'lifecycle']) {
    for (const key of Object.keys(production().config.service[section])) {
      for (const value of [undefined, null]) {
        const f = production();
        f.config.service[section][key] = value;
        assert.throws(() => createProductionService(sdk, f.environment()), { code: 'INVALID_CONFIG' }, `${section}.${key}`);
      }
    }
  }
});

test('RPC uses an explicit allowlist and rejects injected identity or inherited dispatch', async () => {
  const seen = [];
  const handler = createRpcHandler({ getAccount: async () => { seen.push('account'); return { available: 3 }; } });
  assert.deepEqual(await handler({ method: 'getAccount', params: {} }), { ok: true, data: { available: 3 } });
  for (const method of ['constructor', 'toString', '__proto__', 'recoverJobs', 'execute']) {
    assert.deepEqual(await handler({ method, params: {} }), { ok: false, error: { code: 'INVALID_ARGUMENT' } });
  }
  assert.equal((await handler({ method: 'getAccount', params: { userId: 'victim' } })).ok, false);
  assert.deepEqual(seen, ['account']);
});

test('RPC snapshots requests before awaiting and never invokes serialization hooks', async () => {
  let observed, calls = 0;
  const handler = createRpcHandler({ submitGeneration: async request => { await Promise.resolve(); observed = request; return {}; } });
  const event = { method: 'submitGeneration', params: { requestId: 'first', input: { body: 'private' }, versions: {}, layoutDigest: 'digest' } };
  const pending = handler(event); event.params.input.body = 'changed'; await pending;
  assert.equal(observed.input.body, 'private');
  const malicious = { method: 'getAccount', params: { get x() { calls++; return 1; } } };
  assert.equal((await handler(malicious)).ok, false); assert.equal(calls, 0);
  const params = []; Object.setPrototypeOf(params, { toJSON() { calls++; return {}; } });
  assert.equal((await handler({ method: 'getAccount', params })).ok, false); assert.equal(calls, 0);
});

test('statistics RPC forwards only the requested date and cannot assert administrator identity', async () => {
  const seen = [];
  const handler = createRpcHandler({ getAdminStats: async request => { seen.push(request); return { date: request.date }; } });
  assert.deepEqual(await handler({ method: 'getAdminStats', params: { date: '2026-10-11' } }), { ok: true, data: { date: '2026-10-11' } });
  for (const extra of [{ userId: 'admin' }, { role: 'admin' }, { maxScanRecords: 1 }]) {
    assert.deepEqual(await handler({ method: 'getAdminStats', params: extra }), { ok: false, error: { code: 'INVALID_ARGUMENT' } });
  }
  assert.equal(seen.length, 1);
});

test('privacy RPC uses trusted service identity and requires the explicit confirmation field', async () => {
  const seen = [];
  const handler = createRpcHandler({ getPrivacyInfo: async () => ({ policyVersion: 'learn-privacy-v1' }),
    getDeletionStatus: async () => ({ state: 'none' }),
    deleteMyData: async request => { seen.push(request); return { state: 'deleting' }; } });
  assert.equal((await handler({ method: 'getPrivacyInfo', params: {} })).data.policyVersion, 'learn-privacy-v1');
  assert.equal((await handler({ method: 'getDeletionStatus', params: {} })).data.state, 'none');
  for (const method of ['getPrivacyInfo', 'getDeletionStatus', 'deleteMyData']) {
    assert.equal((await handler({ method, params: { confirm: true, userId: 'victim' } })).ok, false);
  }
  assert.equal((await handler({ method: 'deleteMyData', params: {} })).ok, false);
  assert.deepEqual(await handler({ method: 'deleteMyData', params: { confirm: true } }), { ok: true, data: { state: 'deleting' } });
  assert.deepEqual(seen, [{ confirm: true }]);
});

test('RPC projects only trusted safe error codes and null for void', async () => {
  for (const [error, code] of [[new Error('private content'), 'INTERNAL_ERROR'], [{ code: 'secret' }, 'INTERNAL_ERROR'],
    [new ServiceError('FORBIDDEN'), 'FORBIDDEN'], [new RuntimeError('DATABASE_UNAVAILABLE'), 'DATABASE_UNAVAILABLE']]) {
    const result = await createRpcHandler({ getAccount: async () => { throw error; } })({ method: 'getAccount', params: {} });
    assert.deepEqual(result, { ok: false, error: { code } });
  }
  assert.deepEqual(await createRpcHandler({ activatePreset: async () => {} })({ method: 'activatePreset', params: { versions: {} } }), { ok: true, data: null });
});

const latin = FONT_RESOURCES.find(font => font.id === 'misans-latin-regular');
const manifest = JSON.parse(await readFile(new URL('../../../assets/fonts/manifest.json', import.meta.url), 'utf8'));
const latinEntry = manifest.fonts.find(font => font.id === latin.id);
const original = new Uint8Array(await readFile(new URL(`../../../assets/fonts/${latinEntry.path}`, import.meta.url)));
const crypto = { sha256: async bytes => createHash('sha256').update(bytes).digest('hex') };
const response = bytes => ({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });

test('hosted resources verify original bytes, share downloads and return defensive copies', async () => {
  let calls = 0;
  const fonts = createHostedFonts(fixture().config.fontUrls, crypto, 1000, async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.match(url, /^https:/); return response(original);
  });
  const [a, b] = await Promise.all([fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION), fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION)]);
  assert.equal(calls, 1); assert.deepEqual(a, original); a.fill(0); assert.deepEqual(b, original);
  assert.deepEqual(await fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION), original);
  const descriptor = await fonts.resources.describeBundle(FONT_BUNDLE_VERSION); descriptor.fonts[0].bytes = 0;
  assert.ok((await fonts.resources.describeBundle(FONT_BUNDLE_VERSION)).fonts[0].bytes > 0);
  assert.equal(await fonts.resources.describeBundle('wrong'), null);
  await assert.rejects(fonts.resources.readFontBytes('wrong', FONT_BUNDLE_VERSION), { code: 'RESOURCE_UNAVAILABLE' });
  await assert.rejects(fonts.loadMetrics({ versions: { fontBundleVersion: 'wrong' } }), { code: 'RESOURCE_UNAVAILABLE' });
});

test('short, oversized, corrupt, status and thrown downloads fail safely and can retry', async () => {
  for (const bad of [() => response(original.slice(1)), () => response(new Uint8Array(original.length + 1)),
    () => response(new Uint8Array(original.length)), () => ({ ok: false }), () => { throw new Error('secret URL'); }]) {
    let calls = 0;
    const fonts = createHostedFonts(fixture().config.fontUrls, crypto, 1000, async () => ++calls === 1 ? bad() : response(original));
    await assert.rejects(fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION), { code: 'RESOURCE_UNAVAILABLE', message: 'RESOURCE_UNAVAILABLE' });
    assert.deepEqual(await fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION), original);
  }
});

test('deadline bounds stalled fetch, body read and cancellation providers', async () => {
  for (const fetcher of [() => new Promise(() => {}), async () => ({ ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }) } })]) {
    const fonts = createHostedFonts(fixture().config.fontUrls, crypto, 20, fetcher);
    await assert.rejects(fonts.resources.readFontBytes(latin.id, FONT_BUNDLE_VERSION), { code: 'RESOURCE_UNAVAILABLE' });
  }
});

test('RPC emits bounded file bytes as base64 and keeps server file capabilities private', async () => {
  const calls = [];
  const handler = createRpcHandler({ readPdfChunk: async request => {
    calls.push(request); return { jobId: 'j_test', offset: 0, nextOffset: null, totalBytes: 3, sha256: '0'.repeat(64), expiresAt: 99, bytes: new Uint8Array([0, 127, 255]) };
  } });
  const result = await handler({ method: 'readPdfChunk', params: { jobId: 'j_test', offset: 0 } });
  assert.equal(result.data.bytes, 'AH//'); assert.equal(calls.length, 1);
  assert.equal((await handler({ method: 'readPdfChunk', params: { fileId: 'private', jobId: 'j_test', offset: 0 } })).ok, false);
  assert.equal(calls.length, 1);
});
