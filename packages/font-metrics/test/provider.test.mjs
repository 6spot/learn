import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createFontMetricsProvider, createMeasureTextMm, FontMetricsError, FONT_BUNDLE_VERSION, FONT_RESOURCES } from '../dist/index.js';
import { getDefaultPreset, layoutSquareDocument, positionShapedText } from '../../paper-core/dist/index.js';

const repo = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', repo)));
const fonts = Object.fromEntries(manifest.fonts.map(entry => {
  try { return [entry.id, new Uint8Array(readFileSync(new URL(`assets/fonts/${entry.path}`, repo)))]; }
  catch { throw new Error('Original fonts missing; run python3 assets/fonts/tools/font_resources.py restore --download'); }
}));
const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
const latin = 'misans-latin-regular';
const han = 'misans-regular';
const tracing = 'lxgw-wenkai-gb-regular';
const failWith = code => error => error instanceof FontMetricsError && error.code === code && error.message === code;
const numericShape = shape => ({ ...shape, glyphs: shape.glyphs.map(({ clusterStart, clusterEnd, ...glyph }) => glyph) });
const plain = value => JSON.parse(JSON.stringify(value));

test('resource IDs, sizes and hashes are generated from the one official manifest', () => {
  assert.equal(FONT_BUNDLE_VERSION, manifest.candidateResourceSetId);
  assert.deepEqual(FONT_RESOURCES, manifest.fonts.map(({ id, bytes, sha256, fontVersion }) => ({ id, bytes, sha256, fontVersion })));
  assert.throws(() => { FONT_RESOURCES[0].sha256 = '0'.repeat(64); }, TypeError);
});

test('actual Latin advances, spaces, kerning and empty outlines are measured', () => {
  assert.equal(provider.shape(latin, 'AV').advanceWidth, 1261);
  assert.equal(provider.shape(latin, 'A').advanceWidth + provider.shape(latin, 'V').advanceWidth, 1336);
  assert.equal(provider.shape(latin, 'i').advanceWidth, 245);
  assert.equal(provider.shape(latin, 'W').advanceWidth, 968);
  assert.equal(provider.shape(latin, ' ').advanceWidth, 290);
  assert.equal(provider.shape(latin, ' ').inkBounds, null);
  assert.equal(provider.shape(latin, '').advanceWidth, 0);
  assert.deepEqual(provider.shape(latin, '').glyphs, []);
  // Independent HarfBuzz advances: 573 + 179 + 371 + 591.
  assert.equal(provider.shape(latin, '3.14').advanceWidth, 1714);
});

test('all 90 pinyin clusters preserve canonical equivalence and original UTF16 ranges for every font', () => {
  for (const id of Object.keys(fonts)) {
    for (const base of 'aeiouüêmnAEIOUÜÊMN') {
      for (const tone of ['', '\u0304', '\u0301', '\u030c', '\u0300']) {
        const nfc = (base + tone).normalize('NFC');
        const nfd = (base + tone).normalize('NFD');
        const one = provider.shape(id, nfc);
        const two = provider.shape(id, nfd);
        assert.deepEqual(numericShape(one), numericShape(two), `${id}: ${nfc}`);
        for (const glyph of one.glyphs) assert.deepEqual([glyph.clusterStart, glyph.clusterEnd], [0, nfc.length]);
        for (const glyph of two.glyphs) assert.deepEqual([glyph.clusterStart, glyph.clusterEnd], [0, nfd.length]);
        assert.ok(one.glyphs.every(glyph => glyph.glyphId > 0));
      }
    }
  }
  assert.equal(provider.shape(latin, 'Ǹ').advanceWidth, 736);
  assert.equal(provider.shape(latin, 'Ǹ').glyphs.length, 2);
  assert.equal(provider.shape(latin, 'ǖ').inkBounds.yMax, 832);
});

