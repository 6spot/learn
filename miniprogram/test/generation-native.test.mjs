import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomFillSync } from 'node:crypto';
import { build } from 'esbuild';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION, FONT_RESOURCES } from '../../packages/font-metrics/dist/index.js';
import { executionFixture, deferred } from '../../packages/cloud-service/test/execution-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(root, 'miniprogram');
// Compile the current native sources without racing the shared DevTools build.
const bundles = new Map(await Promise.all(['app', 'pages/editor/index', 'pages/preview/index'].map(async entry => {
  const result = await build({ entryPoints: [resolve(output, `${entry}.ts`)], bundle: true, write: false,
    format: 'cjs', platform: 'neutral', target: 'es2017', plugins: [{ name: 'original-font-provider', setup(builder) {
      builder.onResolve({ filter: /font-metrics\/dist\/index\.js$/ }, () => ({ path: './original-font-provider.cjs', external: true }));
    } }] });
  return [resolve(output, `${entry}.js`), result.outputFiles[0].text];
})));
const fontProvider = readFileSync(resolve(root, 'packages/font-metrics/dist/miniapp.cjs'), 'utf8');
const font = new Uint8Array(readFileSync(resolve(root, 'assets/fonts/files/MiSans-Regular.ttf')));
const pin = FONT_RESOURCES.find(item => item.id === 'misans-regular');
const fonts = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { 'misans-regular': font } });
const tick = async (count = 50) => { for (let n = 0; n < count; n++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));

async function nativeRuntime() {
  const backend = await executionFixture({ metrics: fonts, resources: {
    describeBundle: async version => ({ fontBundleVersion: version, fonts: [{ id: pin.id, bytes: pin.bytes,
      sha256: pin.sha256, fontVersion: pin.fontVersion, location: 'local://original-misans' }] }),
    readFontBytes: async () => font,
  } });
  let app, pageDefinition, currentRoute = '', timer = 0, entropyCalls = 0;
  const modules = new Map(), timers = new Map(), navigations = [], requests = [], hooks = {};
  const fs = { readFile({ filePath, success, fail }) {
    if (filePath.endsWith(`${pin.sha256}.ttf`)) success({ data: Uint8Array.from(font).buffer }); else fail();
  }, readdirSync: () => [], mkdirSync() {}, unlinkSync() {}, writeFile({ success }) { success(); } };
  const platform = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => fs,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 700, pixelRatio: 3 }),
    getRandomValues(options) { entropyCalls++; options.success({ randomValues: randomFillSync(new Uint8Array(options.length)).buffer }); },
    navigateTo({ url, success, complete }) { navigations.push(url); currentRoute = url.slice(1).split('?')[0]; success?.(); complete?.(); },
    setNavigationBarTitle() {}, showToast() {},
  };
  const context = vm.createContext({ wx: platform, App(options) { app = options; }, getApp: () => app,
    Page(options) { pageDefinition = options; }, getCurrentPages: () => currentRoute ? [{ route: currentRoute }] : [],
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); } },
  { codeGeneration: { strings: false, wasm: false } });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    assert.ok(file.startsWith(output + '/')); const module = { exports: {} }; modules.set(file, module);
    const require = name => { assert.ok(name.startsWith('.')); return load(resolve(dirname(file), name)); };
    const source = file.endsWith('/original-font-provider.cjs') ? fontProvider : bundles.get(file);
    assert.ok(source, `Missing native source bundle: ${file}`);
    new vm.Script(`(function(require,module,exports){${source}\n})`, { filename: file }).runInContext(context)(require, module, module.exports);
    return module.exports;
  }
  load(resolve(output, 'app.js')); app.onLaunch.call(app); app.onShow.call(app); await app.compatibility.start();
  app.client.transport = async (method, params) => {
    const args = clone(params); requests.push({ method, args });
    await hooks.before?.(method, args);
    let data;
    if (method === 'getCompatibility') data = await backend.service.getCompatibility(args);
    else if (method === 'getSubmissionWindow') data = await backend.service.getSubmissionWindow();
    else if (method === 'submitGeneration') data = await backend.service.submitGeneration(args);
    else if (method === 'findJobByRequest') data = await backend.service.findJobByRequest(args.requestId);
    else if (method === 'getAccount') data = await backend.service.getAccount();
    else throw new Error('Unexpected native generation RPC');
    await hooks.after?.(method, args, data);
    return { ok: true, data };
  };
  await app.compatibility.retry(); assert.equal(app.compatibility.view.canGenerate, true);
  const makePage = (route, display = async () => ({})) => {
    load(resolve(output, `${route}.js`)); const definition = pageDefinition;
    const instance = { data: clone(definition.data), changes: 0,
      setData(value) { Object.assign(this.data, value); this.changes++; }, selectComponent: () => ({ display, clear() {} }) };
    return { instance, call(name, ...args) {
      if (name === 'onShow') currentRoute = route;
      return definition[name]?.call(instance, ...args);
    } };
  };
  async function ready(page) {
    page.call('onLoad', { template: 'essay-grid' }); page.call('onShow'); page.call('onReady');
    await app.editor.preparePreview(); await tick();
  }
  return { app, backend, makePage, ready, hooks, requests, navigations, timers,
    get entropyCalls() { return entropyCalls; }, leave(route = 'pages/records/index') { currentRoute = route; } };
}

