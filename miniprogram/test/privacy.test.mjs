import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const compile = async path => (await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true,
  platform: 'neutral', target: 'es2017', format: 'cjs', write: false })).outputFiles[0].text;
const [sessionCode, clientCode, pageCode, environmentCode, downloaderCode] = await Promise.all([
  compile('../lib/privacy-session.ts'), compile('../lib/cloud-client.ts'), compile('../pages/privacy/index.ts'),
  compile('../lib/editor-environment.ts'), compile('../lib/pdf-download.ts'),
]);
function exportsOf(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals }, { codeGeneration: { strings: false, wasm: false } });
  return module.exports;
}
const { PrivacySession } = exportsOf(sessionCode), { CloudClient } = exportsOf(clientCode);
const { createEditorEnvironment } = exportsOf(environmentCode, { Uint8Array, ArrayBuffer });
const { createPdfDownloader } = exportsOf(downloaderCode, { Uint8Array, ArrayBuffer });
const clone = value => JSON.parse(JSON.stringify(value)), tick = () => new Promise(resolve => setImmediate(resolve));
const now = Date.parse('2026-10-11T00:01:02+08:00'), day = 86400000;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function status(state = 'active', serverTime = now) {
  return { state, requestedAt: state === 'deleting' ? now : null,
    earliestReuseAt: state === 'deleting' ? Date.parse('2026-11-01T00:00:00+08:00') : null, serverTime };
}
function info(state = 'active') {
  return { policyVersion: 'learn-privacy-v1', timeZone: 'Asia/Shanghai', serverTime: now,
    retention: { pdfMs: 7 * day, recordMs: 30 * day, requestMs: 90 * day, ledgerMs: 90 * day,
      activityMs: 30 * day, auditMs: 90 * day, inactiveUserMs: 90 * day, lateIoProtectionMs: 300000, deletionProtectionMs: day },
    deletion: status(state) };
}
function harness() {
  const calls = [], views = [], events = []; let behavior = (method) => ({ ok: true, data: method === 'getPrivacyInfo' ? info() : status() });
  let clearFailure = false;
  const client = new CloudClient(async (method, params) => {
    calls.push({ method, params: clone(params) }); events.push(method); return behavior(method, params);
  });
  const session = new PrivacySession(client, () => { events.push('clear'); if (clearFailure) throw new Error('PRIVATE-PATH'); }, view => views.push(clone(view)));
  return { session, calls, views, events, reply(fn) { behavior = fn; }, failClear(value) { clearFailure = value; } };
}

test('privacy loads dynamic retention and status through App client without creating an account', async () => {
  const h = harness(), value = info('none'); value.retention.pdfMs = day + 3600000 + 60000 + 1000 + 1;
  value.privateBody = 'PRIVATE'; value.deletion.userId = 'PRIVATE';
  h.reply(() => ({ ok: true, data: value })); await h.session.load();
  assert.deepEqual(h.calls, [{ method: 'getPrivacyInfo', params: {} }]);
  assert.equal(h.session.view.policy.rows.length, 9);
  assert.equal(h.session.view.policy.rows[0].duration, '1 天 1 小时 1 分钟 1 秒 1 毫秒');
  assert.equal(h.session.view.policy.loadedAt, '2026-10-11 00:01:02');
  assert.equal(h.session.view.deletion.state, 'none'); assert.equal(h.session.view.canDelete, true);
  assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE|userId|getAccount/); assert.ok(!h.events.includes('clear'));
});

test('initial failures display no invented retention and cannot trigger deletion', async () => {
  const h = harness(); h.reply(() => ({ ok: false, error: { code: 'PRIVACY_UNAVAILABLE' } })); await h.session.load();
  assert.equal(h.session.view.policy, null); assert.equal(h.session.view.canDelete, false);
  let confirmed = 0; await h.session.deleteData(async () => { confirmed++; return true; });
  assert.equal(confirmed, 0); assert.equal(h.calls.length, 1);
  h.reply(() => ({ ok: true, data: status() })); await h.session.checkStatus();
  assert.equal(h.session.view.deletion.state, 'active'); assert.equal(h.session.view.canDelete, false);
});

test('cancelled or failed explicit confirmation preserves local data and does not send deletion', async () => {
  for (const confirm of [async () => false, async () => { throw new Error('PRIVATE'); }]) {
    const h = harness(); await h.session.load(); await h.session.deleteData(confirm);
    assert.equal(h.calls.length, 1); assert.ok(!h.events.includes('clear')); assert.equal(h.session.view.uncertain, false);
    assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE/);
  }
});