test('mixed text maps composed, decomposed and supplementary graphemes without UTF16 splits', () => {
  const input = 'A𠮷ǖǸ';
  const run = provider.shape(tracing, input);
  assert.deepEqual(run.glyphs.map(glyph => [glyph.clusterStart, glyph.clusterEnd]), [[0, 1], [1, 3], [3, 6], [6, 8]]);
  assert.equal(input, 'A𠮷ǖǸ');
  assert.deepEqual(provider.shape(han, '中文ABC 3.14').glyphs.map(g => [g.clusterStart, g.clusterEnd]),
    Array.from({ length: 10 }, (_, i) => [i, i + 1]));
});

test('outline access and cached cmap aliases never change later source provenance', () => {
  for (const id of Object.keys(fonts)) {
    const fresh = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [id]: fonts[id] } });
    const expected = provider.shape(id, 'A');
    fresh.glyphOutline(id, expected.glyphs[0].glyphId);
    assert.deepEqual(fresh.shape(id, 'A'), expected);
  }
  const fresh = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [tracing]: fonts[tracing] } });
  // LXGW maps both Unicode characters to the same glyph ID. They remain two
  // distinct source characters even inside a single shaping call.
  const text = '-\u2011-';
  const run = fresh.shape(tracing, text);
  assert.deepEqual(run.glyphs.map(g => [g.clusterStart, g.clusterEnd]), [[0, 1], [1, 2], [2, 3]]);
  assert.equal(new Set(run.glyphs.map(g => g.glyphId)).size, 1);
  assert.deepEqual(fresh.shape(tracing, text), run);
});

test('all pinned cmap alias groups are deterministic across source orders and providers', () => {
  const reference = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url)));
  const one = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
  const two = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
  let groups = 0;
  for (const font of reference.fonts) {
    for (const points of font.cmapAliases) {
      groups++;
      const characters = points.map(point => String.fromCodePoint(point));
      // Warm the two providers in opposite orders before comparing a mixed run.
      for (const character of characters) one.shape(font.id, character);
      for (const character of [...characters].reverse()) two.shape(font.id, character);
      for (const text of [characters.join(''), [...characters].reverse().join('')]) {
        assert.deepEqual(one.shape(font.id, text), two.shape(font.id, text));
        const covered = one.shape(font.id, text).glyphs.map(g => text.slice(g.clusterStart, g.clusterEnd)).join('');
        assert.equal(covered, text);
      }
    }
  }
  assert.equal(groups, 37);
  for (const id of Object.keys(fonts)) {
    one.shape(id, 'Ǹǖ'); two.shape(id, 'Ǹǖ');
    assert.deepEqual(one.shape(id, 'Ǹǖ Ǹǖ'), two.shape(id, 'Ǹǖ Ǹǖ'));
  }
});

test('all GB2312 Han plus ASCII/pinyin raw glyph bounds match independent fontTools', () => {
  const reference = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url)));
  for (const expected of reference.fonts) {
    const records = expected.points.map(point => {
      // Single combining marks intentionally remain individual raw glyphs here.
      const run = provider.shape(expected.id, String.fromCodePoint(point));
      assert.equal(run.glyphs.length, 1);
      const glyph = run.glyphs[0];
      const outline = provider.glyphOutline(expected.id, glyph.glyphId);
      const b = outline.inkBounds;
      return [point, glyph.glyphId, glyph.xAdvance, b && [b.xMin, b.yMin, b.xMax, b.yMax].map(v => Math.round(v * 1e6))];
    });
    assert.equal(records.length, expected.recordCount);
    assert.equal(createHash('sha256').update(JSON.stringify(records)).digest('hex'), expected.metricsSha256, expected.id);
  }
});