test('source-bundled editor and preview generate through one App session/client; repeat taps and explicit next generation have distinct meanings', async () => {
  for (const route of ['pages/editor/index', 'pages/preview/index']) {
    const h = await nativeRuntime(), page = h.makePage(route); await h.ready(page);
    assert.equal(page.instance.data.canGenerate, true);
    const first = page.call('onGenerate'); page.call('onGenerate');
    assert.equal(page.instance.data.generationBusy, true); assert.equal(page.instance.data.canGenerate, false);
    const result = await first; assert.equal(result.kind, 'known');
    assert.equal(h.entropyCalls, 1); assert.equal(h.backend.counts.render, 1); assert.equal((await h.backend.service.getAccount()).available, 19);
    assert.equal(h.navigations[0], `/pages/records/detail?jobId=${result.jobId}`);
    page.call('onHide'); page.call('onShow'); await tick();
    assert.equal(page.instance.data.generationLabel, '再次生成 PDF'); assert.equal(page.instance.data.canGenerate, true);
    const next = await page.call('onGenerate'); assert.equal(next.kind, 'known'); assert.notEqual(next.jobId, result.jobId);
    assert.equal(h.entropyCalls, 2); assert.equal(h.backend.counts.render, 2); assert.equal((await h.backend.service.getAccount()).available, 18);
    page.call('onUnload');
  }
});

test('unknown original request blocks new generation on both pages; retry after editing submits only the original snapshot', async () => {
  const h = await nativeRuntime(), editor = h.makePage('pages/editor/index'); await h.ready(editor);
  let fail = true;
  h.hooks.before = async method => { if (method === 'submitGeneration' && fail) throw new Error('simulated request not delivered'); };
  assert.equal((await editor.call('onGenerate')).kind, 'unresolved');
  assert.equal(editor.instance.data.generationCanQuery, true); assert.equal(editor.instance.data.generationCanRetry, true);
  assert.equal(editor.instance.data.canGenerate, false);
  editor.call('onBodyInput', { detail: { value: '编辑后的新内容' } });
  await h.app.editor.preparePreview(); await tick();
  assert.match(editor.instance.data.generationHint, /仍对应上次/);
  const first = h.requests.find(item => item.method === 'submitGeneration').args;
  assert.equal(first.input.body, ''); assert.equal(h.backend.counts.render, 0);
  editor.call('onHide'); const preview = h.makePage('pages/preview/index'); await h.ready(preview);
  assert.equal(preview.instance.data.canGenerate, false); assert.equal(preview.instance.data.generationCanQuery, true);
  assert.equal(preview.call('onGenerate'), undefined);
  fail = false; assert.equal((await preview.call('onGenerationRetry')).kind, 'known');
  const submissions = h.requests.filter(item => item.method === 'submitGeneration');
  assert.equal(submissions.length, 2); assert.deepEqual(submissions[1].args, first);
  assert.equal(h.entropyCalls, 1); assert.equal(h.backend.counts.render, 1); assert.equal((await h.backend.service.getAccount()).available, 19);
  assert.equal(h.app.editor.draft.body, '编辑后的新内容'); preview.call('onUnload'); editor.call('onUnload');
});

