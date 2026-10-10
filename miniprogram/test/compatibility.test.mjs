import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(new URL('../../dist/compatibility-tests/', import.meta.url), { recursive: true });
const outfile = fileURLToPath(new URL('../../dist/compatibility-tests/module.mjs', import.meta.url));
await build({ stdin: { contents: `
export { CompatibilitySession } from './miniprogram/lib/compatibility-session.ts';
export { CompatibilityPresets } from './miniprogram/lib/compatibility-presets.ts';
export { EditorSession } from './miniprogram/lib/editor-session.ts';
export { createEditorEnvironment } from './miniprogram/lib/editor-environment.ts';
export { CloudClient } from './miniprogram/lib/cloud-client.ts';
export { getDevelopmentPreset, PAPER_ENGINE_VERSION } from './packages/paper-core/src/index.ts';
export { FONT_RESOURCES } from './packages/font-metrics/dist/index.js';`, resolveDir: root },
  outfile, bundle: true, platform: 'neutral', format: 'esm', target: 'es2017' });
const { CompatibilitySession, CompatibilityPresets, EditorSession, createEditorEnvironment, CloudClient,
  getDevelopmentPreset, PAPER_ENGINE_VERSION, FONT_RESOURCES } = await import(outfile);
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function availability(id = 'essay-grid', version) {
  const preset = clone(getDevelopmentPreset(id));
  if (version) { preset.versions.templateVersion = version; preset.geometry.version = version; }
  return { versions: clone(preset.versions), status: 'ready', published: { registryId: `p_${'a'.repeat(64)}`, preset,
    resources: { fontBundleVersion: preset.versions.fontBundleVersion, fonts: FONT_RESOURCES.map(font => ({
      id: font.id, bytes: font.bytes, sha256: font.sha256, fontVersion: font.fontVersion, location: `https://fonts.example/${font.sha256}.ttf` })) } } };
}
function response(request, current = [availability()], overrides = {}) {
  return { engineSupported: true, current, locked: request.lockedVersions.map(versions =>
    clone(current.find(item => JSON.stringify(item.versions) === JSON.stringify(versions)) ?? { versions, status: 'not-found' })),
    serverTime: 1000, ...overrides };
}
function harness({ fontLoad, platform = {}, now = () => 1000, allowLocal = false } = {}) {
  const presets = new CompatibilityPresets(allowLocal), calls = [], views = [];
  let resetCount = 0, reply = request => response(request);
  const client = new CloudClient(async (method, params) => { calls.push({ method, params: clone(params) });
    try { return { ok: true, data: await reply(params, method) }; }
    catch (error) { return { ok: false, error: { code: error.code, details: error.details } }; } });
  const editor = new EditorSession({ presetFor: id => presets.presetFor(id), loadFonts: fontLoad ?? (async () => { throw { code: 'PREVIEW_FONT_UNAVAILABLE' }; }) });
  const session = new CompatibilitySession(client, editor, presets, platform, () => resetCount++, now);
  session.subscribe(() => views.push(clone(session.view)));
  return { session, editor, presets, client, calls, views, reply(fn) { reply = fn; }, get resetCount() { return resetCount; } };
}
function updates() {
  const callbacks = {}, registered = [], modals = []; let applications = 0, managers = 0;
  const manager = {
    onCheckForUpdate(fn) { registered.push('check'); callbacks.check = fn; },
    onUpdateReady(fn) { registered.push('ready'); callbacks.ready = fn; },
    onUpdateFailed(fn) { registered.push('failed'); callbacks.failed = fn; },
    applyUpdate() { applications++; },
  };
  return { callbacks, registered, modals, manager, platform: { getUpdateManager() { managers++; return manager; }, showModal(options) { modals.push(options); } },
    get applications() { return applications; }, get managers() { return managers; } };
}

