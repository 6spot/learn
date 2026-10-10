import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const compile = async path => (await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true,
  platform: 'neutral', target: 'es2017', format: 'cjs', write: false })).outputFiles[0].text;
const [sessionCode, clientCode, pageCode] = await Promise.all([
  compile('../lib/admin-session.ts'), compile('../lib/cloud-client.ts'), compile('../pages/admin/index.ts'),
]);
function exportsOf(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals }, { codeGeneration: { strings: false, wasm: false } });
  return module.exports;
}
const { AdminSession } = exportsOf(sessionCode), { CloudClient } = exportsOf(clientCode);
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function stats(date = '2026-10-11', generatedAt = Date.parse('2026-10-11T00:01:02+08:00')) {
  const startsAt = Date.parse(`${date}T00:00:00+08:00`);
  return { date, timeZone: 'Asia/Shanghai', period: { startsAt, endsAt: startsAt + 86400000 }, generatedAt,
    coverage: { complete: true, sourceStarts: { users: '2026-10-01', activity: '2026-10-01', jobs: '2026-10-01', credits: '2026-10-01' }, gaps: [] },
    metrics: { newUsers: 4, dau: 2, succeeded: 3, failed: 1, failureRate: 0.25, creditsConsumed: 3 },
    templates: [ { templateId: 'essay-grid', succeeded: 1 }, { templateId: 'tian-grid', succeeded: 1 },
      { templateId: 'mi-grid', succeeded: 1 }, { templateId: 'pinyin-lines', succeeded: 0 } ], scan: { recordsRead: 25, pagesRead: 4 } };
}
function harness() {
  const calls = [], views = []; let reply = { ok: true, data: stats() };
  const client = new CloudClient(async (method, params) => { calls.push({ method, params: clone(params) }); return typeof reply === 'function' ? reply(params) : reply; });
  const session = new AdminSession(client, view => views.push(clone(view)));
  return { session, calls, views, reply(value) { reply = value; } };
}
const metric = (session, id) => session.view.summary.metrics.find(item => item.id === id);

test('native admin uses one CloudClient, server Shanghai date and fixed safe projections', async () => {
  const h = harness(), response = stats(); response.rawUsers = [{ title: 'PRIVATE-TITLE', body: 'PRIVATE-BODY', userId: 'PRIVATE-USER' }];
  h.reply({ ok: true, data: response }); await h.session.load();
  assert.deepEqual(h.calls, [{ method: 'getAdminStats', params: {} }]);
  assert.equal(h.session.view.today, '2026-10-11'); assert.equal(h.session.view.selectedDate, '2026-10-11');
  assert.equal(h.session.view.summary.generatedAt, '2026-10-11 00:01:02');
  assert.equal(metric(h.session, 'failureRate').value, '25.0%');
  assert.equal(h.session.view.summary.templates.length, 4); assert.equal(h.session.view.summary.metrics.length, 6);
  assert.equal(h.session.view.summary.coverage.length, 4);
  assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE|recordsRead|pagesRead|userId/);
});

test('zero completed jobs show no denominator, while actual zero counts remain zero', async () => {
  const h = harness(), data = stats();
  data.metrics = { newUsers: 0, dau: 0, succeeded: 0, failed: 0, failureRate: null, creditsConsumed: 0 };
  data.templates.forEach(row => { row.succeeded = 0; }); h.reply({ ok: true, data }); await h.session.load();
  assert.equal(metric(h.session, 'failureRate').value, '暂无'); assert.equal(metric(h.session, 'succeeded').value, '0');
  assert.equal(h.session.view.summary.templates[0].value, '0');
});

test('failure rates outside zero to one are rejected even within arithmetic tolerance', async () => {
  for (const [succeeded, failed, failureRate] of [[3, 0, -Number.EPSILON], [0, 1, 1 + Number.EPSILON]]) {
    const h = harness(), data = stats();
    Object.assign(data.metrics, { succeeded, failed, failureRate });
    data.templates.forEach((row, index) => { row.succeeded = index === 0 ? succeeded : 0; });
    h.reply({ ok: true, data }); await h.session.load();
    assert.equal(h.session.view.status, 'error');
    assert.equal(h.session.view.summary, null);
  }
});