test('run ink bounds include positioned glyphs; outlines are immutable and useful for Canvas', () => {
  // Independent FontTools result; fontkit's path.bbox incorrectly yields 65.0625.
  assert.ok(Math.abs(provider.shape(tracing, '蔹').inkBounds.xMin - 63.6) < 1e-9);
  const run = provider.shape(latin, 'AV nǐ');
  const bounds = [];
  let penX = 0;
  for (const glyph of run.glyphs) {
    const outline = provider.glyphOutline(latin, glyph.glyphId);
    assert.deepEqual(outline.inkBounds, glyph.inkBounds);
    assert.ok(outline.commands.every(c => ['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath'].includes(c.command)));
    if (glyph.inkBounds) bounds.push({ xMin: glyph.inkBounds.xMin + penX + glyph.xOffset,
      xMax: glyph.inkBounds.xMax + penX + glyph.xOffset, yMin: glyph.inkBounds.yMin + glyph.yOffset,
      yMax: glyph.inkBounds.yMax + glyph.yOffset });
    assert.throws(() => outline.commands.push({ command: 'closePath', args: [] }), TypeError);
    penX += glyph.xAdvance;
  }
  assert.deepEqual(run.inkBounds, { xMin: Math.min(...bounds.map(b => b.xMin)), xMax: Math.max(...bounds.map(b => b.xMax)),
    yMin: Math.min(...bounds.map(b => b.yMin)), yMax: Math.max(...bounds.map(b => b.yMax)) });
});

test('version, resource corruption and missing fonts fail safely; no fallback', () => {
  assert.throws(() => createFontMetricsProvider({ fontBundleVersion: 'unknown', fonts }), failWith('FONT_BUNDLE_UNSUPPORTED'));
  assert.throws(() => createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: {} }), failWith('FONT_RESOURCE_MISSING'));
  const damaged = new Uint8Array(fonts[latin]);
  damaged[100] ^= 1;
  for (const bytes of [damaged, fonts[latin].subarray(1)]) {
    assert.throws(() => createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [latin]: bytes } }), failWith('FONT_RESOURCE_INVALID'));
  }
  const partial = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [latin]: fonts[latin] } });
  assert.equal(partial.hasFont(han), false);
  assert.throws(() => partial.shape(han, '中文'), failWith('FONT_RESOURCE_MISSING'));
  assert.throws(() => partial.shape('arbitrary-private-input', '正文'), failWith('FONT_ID_UNSUPPORTED'));
  assert.throws(() => provider.shape(latin, '中文'), failWith('FONT_GLYPH_MISSING'));
  assert.throws(() => provider.shape(han, '\u9fff'), failWith('FONT_GLYPH_MISSING'));
  assert.throws(() => provider.glyphOutline(latin, 0), failWith('FONT_GLYPH_ID_INVALID'));
});

test('unsupported variation, joiners, bidi controls and lone surrogates are not silently stripped', () => {
  for (const input of ['一\ufe00', 'A\ufe0f', '👩‍💻', 'A\u200dB', '\u200b', '\u202eabc', 'A\ud800', '\u00ad', 'a\n', 'a\t', '\u{e0100}']) {
    assert.throws(() => provider.shape(han, input), failWith('FONT_TEXT_UNSUPPORTED'), input);
  }
  assert.throws(() => provider.shape(han, '😀'), failWith('FONT_GLYPH_MISSING'));
});

test('caller changes and returned TTF copies cannot mutate verified resources', () => {
  const original = new Uint8Array(fonts[latin]);
  const isolated = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [latin]: original } });
  original.fill(0);
  const copy = isolated.originalFontBytes(latin);
  assert.equal(createHash('sha256').update(copy).digest('hex'), FONT_RESOURCES.find(r => r.id === latin).sha256);
  copy.fill(0);
  assert.equal(isolated.shape(latin, 'AV').advanceWidth, 1261);
  assert.deepEqual(isolated.originalFontBytes(latin), fonts[latin]);
});