test('confirmed deletion clears centralized local state before exactly one cloud call and renders the lower bound', async () => {
  const h = harness(); await h.session.load(); const confirmation = deferred();
  h.reply(() => ({ ok: true, data: status('deleting') }));
  const first = h.session.deleteData(() => confirmation.promise), repeat = h.session.deleteData(async () => true);
  assert.equal(first, repeat); assert.equal(h.session.view.phase, 'confirming'); assert.equal(h.session.view.canDelete, false);
  confirmation.resolve(true); await first;
  assert.deepEqual(h.calls[1], { method: 'deleteMyData', params: { confirm: true } }); assert.equal(h.calls.length, 2);
  assert.ok(h.events.indexOf('clear') < h.events.indexOf('deleteMyData'));
  assert.equal(h.session.view.deletion.earliestReuseAt, '2026-11-01 00:00:00');
  assert.equal(h.session.view.deletion.state, 'deleting'); assert.equal(h.session.view.uncertain, false); assert.equal(h.session.view.canDelete, false);
  await h.session.deleteData(async () => { throw new Error('must not reconfirm while deleting'); }); assert.equal(h.calls.length, 2);
});

test('lost deletion response remains uncertain through an active status read and never auto-retries mutation', async () => {
  const h = harness(); await h.session.load();
  h.reply(() => { throw new Error('PRIVATE-BODY'); }); await h.session.deleteData(async () => true);
  assert.equal(h.session.view.phase, 'error'); assert.equal(h.session.view.uncertain, true);
  h.reply(() => ({ ok: true, data: status('active') })); await h.session.checkStatus();
  assert.equal(h.session.view.uncertain, true); assert.equal(h.session.view.canDelete, true);
  assert.deepEqual(h.calls.map(row => row.method), ['getPrivacyInfo', 'deleteMyData', 'getDeletionStatus']);
  h.reply(() => ({ ok: true, data: status('deleting') })); await h.session.checkStatus();
  assert.equal(h.session.view.uncertain, false); assert.equal(h.session.view.canDelete, false);
  assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE/);
});

test('none is a current absence state and permits local cleanup without inventing a completed deletion certificate', async () => {
  const h = harness(); h.reply(method => ({ ok: true, data: method === 'getPrivacyInfo' ? info('none') : status('none') }));
  await h.session.load(); await h.session.deleteData(async () => true);
  assert.equal(h.session.view.deletion.state, 'none'); assert.equal(h.session.view.deletion.requestedAt, '');
  assert.ok(h.events.includes('clear')); assert.equal(h.session.view.uncertain, false);
  assert.doesNotMatch(JSON.stringify(h.views), /completed|已彻底删除/);
});

test('deleting and disabled observations clear stale local state, while disabled users can request data deletion', async () => {
  for (const state of ['deleting', 'disabled']) {
    const h = harness(); h.reply(() => ({ ok: true, data: info(state) })); await h.session.load();
    assert.ok(h.events.includes('clear')); assert.equal(h.session.view.canDelete, state === 'disabled');
  }
  for (const code of ['ACCOUNT_DELETING', 'ACCOUNT_DISABLED']) {
    const h = harness(); h.reply(() => ({ ok: false, error: { code } })); await h.session.load();
    assert.ok(h.events.includes('clear')); assert.equal(h.session.view.canDelete, false);
  }
});

test('local cleanup failures remain visible without suppressing an explicitly requested cloud deletion', async () => {
  const h = harness(); await h.session.load(); h.failClear(true);
  h.reply(() => ({ ok: true, data: status('deleting') })); await h.session.deleteData(async () => true);
  assert.equal(h.session.view.localClearFailed, true); assert.equal(h.session.view.deletion.state, 'deleting');
  assert.ok(h.calls.some(row => row.method === 'deleteMyData')); assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE-PATH/);
  h.failClear(false); h.session.retryLocalClear(); assert.equal(h.session.view.localClearFailed, false);
});

