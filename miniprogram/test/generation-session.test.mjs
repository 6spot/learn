import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getDevelopmentPreset } from '../../packages/paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../packages/font-metrics/dist/index.js';
import { executionFixture, deferred } from '../../packages/cloud-service/test/execution-fixture.mjs';

async function moduleFrom(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', target: 'es2017', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { GenerationSession } = await moduleFrom('../lib/generation-session.ts');
const { EditorSession } = await moduleFrom('../lib/editor-session.ts');
const { CloudClient, CloudClientError } = await moduleFrom('../lib/cloud-client.ts');
const font = new Uint8Array(await readFile(new URL('../../assets/fonts/files/MiSans-Regular.ttf', import.meta.url)));
const fonts = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { 'misans-regular': font } });
const windowId = 'w1.window.1.1000.11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);
const window = { windowId, expiresAt: parseInt('1000', 36) };
const tick = async (count = 30) => { for (let n = 0; n < count; n++) await Promise.resolve(); };
function timers() {
  let id = 0; const callbacks = new Map();
  return { set(fn) { callbacks.set(++id, fn); return id; }, clear(value) { callbacks.delete(value); },
    fire() { for (const fn of [...callbacks.values()]) fn(); }, get size() { return callbacks.size; } };
}
function job(request, status = 'SUCCEEDED', index = 1) {
  return { jobId: `j_${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`, requestId: request.requestId,
    templateId: request.input.templateId, status, createdAt: 1, startedAt: 1, finishedAt: status === 'SUCCEEDED' ? 2 : null,
    pageCount: 1, errorCode: null, fileExpiresAt: 3 };
}
function fixture(overrides = {}) {
  const clock = timers(), calls = { random: 0, window: 0, submit: [], query: [] }, navigations = [];
  const editor = new EditorSession({ presetFor: getDevelopmentPreset, loadFonts: async () => fonts });
  const deps = { editor, timers: clock, waitTimeoutMs: 100, canGenerate: () => true,
    secureUuid: async () => { calls.random++; return randomUUID(); }, onJobKnown: id => { navigations.push(id); },
    client: { getSubmissionWindow: async () => { calls.window++; return window; },
      submitGeneration: async request => { calls.submit.push(request); return { job: job(request, 'SUCCEEDED', calls.submit.length), submission: 'settled' }; },
      findJobByRequest: async id => { calls.query.push(id); return null; } }, ...overrides };
  const session = new GenerationSession(deps);
  return { session, deps, editor: deps.editor, calls, navigations, clock };
}
function safeView(view) {
  const text = JSON.stringify(view);
  for (const secret of ['private body', 'private title', 'layoutDigest', 'requestId', 'fingerprint']) assert.ok(!text.includes(secret));
}

test('double taps share a real current preview, one immutable request and one known-job callback', async () => {
  const f = fixture(); f.editor.setBody('春天'); f.editor.setTitle('标题');
  const a = f.session.submit(), b = f.session.submit(); assert.equal(a, b);
  const result = await a;
  assert.equal(result.kind, 'known'); assert.equal(f.calls.random, 1); assert.equal(f.calls.window, 1); assert.equal(f.calls.submit.length, 1);
  const request = f.calls.submit[0];
  assert.equal(request.input.body, '春天'); assert.equal(request.input.title, '标题');
  assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.input)); assert.ok(Object.isFrozen(request.input.options)); assert.ok(Object.isFrozen(request.versions));
  assert.equal(f.navigations.length, 1); assert.equal(f.clock.size, 0); safeView(f.session.view);
});

test('editing before asynchronous preview completes prevents nonce, signing and submission', async () => {
  const gate = deferred();
  const editor = new EditorSession({ presetFor: getDevelopmentPreset, loadFonts: () => gate.promise });
  editor.setBody('旧文字');
  const f = fixture({ editor }); const pending = f.session.submit(); await tick();
  editor.setBody('新文字'); gate.resolve(fonts);
  assert.equal((await pending).kind, 'blocked');
  assert.equal(f.calls.random, 0); assert.equal(f.calls.window, 0); assert.equal(f.calls.submit.length, 0);
  assert.match(f.session.view.message, /内容已变化/); assert.equal(editor.draft.body, '新文字');
});

