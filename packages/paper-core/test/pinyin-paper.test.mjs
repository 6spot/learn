import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutPinyinPaperDocument, containsInk, PaperError } from '../dist/index.js';
import { syntheticFont } from './synthetic-font.mjs';

const prepare = (input = {}, preset = getDevelopmentPreset('pinyin-lines')) => createPaperDocument({ templateId: 'pinyin-lines', ...input }, preset);
const layoutFor = (input, metrics = syntheticFont, preset) => layoutPinyinPaperDocument(prepare(input, preset), metrics);
const error = code => value => value instanceof PaperError && value.code === code;
const slots = layout => layout.pages.flatMap(page => page.slots);
const lines = layout => layout.pages.flatMap(page => page.lines);
const sources = (layout, text, block = 'body') => slots(layout).filter(slot => slot.source.block === block).map(slot => text.slice(slot.source.start, slot.source.end));

test('pinyin keeps exact spaces, canonical forms, CR/LF/CRLF and trailing paragraph sources', () => {
  const body = "  nǐ  hǎo\r\nu\u0308\u0304 xi'an\r\n\nzhōng\r";
  const doc = prepare({ body });
  const layout = layoutPinyinPaperDocument(doc, syntheticFont);
  assert.equal(doc.input.body, body);
  assert.equal(sources(layout, body).join(''), body.replace(/\r\n|\r|\n/g, ''));
  assert.deepEqual(lines(layout).map(line => line.breakAfter), ['explicit', 'explicit', 'explicit', 'explicit', 'end']);
  assert.deepEqual(lines(layout).map(line => line.empty), [false, false, true, false, true]);
  assert.equal(lines(layout).at(-1).source.start, body.length);
  assert.ok(sources(layout, body).includes("xi'an"));
  assert.ok(sources(layout, body).includes('u\u0308\u0304'));
});

test('pinyin word runs move intact and first-line indent never repeats on automatic wraps', () => {
  const body = 'a'.repeat(37) + ' ni\nhao';
  const layout = layoutFor({ body });
  const all = slots(layout);
  assert.deepEqual(all.map(slot => [slot.row, slot.boundsMm.x]), [[0, 23], [0, 187.28], [1, 15], [2, 23]]);
  assert.equal(body.slice(all[2].source.start, all[2].source.end), 'ni');
  assert.deepEqual(lines(layout).map(line => line.breakAfter), ['wrap', 'explicit', 'end']);
  const none = layoutFor({ body: 'ni\nhao', options: { bodyIndent: 'none' } });
  assert.deepEqual(slots(none).map(slot => slot.boundsMm.x), [15, 15]);
});

test('every pinyin title line obeys its alignment and title/body gap is measured in bands', () => {
  for (const titleAlign of ['left', 'center', 'right']) {
    const result = layoutFor({ title: 'ni\nhao', body: 'ma', options: { titleAlign } });
    const all = slots(result);
    assert.deepEqual(all.map(slot => slot.row), [0, 1, 3]);
    for (const slot of all.slice(0, 2)) {
      const expected = 15 + (titleAlign === 'left' ? 0 : titleAlign === 'center' ? (180 - slot.boundsMm.width) / 2 : 180 - slot.boundsMm.width);
      assert.ok(Math.abs(slot.boundsMm.x - expected) < 1e-6);
      assert.equal(slot.boundsMm.y, 25.5 + slot.row * 18);
      assert.equal(slot.boundsMm.height, 12);
    }
  }
});

test('long titles cross full pages with visual-line alignment, explicit empty bands and one body gap', () => {
  const title = 'a'.repeat(40 * 14 + 2) + '\r\n\r\nni';
  for (const titleAlign of ['left', 'center', 'right']) {
    const result = layoutFor({ title, body: 'hao', options: { titleAlign } });
    assert.equal(result.pages.length, 2);
    assert.equal(sources(result, title, 'title').join(''), title.replace(/\r\n/g, ''));
    const page = result.pages[1];
    assert.deepEqual(page.lines.map(({ row, empty, block }) => ({ row, empty, block })), [
      { row: 0, empty: false, block: 'title' }, { row: 1, empty: true, block: 'title' },
      { row: 2, empty: false, block: 'title' }, { row: 4, empty: false, block: 'body' },
    ]);
    const x = titleAlign === 'left' ? 15 : titleAlign === 'center' ? 100.56 : 186.12;
    assert.equal(page.slots[0].boundsMm.x, x);
    assert.equal(page.slots.at(-1).boundsMm.x, 23);
    assert.equal(page.glyphs.at(-1).originMm.y, 33.5 + 4 * 18);
  }
});

test('long runs split only at whole graphemes and retain every source unit through page boundaries', () => {
  const body = 'u\u0308\u0304'.repeat(600);
  const result = layoutFor({ body });
  assert.ok(result.pages.length > 1);
  assert.equal(sources(result, body).join(''), body);
  for (const slot of slots(result)) {
    assert.equal(slot.source.start % 3, 0);
    assert.equal(slot.source.end % 3, 0);
    assert.ok(slot.boundsMm.x + slot.boundsMm.width <= 195.000001);
  }
  assert.deepEqual(result.pages[0].geometry, result.pages[1].geometry);
});

test('exactly full page has no phantom page; a final explicit newline reserves the next blank band', () => {
  const body = Array(14).fill('a').join('\n');
  assert.equal(layoutFor({ body }).pages.length, 1);
  const trailing = layoutFor({ body: body + '\n' });
  assert.equal(trailing.pages.length, 2);
  assert.equal(trailing.pages[1].lines.length, 1);
  assert.equal(trailing.pages[1].lines[0].empty, true);
  assert.equal(trailing.pages[1].lines[0].row, 0);
  const blankRows = layoutFor({ body: 'a' + '\n'.repeat(28) });
  assert.equal(blankRows.pages.length, 3);
  assert.equal(lines(blankRows).length, 29);
});

