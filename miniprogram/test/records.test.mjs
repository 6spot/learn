import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const compile = async path => (await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true,
  platform: 'neutral', target: 'es2017', format: 'cjs', write: false })).outputFiles[0].text;
const [sessionCode, environmentCode, clientCode, listCode, detailCode, appCode, meCode] = await Promise.all([
  compile('../lib/record-sessions.ts'), compile('../lib/record-environment.ts'), compile('../lib/cloud-client.ts'),
  compile('../pages/records/index.ts'), compile('../pages/records/detail.ts'), compile('../app.ts'), compile('../pages/me/index.ts'),
]);
function exportsOf(code, globals = {}) {
  const module = { exports: {} };
  // Independently built entries share the native host's binary constructors.
  vm.runInNewContext(code, { module, exports: module.exports, Uint8Array, ArrayBuffer, ...globals }, { codeGeneration: { strings: false, wasm: false } });
  return module.exports;
}
const { RecordAccountSession, RecordListSession, RecordDetailSession } = exportsOf(sessionCode);
const { createRecordEnvironment } = exportsOf(environmentCode), { CloudClient } = exportsOf(clientCode);
const clone = value => JSON.parse(JSON.stringify(value)), tick = () => new Promise(resolve => setImmediate(resolve));
const now = Date.parse('2026-10-11T00:01:02+08:00');
const jobId = number => `j_${String(number).padStart(8, '0')}-0000-4000-8000-000000000000`;
function job(number = 1, status = 'SUCCEEDED', delivery = status === 'SUCCEEDED' ? 'ready' : 'not-ready') {
  return { jobId: jobId(number), requestId: 'PRIVATE-REQUEST', templateId: 'tian-grid', status, createdAt: now - number * 1000,
    startedAt: status === 'RESERVED' ? null : now, finishedAt: ['SUCCEEDED', 'FAILED'].includes(status) ? now + 1000 : null,
    pageCount: status === 'SUCCEEDED' ? 2 : null, errorCode: status === 'FAILED' ? 'EXECUTION_TIMEOUT' : null,
    fileExpiresAt: status === 'SUCCEEDED' ? now + 86400000 : null, delivery };
}
const list = (items = [], nextCursor = null) => ({ items, nextCursor, serverTime: now });
const account = () => ({ userId: 'PRIVATE-USER', isAdmin: true, available: 8, reserved: 1, monthlyGrant: 10,
  period: '2026-10', periodEndsAt: Date.parse('2026-11-01T00:00:00+08:00') });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function timers() {
  let next = 0; const entries = new Map();
  return { entries, setTimeout(callback, ms) { entries.set(++next, { callback, ms }); return next; }, clearTimeout(id) { entries.delete(id); },
    async fire() { const first = entries.entries().next().value; assert.ok(first, 'expected scheduled poll'); entries.delete(first[0]); first[1].callback(); await tick(); } };
}
function harness() {
  const calls = [], changes = [], clock = timers(); let revoked = 0;
  let response = method => method === 'getAccount' ? account() : method === 'listJobs' ? list([job()]) : job();
  const client = new CloudClient(async (method, params) => { calls.push({ method, params: clone(params) }); return { ok: true, data: await response(method, params) }; });
  const downloadCalls = []; const downloader = { async open(id, progress) { downloadCalls.push(id); progress?.(1024, 2048); } };
  return { calls, changes, clock, client, downloader, downloadCalls, set(fn) { response = fn; }, get revoked() { return revoked; },
    account: () => new RecordAccountSession(client, clock, () => { revoked++; }),
    list: () => new RecordListSession(client, clock, () => { revoked++; }, value => changes.push(clone(value))),
    detail: (id = jobId(1), downloads = downloader) => new RecordDetailSession(id, client, downloads, clock, () => { revoked++; }, value => changes.push(clone(value))) };
}

test('account projects safe quota values and hides stale admin entry on failed refresh', async () => {
  const h = harness(), session = h.account(), views = []; session.subscribe(view => views.push(clone(view)));
  session.setVisible(true); await tick(); assert.equal(session.view.account.available, 8); assert.equal(session.view.isAdmin, true);
  h.set(() => { throw new Error('PRIVATE-ERROR'); }); await session.refresh();
  assert.equal(session.view.phase, 'error'); assert.equal(session.view.account.available, 8); assert.equal(session.view.isAdmin, false);
  assert.equal(h.clock.entries.size, 0); assert.doesNotMatch(JSON.stringify(views), /PRIVATE/);
});