for (const scenario of ['busy-file', 'pending-write']) {
  test(`actual App/PDF/privacy chain reports ${scenario}, clears other owners and permits explicit local retry`, async () => {
    const directory = '/fixture/learn-pdf', filePath = `${directory}/learn-j_fixture.pdf`;
    const bytes = new Uint8Array([37, 80, 68, 70, 45]), hash = createHash('sha256').update(bytes).digest('hex');
    const files = new Map(), calls = [], views = [], enteredWrite = deferred();
    let busy = true, finishWrite, opened = 0, otherCleared = 0;
    const fs = {
      mkdirSync() {},
      readdirSync(path) { return path === '/fixture' ? ['learn-pdf'] : [...files.keys()].map(file => file.split('/').pop()); },
      unlinkSync(path) { if (busy) throw new Error('PRIVATE-PATH'); files.delete(path); },
      writeFile(options) {
        finishWrite = () => { files.set(options.filePath, options.data); options.success(); };
        enteredWrite.resolve();
      },
    };
    const platform = { env: { USER_DATA_PATH: '/fixture' }, getFileSystemManager: () => fs,
      openDocument(options) { opened++; options.success(); } };
    const app = createEditorEnvironment(platform, null);
    app.client.transport = async method => {
      calls.push(method);
      if (method === 'getPrivacyInfo') return { ok: true, data: info() };
      if (method === 'deleteMyData') return { ok: true, data: status('deleting') };
      if (method === 'getPdfInfo') return { ok: true, data: { jobId: 'j_fixture', bytes: bytes.length, sha256: hash,
        pageCount: 1, expiresAt: now + day, chunkBytes: 262144 } };
      if (method === 'readPdfChunk') return { ok: true, data: { jobId: 'j_fixture', offset: 0, nextOffset: null,
        totalBytes: bytes.length, sha256: hash, expiresAt: now + day, bytes: Buffer.from(bytes).toString('base64') } };
      throw new Error('UNEXPECTED_METHOD');
    };
    const downloader = createPdfDownloader(app.client, platform);
    app.registerUserDataCleanup(() => downloader.clearLocalFiles());
    app.registerUserDataCleanup(() => { otherCleared++; });
    app.editor.setTitle('PRIVATE-TITLE'); app.editor.setBody('PRIVATE-BODY');
    const session = new PrivacySession(app.client, () => app.clearUserData(), view => views.push(clone(view)));
    await session.load();
    let download;
    if (scenario === 'pending-write') {
      download = downloader.open('j_fixture');
      await Promise.race([enteredWrite.promise, download.then(() => { throw new Error('EXPECTED_PENDING_WRITE'); })]);
    }
    else files.set(filePath, bytes.buffer);
    await session.deleteData(async () => true);
    assert.equal(session.view.localClearFailed, true); assert.equal(session.view.deletion.state, 'deleting');
    assert.equal(app.editor.draft.title, ''); assert.equal(app.editor.draft.body, ''); assert.ok(otherCleared > 0);
    assert.equal(calls.filter(method => method === 'deleteMyData').length, 1);
    if (download) { finishWrite(); await assert.rejects(download, { code: 'DOWNLOAD_CANCELLED' }); }
    assert.equal(opened, 0); assert.equal(files.size, 1);
    session.retryLocalClear(); assert.equal(session.view.localClearFailed, true);
    busy = false; session.retryLocalClear();
    assert.equal(session.view.localClearFailed, false); assert.equal(files.size, 0);
    assert.equal(calls.filter(method => method === 'deleteMyData').length, 1);
    assert.doesNotMatch(JSON.stringify(views), /PRIVATE-PATH|PRIVATE-TITLE|PRIVATE-BODY/);
  });
}

test('repeated reads coalesce; suspended reads and confirmations cannot update or mutate hidden pages', async () => {
  const h = harness(), pending = deferred(); h.reply(() => pending.promise);
  const first = h.session.load(); assert.equal(first, h.session.load()); await tick();
  h.session.suspend(); const count = h.views.length; pending.resolve({ ok: true, data: info('deleting') }); await first;
  assert.equal(h.views.length, count); assert.ok(!h.events.includes('clear'));
  h.reply(() => ({ ok: true, data: info() })); await h.session.load();
  let prompts = 0; const deletion = h.session.deleteData(async () => { prompts++; return true; }); h.session.suspend(); await deletion;
  assert.equal(prompts, 0); assert.equal(h.calls.filter(row => row.method === 'deleteMyData').length, 0);
  await h.session.load(); const confirmation = deferred();
  const another = h.session.deleteData(() => confirmation.promise); await tick(); h.session.suspend(); confirmation.resolve(true); await another;
  assert.equal(h.calls.filter(row => row.method === 'deleteMyData').length, 0);
});

