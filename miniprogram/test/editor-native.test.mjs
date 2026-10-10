import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createLayoutDigest } from '../../packages/paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../packages/font-metrics/dist/index.js';
const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(root, 'dist/miniprogram');
function nativeRuntime() {
  let app, page;
  const timers = new Map(), navigations = [], notices = [], modules = new Map(); let timer = 0;
  const platform = {
    env: { USER_DATA_PATH: '/private' }, getWindowInfo: () => ({ windowWidth: 390, windowHeight: 700, pixelRatio: 3 }),
    getFileSystemManager: () => ({ readFile({ fail }) { fail(); }, mkdirSync() {}, unlinkSync() {} }),
    navigateTo({ url, complete }) { navigations.push(url); complete?.(); }, setNavigationBarTitle() {},
    showToast({ title }) { notices.push(title); }, switchTab({ url }) { navigations.push(url); },
  };
  const context = vm.createContext({ wx: platform, App(options) { app = options; }, getApp: () => app,
    Page(options) { page = options; }, setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); } },
  { codeGeneration: { strings: false, wasm: false } });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    assert.ok(file.startsWith(output + '/')); const module = { exports: {} }; modules.set(file, module);
    const require = name => { assert.ok(name.startsWith('.')); return load(resolve(dirname(file), name)); };
    const wrapper = new vm.Script(`(function(require,module,exports){${readFileSync(file, 'utf8')}\n})`, { filename: file }).runInContext(context);
    wrapper(require, module, module.exports); return module.exports;
  }
  load(resolve(output, 'app.js')); app.onLaunch.call(app);
  const makePage = route => {
    load(resolve(output, `${route}.js`)); const definition = page;
    const requests = [];
    const component = { async display(request) {
      requests.push(request);
      const { layout, pageIndex, widthPx, zoom = 1 } = request;
      return { cssWidth: widthPx * zoom, glyphCount: layout.pages[pageIndex].glyphs.length };
    }, clear() {} };
    const instance = { data: {}, setData(value) { Object.assign(this.data, value); }, selectComponent: () => component };
    return { definition, instance, requests, call(name, ...args) { return definition[name]?.call(instance, ...args); } };
  };
  return { app, makePage, navigations, notices, timers };
}
test('independently emitted native page entries share App draft, cleanup and undo across preview/back', async () => {
  const runtime = nativeRuntime(), editor = runtime.makePage('pages/editor/index');
  editor.call('onLoad', { template: 'tian-grid' }); editor.call('onShow'); editor.call('onReady');
  const body = 'hello\r\nworld\n\n原始空行';
  editor.call('onBodyInput', { detail: { value: body } }); editor.call('onTitleInput', { detail: { value: '私人标题' } });
  editor.call('onToggleSettings'); editor.call('onTracing', { detail: { value: true } });
  assert.equal(runtime.app.editor.draft.body, body); assert.equal(editor.instance.data.expanded, true);
  editor.call('onCleanup'); assert.equal(editor.instance.data.cleanup.before, body);
  editor.call('onApplyCleanup'); assert.equal(runtime.app.editor.draft.body, 'hello world\n\n原始空行');
  editor.call('onPreview'); assert.deepEqual(runtime.navigations, ['/pages/preview/index']); editor.call('onHide');
  const preview = runtime.makePage('pages/preview/index'); preview.call('onLoad'); preview.call('onShow'); preview.call('onReady');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(runtime.app.editor.draft.title, '私人标题');
  preview.call('onUnload'); editor.call('onShow');
  assert.equal(editor.instance.data.body, 'hello world\n\n原始空行'); assert.equal(editor.instance.data.expanded, true);
  editor.call('onUndoCleanup'); assert.equal(editor.instance.data.body, body);
  editor.call('onHide'); assert.equal(runtime.timers.size, 0);
});
test('native shares use fixed artwork and template-only routes, never automatic screenshots or private content', () => {
  const runtime = nativeRuntime(); runtime.app.editor.setBody('私人正文'); runtime.app.editor.setTitle('私人标题');
  for (const route of ['pages/templates/index', 'pages/editor/index', 'pages/preview/index']) {
    const page = runtime.makePage(route), share = page.call('onShareAppMessage');
    assert.equal(share.imageUrl, '/assets/share-paper.png');
    assert.ok(existsSync(resolve(output, share.imageUrl.slice(1))));
    assert.ok(!JSON.stringify(share).includes('私人')); assert.ok(!share.path.includes('body='));
  }
});
test('native markup preserves unrestricted stable input nodes and only exposes approved settings/navigation', () => {
  const config = JSON.parse(readFileSync(resolve(output, 'app.json')));
  assert.deepEqual(config.tabBar.list.map(item => item.text), ['纸张', '我的']);
  assert.equal(config.pages[0], 'pages/templates/index');
  const editor = readFileSync(resolve(output, 'pages/editor/index.wxml'), 'utf8');
  assert.equal((editor.match(/<textarea[^>]*maxlength="-1"/g) ?? []).length, 2);
  assert.ok(!/<textarea[^>]*wx:if/.test(editor)); assert.match(editor, /wx:if="\{\{expanded\}\}"/);
  assert.ok(!editor.includes('fontSize')); assert.ok(!editor.includes('gray')); assert.ok(!editor.includes('格宽'));
  assert.match(editor, /id="cleanup-before"/); assert.match(editor, /id="cleanup-after"/);
});


test('pinyin editor excerpt includes the first body band after a title and gap without changing layout', async () => {
  const runtime = nativeRuntime();
  const fonts = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION,
    fonts: { 'misans-latin-regular': new Uint8Array(readFileSync(resolve(root, 'assets/fonts/files/MiSansLatin-Regular.ttf'))) } });
  // Inject the real pinned font through the emitted session's public constructor.
  runtime.app.editor.selectTemplate('pinyin-lines');
  const preset = runtime.app.editor.preset; // Keep the trusted preset in the native VM realm.
  runtime.app.editor = new runtime.app.editor.constructor({ presetFor: () => preset, loadFonts: async () => fonts }, 'pinyin-lines');
  runtime.app.editor.setTitle('Pīn yīn'); runtime.app.editor.setBody('nǐ hǎo');
  const preview = await runtime.app.editor.preparePreview(), digest = createLayoutDigest(JSON.parse(JSON.stringify(preview.layout)));
  const editor = runtime.makePage('pages/editor/index');
  editor.call('onLoad', { template: 'pinyin-lines' }); editor.call('onShow'); editor.call('onReady');
  await Promise.resolve();
  const request = editor.requests.at(-1), viewport = request.viewport;
  const bodyGlyphs = preview.layout.pages[0].glyphs.filter(glyph => glyph.source.block === 'body' && glyph.inkBoundsMm);
  assert.ok(bodyGlyphs.length > 0);
  for (const glyph of bodyGlyphs) {
    assert.ok(glyph.inkBoundsMm.y >= viewport.topMm, 'first body ink begins inside excerpt');
    assert.ok(glyph.inkBoundsMm.y + glyph.inkBoundsMm.height <= viewport.topMm + viewport.heightMm,
      'title and gap must not push the first body band outside the excerpt');
  }
  assert.equal(createLayoutDigest(JSON.parse(JSON.stringify(preview.layout))), digest);
  editor.call('onUnload');
});