test('edits while secure random or window issuance awaits cannot contaminate captured input/options/version/digest', async () => {
  for (const phase of ['random', 'window']) {
    const f = fixture(); f.editor.setBody('原文'); f.editor.setTitle('原题');
    const preview = await f.editor.preparePreview(); const gate = deferred();
    if (phase === 'random') f.deps.secureUuid = () => gate.promise;
    else f.deps.client.getSubmissionWindow = () => gate.promise;
    const pending = f.session.submit(); await tick();
    f.editor.setBody('更改'); f.editor.setTitle('新题'); f.editor.setTracing(true); f.editor.setOptions({ titleAlign: 'right', bodyIndent: 'none' });
    f.editor.selectTemplate('tian-grid');
    gate.resolve(phase === 'random' ? randomUUID() : window); await pending;
    const sent = f.calls.submit[0];
    assert.equal(sent.input.body, '原文'); assert.equal(sent.input.title, '原题'); assert.equal(sent.input.tracing, false);
    assert.equal(sent.input.templateId, 'essay-grid'); assert.equal(sent.layoutDigest, preview.digest);
    assert.deepEqual(sent.versions, preview.layout.versions); assert.notEqual(sent.input.options.titleAlign, 'right');
  }
});

test('a failed window before any submission can retry while preserving the captured preview', async () => {
  const f = fixture(); f.editor.setBody('原文'); let fail = true;
  f.deps.client.getSubmissionWindow = async () => { f.calls.window++; if (fail) throw new CloudClientError('NETWORK_UNAVAILABLE'); return window; };
  assert.equal((await f.session.submit()).kind, 'blocked'); assert.equal(f.calls.submit.length, 0);
  f.editor.setBody('新文'); fail = false;
  assert.equal((await f.session.retry()).kind, 'known'); assert.equal(f.calls.submit[0].input.body, '原文');
  assert.equal(f.calls.random, 1); assert.equal(f.calls.window, 2);
});

test('a definite admission rejection retries the same full request without signing or random renewal', async () => {
  const f = fixture(); let rejected = true;
  f.deps.client.submitGeneration = async request => { f.calls.submit.push(request); if (rejected) throw new CloudClientError('QUOTA_EXHAUSTED'); return { job: job(request), submission: 'settled' }; };
  assert.equal((await f.session.submit()).kind, 'blocked'); assert.equal(f.session.view.canStartNew, true);
  rejected = false; assert.equal((await f.session.retry()).kind, 'known');
  assert.equal(f.calls.submit[0], f.calls.submit[1]); assert.equal(f.calls.window, 1); assert.equal(f.calls.random, 1); assert.equal(f.calls.query.length, 0);
});

test('a lost response first queries the original request; persisted RESERVED is known without claiming execution began', async () => {
  const f = fixture(); let saved;
  f.deps.client.submitGeneration = async request => { saved = request; f.calls.submit.push(request); throw new CloudClientError('NETWORK_UNAVAILABLE'); };
  f.deps.client.findJobByRequest = async id => { f.calls.query.push(id); return job(saved, 'RESERVED'); };
  const result = await f.session.submit();
  assert.equal(result.kind, 'known'); assert.equal(f.calls.query[0], saved.requestId); assert.equal(f.calls.submit.length, 1);
  assert.equal(f.navigations.length, 1); assert.ok(!/已开始|已完成|退款/.test(f.session.view.message));
});

test('unknown outcome and null lookup preserve one request; explicit retry queries before sending that same packet', async () => {
  const f = fixture(); let fail = true; const order = [];
  f.deps.client.submitGeneration = async request => { f.calls.submit.push(request); order.push('submit'); if (fail) throw new CloudClientError('EXECUTION_OUTCOME_UNKNOWN'); return { job: job(request), submission: 'settled' }; };
  f.deps.client.findJobByRequest = async id => { f.calls.query.push(id); order.push('query'); return null; };
  assert.equal((await f.session.submit()).kind, 'unresolved');
  assert.equal(f.session.view.canStartNew, false); fail = false;
  assert.equal((await f.session.retry()).kind, 'known');
  assert.deepEqual(order, ['submit', 'query', 'query', 'submit']); assert.equal(f.calls.submit[0], f.calls.submit[1]);
  assert.equal(f.calls.random, 1); assert.equal(f.calls.window, 1);
});

test('unknown lookup failures never trigger another submit or silently start a new operation', async () => {
  const f = fixture();
  f.deps.client.submitGeneration = async request => { f.calls.submit.push(request); throw new CloudClientError('NETWORK_UNAVAILABLE'); };
  f.deps.client.findJobByRequest = async id => { f.calls.query.push(id); throw new CloudClientError('NETWORK_UNAVAILABLE'); };
  await f.session.submit(); await f.session.retry(); await f.session.startNew();
  assert.equal(f.calls.submit.length, 1); assert.equal(f.calls.random, 1); assert.equal(f.calls.window, 1);
  assert.equal(f.session.view.status, 'uncertain'); assert.equal(f.session.view.canStartNew, false);
});