test('empty and short pages continue through bounded cursor scans without false end or false empty', async () => {
  const h = harness(), session = h.list(); let page = 0;
  h.set(() => list([], `cursor-${++page}`)); await session.refresh();
  assert.equal(h.calls.length, 3); assert.equal(session.view.items.length, 0); assert.equal(session.view.hasMore, true);
  h.set((method, params) => params.cursor === 'cursor-3' ? list([job(1)], 'cursor-4') : list([job(2)], null));
  await session.more(); assert.equal(h.calls.length, 5); assert.equal(session.view.items.length, 2); assert.equal(session.view.hasMore, false);
  assert.deepEqual(h.calls[3].params, { limit: 20, cursor: 'cursor-3' });
  assert.doesNotMatch(JSON.stringify(h.changes), /PRIVATE-REQUEST/);
});

test('failed pagination and malformed looping cursors preserve existing valid rows and continuation', async () => {
  const h = harness(), session = h.list();
  h.set(() => list(Array.from({ length: 20 }, (_, i) => job(i + 1)), 'next')); await session.refresh();
  h.set(() => { throw new Error('PRIVATE'); }); await session.more(); assert.equal(session.view.items.length, 20); assert.equal(session.view.hasMore, true);
  h.set(() => list([], 'next')); await session.more(); assert.equal(session.view.phase, 'error'); assert.equal(session.view.items.length, 20);
  assert.doesNotMatch(JSON.stringify(h.changes), /PRIVATE/);
});

test('polling updates an older loaded pending task without dropping newer pages or resetting continuation', async () => {
  const h = harness(), session = h.list();
  h.set((method, params) => method === 'getJob' ? job(21, 'FAILED') : params.cursor
    ? list([job(21, 'GENERATING')], null) : list(Array.from({ length: 20 }, (_, i) => job(i + 1)), 'next'));
  session.setVisible(true); await tick(); await session.more(); assert.equal(session.view.items.length, 21); assert.equal(h.clock.entries.size, 1);
  assert.equal([...h.clock.entries.values()][0].ms, 5000); await h.clock.fire();
  assert.equal(session.view.items.length, 21); assert.equal(session.view.items[20].state, 'failed'); assert.equal(h.clock.entries.size, 0);
  assert.deepEqual(h.calls.at(-1), { method: 'getJob', params: { jobId: jobId(21) } });
});

test('pending refresh errors keep genuine server state and back off; background and page hide stop polling', async () => {
  const h = harness(), session = h.list(); h.set(() => list([job(1, 'GENERATING')], null));
  session.setVisible(true); await tick(); h.set(() => { throw new Error('network'); }); await h.clock.fire();
  assert.equal(session.view.items[0].status, 'GENERATING'); assert.equal(session.view.phase, 'error');
  assert.equal([...h.clock.entries.values()][0].ms, 15000);
  session.setForeground(false); assert.equal(h.clock.entries.size, 0);
  h.set(() => list([job(1, 'GENERATING')], null)); session.setForeground(true); await tick(); assert.equal(h.clock.entries.size, 1);
  session.setVisible(false); assert.equal(h.clock.entries.size, 0);
});

test('large pending lists poll at most five known jobs per turn and rotate through older entries', async () => {
  const h = harness(), session = h.list();
  h.set((method, params) => method === 'listJobs' ? list(Array.from({ length: 12 }, (_, i) => job(i + 1, 'GENERATING')))
    : job(Number(params.jobId.slice(2, 10)), 'GENERATING'));
  session.setVisible(true); await tick(); await h.clock.fire();
  assert.equal(h.calls.filter(row => row.method === 'getJob').length, 5);
  await h.clock.fire();
  assert.deepEqual(h.calls.filter(row => row.method === 'getJob').map(row => row.params.jobId), Array.from({ length: 10 }, (_, i) => jobId(i + 1)));
  assert.equal(session.view.items.length, 12); session.setVisible(false);
});

test('hidden reads and privacy clearing invalidate late replies and prevent queued account creation', async () => {
  const h = harness(), accountSession = h.account(); accountSession.setVisible(true); accountSession.clear(); await tick();
  assert.equal(h.calls.length, 0);
  const session = h.list(), pending = deferred(); h.set(() => pending.promise);
  session.setVisible(true); await tick(); session.setVisible(false); const count = h.changes.length;
  pending.resolve(list([job(1, 'GENERATING')])); await tick(); assert.equal(h.changes.length, count); assert.equal(h.clock.entries.size, 0);
});