test('launch/foreground/manual checks merge one Promise, cache success 60s and throttle failures 5s', async () => {
  let clock = 1000; const h = harness({ now: () => clock }), pending = deferred(); h.reply(() => pending.promise);
  const first = h.session.start(); assert.equal(first, h.session.onShow()); assert.equal(first, h.session.retry());
  await tick(); assert.equal(h.calls.length, 1); assert.equal(h.session.view.status, 'checking');
  pending.resolve(response(h.calls[0].params)); assert.equal(await first, true); assert.equal(h.session.view.canGenerate, true);
  clock += 59999; await h.session.onShow(); assert.equal(h.calls.length, 1);
  h.reply(() => { throw { code: 'NETWORK_UNAVAILABLE' }; }); clock++; await h.session.onShow(); assert.equal(h.calls.length, 2);
  assert.equal(h.session.view.status, 'network-error'); clock += 4999; await h.session.onShow(); assert.equal(h.calls.length, 2);
  clock++; await h.session.onShow(); assert.equal(h.calls.length, 3);
  await h.session.retry(); assert.equal(h.calls.length, 4);
});

test('first trusted preset invalidates stale preview while preserving exact input/options/cleanup and undo', async () => {
  const h = harness(), original = await h.editor.preparePreview(), next = availability('essay-grid', 'v1-test.2');
  h.editor.setBody('hello\r\nworld\n\n保留'); h.editor.prepareCleanup(); h.editor.applyCleanup();
  h.editor.setTitle('标题\r\n'); h.editor.setTracing(true); h.editor.setOptions({ titleAlign: 'right', bodyIndent: 'none' });
  const draft = h.editor.draft, cleanup = h.editor.prepareCleanup(), revision = h.editor.revision;
  h.reply(request => response(request, [next])); await h.session.start();
  assert.equal(h.editor.draft, draft); assert.equal(h.editor.cleanup, cleanup); assert.equal(h.editor.canUndo, true);
  assert.ok(h.editor.revision > revision); assert.notEqual(h.editor.preview, original);
  assert.equal(h.editor.preset.versions.templateVersion, 'v1-test.2'); assert.equal(h.session.view.status, 'ready');
  assert.equal(h.editor.undoCleanup(), true); assert.equal(h.editor.draft.body, 'hello\r\nworld\n\n保留');
  assert.doesNotMatch(JSON.stringify(h.calls), /hello|标题|保留/);
});

test('a supported old locked combination survives active version or engine changes', async () => {
  const h = harness(), old = availability(); await h.session.start(); const preview = h.editor.preview, preset = h.editor.preset;
  const next = availability('essay-grid', 'v1-test.2');
  for (const active of [next, { versions: { ...next.versions, engineVersion: 'learn-engine-next.1' }, status: 'update-required' }]) {
    h.reply(request => response(request, [active], { locked: [old] })); await h.session.retry();
    assert.equal(h.session.view.status, 'ready'); assert.equal(h.editor.preset, preset); assert.equal(h.editor.preview, preview);
  }
});

test('retired lock requires explicit refresh, which preserves draft and regenerates preview using current tuple', async () => {
  const h = harness(); await h.session.start(); const prior = h.editor.preview, next = availability('essay-grid', 'v1-test.2');
  h.reply(request => response(request, [next], { locked: request.lockedVersions.map(versions => ({ versions, status: 'retired' })) }));
  await h.session.retry(); assert.equal(h.session.view.status, 'refresh-required'); assert.equal(h.session.view.canGenerate, false);
  assert.equal(h.editor.preview, prior); const draft = h.editor.draft;
  const refreshing = h.session.refreshResources(); assert.equal(refreshing, h.session.refreshResources());
  assert.equal(await refreshing, true); assert.equal(h.editor.draft, draft); assert.equal(h.resetCount, 1);
  assert.equal(h.editor.preview.layout.versions.templateVersion, 'v1-test.2'); assert.notEqual(h.editor.preview.digest, prior.digest);
  assert.equal(h.session.view.status, 'ready');
});

test('template and input edits while checking use current selection without restoring the request-time draft', async () => {
  const h = harness(), pending = deferred(); h.reply(() => pending.promise); const operation = h.session.start(); await tick();
  h.editor.selectTemplate('pinyin-lines'); h.editor.setBody('nǐ hǎo\r\n');
  pending.resolve(response(h.calls[0].params, [availability(), availability('pinyin-lines', 'v1-test.7')])); await operation;
  assert.equal(h.editor.draft.templateId, 'pinyin-lines'); assert.equal(h.editor.draft.body, 'nǐ hǎo\r\n');
  assert.equal(h.editor.preset.versions.templateVersion, 'v1-test.7'); assert.equal(h.session.view.status, 'ready');
});

