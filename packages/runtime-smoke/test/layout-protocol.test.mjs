import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const manifest = JSON.parse(read('assets/fonts/manifest.json'));
const fontBuffers = Object.fromEntries(manifest.fonts.map(entry => {
  const bytes = readFileSync(resolve(root, 'assets/fonts', entry.path));
  return [entry.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)];
}));
function runtime(target) {
  const context = vm.createContext({ fontBuffers }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`
    globalThis.Intl = undefined;
    globalThis.TextEncoder = undefined;
    globalThis.TextDecoder = undefined;
    globalThis.Buffer = undefined;
    globalThis.crypto = undefined;
    Array.prototype.at = undefined;
    const NativeRegExp = RegExp;
    RegExp = function(pattern, flags) {
      if (String(pattern).includes('\\\\p{')) throw new SyntaxError('Unavailable Unicode property escapes');
      return new NativeRegExp(pattern, flags);
    };
  `, context);
  for (const [name, path] of [['core', `dist/runtime/${target}/paper-core.cjs`], ['font', `packages/font-metrics/dist/${target}.cjs`]]) {
    vm.runInContext(`globalThis.${name} = (() => { const module = { exports: {} }; const exports = module.exports;\n${read(path)}\nreturn module.exports; })();`, context, { timeout: 2000 });
  }
  vm.runInContext(`globalThis.provider = font.createFontMetricsProvider({ fontBundleVersion: font.FONT_BUNDLE_VERSION,
    fonts: Object.fromEntries(Object.entries(fontBuffers).map(([id, buffer]) => [id, new Uint8Array(buffer)])) });`, context, { timeout: 3000 });
  return context;
}
const miniapp = runtime('miniapp');
const cloud = runtime('cloud');
function render(context, input) {
  context.inputJson = JSON.stringify(input);
  return vm.runInContext(`(() => {
    const input = JSON.parse(inputJson);
    const preset = core.getDevelopmentPreset(input.templateId);
    core.assertLayoutVersionsSupported(preset.versions, [preset.versions]);
    const document = core.createPaperDocument(input, preset);
    const layout = core.layoutPaperDocument(document, provider);
    return { serialized: core.serializePaperLayout(layout), digest: core.createLayoutDigest(layout),
      pages: layout.pages.length, glyphs: layout.pages.reduce((count, page) => count + page.glyphs.length, 0) };
  })()`, context, { timeout: 5000 });
}

for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
  test(`${templateId}: real font layouts and protocol bytes match both isolated compiled targets`, () => {
    const body = templateId === 'pinyin-lines'
      ? "nǐ hǎo xi'an, u\u0308\u0304 Ǹ Ê\u0301 123\r\n".repeat(20) + '\n\n'
      : '春夏秋冬，学习记录。\n'.repeat(28) + '（你好）AV 3.14 e\u0301cole nǚ\n\n';
    for (const input of [{ templateId }, { templateId, body, tracing: false }, { templateId, body, tracing: true }]) {
      const a = render(miniapp, input);
      const b = render(cloud, input);
      assert.equal(a.serialized, b.serialized);
      assert.equal(a.digest, b.digest);
      assert.equal(a.digest, 'learn-layout-v1:sha256:' + createHash('sha256').update(a.serialized, 'utf8').digest('hex'));
      if (input.body) { assert.ok(a.pages > 1); assert.ok(a.glyphs > 0); }
      else { assert.equal(a.pages, 1); assert.equal(a.glyphs, 0); }
    }
  });
}

test('critical real word widths, long Unicode chunks and D025 shared stops match cross-target protocol', () => {
  for (const input of [
    { templateId: 'essay-grid', body: '春'.repeat(17) + '。AV 3.14 ' + 'e\u0301'.repeat(130) },
    { templateId: 'pinyin-lines', body: 'nǐ '.repeat(27) + 'u\u0308\u0304'.repeat(170), options: { bodyIndent: 'none' } },
    { templateId: 'mi-grid', title: '春夏\n秋冬', body: '“你好！”\r\n\n春', tracing: true, options: { titleAlign: 'right' } },
  ]) {
    const a = render(miniapp, input);
    const b = render(cloud, input);
    assert.equal(a.serialized, b.serialized);
    assert.equal(a.digest, b.digest);
  }
});

test('both compiled targets separate unsupported versions, mismatched resources and digest errors', () => {
  for (const context of [miniapp, cloud]) {
    const result = vm.runInContext(`(() => {
      const preset = core.getDevelopmentPreset('pinyin-lines');
      const document = core.createPaperDocument({ templateId: 'pinyin-lines', body: 'ni' }, preset);
      const layout = core.layoutPaperDocument(document, provider);
      const missingStyle = JSON.parse(JSON.stringify(layout));
      missingStyle.pages[0].glyphs[0].styleId = 'missing-style';
      const code = fn => { try { fn(); return 'unexpected-success'; } catch (error) { return core.safePaperFailure(error).code; } };
      return [code(() => core.assertLayoutVersionsSupported({ ...preset.versions, engineVersion: 'old' }, [preset.versions])),
        code(() => core.layoutPaperDocument(document, { fontBundleVersion: 'wrong' })),
        code(() => core.assertLayoutDigestMatches(layout, 'learn-layout-v1:sha256:' + '0'.repeat(64))),
        code(() => core.validateLayoutDigest('bad')),
        code(() => core.createLayoutDigest(missingStyle))];
    })()`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), ['UNSUPPORTED_VERSION', 'VERSION_MISMATCH', 'LAYOUT_DIGEST_MISMATCH', 'LAYOUT_DIGEST_INVALID', 'INVALID_LAYOUT']);
  }
});