test('detail displays each server state, never exposes request data, and hides open action on query failure', async () => {
  const h = harness(), session = h.detail();
  for (const [status, delivery, state] of [['RESERVED', 'not-ready', 'waiting'], ['GENERATING', 'not-ready', 'generating'],
    ['FAILED', 'not-ready', 'failed'], ['SUCCEEDED', 'expired', 'expired'], ['SUCCEEDED', 'unavailable', 'unavailable'], ['SUCCEEDED', 'ready', 'ready']]) {
    h.set(() => job(1, status, delivery)); await session.refresh(); assert.equal(session.view.record.state, state); assert.equal(session.view.canOpen, state === 'ready');
  }
  h.set(() => { throw new Error('network'); }); await session.refresh();
  assert.equal(session.view.record.state, 'ready'); assert.equal(session.view.phase, 'error'); assert.equal(session.view.canOpen, false);
  await session.openPdf(); assert.equal(h.downloadCalls.length, 0); assert.doesNotMatch(JSON.stringify(h.changes), /PRIVATE-REQUEST/);
});

test('detail duplicate PDF actions share one verified downloader; viewer failure never changes job outcome', async () => {
  const h = harness(), pending = deferred(); let opens = 0;
  const session = h.detail(jobId(1), { open(id, progress) { opens++; progress(1024, 2048); return pending.promise; } });
  await session.refresh(); const first = session.openPdf(), repeat = session.openPdf(); assert.equal(first, repeat); await tick();
  assert.equal(opens, 1); assert.equal(session.view.downloading, true); assert.match(session.view.downloadProgress, /1 \/ 2 KB/);
  pending.reject({ code: 'FILE_OPEN_FAILED' }); await first;
  assert.equal(session.view.record.status, 'SUCCEEDED'); assert.equal(session.view.downloading, false); assert.equal(session.view.canOpen, true);
});

test('download completion after hide/reentry releases busy state without replaying stale progress or result messages', async () => {
  const h = harness(), pending = deferred(), session = h.detail(jobId(1), { open: () => pending.promise });
  session.setVisible(true); await tick(); const first = session.openPdf(); await tick();
  session.setVisible(false); session.setVisible(true); await tick(); assert.equal(session.view.downloading, true);
  pending.resolve(); await first; assert.equal(session.view.downloading, false); assert.equal(session.view.canOpen, true);
  assert.equal(session.view.downloadMessage, '');
});

test('PDF retrieval with expired records or revoked access cannot retain its old delivery action', async () => {
  for (const code of ['NOT_FOUND', 'RECORD_EXPIRED', 'ACCOUNT_DELETING', 'ACCOUNT_DISABLED', 'UNAUTHENTICATED', 'FORBIDDEN']) {
    const h = harness(), session = h.detail(jobId(1), { async open() { throw { code }; } });
    await session.refresh(); assert.equal(session.view.canOpen, true);
    await session.openPdf();
    assert.equal(session.view.phase, 'error');
    assert.equal(session.view.record, null);
    assert.equal(session.view.canOpen, false);
    assert.equal(session.view.downloading, false);
    assert.equal(h.revoked, ['NOT_FOUND', 'RECORD_EXPIRED'].includes(code) ? 0 : 1);
    await session.refresh(); assert.equal(session.view.canOpen, true);
  }
});

test('expired/not-owned detail and malformed responses never offer delivery', async () => {
  const h = harness(), session = h.detail(); await session.refresh();
  const unavailable = new RecordDetailSession(jobId(1), { getJob: async () => { throw { code: 'RECORD_EXPIRED' }; } }, h.downloader, h.clock, () => {}, () => {});
  await unavailable.refresh(); assert.equal(unavailable.view.record, null); assert.equal(unavailable.view.canOpen, false);
  const invalid = h.detail('j_fake'); await invalid.refresh(); assert.equal(invalid.view.phase, 'error'); assert.equal(h.calls.length, 1);
  for (const corrupt of [value => { value.jobId = jobId(2); }, value => { value.status = 'PRIVATE'; }, value => { value.pageCount = 99; },
    value => { value.createdAt = NaN; }, value => { value.errorCode = 'PRIVATE'; }, value => { value.delivery = 'PRIVATE'; }]) {
    const value = job(); corrupt(value); h.set(() => value); await session.refresh(); assert.equal(session.view.phase, 'error'); assert.equal(session.view.canOpen, false);
  }
  assert.doesNotMatch(JSON.stringify(h.changes), /PRIVATE/);
});