test('explicit refresh does not replace a different template selected while its check is pending', async () => {
  const h = harness(); h.reply(request => response(request, [availability(), availability('tian-grid')])); await h.session.start();
  const pending = deferred(); h.reply(() => pending.promise); const operation = h.session.refreshResources(); await tick();
  h.editor.selectTemplate('tian-grid'); const revision = h.editor.revision;
  pending.resolve(response(h.calls.at(-1).params, [availability(), availability('tian-grid')])); assert.equal(await operation, false);
  assert.equal(h.editor.revision, revision); assert.equal(h.resetCount, 0);
});

test('invalid resources and unsupported bundled fonts fail closed without being called a code update', async () => {
  for (const mutate of [ row => row.published.resources.fonts[0].sha256 = 'b'.repeat(64),
    row => row.published.resources.fonts[0].bytes++, row => row.published.resources.fonts[0].fontVersion = 'unknown',
    row => row.published.resources.fonts = [], row => row.published.resources.fonts[0].location = 'http://example/font',
    row => row.published.resources.fonts[0].location = 'local://verified/font',
    row => { row.published.resources.fonts = row.published.resources.fonts.filter(font => font.id !== 'misans-regular'); } ]) {
    const h = harness(), row = availability(); mutate(row); h.reply(request => response(request, [row])); await h.session.start();
    assert.equal(h.session.view.status, 'resource-unavailable'); assert.equal(h.session.view.canGenerate, false);
    assert.equal(h.presets.isVerified(h.editor.preset), false);
  }
  const h = harness({ allowLocal: true }), row = availability(); row.published.resources.fonts.forEach(font => font.location = `local://verified/${font.id}`);
  h.reply(request => response(request, [row])); await h.session.start(); assert.equal(h.session.view.status, 'ready');
});

test('malformed compatibility responses cannot partially install current presets or leak raw strings', async () => {
  for (const mutate of [ data => data.engineSupported = 'yes', data => data.serverTime = Infinity,
    data => data.current.push(clone(data.current[0])), data => data.locked = [],
    data => data.locked[0].versions.templateVersion = 'wrong', data => data.current[0].status = 'PRIVATE',
    data => data.current[0].published.registryId = 'PRIVATE', data => data.current[0].published.preset.geometry.marginTopMm = -5,
    data => data.current[0].published.preset.versions.templateVersion = 'wrong',
    data => data.current[0].published.resources.fonts.push(clone(data.current[0].published.resources.fonts[0])) ]) {
    const h = harness(); h.reply(request => { const data = response(request); mutate(data); return data; }); await h.session.start();
    assert.equal(h.session.view.status, 'resource-unavailable'); assert.equal(h.presets.currentFor('essay-grid'), undefined);
    assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE|Infinity/);
  }
});

test('native cross-realm JSON normalizes without weakening core validation or executing hooks', async () => {
  const h = harness(); h.reply(request => vm.runInNewContext('JSON.parse(serialized)', { serialized: JSON.stringify(response(request)) }));
  await h.session.start(); assert.equal(h.session.view.status, 'ready');
  let executed = false;
  for (const corrupt of [ data => Object.defineProperty(data.current[0].published.preset, 'geometry', { enumerable: true, get() { executed = true; return {}; } }),
    data => { data.current[0].published.preset.toJSON = () => { executed = true; return {}; }; },
    data => { data.current[0].published.preset = new (class BadPreset {})(); } ]) {
    h.reply(request => { const data = response(request); corrupt(data); return data; });
    await h.session.retry(); assert.equal(h.session.view.status, 'resource-unavailable'); assert.equal(executed, false);
  }
});

test('native JSON copying rejects inherited serialization hooks and exotic array prototypes without executing them', async () => {
  let executed = 0;
  for (const corrupt of [
    data => { data.current = new (class ArraySubclass extends Array {})(...data.current); },
    data => Object.setPrototypeOf(data.current, { toJSON() { executed++; return []; } }),
    data => Object.setPrototypeOf(data.current, Object.create(Array.prototype, { toJSON: { get() { executed++; return () => []; } } })),
    data => Object.setPrototypeOf(data, Object.assign(Object.create(null), { toJSON() { executed++; return {}; } })),
    data => Object.setPrototypeOf(data, Object.create(null, { toJSON: { get() { executed++; return () => ({}); } } })),
  ]) {
    const h = harness();
    h.reply(request => { const data = response(request); corrupt(data); return data; });
    await h.session.start();
    assert.equal(h.session.view.status, 'resource-unavailable');
    assert.equal(h.presets.currentFor('essay-grid'), undefined);
    assert.equal(executed, 0);
  }
});