test('local waiting timeout is not a task failure; a late verified response can restore known exactly once', async () => {
  const f = fixture(), gate = deferred(); let request;
  f.deps.client.submitGeneration = value => { request = value; f.calls.submit.push(value); return gate.promise; };
  const pending = f.session.submit(); await tick(); assert.ok(request);
  f.clock.fire(); assert.equal((await pending).kind, 'unresolved');
  assert.equal(f.session.view.status, 'uncertain'); assert.ok(!/失败|退款/.test(f.session.view.message));
  gate.resolve({ job: job(request), submission: 'settled' }); await tick();
  assert.equal(f.session.view.status, 'known'); assert.equal(f.navigations.length, 1); assert.equal(f.calls.submit.length, 1);
});

test('clear during submission cancels local wait, releases request ownership and ignores every late callback', async () => {
  const f = fixture(), gate = deferred(); let request;
  f.deps.client.submitGeneration = value => { request = value; f.calls.submit.push(value); return gate.promise; };
  const pending = f.session.submit(); await tick();
  f.session.clear(); assert.equal((await pending).kind, 'cancelled');
  assert.equal(f.session.view.hasRequest, false); assert.equal(f.session.view.status, 'idle'); assert.equal(f.clock.size, 0);
  gate.resolve({ job: job(request), submission: 'settled' }); await tick();
  assert.equal(f.session.view.status, 'idle'); assert.equal(f.navigations.length, 0);
});

test('a late verified lookup restores known after timeout, while clear prevents late query navigation', async () => {
  for (const clear of [false, true]) {
    const f = fixture(), gate = deferred(); let request;
    f.deps.client.submitGeneration = async value => { request = value; f.calls.submit.push(value); throw new CloudClientError('NETWORK_UNAVAILABLE'); };
    f.deps.client.findJobByRequest = id => { f.calls.query.push(id); return gate.promise; };
    const pending = f.session.submit(); await tick(); assert.equal(f.session.view.status, 'querying');
    f.clock.fire(); assert.equal((await pending).kind, 'unresolved');
    assert.equal(f.session.view.status, 'uncertain'); assert.equal(f.session.view.canStartNew, false);
    if (clear) f.session.clear();
    gate.resolve(job(request, 'RESERVED')); await tick();
    assert.equal(f.session.view.status, clear ? 'idle' : 'known'); assert.equal(f.navigations.length, clear ? 0 : 1);
    assert.equal(f.calls.submit.length, 1); assert.equal(f.calls.query.length, 1); assert.equal(f.clock.size, 0);
  }
});

test('unavailable secure random and preparation timeouts do not submit, query or retain a full request', async () => {
  for (const phase of ['random-failure', 'random-timeout', 'preview-timeout']) {
    const gate = deferred(), f = fixture();
    if (phase === 'preview-timeout') f.deps.editor = { revision: 0, preparePreview: () => gate.promise };
    else f.deps.secureUuid = () => phase === 'random-failure' ? Promise.reject({ code: 'SECURE_RANDOM_UNAVAILABLE' }) : gate.promise;
    const pending = f.session.submit(); await tick();
    if (phase !== 'random-failure') f.clock.fire();
    assert.equal((await pending).kind, 'blocked'); assert.equal(f.session.view.hasRequest, false);
    assert.equal(f.calls.window, 0); assert.equal(f.calls.submit.length, 0); assert.equal(f.calls.query.length, 0);
    if (phase !== 'random-failure') {
      gate.resolve(Promise.reject(new Error('private late provider failure'))); await tick();
      assert.equal(f.session.view.status, 'error'); assert.equal(f.clock.size, 0);
    }
    safeView(f.session.view);
  }
});

test('clear while signing prevents submission and the next operation is independent of stale callbacks', async () => {
  const f = fixture(), gate = deferred();
  f.deps.client.getSubmissionWindow = () => gate.promise;
  const old = f.session.submit(); await tick(); f.session.clear(); assert.equal((await old).kind, 'cancelled');
  f.deps.client.getSubmissionWindow = async () => window;
  const next = await f.session.submit(); assert.equal(next.kind, 'known');
  gate.resolve(window); await tick(); assert.equal(f.calls.submit.length, 1); assert.equal(f.navigations.length, 1);
});

test('a synchronous cleanup listener prevents send or navigation at the callback boundary', async () => {
  for (const target of ['submitting', 'known']) {
    const f = fixture();
    f.session.subscribe(() => { if (f.session.view.status === target) f.session.clear(); });
    assert.equal((await f.session.submit()).kind, 'cancelled');
    assert.equal(f.calls.submit.length, target === 'submitting' ? 0 : 1); assert.equal(f.navigations.length, 0);
  }
});

