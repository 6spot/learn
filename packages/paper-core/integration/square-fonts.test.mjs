import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutSquarePaperDocument, containsInk, PaperError } from '../dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';

const repo = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', repo)));
const fonts = Object.fromEntries(manifest.fonts.map(entry => [entry.id,
  new Uint8Array(readFileSync(new URL(`assets/fonts/${entry.path}`, repo)))]));
const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
const prepare = (templateId, input) => createPaperDocument({ templateId, ...input }, getDevelopmentPreset(templateId));
const layoutFor = (templateId, input) => layoutSquarePaperDocument(prepare(templateId, input), provider);
const error = code => value => value instanceof PaperError && value.code === code;

for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid']) {
  test(`${templateId}: real filled/tracing glyphs fit all fixed slots and share exact logical pagination`, () => {
    const input = { title: '学习记录', body: ('春夏秋冬，学习记录。\n').repeat(25) + '“你好！” (hello) 3.14 e\u0301cole nǚ Ǹ\n\n' };
    const filled = layoutFor(templateId, input);
    const tracing = layoutFor(templateId, { ...input, tracing: true });
    assert.ok(filled.pages.length > 1);
    assert.deepEqual(filled.pages.map(({ lines, slots }) => ({ lines, slots })), tracing.pages.map(({ lines, slots }) => ({ lines, slots })));
    for (const result of [filled, tracing]) {
      for (const page of result.pages) {
        for (const glyph of page.glyphs) {
          assert.ok(glyph.glyphId > 0);
          const slot = page.slots.find(entry => entry.source.block === glyph.source.block && entry.source.start <= glyph.source.start && entry.source.end >= glyph.source.end);
          assert.ok(slot);
          if (glyph.inkBoundsMm) {
            assert.ok(containsInk(slot.boundsMm, glyph.inkBoundsMm));
            assert.ok(containsInk(page.geometry.bounds, glyph.inkBoundsMm));
          }
          assert.deepEqual(provider.glyphOutline(glyph.fontId, glyph.glyphId).glyphId, glyph.glyphId);
        }
      }
      const reconstructed = result.pages.flatMap(page => page.slots)
        .filter(slot => slot.source.block === 'body').map(slot => input.body.slice(slot.source.start, slot.source.end)).join('');
      assert.equal(reconstructed, input.body.replace(/\r\n|\r|\n/g, ''));
    }
    const firstHan = tracing.pages[0].glyphs[0];
    assert.equal(firstHan.fontId, templateId === 'essay-grid' ? 'misans-regular' : 'lxgw-wenkai-gb-regular');
  });
}

test('real font widths retain kerning, decimals and intact Unicode chunks in long words', () => {
  const input = { body: '春'.repeat(17) + 'AV 3.14 ' + 'e\u0301'.repeat(150) };
  const layout = layoutFor('essay-grid', input);
  const slots = layout.pages.flatMap(page => page.slots);
  const av = slots.find(slot => input.body.slice(slot.source.start, slot.source.end) === 'AV');
  const shaped = provider.shape('misans-regular', 'AV');
  const expectedWidth = (Math.max(shaped.advanceWidth, shaped.inkBounds.xMax) - Math.min(0, shaped.inkBounds.xMin)) * 7 / shaped.unitsPerEm;
  assert.ok(Math.abs(av.boundsMm.width - expectedWidth) < 1e-6);
  assert.ok(slots.some(slot => input.body.slice(slot.source.start, slot.source.end) === '3.14'));
  for (const slot of slots) {
    const text = input.body.slice(slot.source.start, slot.source.end);
    if (text.startsWith('e')) assert.ok(text.endsWith('\u0301'));
  }
});

test('real full-width word and smart apostrophe are measured without compatibility normalization', () => {
  const body = 'ＡＢＣ ３．１４ don’t';
  const result = layoutFor('essay-grid', { body });
  const slots = result.pages.flatMap(page => page.slots);
  assert.deepEqual(slots.map(slot => body.slice(slot.source.start, slot.source.end)), ['ＡＢＣ', ' ', '３．１４', ' ', 'don’t']);
  assert.equal(slots[0].boundsMm.width, provider.shape('misans-regular', 'ＡＢＣ').advanceWidth * 7 / 1000);
});

test('actual D025 shared stop fits lower-right slot without moving last Han in filled or tracing mode', () => {
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid']) {
    const columns = getDevelopmentPreset(templateId).geometry.columns;
    for (const tracing of [false, true]) {
      for (const stop of ['。', '，', '、', '；', '：', '！', '？']) {
        const result = layoutFor(templateId, { body: '春'.repeat(columns - 2) + stop + '秋', tracing });
        const page = result.pages[0];
        const share = page.slots.find(slot => slot.sharesCell);
        assert.ok(share);
        const glyph = page.glyphs.find(g => g.source.start === columns - 2);
        assert.ok(containsInk(share.boundsMm, glyph.inkBoundsMm));
        assert.equal(page.slots.at(-1).row, 1);
      }
    }
  }
});

test('unavailable glyphs and forbidden font shaping controls reject instead of substituting or deleting text', () => {
  assert.throws(() => layoutFor('essay-grid', { body: '春😀' }), error('MISSING_GLYPH'));
  assert.throws(() => layoutFor('essay-grid', { body: '春\u200d秋' }), error('UNSUPPORTED_TEXT'));
  assert.throws(() => layoutFor('essay-grid', { body: '春'.repeat(17) + '？！' }), error('UNSUPPORTED_TEXT'));
});
