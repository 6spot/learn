import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutPinyinPaperDocument, containsInk, PaperError } from '../dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';

const repo = new URL('../../../', import.meta.url);
const entry = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', repo))).fonts.find(entry => entry.id === 'misans-latin-regular');
const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION,
  fonts: { [entry.id]: new Uint8Array(readFileSync(new URL(`assets/fonts/${entry.path}`, repo))) } });
const preset = getDevelopmentPreset('pinyin-lines');
const prepare = input => createPaperDocument({ templateId: 'pinyin-lines', ...input }, preset);
const layoutFor = input => layoutPinyinPaperDocument(prepare(input), provider);
const baseLetters = [...'abcdefghijklmnopqrstuvwxyz', ...'āáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜêńňǹḿ',
  ...['ê', 'm', 'n'].flatMap(base => ['\u0304', '\u0301', '\u030c', '\u0300'].map(tone => base + tone))];
const letters = [...baseLetters, ...baseLetters.map(text => text.toUpperCase())];

function verifyInkAndSources(layout, input) {
  for (const page of layout.pages) for (const glyph of page.glyphs) {
    const slot = page.slots.find(value => value.source.block === glyph.source.block && value.source.start <= glyph.source.start && value.source.end >= glyph.source.end);
    assert.ok(slot);
    assert.equal(glyph.fontId, 'misans-latin-regular');
    assert.ok(provider.glyphOutline(glyph.fontId, glyph.glyphId).commands.length > 0 || !glyph.inkBoundsMm);
    if (glyph.inkBoundsMm) {
      assert.ok(containsInk(slot.boundsMm, glyph.inkBoundsMm));
      assert.ok(containsInk(page.geometry.bounds, glyph.inkBoundsMm));
    }
  }
  for (const block of ['title', 'body']) {
    const text = input[block] ?? '';
    const preserved = layout.pages.flatMap(page => page.slots).filter(slot => slot.source.block === block)
      .map(slot => text.slice(slot.source.start, slot.source.end)).join('');
    assert.equal(preserved, text.replace(/\r\n|\r|\n/g, ''));
  }
}

test('MiSans Latin measured x-height, ascenders, descenders and every pinyin tone fit fixed third-line baseline', () => {
  assert.equal(provider.shape(entry.id, 'x').inkBounds.yMax, 530);
  assert.equal(provider.shape(entry.id, 'bdfhkl').inkBounds.yMax, 754);
  assert.equal(provider.shape(entry.id, 'gjpqy').inkBounds.yMin, -224);
  const raw = letters.map(text => provider.shape(entry.id, text).inkBounds);
  assert.equal(Math.max(...raw.map(ink => ink.yMax)), 1070);
  assert.equal(Math.min(...raw.map(ink => ink.yMin)), -224);
  assert.equal(preset.textStyles.body.fontSizeMm, 7.4);
  assert.equal(preset.carrier.baselineOffsetMm, 8);
  assert.ok(Math.abs(8 - 1070 * 7.4 / 1000 - 0.082) < 1e-10);
  const input = { title: 'Pīn yīn', body: letters.join(' ') };
  const layout = layoutFor(input);
  verifyInkAndSources(layout, input);
  assert.deepEqual(layout.pages, layoutFor({ ...input, tracing: true }).pages);
});

test('canonical NFC/NFD pinyin renders equivalent glyphs without rewriting original source ranges', () => {
  for (const body of letters) {
    const nfd = body.normalize('NFD');
    const nfc = body.normalize('NFC');
    const document = prepare({ body: nfd });
    assert.equal(document.input.body, nfd);
    const normalized = layoutFor({ body: nfc });
    const decomposed = layoutPinyinPaperDocument(document, provider);
    const glyphView = layout => layout.pages.flatMap(page => page.glyphs).map(({ source, ...glyph }) => glyph);
    assert.deepEqual(glyphView(normalized), glyphView(decomposed));
    for (const glyph of decomposed.pages[0].glyphs) assert.deepEqual(glyph.source, { block: 'body', start: 0, end: nfd.length });
  }
});

test('real pinyin preserves long syllables, punctuation, numbers, explicit empty rows and filled/tracing pagination', () => {
  const input = { title: 'Nǐ hǎo', body: "  xi'an xī’ān, nǚ! 3.14 123\r\n\r\n" + 'u\u0308\u0304'.repeat(800) + '\n\n' };
  const layout = layoutFor(input);
  assert.ok(layout.pages.length > 1);
  verifyInkAndSources(layout, input);
  assert.deepEqual(layout.pages, layoutFor({ ...input, tracing: true }).pages);
  const last = layout.pages.at(-1).lines;
  assert.equal(last.at(-1).empty, true);
  assert.equal(last.at(-2).empty, true);
  const slots = layout.pages.flatMap(page => page.slots).filter(slot => slot.source.block === 'body');
  assert.ok(slots.some(slot => input.body.slice(slot.source.start, slot.source.end) === "xi'an"));
  assert.ok(slots.some(slot => input.body.slice(slot.source.start, slot.source.end) === '3.14'));
});

test('real negative side bearings are contained and all runs use the same fixed baseline', () => {
  const input = { body: 'f j ǐ Ā U\u0308\u0304' };
  const layout = layoutFor(input);
  verifyInkAndSources(layout, input);
  for (const slot of layout.pages[0].slots) {
    const text = input.body.slice(slot.source.start, slot.source.end);
    const shape = provider.shape(entry.id, text);
    const glyphs = layout.pages[0].glyphs.filter(g => slot.source.start <= g.source.start && slot.source.end >= g.source.end);
    for (let i = 0; i < glyphs.length; i++) {
      const baseline = glyphs[i].originMm.y + shape.glyphs[i].yOffset * 7.4 / 1000;
      assert.ok(Math.abs(baseline - (33.5 + slot.row * 18)) < 1e-6);
    }
  }
});

test('duplicate tone marks reject explicitly rather than overprinting or silently dropping them', () => {
  assert.throws(() => layoutFor({ body: 'u' + '\u0308'.repeat(15) }), e => e instanceof PaperError && e.code === 'UNSUPPORTED_TEXT');
  assert.throws(() => layoutFor({ body: 'nǐ 汉字' }), e => e instanceof PaperError && e.code === 'UNSUPPORTED_TEXT' && e.details.offset === 3);
});