test('malformed responses and mismatched request/template/job identifiers cannot navigate or leak provider text', async () => {
  for (const mutate of [value => ({ ...value, jobId: 'private body' }), value => ({ ...value, requestId: 'another' }),
    value => ({ ...value, templateId: 'tian-grid' }), value => ({ ...value, status: 'private title' })]) {
    const f = fixture();
    f.deps.client.submitGeneration = async request => ({ job: mutate(job(request)), submission: 'settled' });
    assert.equal((await f.session.submit()).kind, 'unresolved'); assert.equal(f.navigations.length, 0); safeView(f.session.view);
  }
});

test('known-operation double taps reuse its job while explicit new generation uses fresh ID and current preview', async () => {
  const f = fixture(); const first = await f.session.submit();
  assert.deepEqual(await f.session.submit(), first); assert.deepEqual(await f.session.retry(), first); assert.equal(f.calls.submit.length, 1);
  f.editor.setBody('新文章'); assert.equal((await f.session.startNew()).kind, 'known');
  assert.equal(f.calls.submit.length, 2); assert.notEqual(f.calls.submit[0].requestId, f.calls.submit[1].requestId);
  assert.equal(f.calls.submit[1].input.body, '新文章'); assert.equal(f.calls.random, 2); assert.equal(f.calls.window, 2);
});

test('submission disposition must agree with the returned cloud status before a job is remembered', async () => {
  for (const [status, submission] of [['RESERVED', 'settled'], ['SUCCEEDED', 'pending'], ['FAILED', 'pending']]) {
    const f = fixture();
    f.deps.client.submitGeneration = async request => ({ job: job(request, status), submission });
    assert.equal((await f.session.submit()).kind, 'unresolved');
    assert.equal(f.navigations.length, 0); assert.equal(f.session.view.jobId, null); assert.equal(f.calls.query.length, 1);
  }
});

test('compatibility blocks new operations, while a fixed existing request can still recover safely', async () => {
  const f = fixture(); let available = false; f.deps.canGenerate = () => available;
  assert.equal((await f.session.submit()).kind, 'blocked'); assert.equal(f.calls.random, 0);
  available = true; let request;
  f.deps.client.submitGeneration = async value => { request = value; throw new CloudClientError('NETWORK_UNAVAILABLE'); };
  await f.session.submit(); available = false;
  f.deps.client.findJobByRequest = async () => job(request);
  assert.equal((await f.session.recover()).kind, 'known');
});

test('navigation failure keeps a known job and never retries rendering or creates a new request', async () => {
  const f = fixture({ onJobKnown() { throw new Error('private navigation details'); } });
  const first = await f.session.submit(); assert.equal(first.kind, 'known');
  assert.equal((await f.session.submit()).jobId, first.jobId); assert.equal(f.calls.submit.length, 1);
  assert.match(f.session.view.message, /我的/); safeView(f.session.view);
});

test('authoritative expired lookup resolves uncertainty without automatic renewal; new generation stays explicit', async () => {
  const f = fixture();
  f.deps.client.submitGeneration = async () => { throw new CloudClientError('NETWORK_UNAVAILABLE'); };
  f.deps.client.findJobByRequest = async () => { throw new CloudClientError('REQUEST_EXPIRED'); };
  assert.equal((await f.session.submit()).kind, 'blocked'); assert.equal(f.session.view.canRetry, false); assert.equal(f.session.view.canStartNew, true);
  await f.session.retry(); assert.equal(f.calls.random, 1); assert.equal(f.calls.window, 1);
});

test('actual CloudClient and CloudService recover a lost successful response with one task and one debit', async () => {
  const backend = await executionFixture(); let lose = true; const calls = [];
  const client = new CloudClient(async (method, params) => {
    calls.push(method);
    let data;
    if (method === 'getSubmissionWindow') data = await backend.service.getSubmissionWindow();
    else if (method === 'submitGeneration') {
      data = await backend.service.submitGeneration(params);
      if (lose) { lose = false; throw new Error('simulated lost successful response'); }
    } else if (method === 'findJobByRequest') data = await backend.service.findJobByRequest(params.requestId);
    else throw new Error('unexpected RPC');
    return { ok: true, data };
  });
  const f = fixture({ client, secureUuid: async () => randomUUID() });
  const result = await f.session.submit(); assert.equal(result.kind, 'known');
  assert.deepEqual(calls, ['getSubmissionWindow', 'submitGeneration', 'findJobByRequest']);
  assert.equal((await backend.service.getAccount()).available, 19); assert.equal(backend.counts.render, 1);
  await f.session.retry(); assert.equal(backend.counts.render, 1);
  await f.session.startNew(); assert.equal((await backend.service.getAccount()).available, 18); assert.equal(backend.counts.render, 2);
});