test('coverage gaps map only affected metrics to unavailable and explain each source', async () => {
  for (const [source, reason, ids] of [ ['users', 'before-coverage-start', ['newUsers']], ['activity', 'account-deletion', ['dau']],
    ['jobs', 'retention', ['succeeded', 'failed', 'failureRate']], ['credits', 'retention', ['creditsConsumed']] ]) {
    const h = harness(), data = stats(); data.coverage.complete = false; data.coverage.gaps = [{ source, reason }];
    if (reason === 'before-coverage-start') data.coverage.sourceStarts[source] = '2026-10-12';
    for (const id of ids) data.metrics[id] = null;
    if (source === 'jobs') data.templates.forEach(row => { row.succeeded = null; });
    h.reply({ ok: true, data }); await h.session.load(); assert.equal(h.session.view.status, 'ready');
    for (const id of ids) assert.equal(metric(h.session, id).value, '不可用');
    const gap = h.session.view.summary.coverage.find(row => row.id === source);
    assert.match(gap.note, /覆盖起点|数据缺口/);
    if (source === 'jobs') assert.ok(h.session.view.summary.templates.every(row => row.value === '不可用'));
    else assert.equal(metric(h.session, 'succeeded').value, '3');
  }
});

test('repeated refresh shares a request; changed dates and today invalidate late responses', async () => {
  const h = harness(); await h.session.load();
  const old = deferred(), fresh = deferred(); h.reply(params => params.date ? old.promise : fresh.promise);
  const first = h.session.load('2026-10-10'), duplicate = h.session.load('2026-10-10');
  assert.equal(first, duplicate); await tick();
  const today = h.session.today(); await tick();
  fresh.resolve({ ok: true, data: stats() }); await today;
  old.resolve({ ok: true, data: stats('2026-10-10') }); await first;
  assert.equal(h.session.view.summary.date, '2026-10-11'); assert.equal(h.session.view.historical, false);
  assert.deepEqual(h.calls.slice(1), [{ method: 'getAdminStats', params: { date: '2026-10-10' } }, { method: 'getAdminStats', params: {} }]);
});

test('network and bounded-statistics failures keep explicitly dated prior data, never fabricated new totals', async () => {
  for (const code of ['NETWORK_UNAVAILABLE', 'STATS_LIMIT_EXCEEDED', 'STATS_CHANGED', 'STATS_UNAVAILABLE']) {
    const h = harness(); await h.session.load(); const previous = clone(h.session.view.summary);
    h.reply({ ok: false, error: { code, details: 'PRIVATE-ERROR' } }); await h.session.load('2026-10-10');
    assert.equal(h.session.view.status, 'error'); assert.equal(h.session.view.selectedDate, '2026-10-10');
    assert.deepEqual(clone(h.session.view.summary), previous); assert.doesNotMatch(h.session.view.message, /PRIVATE|STATS_/);
  }
});

