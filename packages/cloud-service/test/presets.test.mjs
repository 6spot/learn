import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { MemoryMetadataStore, ManualClock } from '@learn/cloud-runtime';
import { getDevelopmentPreset, DEVELOPMENT_ENGINE_VERSION, DEVELOPMENT_FONT_BUNDLE_VERSION } from '@learn/paper-core';
import { CloudService } from '../dist/index.js';
import { retainPresetInTransaction, releasePresetInTransaction, loadPresetForJob } from '../dist/presets.js';

function preset(version = 'v1-development.1', engine = DEVELOPMENT_ENGINE_VERSION) {
  const value = structuredClone(getDevelopmentPreset('tian-grid'));
  value.versions.templateVersion = version;
  value.geometry.version = version;
  value.versions.engineVersion = engine;
  return value;
}

async function fixture(overrides = {}) {
  const store = new MemoryMetadataStore();
  const clock = new ManualClock(Date.parse('2026-10-10T00:00:00Z'));
  let subject = 'trusted_admin';
  const bytes = new Map(['misans-regular', 'misans-latin-regular', 'lxgw-wenkai-gb-regular'].map(id => [id, Buffer.from(`synthetic-font-${id}`)]));
  let bundle = { fontBundleVersion: DEVELOPMENT_FONT_BUNDLE_VERSION, fonts: [...bytes].map(([id, content]) => ({
    id, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), fontVersion: 'test.1', location: `https://example.invalid/fonts/${id}.ttf`,
  })) };
  let beforeRead = () => {};
  const dependencies = { store, clock, identity: { current: () => ({ subject, appId: 'trusted_app' }) },
    crypto: { hmacSha256: async (key, text) => createHmac('sha256', `test-${key}`).update(text).digest('hex'),
      sha256: async value => createHash('sha256').update(value).digest('hex'), randomId: randomUUID },
    resources: { describeBundle: async version => version === bundle?.fontBundleVersion ? structuredClone(bundle) : null,
      readFontBytes: async id => { beforeRead(); return bytes.get(id); } } };
  const config = { stage: 'development', monthlyFreeCredits: 20, quotaTimeZone: 'Asia/Shanghai', identityKeyId: 'identity_test_only',
    adminUserIds: [], registry: { cloudEngineVersions: [DEVELOPMENT_ENGINE_VERSION], clientReadyEngineVersions: [DEVELOPMENT_ENGINE_VERSION] }, ...overrides };
  const userId = (await new CloudService(dependencies, config).getAccount()).userId;
  const service = new CloudService(dependencies, { ...config, adminUserIds: [userId] });
  return { store, dependencies, config, service, userId, bytes, bundle, setSubject: value => { subject = value; },
    setBundle: value => { bundle = value; }, beforeRead: fn => { beforeRead = fn; },
    newService: changes => new CloudService(dependencies, { ...config, adminUserIds: [userId], ...changes }) };
}

const accepted = { fontLicense: true, print: true, resources: true, evidenceId: 'synthetic-evidence-only' };

test('published presets are immutable and current pointer exposes exactly one version', async () => {
  const f = await fixture();
  const first = await f.service.publishPreset(preset());
  await assert.rejects(f.service.publishPreset(preset()), { code: 'VERSION_EXISTS' });
  await f.service.activatePreset(first.preset.versions);
  const second = await f.service.publishPreset(preset('v2'));
  await Promise.all([f.service.activatePreset(first.preset.versions), f.service.activatePreset(second.preset.versions)]);
  const response = await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION });
  assert.equal(response.current.length, 1);
  assert.equal(response.current[0].published.registryId, second.registryId);
  response.current[0].published.preset.defaults.titleAlign = 'right';
  assert.equal((await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION })).current[0].published.preset.defaults.titleAlign, 'center');
  assert.equal((await f.store.list('preset_versions')).length, 2);
});