test('millimetre adapter uses canonical font and tracing does not change legacy logical placements', () => {
  const measureTextMm = createMeasureTextMm(provider, han, 6);
  assert.equal(measureTextMm('AV'), 7.566);
  assert.throws(() => createMeasureTextMm(provider, han, 0), failWith('FONT_METRICS_INVALID'));
  assert.throws(() => createMeasureTextMm(provider, han, Number.MAX_VALUE)('AV'), failWith('FONT_METRICS_INVALID'));
  const document = { preset: getDefaultPreset('tian-grid'), body: '春天 ABC 3.14\n学习写字' };
  const filled = layoutSquareDocument(document, { measureTextMm });
  const traced = layoutSquareDocument({ ...document, tracing: true }, { measureTextMm });
  assert.deepEqual(filled.pages, traced.pages);
  assert.notDeepEqual(provider.shape(han, '春').glyphs, provider.shape(tracing, '春').glyphs);
});

test('real shaped Unicode clusters pass core placement validation at canonical source ranges', () => {
  for (const input of ['Ǹ', 'Ǹ', 'ǖ', 'nǐ hǎo', '中文 ABC 3.14']) {
    const shaped = provider.shape(han, input);
    const positioned = positionShapedText(shaped, { block: 'body', start: 10, end: 10 + input.length },
      { x: 15, y: 30 }, 6, 'body-filled');
    assert.equal(positioned.length, shaped.glyphs.length);
    for (const [i, glyph] of positioned.entries()) {
      assert.deepEqual(glyph.source, { block: 'body', start: 10 + shaped.glyphs[i].clusterStart, end: 10 + shaped.glyphs[i].clusterEnd });
      assert.ok(glyph.inkBoundsMm === null || [glyph.inkBoundsMm.x, glyph.inkBoundsMm.y, glyph.inkBoundsMm.width, glyph.inkBoundsMm.height].every(Number.isFinite));
    }
  }
});

test('actual font width on either side of a line boundary changes wrapping without guessed metrics', () => {
  const word = 'W'.repeat(26);
  const sizeAtBoundary = 170 * 1000 / provider.shape(han, word).advanceWidth;
  const document = { preset: getDefaultPreset('essay-grid'), body: word };
  const exact = layoutSquareDocument(document, { measureTextMm: createMeasureTextMm(provider, han, sizeAtBoundary) });
  const over = layoutSquareDocument(document, { measureTextMm: createMeasureTextMm(provider, han, sizeAtBoundary + 0.00001) });
  assert.equal(exact.pages[0].placements[0].row, 0);
  assert.equal(over.pages[0].placements[0].row, 1);
});

test('browser and cloud bundles agree without host codecs, Intl.Segmenter, DOM, Buffer or code generation', () => {
  const require = createRequire(import.meta.url);
  const cloud = require('../dist/cloud.cjs');
  const context = vm.createContext({ module: { exports: {} } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('Intl.Segmenter = undefined;', context);
  vm.runInContext(readFileSync(new URL('../dist/miniapp.cjs', import.meta.url), 'utf8'), context);
  const mini = context.module.exports;
  const one = mini.createFontMetricsProvider({ fontBundleVersion: mini.FONT_BUNDLE_VERSION, fonts });
  const two = cloud.createFontMetricsProvider({ fontBundleVersion: cloud.FONT_BUNDLE_VERSION, fonts });
  for (const id of Object.keys(fonts)) one.glyphOutline(id, two.shape(id, 'A').glyphs[0].glyphId);
  for (const [id, input] of [[latin, 'AV nǐ hǎo Ǹ ǖ'], [han, '春天 ABC 3.14'], [tracing, '学习𠮷 -\u2011']]) {
    assert.deepEqual(plain(one.shape(id, input)), plain(two.shape(id, input)));
    assert.deepEqual(plain(one.shape(id, input)), plain(provider.shape(id, input)));
  }
  assert.equal(context.Buffer, undefined);
  assert.equal(context.process, undefined);
  assert.equal(context.TextDecoder, undefined);
  assert.equal(context.TextEncoder, undefined);
  const info = JSON.parse(readFileSync(new URL('../dist/build-info.json', import.meta.url)));
  assert.deepEqual(info.externalImports, []);
  assert.equal(info.hostTextCodecsRequired, false);
  assert.ok(info.bundleBytes < 500_000);
});