test('pinyin baseline is fixed per band and all real-like ink is constrained without moving gridlines', () => {
  const result = layoutFor({ body: 'bā gǚ\nyī' });
  for (const page of result.pages) for (const glyph of page.glyphs) {
    const slot = page.slots.find(s => s.source.start <= glyph.source.start && s.source.end >= glyph.source.end);
    assert.equal(glyph.originMm.y, 33.5 + slot.row * 18);
    if (glyph.inkBoundsMm) assert.ok(containsInk(slot.boundsMm, glyph.inkBoundsMm));
  }
  assert.equal(result.pages[0].geometry.segments.length, 56);
  assert.equal(result.pages[0].geometry.segments[55].from.y, 271.5);
});

test('pinyin filled/tracing have exactly the same slots, glyphs, lines and pages', () => {
  const input = { title: 'pīn yīn', body: ('nǐ hǎo u\u0308\u0304\n').repeat(20) };
  const filled = layoutFor(input);
  const tracing = layoutFor({ ...input, tracing: true });
  assert.equal(tracing.mode, 'tracing');
  assert.deepEqual(tracing.pages, filled.pages);
  assert.ok(tracing.pages.every(page => page.glyphs.every(g => g.fontId === 'misans-latin-regular')));
});

test('whitespace-only pinyin remains a single complete blank sheet', () => {
  const result = layoutFor({ title: ' ', body: ' \r\n'.repeat(100), tracing: true });
  assert.equal(result.mode, 'blank');
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].geometry.segments.length, 56);
  assert.equal(slots(result).length, 0);
});

test('pinyin rejects Han, other scripts, emoji, stray marks and unsupported punctuation without exposing source', () => {
  for (const bad of ['汉', 'α', 'é漢', '😀', '\u0301', '@', 'é\u200d', 'ñ', 'á\u0301', 'u\u0308\u0308', 'a\u0302']) {
    assert.throws(() => layoutFor({ body: 'ni ' + bad }), value => {
      assert.ok(error('UNSUPPORTED_TEXT')(value));
      assert.equal(value.details.offset, bad === 'é漢' ? 4 : bad === '\u0301' ? 2 : 3);
      assert.equal(JSON.stringify(value).includes(bad), false);
      return true;
    });
  }
  assert.throws(() => layoutFor({ title: '汉字', body: 'ni' }), error('UNSUPPORTED_TEXT'));
});

test('pinyin validates provider resources/metrics before pagination and reports only safe failures', () => {
  assert.throws(() => layoutFor({ body: 'ni' }, { ...syntheticFont, fontBundleVersion: 'other' }), error('VERSION_MISMATCH'));
  const broken = code => ({ ...syntheticFont, shape() { throw Object.assign(new Error('private input must not escape'), { code }); } });
  for (const [upstream, expected] of [['FONT_GLYPH_MISSING', 'MISSING_GLYPH'], ['FONT_RESOURCE_MISSING', 'FONT_RESOURCE_MISSING'],
    ['FONT_RESOURCE_INVALID', 'FONT_INTEGRITY_FAILED'], ['FONT_TEXT_UNSUPPORTED', 'UNSUPPORTED_TEXT'], ['vendor', 'INVALID_FONT_METRICS']]) {
    assert.throws(() => layoutFor({ body: 'ni' }, broken(upstream)), error(expected));
  }
  const forged = { ...syntheticFont, shape(fontId, text) { const value = syntheticFont.shape(fontId, text); return { ...value, advanceWidth: NaN }; } };
  assert.throws(() => layoutFor({ body: 'ni' }, forged), error('INVALID_FONT_METRICS'));
});

test('oversized glyphs/accents and page overflow reject the whole layout rather than clip content', () => {
  const preset = structuredClone(getDevelopmentPreset('pinyin-lines'));
  preset.textStyles.body.fontSizeMm = 20;
  assert.throws(() => layoutFor({ body: 'ā' }, syntheticFont, preset), error('GLYPH_OUT_OF_BOUNDS'));
  preset.textStyles.body.fontSizeMm = 400;
  assert.throws(() => layoutFor({ body: 'a' }, syntheticFont, preset), error('GLYPH_OUT_OF_BOUNDS'));
  preset.textStyles.body.fontSizeMm = 7.4;
  preset.limits.maxPages = 1;
  assert.throws(() => layoutFor({ body: 'a' + '\n'.repeat(14) }, syntheticFont, preset), error('PAGE_LIMIT_EXCEEDED'));
});

test('pinyin reconstructs derived fields, rejects square carrier and returns immutable layouts', () => {
  const doc = prepare({ body: 'ni' });
  const actual = layoutPinyinPaperDocument({ ...doc, mode: 'blank', blocks: [] }, syntheticFont);
  assert.equal(actual.mode, 'filled');
  assert.ok(actual.pages[0].glyphs.length > 0);
  assert.ok(Object.isFrozen(actual.pages[0].glyphs[0].originMm));
  const square = createPaperDocument({ templateId: 'essay-grid', body: 'ni' }, getDevelopmentPreset('essay-grid'));
  assert.throws(() => layoutPinyinPaperDocument(square, syntheticFont), error('INVALID_PRESET'));
});

test('reviewed synthetic pinyin layouts retain baseline sources, breaks and exact placements', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pinyin-layout.json', import.meta.url)));
  for (const fixture of fixtures) {
    const result = layoutFor(fixture.input);
    assert.deepEqual(result.pages.map(({ lines, slots, glyphs }) => ({ lines, slots, glyphs })), fixture.pages, fixture.id);
  }
});