test('native retry recovers a lost successful response without another render or debit', async () => {
  const h = await nativeRuntime(), page = h.makePage('pages/editor/index'); await h.ready(page);
  let lose = true, offline = true;
  h.hooks.after = async method => { if (method === 'submitGeneration' && lose) { lose = false; throw new Error('simulated response loss'); } };
  h.hooks.before = async method => { if (method === 'findJobByRequest' && offline) throw new Error('simulated query offline'); };
  assert.equal((await page.call('onGenerate')).kind, 'unresolved');
  assert.equal(h.backend.counts.render, 1); assert.equal(h.navigations.length, 0); assert.equal(page.instance.data.canGenerate, false);
  offline = false; assert.equal((await page.call('onGenerationRetry')).kind, 'known');
  assert.equal(h.requests.filter(item => item.method === 'submitGeneration').length, 1);
  assert.equal(h.backend.counts.render, 1); assert.equal((await h.backend.service.getAccount()).available, 19);
  page.call('onUnload');
});

test('leaving a generation page keeps the cloud task running and does not navigate back on its late result', async () => {
  const h = await nativeRuntime(), page = h.makePage('pages/editor/index'), gate = deferred(); await h.ready(page);
  h.hooks.after = async method => { if (method === 'submitGeneration') await gate.promise; };
  const pending = page.call('onGenerate'); await tick();
  page.call('onHide'); h.leave(); const changes = page.instance.changes;
  gate.resolve(); assert.equal((await pending).kind, 'known');
  assert.equal(h.app.generation.view.status, 'known'); assert.equal(h.navigations.length, 0);
  assert.equal(page.instance.changes, changes); assert.equal((await h.backend.service.getAccount()).available, 19);
  page.call('onUnload');
});

test('App privacy cleanup cancels pending local generation and prevents its late cloud response from navigating', async () => {
  const h = await nativeRuntime(), page = h.makePage('pages/preview/index'), gate = deferred(); await h.ready(page);
  h.hooks.after = async method => { if (method === 'submitGeneration') await gate.promise; };
  const pending = page.call('onGenerate'); await tick();
  h.app.clearUserData(); assert.equal((await pending).kind, 'cancelled');
  assert.equal(h.app.generation.view.hasRequest, false); assert.equal(h.app.editor.draft.body, '');
  gate.resolve(); await tick(); assert.equal(h.app.generation.view.status, 'idle'); assert.equal(h.navigations.length, 0);
  page.call('onUnload');
});

test('hidden generation pages do not navigate on late results even when the top route is retained', async () => {
  for (const route of ['pages/editor/index', 'pages/preview/index']) {
    const h = await nativeRuntime(), page = h.makePage(route), gate = deferred(); await h.ready(page);
    h.hooks.after = async method => { if (method === 'submitGeneration') await gate.promise; };
    const pending = page.call('onGenerate'); await tick();
    page.call('onHide'); const changes = page.instance.changes;
    gate.resolve(); assert.equal((await pending).kind, 'known');
    assert.equal(h.app.generation.view.status, 'known'); assert.equal(h.navigations.length, 0);
    assert.equal(page.instance.changes, changes); assert.equal((await h.backend.service.getAccount()).available, 19);
    page.call('onShow'); await tick(); assert.equal(h.navigations.length, 0);
    page.call('onUnload');
  }
});