test('account revocation clears old quota/history/detail and never schedules another pending poll', async () => {
  const clock = timers(), views = []; let revoked = 0, denied = false;
  const client = { async getAccount() { if (denied) throw { code: 'ACCOUNT_DELETING' }; return account(); },
    async listJobs() { if (denied) throw { code: 'ACCOUNT_DELETING' }; return list([job(1, 'GENERATING')]); },
    async getJob() { if (denied) throw { code: 'ACCOUNT_DISABLED' }; return job(1, 'GENERATING'); } };
  const accountSession = new RecordAccountSession(client, clock, clear);
  const listSession = new RecordListSession(client, clock, clear, value => views.push(clone(value)));
  const detail = new RecordDetailSession(jobId(1), client, { open: async () => {} }, clock, clear, value => views.push(clone(value)));
  function clear() { revoked++; accountSession.clear(); listSession.clear(); detail.clear(); }
  accountSession.setVisible(true); listSession.setVisible(true); detail.setVisible(true); await tick();
  assert.equal(clock.entries.size, 2); denied = true; await detail.refresh();
  assert.equal(revoked, 1); assert.equal(accountSession.view.account, null); assert.equal(listSession.view.items.length, 0);
  assert.equal(detail.view.record, null); assert.equal(clock.entries.size, 0); assert.equal(detail.view.phase, 'error');
  assert.doesNotMatch(JSON.stringify(views), /PRIVATE/);
});

test('App-owned environment reuses actual downloader and clears every session before reporting file cleanup failure', async () => {
  const bytes = Buffer.from('%PDF-1.7\nminimal verified test bytes\n%%EOF'), hash = createHash('sha256').update(bytes).digest('hex');
  const calls = [], files = new Map(), opens = [], clock = timers(); let readFails = false;
  const platform = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({
    readdirSync(path) { if (readFails) throw new Error('PRIVATE-FS'); return path === '/private' ? ['learn-pdf'] : [...files.keys()].map(path => path.split('/').at(-1)); },
    unlinkSync(path) { files.delete(path); }, mkdirSync() {}, writeFile({ filePath, data, success }) { files.set(filePath, new Uint8Array(data)); success(); },
  }), openDocument(value) { opens.push(value); value.success(); } };
  const client = new CloudClient(async (method, params) => {
    calls.push(method); let data;
    if (method === 'getAccount') data = account();
    else if (method === 'listJobs') data = list([job()]);
    else if (method === 'getJob') data = job();
    else if (method === 'getPdfInfo') data = { jobId: params.jobId, bytes: bytes.length, sha256: hash, pageCount: 2, expiresAt: now + 86400000, chunkBytes: 262144 };
    else data = { jobId: params.jobId, offset: 0, nextOffset: null, totalBytes: bytes.length, sha256: hash, expiresAt: now + 86400000, bytes: bytes.toString('base64') };
    return { ok: true, data };
  });
  const environment = createRecordEnvironment(client, platform, clock, () => environment.clearUserData());
  const listSession = environment.createListSession(() => {}), detail = environment.createDetailSession(jobId(1), () => {});
  await environment.account.refresh(); await listSession.refresh(); await detail.refresh();
  await detail.openPdf(); assert.equal(opens.length, 1); assert.equal(files.size, 1);
  assert.equal(opens[0].fileType, 'pdf'); assert.equal(opens[0].showMenu, true);
  readFails = true; assert.throws(() => environment.clearUserData(), { code: 'LOCAL_DATA_CLEAR_FAILED' });
  assert.equal(environment.account.view.account, null); assert.equal(listSession.view.items.length, 0); assert.equal(detail.view.record, null);
  readFails = false; environment.clearUserData(); assert.equal(files.size, 0);
  assert.ok(!calls.includes('submitGeneration')); environment.release(listSession); environment.release(detail);
});