test('every admin operation checks trusted current identity and never honors caller role', async () => {
  const f = await fixture();
  const version = await f.service.publishPreset(preset());
  f.setSubject('ordinary_user');
  for (const action of [() => f.service.publishPreset(preset('v2'), { ...accepted, isAdmin: true }),
    () => f.service.activatePreset(version.preset.versions, { userId: f.userId }),
    () => f.service.retirePreset(version.preset.versions), () => f.service.removePreset(version.preset.versions)]) {
    await assert.rejects(action(), { code: 'FORBIDDEN' });
  }
  assert.equal((await f.store.list('admin_audit_logs')).length, 1);
});

test('core rejects forged geometry; missing required font and unsupported combinations are refused', async () => {
  const f = await fixture();
  const forged = preset(); forged.geometry.cellMm = 14;
  await assert.rejects(f.service.publishPreset(forged), { code: 'INVALID_PRESET' });
  const mismatched = preset(); mismatched.versions.fontBundleVersion = 'unavailable_bundle';
  await assert.rejects(f.service.publishPreset(mismatched), { code: 'RESOURCE_UNAVAILABLE' });
  f.setBundle({ ...f.bundle, fonts: f.bundle.fonts.filter(font => font.id !== 'lxgw-wenkai-gb-regular') });
  await assert.rejects(f.service.publishPreset(preset()), { code: 'RESOURCE_UNAVAILABLE' });
  assert.equal((await f.store.list('preset_versions')).length, 0);
});

test('cloud support and publication precede client readiness and activation', async () => {
  const f = await fixture({ registry: { cloudEngineVersions: [DEVELOPMENT_ENGINE_VERSION], clientReadyEngineVersions: [] } });
  await assert.rejects(f.service.activatePreset(preset().versions), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.publishPreset(preset('v2', 'not-deployed')), { code: 'UPDATE_REQUIRED' });
  const published = await f.service.publishPreset(preset());
  await assert.rejects(f.service.activatePreset(published.preset.versions), { code: 'CLIENT_NOT_READY' });
  const ready = f.newService({ registry: { cloudEngineVersions: [DEVELOPMENT_ENGINE_VERSION], clientReadyEngineVersions: [DEVELOPMENT_ENGINE_VERSION] } });
  await ready.activatePreset(published.preset.versions);
  assert.equal((await ready.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION })).current[0].status, 'ready');
});

test('production refuses development candidates and requires authenticated acceptance evidence', async () => {
  const f = await fixture({ stage: 'production' });
  await assert.rejects(f.service.publishPreset(preset(), accepted), { code: 'RELEASE_NOT_ACCEPTED' });
  const release = preset(); release.stage = 'validated-release';
  await assert.rejects(f.service.publishPreset(release), { code: 'RELEASE_NOT_ACCEPTED' });
  await assert.rejects(f.service.publishPreset(release, { ...accepted, print: false }), { code: 'RELEASE_NOT_ACCEPTED' });
  const published = await f.service.publishPreset(release, accepted);
  await f.service.activatePreset(published.preset.versions);
  const record = await f.store.get('preset_versions', published.registryId);
  assert.equal(record.publishedBy, f.userId);
  assert.equal(record.acceptance.evidenceId, accepted.evidenceId);
});

test('changing deployment stage cannot promote an unaccepted development publication', async () => {
  const f = await fixture();
  const version = await f.service.publishPreset(preset());
  await f.service.activatePreset(version.preset.versions);
  const production = f.newService({ stage: 'production' });
  await assert.rejects(production.activatePreset(version.preset.versions), { code: 'RELEASE_NOT_ACCEPTED' });
  assert.equal((await production.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION })).current[0].status, 'resource-unavailable');
});

test('hash drift and descriptor changes fail compatibility without silently substituting fonts', async () => {
  const f = await fixture();
  const published = await f.service.publishPreset(preset());
  await f.service.activatePreset(published.preset.versions);
  const saved = f.bytes.get('misans-regular');
  f.bytes.set('misans-regular', Buffer.from('mutated-font'));
  assert.equal((await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION })).current[0].status, 'resource-unavailable');
  await assert.rejects(f.service.activatePreset(published.preset.versions), { code: 'RESOURCE_UNAVAILABLE' });
  f.bytes.set('misans-regular', saved);
  f.setBundle({ ...f.bundle, fonts: f.bundle.fonts.map(font => ({ ...font, location: `${font.location}?changed=1` })) });
  assert.equal((await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION })).current[0].status, 'resource-unavailable');
});