test('App backgrounding prevents late navigation before the generation page receives onHide', async () => {
  const h = await nativeRuntime(), page = h.makePage('pages/editor/index'), gate = deferred(); await h.ready(page);
  h.hooks.after = async method => { if (method === 'submitGeneration') await gate.promise; };
  const pending = page.call('onGenerate'); await tick(); h.app.onHide.call(h.app);
  gate.resolve(); assert.equal((await pending).kind, 'known');
  assert.equal(h.app.generation.view.status, 'known'); assert.equal(h.navigations.length, 0);
  page.call('onHide'); h.app.onShow.call(h.app); page.call('onShow'); await tick();
  assert.equal(h.navigations.length, 0); assert.equal((await h.backend.service.getAccount()).available, 19);
  page.call('onUnload');
});

test('an old page hide token cannot cancel the newly visible generation page', async () => {
  const h = await nativeRuntime(), editor = h.makePage('pages/editor/index'), gate = deferred(); await h.ready(editor);
  h.hooks.after = async method => { if (method === 'submitGeneration') await gate.promise; };
  const pending = editor.call('onGenerate'); await tick();
  const preview = h.makePage('pages/preview/index'); await h.ready(preview);
  editor.call('onHide'); editor.call('onUnload');
  gate.resolve(); const result = await pending; assert.equal(result.kind, 'known');
  assert.deepEqual(h.navigations, [`/pages/records/detail?jobId=${result.jobId}`]);
  preview.call('onUnload');
});

test('generation stays disabled before current Canvas completes and after a failed render on either page', async () => {
  for (const route of ['pages/editor/index', 'pages/preview/index']) {
    const h = await nativeRuntime(), gate = deferred(), page = h.makePage(route, () => gate.promise); await h.ready(page);
    assert.equal(h.app.editor.status, 'ready'); assert.equal(page.instance.data.canGenerate, false);
    assert.equal(page.call('onGenerate'), undefined); assert.equal(h.entropyCalls, 0);
    gate.resolve(null); await tick(); assert.equal(page.instance.data.canGenerate, false);
    assert.equal(page.call('onGenerate'), undefined); assert.equal(h.entropyCalls, 0); page.call('onUnload');
  }
});

test('a stale Canvas completion never enables generation for newer input on either page', async () => {
  for (const route of ['pages/editor/index', 'pages/preview/index']) {
    const h = await nativeRuntime(), displays = [], page = h.makePage(route, () => {
      const gate = deferred(); displays.push(gate); return gate.promise;
    });
    await h.ready(page); assert.equal(displays.length, 1); assert.equal(page.instance.data.canGenerate, false);
    h.app.editor.setBody('当前正文'); await h.app.editor.preparePreview(); await tick();
    assert.equal(displays.length, 2);
    displays[0].resolve({}); await tick(); assert.equal(page.instance.data.canGenerate, false);
    assert.equal(page.call('onGenerate'), undefined); assert.equal(h.entropyCalls, 0);
    displays[1].resolve({}); await tick(); assert.equal(page.instance.data.canGenerate, true);
    assert.equal((await page.call('onGenerate')).kind, 'known');
    assert.equal(h.requests.find(item => item.method === 'submitGeneration').args.input.body, '当前正文');
    page.call('onUnload');
  }
});

test('both generation entry points use real loading/disabled buttons and explicit original-request actions', () => {
  for (const route of ['editor', 'preview']) {
    const wxml = readFileSync(resolve(output, `pages/${route}/index.wxml`), 'utf8');
    assert.match(wxml, /<button[^>]*id="generate-pdf"[^>]*loading="\{\{generationBusy\}\}"[^>]*disabled="\{\{!canGenerate\}\}"/);
    assert.match(wxml, /id="generation-query"[^>]*bindtap="onGenerationQuery"/);
    assert.match(wxml, /id="generation-retry"[^>]*bindtap="onGenerationRetry"/);
    assert.match(wxml, /重试上次内容/);
  }
});