test('verified tuple is immutable and equivalent object key ordering remains valid', async () => {
  const h = harness(); await h.session.start(); const preset = h.editor.preset;
  h.reply(request => { const data = response(request); data.locked[0].published.preset = Object.fromEntries(Object.entries(data.locked[0].published.preset).reverse()); return data; });
  await h.session.retry(); assert.equal(h.session.view.status, 'ready');
  h.reply(request => { const next = availability(); next.published.preset.textStyles.body.fontSizeMm -= 0.1; return response(request, [next]); });
  await h.session.retry(); assert.equal(h.session.view.status, 'resource-unavailable'); assert.equal(h.editor.preset, preset);
});

test('network/service/account/code errors remain distinct and never gate the shared client history API', async () => {
  for (const [code, status] of [['NETWORK_UNAVAILABLE', 'network-error'], ['SERVICE_UNAVAILABLE', 'service-unavailable'],
    ['ACCOUNT_DELETING', 'account-unavailable'], ['ACCOUNT_DISABLED', 'account-unavailable'], ['UPDATE_REQUIRED', 'update-required']]) {
    const h = harness(); await h.session.start(); h.editor.setBody('保留原文'); h.reply((request, method) => { if (method === 'getCompatibility') throw { code, details: 'PRIVATE' }; return { items: [], nextCursor: null, serverTime: 1000 }; });
    await h.session.retry(); assert.equal(h.session.view.status, status); assert.equal(h.editor.draft.body, '保留原文');
    assert.equal(h.session.view.canRefresh, false);
    assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE|保留原文/); await h.client.listJobs({}); assert.equal(h.calls.at(-1).method, 'listJobs');
  }
});

test('unsupported engine response blocks generation even if a contradictory ready row is present', async () => {
  const h = harness(); h.reply(request => response(request, [availability()], { engineSupported: false })); await h.session.start();
  assert.equal(h.session.view.status, 'update-required'); assert.equal(h.session.view.canRefresh, false);
});

test('clearing cancels queued compatibility, in-flight responses and old preview computations', async () => {
  const h = harness(); const queued = h.session.start(); h.session.clearUserData(); assert.equal(await queued, false); assert.equal(h.calls.length, 0);
  const pending = deferred(); h.reply(() => pending.promise); const active = h.session.retry(); await tick(); h.session.clearUserData();
  pending.resolve(response(h.calls[0].params)); assert.equal(await active, false); assert.equal(h.session.view.status, 'idle'); assert.equal(h.presets.currentFor('essay-grid'), undefined);
  const font = deferred(), withText = harness({ fontLoad: () => font.promise }); withText.editor.setBody('原文');
  const preview = withText.editor.preparePreview(); withText.editor.clear(); font.reject({ code: 'PREVIEW_FONT_INVALID' });
  assert.equal(await preview, null); assert.equal(withText.editor.status, 'idle'); assert.equal(withText.editor.draft.body, '');
});

test('UpdateManager listeners register once and neither hasUpdate nor ready automatically prompts/restarts', async () => {
  const update = updates(), h = harness({ platform: update.platform }); await h.session.start(); await h.session.start(); await h.session.onShow();
  assert.equal(update.managers, 1); assert.deepEqual(update.registered, ['check', 'ready', 'failed']);
  update.callbacks.check({ hasUpdate: true }); assert.equal(h.session.view.updateStatus, 'downloading');
  assert.equal(await h.session.requestUpdate(), false); update.callbacks.ready(); assert.equal(h.session.view.canUpdate, true);
  assert.equal(update.modals.length, 0); assert.equal(update.applications, 0);
});

test('only ready plus explicit confirmation applies once and duplicate taps share no second modal', async () => {
  const update = updates(), h = harness({ platform: update.platform }); h.editor.setBody('当前文字'); await h.session.start(); update.callbacks.ready();
  const operation = h.session.requestUpdate(); assert.equal(await h.session.requestUpdate(), false); assert.equal(update.modals.length, 1);
  assert.match(update.modals[0].content, /不会保留.*复制保存/); assert.doesNotMatch(update.modals[0].content, /当前文字$/);
  update.modals[0].success({ confirm: true }); assert.equal(await operation, true); assert.equal(update.applications, 1);
  assert.equal(await h.session.requestUpdate(), false); assert.equal(h.session.view.canUpdate, false); assert.equal(h.editor.draft.body, '当前文字');
});