test('active engine update preserves a supported old locked editing combination', async () => {
  const engines = [DEVELOPMENT_ENGINE_VERSION, 'engine-v2'];
  const f = await fixture({ registry: { cloudEngineVersions: engines, clientReadyEngineVersions: engines } });
  const old = await f.service.publishPreset(preset());
  await f.service.activatePreset(old.preset.versions);
  const next = await f.service.publishPreset(preset('v2', 'engine-v2'));
  await f.service.activatePreset(next.preset.versions);
  const response = await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION, lockedVersions: [old.preset.versions] });
  assert.equal(response.engineSupported, true);
  assert.equal(response.current[0].status, 'update-required');
  assert.equal(response.locked[0].status, 'ready');
  assert.equal(response.locked[0].published.registryId, old.registryId);
});

test('retirement blocks new use but retained jobs load old resources until final release', async () => {
  const f = await fixture();
  const old = await f.service.publishPreset(preset());
  await f.service.activatePreset(old.preset.versions);
  await assert.rejects(f.service.retirePreset(old.preset.versions), { code: 'VERSION_IN_USE' });
  await f.store.transaction(tx => retainPresetInTransaction(tx, old.registryId, 'running_job'));
  const next = await f.service.publishPreset(preset('v2'));
  await f.service.activatePreset(next.preset.versions);
  await f.service.retirePreset(old.preset.versions);
  await assert.rejects(f.store.transaction(tx => retainPresetInTransaction(tx, old.registryId, 'new_job')), { code: 'VERSION_RETIRED' });
  assert.equal((await loadPresetForJob(f.store, old.registryId, 'running_job')).registryId, old.registryId);
  await assert.rejects(f.service.removePreset(old.preset.versions), { code: 'VERSION_IN_USE' });
  await Promise.all(Array.from({ length: 20 }, () => f.store.transaction(tx => releasePresetInTransaction(tx, old.registryId, 'running_job'))));
  await f.service.removePreset(old.preset.versions);
  assert.equal(await f.store.get('preset_versions', old.registryId), null);
  assert.equal((await f.store.get('preset_states', old.registryId)).state, 'removed');
  await assert.rejects(f.service.publishPreset(preset()), { code: 'VERSION_EXISTS' });
  const response = await f.service.getCompatibility({ engineVersion: DEVELOPMENT_ENGINE_VERSION, lockedVersions: [old.preset.versions] });
  assert.equal(response.locked[0].status, 'not-found');
});

test('concurrent retains count once per job and retirement/removal cannot race past held references', async () => {
  const f = await fixture();
  const published = await f.service.publishPreset(preset());
  await Promise.all(Array.from({ length: 30 }, (_, index) => f.store.transaction(tx =>
    retainPresetInTransaction(tx, published.registryId, `job_${index % 10}`))));
  assert.equal((await f.store.get('preset_states', published.registryId)).references, 10);
  await f.service.retirePreset(published.preset.versions);
  await assert.rejects(f.service.removePreset(published.preset.versions), { code: 'VERSION_IN_USE' });
  assert.equal((await f.store.list('preset_versions')).length, 1);
});

test('activation commit failure leaves previous active pointer and no partial audit', async () => {
  const f = await fixture();
  const first = await f.service.publishPreset(preset());
  await f.service.activatePreset(first.preset.versions);
  const next = await f.service.publishPreset(preset('v2'));
  const audits = (await f.store.list('admin_audit_logs')).length;
  f.beforeRead(() => f.store.failNextCommit());
  await assert.rejects(f.service.activatePreset(next.preset.versions), { code: 'INTERNAL_ERROR' });
  f.beforeRead(() => {});
  assert.equal((await f.store.get('active_presets', 'tian-grid')).registryId, first.registryId);
  assert.equal((await f.store.list('admin_audit_logs')).length, audits);
});
