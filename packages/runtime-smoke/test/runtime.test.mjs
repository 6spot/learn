import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function isolatedModule(file, setup = '', globals = {}) {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, ...globals }, {
    codeGeneration: { strings: false, wasm: false },
  });
  if (setup) vm.runInContext(setup, context);
  vm.runInContext(read(file), context, { filename: file, timeout: 2000 });
  return module.exports;
}
const load = (target, name = 'runtime-smoke', setup = '') =>
  isolatedModule(`dist/runtime/${target}/${name}.cjs`, setup);

test('both emitted bundles import in isolation without Node, wx or dynamic evaluation', () => {
  for (const target of ['miniapp', 'cloud']) {
    const report = load(target).runRuntimeSmoke();
    assert.equal(report.checks.length, 11);
    assert.ok(report.checks.every(check => check.status === 'passed'));
    assert.equal(report.targetRuntimeVerified, false);
  }
});

test('Node can import the cloud CommonJS artifact using its native module loader', () => {
  const require = createRequire(import.meta.url);
  const core = require(resolve(root, 'dist/runtime/cloud/paper-core.cjs'));
  assert.equal(core.buildPageGeometry(core.getDefaultPreset('pinyin-lines')).segments.length, 56);
});

test('miniapp and cloud artifacts preserve all geometry and synthetic text placements', () => {
  const mini = load('miniapp');
  const cloud = load('cloud');
  for (const fixture of mini.TEXT_FIXTURES) {
    assert.deepEqual(plain(mini.runTextFixture(fixture.id)), plain(cloud.runTextFixture(fixture.id)), fixture.id);
  }
  const miniCore = load('miniapp', 'paper-core');
  const cloudCore = load('cloud', 'paper-core');
  for (const id of mini.TEMPLATE_IDS) {
    assert.deepEqual(plain(miniCore.buildPageGeometry(miniCore.getDefaultPreset(id))),
      plain(cloudCore.buildPageGeometry(cloudCore.getDefaultPreset(id))));
  }
});

test('synthetic fixtures retain paragraphs, graphemes, end-stop and multipage content', () => {
  const smoke = load('miniapp');
  const paragraphs = smoke.runTextFixture('essay-paragraphs').pages[0].placements;
  assert.deepEqual(plain(paragraphs.filter(p => p.kind === 'body').map(p => p.row)), [2, 2, 3, 3, 5, 5]);
  const unicode = smoke.runTextFixture('essay-unicode').pages[0].placements.map(p => p.text);
  assert.deepEqual(plain(unicode), ['春', 'e\u0301cole', ' ', '👨‍👩‍👧‍👦', '𠀀']);
  const multipage = smoke.runTextFixture('essay-multipage');
  assert.equal(multipage.pages.length, 2);
  assert.equal(multipage.pages.flatMap(page => page.placements).map(p => p.text).join(''), '春'.repeat(19 * 28));
  assert.ok(multipage.pages.every(page => page.geometry.segments.length === 48));
  const stop = smoke.runTextFixture('essay-last-cell-stop').pages[0].placements;
  assert.equal(stop[17].sharesCell, true);
  assert.equal(stop[18].row, 1);
  assert.deepEqual(plain(smoke.runTextFixture('tian-filled').pages.map(page => page.placements)),
    plain(smoke.runTextFixture('mi-tracing').pages.map(page => page.placements)));
});

test('Array.at removal keeps filled layout and punctuation behavior intact', () => {
  const smoke = load('miniapp', 'runtime-smoke', 'Array.prototype.at = undefined;');
  assert.equal(smoke.probeRuntimeCapabilities().arrayAt, false);
  assert.ok(smoke.runRuntimeSmoke().checks.every(check => check.status === 'passed'));
  assert.equal(smoke.runTextFixture('essay-last-cell-stop').pages[0].placements[17].sharesCell, true);
});

for (const setup of ['Intl.Segmenter = undefined;', 'Intl = undefined;']) {
  test(`bundled grapheme segmentation works independently of native Intl: ${setup}`, () => {
    const smoke = load('miniapp', 'runtime-smoke', setup);
    const report = smoke.runRuntimeSmoke();
    assert.equal(report.capabilities.intlSegmenter, false);
    assert.equal(report.capabilities.textLayoutSupported, true);
    assert.equal(report.capabilities.graphemeImplementation, 'unicode-segmenter@0.17.3');
    assert.equal(report.checks.filter(check => check.status === 'passed').length, 11);
    assert.equal(report.checks.filter(check => check.status === 'skipped').length, 0);
    assert.equal(report.checks.filter(check => check.status === 'failed').length, 0);
    assert.deepEqual(plain(smoke.runTextFixture('essay-unicode')), plain(load('cloud').runTextFixture('essay-unicode')));
  });
}

