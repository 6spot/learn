import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if (process.argv.slice(2).join(' ') !== '--diagnostics') {
  console.error('Use --diagnostics for fixed synthetic product integration only.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url)), output = new URL('../dist/product-evidence/', import.meta.url);
await mkdir(output, { recursive: true }); await rm(new URL('report.json', output), { force: true });
const OWNER = 'diagnostic-product-user', ADMIN = 'diagnostic-bootstrap', OTHER = 'diagnostic-product-other';
const templates = ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'];
const productRoutes = ['pages/templates/index', 'pages/editor/index', 'pages/preview/index', 'pages/me/index',
  'pages/records/index', 'pages/records/detail', 'pages/admin/index', 'pages/privacy/index'];
let miniProgram, local, subject = ADMIN, stage = 'preflight', watchdog, exceptions = 0, restored = false;
let prepareGate = null, prepareCalls = 0, loseBeforeSubmit = 0, loseAfterSubmit = 0;
const failures = new Map(), responseGates = new Map(), requests = [], rpcCounts = new Map(), listLengths = [];
const checks = [], pdfs = [], visited = new Set();
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve, arrived: false }; };
const unavailable = () => ({ ok: false, error: { code: 'NETWORK_UNAVAILABLE' } });
function checkpoint(name) {
  if (name !== stage) console.log(`Product diagnostics: ${name}.`);
  stage = name; clearTimeout(watchdog);
  watchdog = setTimeout(() => { miniProgram?.disconnect(); console.error(`Product diagnostics timed out during ${stage}.`); process.exit(1); }, 60000);
}
async function waitFor(check, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error('DIAGNOSTIC_TIMEOUT');
}
async function current(path) {
  await waitFor(async () => (await miniProgram.currentPage())?.path === path);
  visited.add(path); return miniProgram.currentPage();
}
async function screenshot(name) { await new Promise(resolve => setTimeout(resolve, 400)); await miniProgram.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) }); }
async function actionScreenshot(name, selector) {
  checkpoint(`visible ${name} actions`);
  await waitFor(async () => {
    // setData/rendering can trail the App session state. Recompute the scroll
    // limit after new error/query/retry controls have entered native layout.
    await miniProgram.pageScrollTo(99999);
    // getWindowInfo retains the initial tab's shorter height in DevTools, and
    // automator does not expose arbitrary DOM dimensions. Query the actual
    // native viewport and control together in the same CSS pixel space.
    return miniProgram.evaluate(target => new Promise(resolve => {
      const query = wx.createSelectorQuery();
      query.select(target).boundingClientRect(); query.selectViewport().boundingClientRect();
      query.exec(([rect, viewport]) => resolve(!!rect && viewport?.height > 0 && rect.top >= 0 && rect.bottom <= viewport.height));
    }), selector);
  });
  await screenshot(name);
}
async function tap(page, selector) { const control = await page.$(selector); assert.ok(control, 'required native control'); await control.tap(); }
async function input(page, field, value) {
  await (await page.$(`#${field}-input`)).input(value);
  await waitFor(() => miniProgram.evaluate((name, expected) => getApp().editor.draft[name] === expected, field, value));
}
async function readyEditor(page) {
  await waitFor(async () => await page.data('previewStatus') === 'ready' && await page.data('canGenerate') === true);
}
async function generationState(value) {
  await waitFor(() => miniProgram.evaluate(expected => getApp().generation.view.status === expected && !getApp().generation.view.busy, value));
}
async function setIdentity(next) {
  subject = next;
  await miniProgram.reLaunch('/pages/templates/index'); visited.add('pages/templates/index');
  await miniProgram.evaluate(() => { getApp().clearUserData(); void getApp().compatibility.retry(); });
  await waitFor(() => miniProgram.evaluate(() => getApp().compatibility.view.status === 'ready'));
}
async function openEditor(template, title = '', body = '', tracing = false) {
  const home = await miniProgram.switchTab('/pages/templates/index'); visited.add(home.path);
  await tap(home, `.template-entry[data-template="${template}"]`);
  const page = await current('pages/editor/index');
  await input(page, 'title', title); await input(page, 'body', body);
  if (await page.data('tracing') !== tracing) await tap(page, '#tracing-switch');
  await readyEditor(page); return page;
}
async function generate(page, expectedTemplate) {
  await waitFor(async () => await page.data('canGenerate') === true);
  await tap(page, '#generate-pdf'); const detail = await current('pages/records/detail');
  await waitFor(async () => await detail.data('phase') === 'ready');
  const row = await detail.data('record'); assert.equal(row.templateId, expectedTemplate); assert.equal(row.state, 'ready');
  return { page: detail, jobId: row.jobId };
}
const account = () => local.serviceFor(subject).getAccount();
function consumption(jobId) {
  return Object.values(local.store.snapshot().credit_ledger ?? {}).filter(row => row.reservationId === jobId && row.operation === 'CONSUME').length;
}
async function inspectPdf(jobId, expectedTemplate) {
  const job = local.store.snapshot().generation_jobs[jobId]; assert.equal(job.status, 'SUCCEEDED');
  assert.equal(job.versions.templateId, expectedTemplate); assert.equal(consumption(jobId), 1);
  const bytes = await local.storage.read(job.fileId);
  assert.equal(bytes.length, job.fileBytes); assert.match(Buffer.from(bytes.subarray(0, 16)).toString('ascii'), /^%PDF-/);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), job.fileSha256);
  return { template: expectedTemplate, pages: job.pageCount, bytes: bytes.length, hashVerified: true };
}
async function serviceHandler(request) {
  const currentSubject = subject;
  rpcCounts.set(request.method, (rpcCounts.get(request.method) ?? 0) + 1);
  if (request.method === 'submitGeneration') {
    requests.push({ subject: currentSubject, params: structuredClone(request.params) });
    if (loseBeforeSubmit > 0) { loseBeforeSubmit--; return unavailable(); }
  }
  if ((failures.get(request.method) ?? 0) > 0) {
    failures.set(request.method, failures.get(request.method) - 1); return unavailable();
  }
  const gate = responseGates.get(request.method);
  const reply = await local.rpcFor(currentSubject)(request);
  if (request.method === 'listJobs' && reply.ok) listLengths.push({ length: reply.data.items.length, cursor: reply.data.nextCursor !== null });
  if (gate) { gate.arrived = true; await gate.promise; }
  if (request.method === 'submitGeneration' && loseAfterSubmit > 0) { loseAfterSubmit--; return unavailable(); }
  return reply;
}
async function installNativeDiagnostics() {
  await miniProgram.evaluate(() => {
    const app = getApp(), originalModal = wx.showModal, originalOpen = wx.openDocument;
    const state = app.__productDiagnostic = { modal: null, modalCalls: 0, viewerCalls: 0,
      viewerMode: 'native', viewerOutcome: 'untested', failCleanup: false, readback: null };
    state.unregisterCleanup = app.registerUserDataCleanup(() => { if (state.failCleanup) throw new Error('DIAGNOSTIC_CLEAR_FAILURE'); });
    state.originalModal = originalModal;
    state.restore = () => { wx.showModal = originalModal; wx.openDocument = originalOpen; state.unregisterCleanup(); };
    wx.showModal = options => {
      if (options.title !== '删除我的数据') return originalModal.call(wx, options);
      state.modal = options; state.modalCalls++;
    };
    wx.openDocument = options => {
      state.viewerCalls++; state.pdfPath = options.filePath;
      state.pdfOptionsValid = options.fileType === 'pdf' && options.showMenu === true;
      if (state.viewerMode === 'simulated') { state.viewerOutcome = 'simulated'; options.success(); return; }
      let finished = false;
      const finish = succeeded => {
        if (finished) return; finished = true; clearTimeout(timer);
        state.viewerOutcome = succeeded ? 'native-success' : 'native-unavailable';
        if (succeeded) options.success(); else options.fail();
      };
      const timer = setTimeout(() => finish(false), 10000);
      try { originalOpen.call(wx, { ...options, success: () => finish(true), fail: () => finish(false) }); }
      catch { finish(false); }
    };
  });
}
async function seedFonts() {
  const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  for (const font of manifest.fonts) {
    const name = `${font.sha256}.ttf`;
    const size = await miniProgram.evaluate(filename => {
      const fs = wx.getFileSystemManager(), directory = `${wx.env.USER_DATA_PATH}/learn-fonts`;
      try { fs.mkdirSync(directory, true); } catch { /* existing */ }
      try { return fs.statSync(`${directory}/${filename}`).size; } catch { return 0; }
    }, name);
    if (size === font.bytes) continue;
    const bytes = await readFile(new URL(`../assets/fonts/${font.path}`, import.meta.url)); assert.equal(bytes.length, font.bytes);
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      checkpoint('pinned font cache');
      await miniProgram.evaluate((filename, encoded, position, length) => {
        const state = getApp().__productDiagnostic;
        if (!position) state.fontSeed = new Uint8Array(length);
        const chunk = new Uint8Array(wx.base64ToArrayBuffer(encoded)); state.fontSeed.set(chunk, position);
        if (position + chunk.length === length) {
          try { wx.getFileSystemManager().writeFileSync(`${wx.env.USER_DATA_PATH}/learn-fonts/${filename}`, state.fontSeed.buffer); }
          finally { delete state.fontSeed; }
        }
      }, name, bytes.subarray(offset, offset + 262144).toString('base64'), offset, bytes.length);
    }
  }
}
async function openAndVerifyNativePdf(detail, jobId) {
  checkpoint('complete native PDF download'); const before = await account();
  await tap(detail, '#record-open-pdf');
  await waitFor(async () => await detail.data('downloading') === false && await miniProgram.evaluate(() => getApp().__productDiagnostic.viewerOutcome !== 'untested'));
  const firstOutcome = await miniProgram.evaluate(() => getApp().__productDiagnostic.viewerOutcome);
  if (firstOutcome === 'native-unavailable') {
    await miniProgram.evaluate(() => { getApp().__productDiagnostic.viewerMode = 'simulated'; });
    await repeatNativeDownload(detail);
  }
  assert.equal(await miniProgram.evaluate(() => getApp().__productDiagnostic.pdfOptionsValid), true);
  const length = await miniProgram.evaluate(id => {
    const state = getApp().__productDiagnostic, path = `${wx.env.USER_DATA_PATH}/learn-pdf/learn-${id}.pdf`;
    if (state.pdfPath !== path) return -1;
    state.readback = new Uint8Array(wx.getFileSystemManager().readFileSync(path)); return state.readback.length;
  }, jobId);
  const job = local.store.snapshot().generation_jobs[jobId]; assert.equal(length, job.fileBytes);
  const hash = createHash('sha256');
  for (let offset = 0; offset < length; offset += 262144) {
    checkpoint('native PDF readback hash');
    const encoded = await miniProgram.evaluate(position => wx.arrayBufferToBase64(getApp().__productDiagnostic.readback.slice(position, position + 262144).buffer), offset);
    hash.update(Buffer.from(encoded, 'base64'));
  }
  await miniProgram.evaluate(() => { delete getApp().__productDiagnostic.readback; });
  assert.equal(hash.digest('hex'), job.fileSha256); assert.equal((await account()).available, before.available);
  assert.equal(consumption(jobId), 1); return firstOutcome;
}
async function repeatNativeDownload(detail) {
  const calls = await miniProgram.evaluate(() => getApp().__productDiagnostic.viewerCalls);
  await tap(detail, '#record-open-pdf');
  await waitFor(async () => await detail.data('downloading') === false &&
    await miniProgram.evaluate(previous => getApp().__productDiagnostic.viewerCalls > previous, calls));
}
async function confirmPrivacy(value) {
  await waitFor(() => miniProgram.evaluate(() => !!getApp().__productDiagnostic.modal));
  await miniProgram.evaluate(confirm => {
    const state = getApp().__productDiagnostic, modal = state.modal; state.lastModal = modal; state.modal = null;
    modal.success({ confirm, cancel: !confirm });
  }, value);
}
async function restoreDiagnostics() {
  if (!miniProgram || restored) return;
  for (const gate of responseGates.values()) gate.resolve(); responseGates.clear(); prepareGate?.resolve(); prepareGate = null;
  await waitFor(() => miniProgram.evaluate(() => {
    const app = getApp(), state = app.__productDiagnostic;
    if (!state) return true;
    state.failCleanup = false;
    try { app.clearUserData(); return true; } catch { return false; }
  }), 10000);
  await miniProgram.evaluate(() => {
    const app = getApp(), state = app.__productDiagnostic;
    if (state) { state.restore(); delete app.__productDiagnostic; delete app.__learnRpcCallbacks; app.onLaunch(); }
  });
  await miniProgram.reLaunch('/pages/templates/index'); restored = true;
}
checkpoint('preflight');
try {
  const { default: automator } = await import('miniprogram-automator');
  const { createLocalService } = await import('./diagnostics/local-service.mjs');
  const { installServiceBridge } = await import('./diagnostics/automator-bridge.mjs');
  local = await createLocalService();
  // Valid diagnostic-only scan budget forces signed empty/short cursor pages.
  local.config.fileAccess.maxListScanRecords = 1;
  const originalPrepare = local.preparer.prepare.bind(local.preparer);
  local.preparer.prepare = async (...args) => {
    prepareCalls++; const result = await originalPrepare(...args), gate = prepareGate;
    if (gate) { gate.arrived = true; await gate.promise; } return result;
  };
  checkpoint('launch'); miniProgram = await automator.launch({ projectPath: root, timeout: 25000 });
  miniProgram.on('exception', () => exceptions++);
  await miniProgram.reLaunch('/pages/templates/index'); visited.add('pages/templates/index');
  await installServiceBridge(miniProgram, serviceHandler); await installNativeDiagnostics(); await seedFonts();
  await miniProgram.evaluate(() => { void getApp().compatibility.retry(); });
  await waitFor(() => miniProgram.evaluate(() => getApp().compatibility.view.status === 'ready'));

  checkpoint('admin zero-denominator and dated coverage');
  let me = await miniProgram.switchTab('/pages/me/index'); visited.add(me.path);
  await waitFor(async () => await me.data('phase') === 'ready'); assert.equal(await me.data('isAdmin'), true);
  await tap(me, '#me-admin'); let admin = await current('pages/admin/index');
  await waitFor(async () => await admin.data('status') === 'ready');
  assert.equal((await admin.data('summary')).metrics.find(row => row.id === 'failureRate').value, '暂无');
  await screenshot('admin-empty-denominator');
  await admin.callMethod('onDateChange', { detail: { value: '2000-01-01' } });
  await waitFor(async () => await admin.data('status') === 'ready' && (await admin.data('summary')).date === '2000-01-01');
  assert.equal((await admin.data('summary')).complete, false);
  assert.ok((await admin.data('summary')).metrics.every(row => row.value === '不可用'));
  checks.push('native-admin-zero-denominator-and-real-service-coverage-nulls');

  checkpoint('ordinary account and empty history'); await setIdentity(OWNER);
  me = await miniProgram.switchTab('/pages/me/index'); await waitFor(async () => await me.data('phase') === 'ready');
  assert.equal(await me.data('isAdmin'), false); assert.equal(await me.$('#me-admin'), null);
  const startingCredits = (await account()).available;
  await tap(me, '#me-records'); let records = await current('pages/records/index');
  await waitFor(async () => await records.data('phase') === 'ready'); assert.equal((await records.data('items')).length, 0);
  await screenshot('records-empty');
  admin = await miniProgram.navigateTo('/pages/admin/index'); await waitFor(async () => await admin.data('status') === 'denied');
  assert.equal(await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].data.summary === null), true);
  checks.push('ordinary-admin-denied-and-native-empty-history');

  for (const template of templates) for (const mode of ['blank', 'filled', 'tracing']) {
    checkpoint(`${template} ${mode} native generation`);
    const title = mode === 'blank' ? '' : template === 'pinyin-lines' ? 'Pīn yīn' : '合成学习练习';
    const body = mode === 'blank' ? '' : template === 'pinyin-lines' ? 'nǐ hǎo\nā á ǎ à ǖ ǘ ǚ ǜ\nǖ'
      : '春天来了\r\n小草发芽。\n\nhello 2026';
    let editor = await openEditor(template, title, body, mode === 'tracing');
    if (mode === 'filled') {
      await tap(editor, '#open-preview'); editor = await current('pages/preview/index');
      await waitFor(async () => await editor.data('status') === 'ready');
    }
    const result = await generate(editor, template); pdfs.push({ mode, ...await inspectPdf(result.jobId, template) });
    assert.equal(await miniProgram.evaluate(() => getApp().editor.draft.body), body);
    if (mode === 'filled') await screenshot(`generated-${template}`);
  }
  assert.equal((await account()).available, startingCredits - 12); assert.equal((await account()).reserved, 0);
  checks.push('four-templates-blank-filled-tracing-real-preview-cloud-PDF-and-one-debit');

  checkpoint('cloud input limit explicitly rejects without truncation');
  let editor = await openEditor('essay-grid', '', '春'.repeat(10001)); const beforeOverflow = (await account()).available;
  await tap(editor, '#generate-pdf'); await generationState('error');
  assert.equal((await miniProgram.currentPage()).path, 'pages/editor/index');
  assert.equal(await miniProgram.evaluate(() => getApp().editor.draft.body.length), 10001);
  assert.equal((await account()).available, beforeOverflow); await actionScreenshot('explicit-input-limit', '#generation-status');
  checks.push('oversize-cloud-input-rejected-with-exact-local-input-and-no-debit');

  checkpoint('successful response loss and native duplicate taps');
  editor = await openEditor('essay-grid'); const beforeLoss = (await account()).available, initialRequests = requests.length, beforePrepare = prepareCalls;
  loseAfterSubmit = 1; failures.set('findJobByRequest', 1);
  const heldSubmit = deferred(); responseGates.set('submitGeneration', heldSubmit);
  await tap(editor, '#generate-pdf'); await tap(editor, '#generate-pdf'); await waitFor(() => heldSubmit.arrived);
  assert.equal(requests.length, initialRequests + 1); responseGates.delete('submitGeneration'); heldSubmit.resolve();
  await generationState('uncertain'); await actionScreenshot('submission-unknown', '#generation-retry'); await tap(editor, '#generation-retry');
  let detail = await current('pages/records/detail'); await waitFor(async () => await detail.data('phase') === 'ready');
  const recoveredId = (await detail.data('record')).jobId;
  assert.equal(requests.length, initialRequests + 1); assert.equal(prepareCalls, beforePrepare + 1);
  assert.equal((await account()).available, beforeLoss - 1); assert.equal(consumption(recoveredId), 1);
  checks.push('duplicate-native-taps-and-lost-success-response-recover-original-job-once');

  checkpoint('unreceived submission retries the exact request');
  editor = await openEditor('tian-grid'); const prior = requests.length, priorCredits = (await account()).available;
  loseBeforeSubmit = 1; await tap(editor, '#generate-pdf'); await generationState('uncertain'); await tap(editor, '#generation-retry');
  detail = await current('pages/records/detail'); await waitFor(async () => await detail.data('phase') === 'ready');
  assert.equal(requests.length, prior + 2); assert.deepEqual(requests[prior].params, requests[prior + 1].params);
  assert.equal((await account()).available, priorCredits - 1); assert.equal(consumption((await detail.data('record')).jobId), 1);
  checks.push('native-retry-reuses-complete-request-id-and-immutable-snapshot');

  checkpoint('simulated background receives late settled response without navigation');
  editor = await openEditor('essay-grid');
  const backgroundResponse = deferred(); responseGates.set('submitGeneration', backgroundResponse);
  const beforeBackground = (await account()).available;
  await tap(editor, '#generate-pdf'); await waitFor(() => backgroundResponse.arrived);
  const backgroundRequest = requests.at(-1).params;
  const backgroundJob = Object.values(local.store.snapshot().generation_jobs).find(job => job.requestId === backgroundRequest.requestId);
  assert.equal(backgroundJob.status, 'SUCCEEDED');
  await miniProgram.evaluate(() => { getCurrentPages().slice(-1)[0].onHide(); getApp().onHide(); });
  responseGates.delete('submitGeneration'); backgroundResponse.resolve();
  await generationState('known'); assert.equal((await miniProgram.currentPage()).path, 'pages/editor/index');
  await miniProgram.evaluate(() => { getApp().onShow(); getCurrentPages().slice(-1)[0].onShow(); });
  await readyEditor(editor); assert.equal((await miniProgram.currentPage()).path, 'pages/editor/index');
  assert.equal((await account()).available, beforeBackground - 1); assert.equal(consumption(backgroundJob.jobId), 1);
  me = await miniProgram.switchTab('/pages/me/index'); await waitFor(async () => await me.data('phase') === 'ready');
  await tap(me, '#me-records'); records = await current('pages/records/index');
  await waitFor(async () => await records.data('phase') === 'ready');
  assert.ok((await records.data('items')).some(row => row.jobId === backgroundJob.jobId && row.state === 'ready'));
  await screenshot('background-completed-job-in-records');
  checks.push('simulated-App-page-background-late-response-preserves-navigation-and-cloud-settlement');

  checkpoint('leave page while real cloud preparation is pending');
  editor = await openEditor('mi-grid', '离页合成练习', '原文只在本次调用使用。');
  prepareGate = deferred(); await tap(editor, '#generate-pdf'); await waitFor(() => prepareGate.arrived);
  me = await miniProgram.switchTab('/pages/me/index'); await waitFor(async () => await me.data('phase') === 'ready');
  assert.equal((await account()).reserved, 1); await tap(me, '#me-records'); records = await current('pages/records/index');
  await waitFor(async () => await records.data('phase') === 'ready'); assert.ok((await records.data('items')).some(row => row.pending));
  await screenshot('accepted-job-after-leaving-editor'); const gate = prepareGate; prepareGate = null; gate.resolve();
  await waitFor(async () => (await account()).reserved === 0);
  await waitFor(async () => (await records.data('items')).every(row => !row.pending));
  assert.equal((await miniProgram.currentPage()).path, 'pages/records/index');
  await tap(records, '.record-row'); detail = await current('pages/records/detail'); await waitFor(async () => await detail.data('phase') === 'ready');
  const downloadJobId = (await detail.data('record')).jobId;
  checks.push('accepted-cloud-work-survives-navigation-and-records-observe-terminal-state');

  checkpoint('full native PDF file and repeated authorized download');
  const viewerOutcome = await openAndVerifyNativePdf(detail, downloadJobId); await screenshot('pdf-record-ready');
  const afterFirstDownload = (await account()).available;
  await repeatNativeDownload(detail);
  assert.equal((await account()).available, afterFirstDownload); assert.equal(consumption(downloadJobId), 1);
  checks.push('native-filesystem-complete-PDF-readback-hash-and-repeat-download-no-debit');

  // Further record/privacy integration follows below; no report is emitted until
  // every final stage and native cleanup succeeds.
  checkpoint('detail failure and expired file preserve authoritative success');
  const priorRecord = await detail.data('record'); failures.set('getJob', 1); await detail.callMethod('onRefresh');
  await waitFor(async () => await detail.data('phase') === 'error');
  assert.deepEqual(await detail.data('record'), priorRecord); assert.equal(await detail.data('canOpen'), false);
  await screenshot('detail-query-failure-preserves-known-status'); await detail.callMethod('onRefresh');
  await waitFor(async () => await detail.data('phase') === 'ready');
  const realNow = local.clock.now.bind(local.clock), requestCountBeforeExpiry = requests.length;
  try {
    local.clock.now = () => realNow() + local.config.generation.pdfRetentionMs + 60000;
    await detail.callMethod('onRefresh'); await waitFor(async () => (await detail.data('record'))?.state === 'expired');
    assert.equal(await detail.data('canOpen'), false); assert.equal(requests.length, requestCountBeforeExpiry);
    assert.equal(local.store.snapshot().generation_jobs[downloadJobId].status, 'SUCCEEDED'); await screenshot('expired-file');
  } finally { local.clock.now = realNow; }
  checks.push('record-query-errors-and-file-expiry-never-reverse-success-or-regenerate');

  checkpoint('real signed cursors across empty and short pages');
  const latestJob = local.store.snapshot().generation_jobs[downloadJobId];
  const binding = await local.store.get('generation_requests', latestJob.requestKey);
  // Simulate a retained deletion marker awaiting index cleanup. The real service
  // filters it and signs the continuation cursor; no list response is invented.
  await local.store.transaction(tx => tx.set('generation_requests', latestJob.requestKey, { ...binding, deleted: true }));
  const cursorStart = listLengths.length;
  try {
    await detail.callMethod('onRecords'); records = await current('pages/records/index');
    await waitFor(async () => await records.data('phase') === 'ready');
    assert.equal(await records.data('hasMore'), true);
    for (let count = 0; await records.data('hasMore'); count++) {
      assert.ok(count < 20, 'bounded native pagination'); checkpoint('native record continuation');
      const priorLength = (await records.data('items')).length;
      // Automator scroll-to-tap may trigger onReachBottom and remove the button
      // before Element.tap. Invoke that same registered page handler explicitly.
      await records.callMethod('onMore');
      await waitFor(async () => await records.data('phase') === 'ready' && await records.data('loadingMore') === false &&
        ((await records.data('items')).length > priorLength || await records.data('hasMore') === false));
    }
    const visible = await records.data('items');
    const expected = Object.values(local.store.snapshot().generation_jobs).filter(job => job.userId === latestJob.userId).length - 1;
    assert.equal(visible.length, expected); assert.ok(listLengths.slice(cursorStart).some(row => row.length === 0 && row.cursor));
    assert.ok(listLengths.slice(cursorStart).some(row => row.length === 1 && row.cursor));
    assert.doesNotMatch(JSON.stringify(visible), /requestId|layoutDigest|合成学习练习/);
    failures.set('listJobs', 1); await records.callMethod('onRefresh'); await waitFor(async () => await records.data('phase') === 'error');
    assert.deepEqual(await records.data('items'), visible); await screenshot('record-list-retry-preserves-items');
  } finally { await local.store.transaction(tx => tx.set('generation_requests', latestJob.requestKey, binding)); }
  checks.push('actual-cloud-signed-empty-short-cursor-pages-and-native-list-error-retention');

  checkpoint('cross-user record and PDF authorization'); await setIdentity(OTHER);
  detail = await miniProgram.navigateTo(`/pages/records/detail?jobId=${downloadJobId}`);
  await waitFor(async () => await detail.data('phase') === 'error');
  assert.equal(await miniProgram.evaluate(() => getCurrentPages().slice(-1)[0].data.record === null), true);
  assert.equal(await detail.data('canOpen'), false);
  const otherPdf = await local.rpcFor(OTHER)({ method: 'getPdfInfo', params: { jobId: downloadJobId } });
  assert.equal(otherPdf.ok, false); assert.ok(['NOT_FOUND', 'FORBIDDEN'].includes(otherPdf.error.code));
  await screenshot('other-user-record-denied'); checks.push('native-cross-user-record-denial-and-cloud-PDF-authorization');

  checkpoint('privacy cancels local pending work while cloud settlement survives'); await setIdentity(OWNER);
  editor = await openEditor('essay-grid', '隐私合成练习', '此合成输入只用于最终自动化验证。');
  const lateSubmit = deferred(); responseGates.set('submitGeneration', lateSubmit);
  await tap(editor, '#generate-pdf'); await waitFor(() => lateSubmit.arrived);
  const privacyRequest = requests.at(-1).params;
  const settledJob = Object.values(local.store.snapshot().generation_jobs).find(job => job.requestId === privacyRequest.requestId);
  assert.equal(settledJob.status, 'SUCCEEDED'); assert.equal(consumption(settledJob.jobId), 1);
  detail = await miniProgram.navigateTo(`/pages/records/detail?jobId=${downloadJobId}`);
  await waitFor(async () => await detail.data('phase') === 'ready');
  const latePdf = deferred(); responseGates.set('readPdfChunk', latePdf);
  const viewerCallsBeforeClear = await miniProgram.evaluate(() => getApp().__productDiagnostic.viewerCalls);
  await tap(detail, '#record-open-pdf'); await waitFor(() => latePdf.arrived);
  me = await miniProgram.switchTab('/pages/me/index'); await waitFor(async () => await me.data('phase') === 'ready');
  const accountCallsBeforePrivacy = rpcCounts.get('getAccount') ?? 0;
  await tap(me, '#me-privacy'); const privacy = await current('pages/privacy/index');
  await waitFor(async () => await privacy.data('phase') === 'ready');
  assert.equal(rpcCounts.get('getAccount') ?? 0, accountCallsBeforePrivacy);
  const draftBeforeCancel = await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft));
  const deleteCallsBefore = rpcCounts.get('deleteMyData') ?? 0;
  await tap(privacy, '#privacy-delete'); await waitFor(async () => await privacy.data('phase') === 'confirming');
  await confirmPrivacy(false); await waitFor(async () => await privacy.data('phase') === 'ready');
  assert.equal(rpcCounts.get('deleteMyData') ?? 0, deleteCallsBefore);
  assert.equal(await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft)), draftBeforeCancel);
  await miniProgram.evaluate(() => { getApp().__productDiagnostic.failCleanup = true; });
  await tap(privacy, '#privacy-delete'); await waitFor(async () => await privacy.data('phase') === 'confirming'); await confirmPrivacy(true);
  await waitFor(async () => await privacy.data('phase') === 'ready' && (await privacy.data('deletion'))?.state === 'deleting');
  assert.equal(await privacy.data('localClearFailed'), true); assert.equal(await miniProgram.evaluate(() => getApp().editor.hasInput), false);
  assert.equal(await miniProgram.evaluate(() => getApp().generation.view.hasRequest), false);
  responseGates.delete('submitGeneration'); responseGates.delete('readPdfChunk'); lateSubmit.resolve(); latePdf.resolve();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await miniProgram.currentPage()).path, 'pages/privacy/index');
  assert.equal(await miniProgram.evaluate(() => getApp().__productDiagnostic.viewerCalls), viewerCallsBeforeClear);
  await screenshot('privacy-deleting-with-local-retry');
  await miniProgram.evaluate(() => { getApp().__productDiagnostic.failCleanup = false; });
  await tap(privacy, '.local-error button'); await waitFor(async () => await privacy.data('localClearFailed') === false);
  const localEmpty = await miniProgram.evaluate(() => {
    const app = getApp(), fs = wx.getFileSystemManager();
    const pdfs = fs.readdirSync(wx.env.USER_DATA_PATH).includes('learn-pdf')
      ? fs.readdirSync(`${wx.env.USER_DATA_PATH}/learn-pdf`).filter(name => name.endsWith('.pdf')) : [];
    return !app.editor.hasInput && app.editor.preview === null && !app.generation.view.hasRequest && pdfs.length === 0;
  });
  assert.equal(localEmpty, true); assert.equal(consumption(settledJob.jobId), 1);
  const userCount = Object.keys(local.store.snapshot().users).length;
  for (const [method, params] of [['getAccount', {}], ['listJobs', {}], ['getPdfInfo', { jobId: downloadJobId }]]) {
    const denied = await local.rpcFor(OWNER)({ method, params }); assert.equal(denied.ok, false);
    assert.ok(['ACCOUNT_DELETING', 'ACCOUNT_DISABLED'].includes(denied.error.code));
  }
  assert.equal(Object.keys(local.store.snapshot().users).length, userCount);
  checks.push('explicit-privacy-cancel-delete-local-failure-retry-and-late-submit-PDF-cancellation');
  checks.push('deleted-account-denies-account-records-files-without-recreation-or-terminal-reversal');

  checkpoint('native privacy warning rendering');
  await miniProgram.evaluate(() => {
    const state = getApp().__productDiagnostic, options = state.lastModal;
    state.originalModal.call(wx, { title: options.title, content: options.content, confirmText: options.confirmText, cancelText: options.cancelText });
  });
  await screenshot('privacy-native-confirmation-warning');
  const durable = JSON.stringify(local.store.snapshot());
  for (const text of ['合成学习练习', '离页合成练习', '隐私合成练习', '此合成输入只用于最终自动化验证。']) assert.equal(durable.includes(text), false);
  for (const route of productRoutes) assert.ok(visited.has(route), 'each product page was visited');
  const summary = { checks, productPages: productRoutes.length, PDFs: pdfs,
    rpcCounts: Object.fromEntries(rpcCounts), actualPrepareCalls: prepareCalls,
    originalViewerOutcome: viewerOutcome, viewerFallback: viewerOutcome === 'native-unavailable' ? 'only openDocument completion simulated after actual API failure/timeout' : 'none',
    backgroundLifecycle: 'actual App/Page onHide/onShow handlers invoked explicitly; no true-device background claim',
    secureRandom: 'actual wx.getRandomValues without override',
    paginationInteraction: 'registered native page onMore handler; automator scroll-to-tap also triggers onReachBottom',
    privacyConfirmation: 'native buttons; actual showModal options rendered; confirm/cancel callbacks simulated because SDK native modal actions do not callback',
    backend: 'actual CloudService/layout/fonts/PDF with shared memory identity/store/storage; deliberate transport and cleanup faults',
    compatibility: 'covered separately by test-compatibility-devtools and T19 evidence',
    externalCloudBaseDevicesLicensingPrintingAndPublishing: 'pending Owner acceptance' };
  checkpoint('restore native APIs and clear synthetic data'); await restoreDiagnostics(); await screenshot('cleanup-home');
  const system = await miniProgram.systemInfo(); assert.equal(system.platform, 'devtools'); assert.equal(exceptions, 0);
  await writeFile(new URL('report.json', output), JSON.stringify({ platform: system.platform, baseLibraryVersion: system.SDKVersion,
    simulatedWechatVersion: system.version, appExceptions: exceptions, ...summary }, null, 2) + '\n');
  console.log(JSON.stringify({ productIntegrationPassed: true, checks: checks.length, productPages: productRoutes.length,
    generatedMatrixPDFs: pdfs.length, appExceptions: exceptions, originalViewerOutcome: viewerOutcome, externalAcceptance: 'pending' }));
} catch (error) {
  console.error(`Product diagnostics failed during ${stage}; no input, request, layout or raw exception logged.`);
  console.error(`Error class: ${/^[A-Za-z0-9_]+$/.test(error?.name) ? error.name : 'unavailable'}.`);
  const frame = error?.stack?.match(/test-product-devtools\.mjs:\d+:\d+/)?.[0]; if (frame) console.error(`Diagnostic location: ${frame}.`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (miniProgram) { await restoreDiagnostics().catch(() => {}); miniProgram.disconnect(); }
}