test('authorization or account revocation immediately removes previously visible totals', async () => {
  for (const code of ['FORBIDDEN', 'UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'ACCOUNT_DELETING']) {
    const h = harness(); await h.session.load(); h.reply({ ok: false, error: { code } }); await h.session.load();
    assert.equal(h.session.view.status, 'denied'); assert.equal(h.session.view.summary, null);
  }
});

test('invalid dates cannot issue a query; date limit uses server time and today remains unpinned across midnight', async () => {
  const h = harness(); await h.session.load();
  for (const date of ['2026-02-30', '1999-12-31', '2026-10-12', '2026-1-1', 'not-a-date']) await h.session.load(date);
  assert.equal(h.calls.length, 1);
  h.reply({ ok: true, data: stats('2026-10-12', Date.parse('2026-10-12T00:00:01+08:00')) }); await h.session.load();
  assert.equal(h.session.view.today, '2026-10-12'); assert.deepEqual(h.calls[1].params, {});
});

test('malformed successful envelopes fail safely without raw response strings', async () => {
  const corruptions = [
    data => { data.timeZone = 'UTC'; }, data => { data.date = '2026-02-30'; }, data => { data.generatedAt = Infinity; },
    data => { data.metrics.newUsers = 'PRIVATE'; }, data => { data.metrics.dau = -1; },
    data => { data.metrics.failureRate = 0; }, data => { data.metrics.creditsConsumed = null; },
    data => { data.templates[1].templateId = data.templates[0].templateId; }, data => { data.templates[0].succeeded = 8; },
    data => { data.coverage.complete = false; }, data => { data.coverage.sourceStarts.jobs = 'PRIVATE'; },
    data => { data.coverage.gaps = [{ source: 'PRIVATE', reason: 'PRIVATE' }]; },
    data => { data.period.endsAt++; }, data => { data.date = '2026-10-10'; },
  ];
  for (const corrupt of corruptions) {
    const h = harness(), data = stats(); corrupt(data); h.reply({ ok: true, data }); await h.session.load();
    assert.equal(h.session.view.status, 'error'); assert.equal(h.session.view.summary, null);
    assert.doesNotMatch(JSON.stringify(h.views), /PRIVATE|Infinity/);
  }
});

test('hidden or disposed sessions discard late success and permission errors without notifications', async () => {
  for (const response of [{ ok: true, data: stats() }, { ok: false, error: { code: 'FORBIDDEN' } }]) {
    const h = harness(), pending = deferred(); h.reply(() => pending.promise);
    const operation = h.session.load(); await tick(); h.session.clear(); const count = h.views.length;
    pending.resolve(response); await operation;
    assert.equal(h.session.view.status, 'idle'); assert.equal(h.session.view.summary, null); assert.equal(h.views.length, count);
  }
});

test('actual native page lifecycle consumes App client and clears hidden state without automatic polling', async () => {
  const requests = [], updates = [], navigation = []; let page;
  const app = { client: { getAdminStats(params) { const pending = deferred(); requests.push({ params: clone(params), pending }); return pending.promise; } } };
  exportsOf(pageCode, { getApp: () => app, Page(value) { page = value; }, wx: { switchTab({ url }) { navigation.push(url); } } });
  const instance = { data: clone(page.data), setData(value) { updates.push(clone(value)); Object.assign(this.data, value); } };
  const call = (name, ...args) => page[name].call(instance, ...args);
  call('onLoad'); call('onShow'); call('onShow'); call('onRefresh'); await tick(); assert.equal(requests.length, 1);
  requests[0].pending.resolve(stats()); await tick(); assert.equal(instance.data.status, 'ready');
  call('onDateChange', { detail: { value: '2026-10-10' } }); await tick(); assert.equal(requests.length, 2);
  call('onHide'); const updateCount = updates.length;
  requests[1].pending.resolve(stats('2026-10-10')); await tick(); assert.equal(updates.length, updateCount);
  assert.equal(instance.data.summary, null); call('onRefresh'); await tick(); assert.equal(requests.length, 2);
  call('onShow'); await tick(); assert.deepEqual(requests[2].params, { date: '2026-10-10' });
  requests[2].pending.reject({ code: 'FORBIDDEN' }); await tick(); assert.equal(instance.data.status, 'denied');
  call('onBackToMe'); assert.deepEqual(navigation, ['/pages/me/index']); call('onUnload');
});

test('native markup labels stale data, exposes bounded date selection and uses safe native actions', () => {
  const source = readFileSync(new URL('../pages/admin/index.wxml', import.meta.url), 'utf8');
  assert.match(source, /mode="date"[^>]*end="\{\{today\}\}"/);
  assert.match(source, /本次未更新，以下为 \{\{summary.date\}\} 的上次统计/);
  assert.match(source, /统计日期：\{\{summary.date\}\}/);
  assert.match(source, /loading="\{\{status === 'loading'\}\}" disabled="\{\{status === 'loading'\}\}"/);
  assert.doesNotMatch(source, /<input|<textarea|open-type="share"/);
  assert.equal(JSON.parse(readFileSync(new URL('../pages/admin/index.json', import.meta.url))).navigationBarTitleText, '运营中心');
});