test('central cleanup rejects late metadata and a late PDF write, then permits a verified cleanup retry', async () => {
  const bytes = new Uint8Array(Buffer.from('%PDF-1.7\nlate private test bytes\n%%EOF'));
  const hash = createHash('sha256').update(bytes).digest('hex'), files = new Map(), clock = timers();
  const metadata = deferred(), writeStarted = deferred(); let delayed = false, write, opens = 0;
  const client = { getAccount: async () => delayed ? metadata.promise.then(() => account()) : account(),
    listJobs: async () => delayed ? metadata.promise.then(() => list([job()])) : list([job()]),
    getJob: async () => delayed ? metadata.promise.then(() => job()) : job(),
    getPdfInfo: async id => ({ jobId: id, bytes: bytes.length, sha256: hash, pageCount: 2, expiresAt: now + 86400000, chunkBytes: 262144 }),
    readPdfChunk: async ({ jobId: id }) => ({ jobId: id, offset: 0, nextOffset: null, totalBytes: bytes.length, sha256: hash, expiresAt: now + 86400000, bytes }),
  };
  const platform = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({
    readdirSync: path => path === '/private' ? ['learn-pdf'] : [...files.keys()].map(path => path.split('/').at(-1)),
    unlinkSync: path => files.delete(path), mkdirSync() {}, writeFile(options) { write = options; writeStarted.resolve(); },
  }), openDocument(options) { opens++; options.success(); } };
  const environment = createRecordEnvironment(client, platform, clock, () => environment.clearUserData());
  const listSession = environment.createListSession(() => {}), detail = environment.createDetailSession(jobId(1), () => {});
  environment.account.setVisible(true); listSession.setVisible(true); detail.setVisible(true); await tick();
  const opening = detail.openPdf(); await writeStarted.promise;
  delayed = true;
  const reads = [environment.account.refresh(), listSession.refresh(), detail.refresh()]; await tick();
  assert.throws(() => environment.clearUserData(), { code: 'LOCAL_DATA_CLEAR_FAILED' });
  metadata.resolve(); await Promise.all(reads);
  files.set(write.filePath, new Uint8Array(write.data)); write.success(); await opening;
  assert.equal(opens, 0); assert.equal(files.size, 0);
  assert.equal(environment.account.view.account, null); assert.equal(listSession.view.items.length, 0);
  assert.equal(detail.view.record, null); assert.equal(detail.view.phase, 'idle'); assert.equal(detail.view.canOpen, false);
  assert.equal(clock.entries.size, 0);
  assert.doesNotThrow(() => environment.clearUserData());
  environment.release(listSession); environment.release(detail);
});

test('native records pages use the sole detail route and current in-memory editor without private route data', async () => {
  const h = harness(), pages = [], navigation = []; let stack = [];
  const records = { createListSession: changed => new RecordListSession(h.client, h.clock, () => {}, changed),
    createDetailSession: (id, changed) => new RecordDetailSession(id, h.client, h.downloader, h.clock, () => {}, changed), release(session) { session.setVisible(false); session.clear(); } };
  const app = { records, editor: { draft: { templateId: 'tian-grid', title: 'PRIVATE-TITLE', body: 'PRIVATE-BODY' } } };
  const globals = { getApp: () => app, getCurrentPages: () => stack, Page(value) { pages.push(value); }, wx: {
    navigateTo({ url, complete }) { navigation.push(url); complete?.(); }, switchTab({ url }) { navigation.push(url); },
    navigateBack({ delta, complete }) { navigation.push(`back:${delta}`); complete?.(); },
  } };
  exportsOf(listCode, globals); exportsOf(detailCode, globals);
  const instance = () => ({ data: {}, setData(value) { Object.assign(this.data, value); } });
  const listPage = instance(), detailPage = instance();
  pages[0].onLoad.call(listPage); pages[0].onShow.call(listPage); await tick();
  pages[0].onOpen.call(listPage, { currentTarget: { dataset: { jobId: jobId(1) } } });
  assert.equal(navigation[0], `/pages/records/detail?jobId=${jobId(1)}`);
  pages[1].onLoad.call(detailPage, { jobId: jobId(1) }); pages[1].onShow.call(detailPage); await tick();
  assert.equal(detailPage.data.hasEditorInput, true); pages[1].onReturnEditor.call(detailPage);
  assert.equal(navigation[1], '/pages/editor/index?template=tian-grid');
  stack = [{ route: 'pages/records/index' }, { route: 'pages/records/detail' }]; pages[1].onRecords.call(detailPage);
  assert.equal(navigation[2], 'back:1');
  assert.doesNotMatch(JSON.stringify([navigation, listPage.data, detailPage.data]), /PRIVATE/);
  pages[0].onUnload.call(listPage); pages[1].onUnload.call(detailPage); assert.equal(h.clock.entries.size, 0);
});

