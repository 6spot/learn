import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderPdf } from '../dist/index.js';
import { layoutFor, provider, originalFonts } from './fixtures.mjs';

const layout = layoutFor('pinyin-lines', { title: 'Pīn yīn', body: 'nǐ hǎo u\u0308\u0304\nǸ Á ǘ y g' });
const latin = originalFonts['misans-latin-regular'];

for (const target of ['miniapp', 'cloud']) {
  test(`${target} PDF bundle renders identical actual font bytes without Node, host codecs or dynamic code`, async () => {
    const context = vm.createContext({ layoutJson: JSON.stringify(layout), fontBuffer: latin.buffer },
      { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(`globalThis.Buffer = undefined; globalThis.TextEncoder = undefined; globalThis.TextDecoder = undefined;
      globalThis.Intl = undefined; globalThis.crypto = undefined; Array.prototype.at = undefined;`, context);
    for (const [name, path] of [['renderer', `../dist/${target}.cjs`], ['fonts', `../../font-metrics/dist/${target}.cjs`]]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      vm.runInContext(`globalThis.${name} = (() => { const module = { exports: {} }; const exports = module.exports;\n${source}\nreturn module.exports; })();`, context, { timeout: 2000 });
    }
    const bytes = await vm.runInContext(`renderer.renderPdf(JSON.parse(layoutJson), fonts.createFontMetricsProvider({
      fontBundleVersion: fonts.FONT_BUNDLE_VERSION, fonts: { 'misans-latin-regular': new Uint8Array(fontBuffer) }
    }))`, context, { timeout: 5000 });
    assert.deepEqual(new Uint8Array(bytes), await renderPdf(layout, provider));
  });
}