test('navigation after confirmed submission leaves uncertainty and a subsequent read resolves server state', async () => {
  const h = harness(); await h.session.load(); const pending = deferred(); h.reply(() => pending.promise);
  const action = h.session.deleteData(async () => true); await tick(); assert.equal(h.session.view.phase, 'submitting');
  h.session.suspend(); pending.resolve({ ok: true, data: status('deleting') }); await action;
  assert.equal(h.session.view.uncertain, true); assert.equal(h.session.view.canDelete, false);
  h.reply(() => ({ ok: true, data: info('deleting') })); await h.session.load();
  assert.equal(h.session.view.deletion.state, 'deleting'); assert.equal(h.session.view.uncertain, false);
});

test('malformed policy and deletion responses reject invented durations, timezones and status fields safely', async () => {
  const corruptions = [
    value => { value.retention.pdfMs = 0; }, value => { value.retention.recordMs = 10000000001; },
    value => { value.retention.requestMs = 2.5; }, value => { value.retention.activityMs = 'PRIVATE'; },
    value => { value.timeZone = 'UTC'; }, value => { value.policyVersion = 'unknown'; },
    value => { value.deletion.state = 'PRIVATE'; }, value => { value.serverTime++; },
    value => { value.deletion.requestedAt = now; }, value => { value.deletion = status('deleting'); value.deletion.earliestReuseAt = now - 1; },
    value => { value.deletion = status('deleting'); value.deletion.requestedAt = now + 1; },
  ];
  for (const corrupt of corruptions) {
    const h = harness(), value = info(); corrupt(value); h.reply(() => ({ ok: true, data: value })); await h.session.load();
    assert.equal(h.session.view.phase, 'error'); assert.equal(h.session.view.policy, null); assert.equal(h.session.view.canDelete, false);
    assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE/);
  }
  const h = harness(); await h.session.load(); h.reply(() => ({ ok: true, data: status('active') })); await h.session.deleteData(async () => true);
  assert.equal(h.session.view.phase, 'error'); assert.equal(h.session.view.uncertain, true);
});

test('actual native Page shares App clearing, uses one native modal and ignores a confirmation after navigation', async () => {
  const methods = [], modals = [], clears = []; let page;
  const app = { client: {
    async getPrivacyInfo() { methods.push('info'); return info(); },
    async getDeletionStatus() { methods.push('status'); return status(); },
    async deleteMyData(value) { methods.push('delete'); assert.equal(value.confirm, true); return status('deleting'); },
  }, clearUserData() { clears.push('clear'); } };
  exportsOf(pageCode, { getApp: () => app, Page(value) { page = value; }, wx: { showModal(value) { modals.push(value); } } });
  const instance = { data: clone(page.data), setData(value) { Object.assign(this.data, value); } };
  const call = (name, ...args) => page[name].call(instance, ...args);
  call('onLoad'); call('onShow'); call('onShow'); await tick(); assert.deepEqual(methods, ['info']);
  call('onDelete'); call('onDelete'); await tick(); assert.equal(modals.length, 1);
  assert.equal(modals[0].confirmText, '确认删除'); assert.match(modals[0].content, /无法撤销/);
  modals[0].success({ confirm: false, cancel: true }); await tick(); assert.equal(clears.length, 0);
  call('onDelete'); await tick(); call('onHide'); modals[1].success({ confirm: true, cancel: false }); await tick();
  assert.equal(clears.length, 0); assert.ok(!methods.includes('delete'));
  call('onShow'); await tick(); call('onDelete'); await tick(); modals[2].success({ confirm: true, cancel: false }); await tick();
  assert.equal(methods.filter(method => method === 'delete').length, 1); assert.ok(clears.length >= 1);
  assert.equal(instance.data.deletion.state, 'deleting'); assert.equal(instance.data.canDelete, false); call('onUnload');
});

test('native privacy copy distinguishes raw text, private PDFs, lower-bound protection and user-saved files', () => {
  const source = readFileSync(new URL('../pages/privacy/index.wxml', import.meta.url), 'utf8');
  for (const phrase of ['生成的 PDF 含有你输入的内容', '这不是完成时间', '已受理任务仍会按原规则结算', '另存或分享', '重新确认删除']) assert.ok(source.includes(phrase));
  assert.match(source, /disabled="\{\{!canDelete\}\}"/); assert.match(source, /open-type="feedback"/);
  assert.doesNotMatch(source, /<input|<textarea|open-type="share"|已彻底删除/);
  assert.equal(JSON.parse(readFileSync(new URL('../pages/privacy/index.json', import.meta.url))).navigationBarTitleText, '隐私与数据');
});