test('cancel/failure/input revision/background/cleanup invalidate native update confirmation', async () => {
  for (const mode of ['cancel', 'failure', 'edit', 'hide', 'clear']) {
    const update = updates(), h = harness({ platform: update.platform }); await h.session.start(); update.callbacks.ready();
    const operation = h.session.requestUpdate();
    if (mode === 'failure') update.callbacks.failed();
    if (mode === 'edit') { h.editor.setBody('更改'); h.editor.setBody(''); }
    if (mode === 'hide') { h.session.onHide(); await h.session.onShow(); }
    if (mode === 'clear') h.session.clearUserData();
    update.modals[0].success({ confirm: mode !== 'cancel' });
    assert.equal(await operation, false, mode); assert.equal(update.applications, 0); assert.equal(h.session.view.canUpdate, mode !== 'failure');
  }
});

test('clearing resolves a never-returning modal so a later explicit action can be confirmed', async () => {
  const update = updates(), h = harness({ platform: update.platform }); await h.session.start(); update.callbacks.ready();
  const obsolete = h.session.requestUpdate(); h.session.clearUserData(); assert.equal(await obsolete, false);
  const current = h.session.requestUpdate(); update.modals[0].success({ confirm: true }); assert.equal(update.applications, 0);
  update.modals[1].success({ confirm: true }); assert.equal(await current, true); assert.equal(update.applications, 1);
});

test('missing update APIs, failed download and absent update stay recoverable without clearing text', async () => {
  const missing = harness(); await missing.session.start(); assert.equal(await missing.session.requestUpdate(), false);
  const update = updates(), h = harness({ platform: update.platform }); h.editor.setBody('保留');
  h.reply(request => response(request, [], { engineSupported: false })); await h.session.start();
  update.callbacks.check({ hasUpdate: false }); assert.match(h.session.view.updateMessage, /暂未发现/);
  update.callbacks.failed(); assert.match(h.session.view.updateMessage, /下载失败/); assert.equal(h.editor.draft.body, '保留');
  update.callbacks.ready(); const operation = h.session.requestUpdate(); update.modals[0].fail(); assert.equal(await operation, false);
  assert.equal(h.session.view.canUpdate, true);
});

test('application composition owns one initialized client, keeps generation unavailable, and centrally clears all local owners', async () => {
  const calls = [], platform = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ readFile({ fail }) { fail(); } }),
    cloud: { init(options) { calls.push(options); }, callFunction() {} } };
  const env = createEditorEnvironment(platform, { environmentId: 'env-test', functionName: 'learn-service' });
  assert.equal(calls.length, 1); assert.equal(calls[0].traceUser, false);
  env.client.transport = async (method, request) => ({ ok: true, data: response(request) });
  await env.compatibility.start(); assert.equal(env.compatibility.view.canGenerate, true); assert.equal(env.generation.available, false);
  env.editor.setBody('hello\nworld'); env.editor.prepareCleanup(); env.editor.applyCleanup(); env.editor.setTitle('标题'); env.editor.setTracing(true);
  env.editor.setOptions({ titleAlign: 'right', bodyIndent: 'none' }); env.editor.prepareCleanup();
  const cleaned = []; env.registerUserDataCleanup(() => { cleaned.push('one'); throw new Error('ignored cleanup'); });
  env.registerUserDataCleanup(() => cleaned.push('two')); const unregister = env.registerUserDataCleanup(() => cleaned.push('removed')); unregister();
  assert.throws(() => env.clearUserData(), /^Error: LOCAL_DATA_CLEAR_FAILED$/);
  assert.deepEqual(cleaned, ['one', 'two']); assert.equal(env.editor.hasInput, false); assert.equal(env.editor.draft.tracing, false);
  assert.equal(env.editor.cleanup, null); assert.equal(env.editor.canUndo, false); assert.equal(env.editor.preview, null); assert.equal(env.compatibility.view.status, 'idle');
});