test('native detail places open before metadata and restricts it to current successful queries', () => {
  const source = readFileSync(new URL('../pages/records/detail.wxml', import.meta.url), 'utf8');
  assert.ok(source.indexOf('record-open-pdf') < source.indexOf('文件信息'));
  assert.match(source, /wx:if="\{\{phase === 'ready' && record.state === 'ready'\}\}" id="record-open-pdf"/);
  assert.doesNotMatch(source, /open-type="share"|\d+%|重做/);
  assert.match(readFileSync(new URL('../pages/records/index.wxml', import.meta.url), 'utf8'), /还有历史记录待查询/);
});

test('actual App creates one records owner, wires foreground and cleanup, and My uses its single account session', async () => {
  let app, page, denied = false; const clock = timers(), calls = [], navigation = []; let scans = 0;
  const fs = { readFile({ fail }) { fail(); }, readdirSync() { scans++; return []; }, mkdirSync() {}, unlinkSync() {},
    writeFile({ success }) { success(); } };
  const globals = { App(value) { app = value; }, Page(value) { page = value; }, getApp: () => app,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    wx: { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => fs,
      navigateTo({ url, complete }) { navigation.push(url); complete?.(); }, openDocument({ success }) { success(); } } };
  exportsOf(appCode, globals); app.onLaunch.call(app); await tick();
  const owner = app.records; assert.equal(scans, 1, 'downloader is constructed only at App launch');
  app.client.transport = async (method, params) => {
    calls.push(method);
    if (denied && method === 'getAccount') return { ok: false, error: { code: 'NETWORK_UNAVAILABLE' } };
    return { ok: true, data: method === 'getAccount' ? account() : method === 'listJobs' ? list([job(1, 'GENERATING')]) : job(1, 'GENERATING') };
  };
  exportsOf(meCode, globals);
  const instance = { data: {}, setData(value) { Object.assign(this.data, value); } };
  page.onLoad.call(instance); page.onShow.call(instance); page.onShow.call(instance); await tick();
  assert.equal(calls.filter(method => method === 'getAccount').length, 1);
  assert.equal(instance.data.account.available, 8); assert.equal(instance.data.isAdmin, true);
  page.onRecords.call(instance); page.onPrivacy.call(instance); page.onAdmin.call(instance);
  assert.deepEqual(navigation, ['/pages/records/index', '/pages/privacy/index', '/pages/admin/index']);
  denied = true; page.onRefresh.call(instance); await tick(); assert.equal(instance.data.isAdmin, false);
  instance.data.isAdmin = true; page.onAdmin.call(instance); assert.equal(navigation.length, 3, 'page data cannot fabricate current admin confirmation');
  const records = app.records.createListSession(() => {}); records.setVisible(true); await tick(); assert.equal(clock.entries.size, 1);
  app.onHide.call(app); assert.equal(clock.entries.size, 0); app.onShow.call(app); await tick();
  assert.equal(app.records, owner); assert.equal(clock.entries.size, 1);
  app.editor.setBody('PRIVATE-BODY'); app.editor.setTitle('PRIVATE-TITLE'); app.clearUserData();
  assert.equal(app.editor.draft.body, ''); assert.equal(app.editor.draft.title, ''); assert.equal(records.view.items.length, 0);
  assert.equal(app.records.account.view.account, null); assert.equal(clock.entries.size, 0);
  assert.doesNotMatch(JSON.stringify(instance.data), /PRIVATE/);
  page.onUnload.call(instance); app.records.release(records);
});

test('My markup keeps approved menu order and requires current cloud admin confirmation', () => {
  const source = readFileSync(new URL('../pages/me/index.wxml', import.meta.url), 'utf8');
  assert.ok(source.indexOf('me-records') < source.indexOf('me-feedback'));
  assert.ok(source.indexOf('me-feedback') < source.indexOf('me-privacy'));
  assert.ok(source.indexOf('me-privacy') < source.indexOf('me-admin'));
  assert.match(source, /wx:if="\{\{isAdmin\}\}"/); assert.match(source, /open-type="feedback"/);
  assert.doesNotMatch(source, /手机号|购买|广告|<input/);
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url)));
  for (const route of ['pages/records/index', 'pages/records/detail', 'pages/privacy/index', 'pages/admin/index']) assert.equal(config.pages.filter(page => page === route).length, 1);
});