test('missing Unicode properties skip text before executing property regexes', () => {
  const smoke = load('miniapp', 'runtime-smoke', `
    const NativeRegExp = RegExp;
    RegExp = function(pattern, flags) {
      if (String(pattern).includes('\\\\p{')) throw new SyntaxError('Unsupported property escapes');
      return new NativeRegExp(pattern, flags);
    };
  `);
  const report = smoke.runRuntimeSmoke();
  assert.equal(report.capabilities.unicodePropertyEscapes, false);
  assert.equal(report.checks.filter(check => check.status === 'skipped').length, 6);
  assert.equal(report.checks.filter(check => check.status === 'failed').length, 0);
});

test('incorrect native segmentation is reported but the bundled algorithm remains usable', () => {
  const smoke = load('miniapp', 'runtime-smoke', `
    Intl.Segmenter = class { segment(text) { return Array.from(text, segment => ({ segment })); } };
  `);
  assert.equal(smoke.probeRuntimeCapabilities().intlSegmenter, false);
  assert.ok(smoke.runRuntimeSmoke().checks.every(check => check.status === 'passed'));
});

test('diagnostic summaries do not contain synthetic text or full layouts', () => {
  const smoke = load('miniapp');
  const output = JSON.stringify(smoke.runRuntimeSmoke());
  for (const fixture of smoke.TEXT_FIXTURES) assert.ok(!output.includes(fixture.body));
  assert.ok(!output.includes('placements'));
  assert.match(output, /formal-font-metrics-and-renderers-not-connected/);
});

test('native app and declared page scripts register and rerun smoke through the actual output', () => {
  let appRegistered = false;
  isolatedModule('dist/miniprogram/app.js', '', { App() { appRegistered = true; } });
  assert.equal(appRegistered, true);
  const config = JSON.parse(read('dist/miniprogram/app.json'));
  for (const pagePath of config.pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(existsSync(resolve(root, `dist/miniprogram/${pagePath}.${extension}`)));
    }
  }
  let page;
  isolatedModule('dist/miniprogram/pages/runtime/index.js', '', { Page(options) { page = options; } });
  let latest;
  const host = { setData(data) { latest = data; } };
  page.onLoad.call(host);
  assert.equal(latest.checks.length, 11);
  page.onRun.call(host);
  assert.equal(latest.summary, '合成检查通过');
  assert.ok(!read('dist/miniprogram/pages/runtime/index.js').includes('node:'));
});

test('project config points to the generated native host', () => {
  const config = JSON.parse(read('project.config.json'));
  assert.equal(config.miniprogramRoot, 'dist/miniprogram/');
  assert.ok(existsSync(resolve(root, config.miniprogramRoot, 'app.json')));
});

test('document contract is identical on both targets with no native Intl or Unicode property regex support', () => {
  const body = '\r\n春e\u0301👨‍👩‍👧‍👦𠀀\r夏\n\n';
  const results = [];
  for (const target of ['miniapp', 'cloud']) {
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(`
      Intl = undefined;
      Array.prototype.at = undefined;
      const NativeRegExp = RegExp;
      RegExp = function(pattern, flags) {
        if (String(pattern).includes('\\\\p{')) throw new SyntaxError('Unsupported property escapes');
        return new NativeRegExp(pattern, flags);
      };
    `, context);
    vm.runInContext(read(`dist/runtime/${target}/paper-core.cjs`), context);
    // Construct JSON data inside the target realm, as a platform JSON transport would.
    results.push(plain(vm.runInContext(`module.exports.createPaperDocument(
      { templateId: 'essay-grid', body: ${JSON.stringify(body)} },
      module.exports.getDevelopmentPreset('essay-grid'))`, context)));
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].input.body, body);
  assert.equal(results[0].blocks[1].paragraphs.length, 5);
  assert.equal(results[0].blocks[1].paragraphs[4].source.end, body.length);
});
