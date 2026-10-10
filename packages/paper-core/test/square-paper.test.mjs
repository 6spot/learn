import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutSquarePaperDocument, PaperError, containsInk } from '../dist/index.js';
import { syntheticFont } from './synthetic-font.mjs';

export const create = (input = {}, preset = getDevelopmentPreset('essay-grid'), provider = syntheticFont) => {
  const document = createPaperDocument({ templateId: preset.versions.templateId, ...input }, preset);
  return { document, layout: layoutSquarePaperDocument(document, provider) };
};
const error = code => value => value instanceof PaperError && value.code === code;
const textOf = (document, slot) => document.input[slot.source.block].slice(slot.source.start, slot.source.end);
const allSlots = layout => layout.pages.flatMap(page => page.slots);

test('new square layout preserves complete source across words, spaces, combining characters and all pages', () => {
  const body = '春'.repeat(17) + '。\r\n\nWii e\u0301cole 3.14 ' + 'W'.repeat(100) + '\n'.repeat(30);
  const { document, layout } = create({ body });
  assert.equal(allSlots(layout).map(slot => textOf(document, slot)).join(''), body.replace(/\r\n|\r|\n/g, ''));
  assert.equal(layout.pages.length, 2);
  assert.equal(layout.pages[1].lines.at(-1).empty, true);
  assert.equal(layout.pages[1].lines.at(-1).source.end, body.length);
  for (const page of layout.pages) {
    assert.equal(page.geometry.segments.length, 48);
    assert.ok(page.glyphs.every(glyph => !glyph.inkBoundsMm || containsInk(page.geometry.bounds, glyph.inkBoundsMm)));
  }
});

test('title alignment and first-paragraph indentation are applied without inserting input spaces', () => {
  for (const [titleAlign, x] of [['left', 10], ['center', 95], ['right', 180]]) {
    const { layout } = create({ title: '春夏', body: '秋'.repeat(20), options: { titleAlign, bodyIndent: 'none' } });
    assert.equal(layout.pages[0].slots[0].boundsMm.x, x);
    const bodySlots = layout.pages[0].slots.filter(slot => slot.source.block === 'body');
    assert.equal(bodySlots[0].boundsMm.x, 10);
    assert.equal(bodySlots[0].row, 2);
    assert.equal(bodySlots[19].row, 3);
    assert.equal(bodySlots[19].boundsMm.x, 10);
  }
  const { layout } = create({ body: '春'.repeat(18) + '\n夏' });
  assert.equal(layout.pages[0].slots[0].boundsMm.x, 30);
  assert.equal(layout.pages[0].slots[17].boundsMm.x, 10);
  assert.equal(layout.pages[0].slots[18].boundsMm.x, 30);
});

test('multi-page titles align each visual row while preserving explicit paragraphs and the body gap', () => {
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid']) {
    const preset = getDevelopmentPreset(templateId);
    const { columns, rows, origin, cellMm } = preset.geometry;
    const title = '春'.repeat(columns * rows + 2) + '\r\n\r\n夏';
    for (const titleAlign of ['left', 'center', 'right']) {
      const { document, layout } = create({ title, body: '秋\r冬', options: { titleAlign } }, preset);
      assert.equal(layout.pages.length, 2);
      const slots = allSlots(layout);
      assert.equal(slots.filter(slot => slot.source.block === 'title').map(slot => textOf(document, slot)).join(''), title.replace(/\r\n/g, ''));
      const second = layout.pages[1];
      const shift = titleAlign === 'left' ? 0 : titleAlign === 'center' ? (columns - 2) * cellMm / 2 : (columns - 2) * cellMm;
      assert.equal(second.slots[0].boundsMm.x, origin.x + shift);
      assert.deepEqual(second.lines.map(({ block, row, empty, breakAfter }) => ({ block, row, empty, breakAfter })), [
        { block: 'title', row: 0, empty: false, breakAfter: 'explicit' },
        { block: 'title', row: 1, empty: true, breakAfter: 'explicit' },
        { block: 'title', row: 2, empty: false, breakAfter: 'end' },
        { block: 'body', row: 4, empty: false, breakAfter: 'explicit' },
        { block: 'body', row: 5, empty: false, breakAfter: 'end' },
      ]);
      assert.ok(second.slots.filter(slot => slot.source.block === 'body').every(slot => slot.boundsMm.x === origin.x + 2 * cellMm));
    }
  }
});

test('D025 keeps last Han in place and gives the following stop a distinct reduced lower-right slot', () => {
  const { document, layout } = create({ body: '春'.repeat(17) + '。夏' });
  const slots = layout.pages[0].slots;
  assert.equal(slots[16].boundsMm.x, 190);
  assert.equal(textOf(document, slots[17]), '。');
  assert.equal(slots[17].sharesCell, true);
  assert.deepEqual(slots[17].boundsMm, { x: 196.666667, y: 20.166667, width: 3.333333, height: 3.333333 });
  assert.equal(slots[18].row, 1);
  const sharedGlyph = layout.pages[0].glyphs.find(glyph => glyph.source.start === 17);
  assert.equal(sharedGlyph.fontSizeMm, 7 / 3);
  assert.ok(containsInk(slots[17].boundsMm, sharedGlyph.inkBoundsMm));
});

test('ordinary paired quotes and brackets stay bound across soft wraps; punctuation sources are never merged', () => {
  for (const body of ['春'.repeat(16) + '“夏”秋', '春'.repeat(15) + '（夏）秋', '“春，夏。”秋', '春？！夏……秋——冬', 'a '.repeat(30) + '"hello" (world)']) {
    const { document, layout } = create({ body });
    assert.equal(allSlots(layout).map(slot => textOf(document, slot)).join(''), body);
    for (const page of layout.pages) {
      for (const line of page.lines.filter(line => line.breakAfter === 'wrap')) {
        const last = page.slots.filter(slot => slot.row === line.row).at(-1);
        assert.ok(!['“', '（', '(', '"'].includes(textOf(document, last)));
      }
    }
  }
  const { layout } = create({ body: '春'.repeat(16) + '“夏”' });
  assert.equal(layout.pages[0].slots[16].row, 1);
  assert.equal(layout.pages[0].slots[18].row, 1);
});

test('impossible repeated-stop/closing conflicts reject safely instead of moving the final Han', () => {
  for (const body of ['春'.repeat(17) + '？！', '“' + '春'.repeat(16) + '。”']) {
    assert.throws(() => create({ body }), error('UNSUPPORTED_TEXT'));
  }
});

test('long words split only at grapheme boundaries; full words and decimal numbers remain intact when possible', () => {
  const { document, layout } = create({ body: '春'.repeat(17) + 'hello 3.14 ' + 'e\u0301'.repeat(100) });
  const slots = allSlots(layout);
  assert.equal(textOf(document, slots[17]), 'hello');
  assert.equal(slots[17].row, 1);
  assert.ok(slots.some(slot => textOf(document, slot) === '3.14'));
  for (const slot of slots.filter(slot => slot.source.start > 28)) {
    const text = textOf(document, slot);
    if (text.includes('e')) assert.ok(text.endsWith('\u0301'));
  }
  assert.equal(slots.map(slot => textOf(document, slot)).join(''), document.input.body);
  const narrow = create({ body: 'i'.repeat(90) }).layout;
  const wide = create({ body: 'W'.repeat(90) }).layout;
  assert.ok(wide.pages[0].lines.length > narrow.pages[0].lines.length);
});

test('a multi-page decimal keeps every original digit and never reindents automatic continuation', () => {
  const body = '1234567890'.repeat(300) + '.25';
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid']) {
    const preset = getDevelopmentPreset(templateId);
    const { document, layout } = create({ body }, preset);
    assert.ok(layout.pages.length > 2);
    const slots = allSlots(layout);
    assert.equal(slots.map(slot => textOf(document, slot)).join(''), body);
    assert.equal(slots[0].boundsMm.x, preset.geometry.origin.x + 2 * preset.geometry.cellMm);
    assert.ok(slots.slice(1).every(slot => slot.boundsMm.x === preset.geometry.origin.x));
    assert.ok(layout.pages.flatMap(page => page.lines).every(line => line.paragraphIndex === 0));
    assert.equal(layout.pages.at(-1).lines.at(-1).source.end, body.length);
  }
});

test('negative bearings and descenders keep complete ink and a common baseline across separate Latin runs', () => {
  const provider = {
    ...syntheticFont,
    shape(fontId, text) {
      if (text === ' ') return syntheticFont.shape(fontId, text);
      const ink = text === 'j'
        ? { xMin: -100, yMin: -200, xMax: 200, yMax: 800 }
        : { xMin: 0, yMin: 0, xMax: 600, yMax: 1000 };
      const advanceWidth = text === 'j' ? 300 : 600;
      return { fontId, unitsPerEm: 1000, advanceWidth, ascender: 1000, descender: -200, inkBounds: ink,
        glyphs: [{ glyphId: text.codePointAt(0), clusterStart: 0, clusterEnd: 1, xAdvance: advanceWidth,
          yAdvance: 0, xOffset: 0, yOffset: 0, inkBounds: ink }] };
    },
  };
  const { layout } = create({ body: 'j Á', options: { bodyIndent: 'none' } }, undefined, provider);
  const { slots, glyphs } = layout.pages[0];
  assert.equal(slots[0].boundsMm.width, 2.8);
  assert.equal(glyphs[0].originMm.x, 10.7);
  assert.equal(glyphs[0].originMm.y, 21.3);
  assert.equal(glyphs[2].originMm.y, 21.3);
  assert.deepEqual(glyphs[0].inkBoundsMm, { x: 10, y: 15.7, width: 2.1, height: 7 });
  assert.deepEqual(glyphs[2].inkBoundsMm, { x: 14.9, y: 14.3, width: 4.2, height: 7 });
  assert.ok(glyphs.every((glyph, index) => !glyph.inkBoundsMm || containsInk(slots[index].boundsMm, glyph.inkBoundsMm)));
});

test('full-width Latin/numeric forms and apostrophes retain their source and actual measured word width', () => {
  const body = "ＡＢＣ ３．１４ don't don’t";
  const { document, layout } = create({ body });
  assert.deepEqual(allSlots(layout).map(slot => textOf(document, slot)), ['ＡＢＣ', ' ', '３．１４', ' ', "don't", ' ', 'don’t']);
});

test('overlong words with ordinary enclosing punctuation retain open/close bonds', () => {
  const body = '（' + 'W'.repeat(90) + '）';
  const { document, layout } = create({ body });
  assert.equal(allSlots(layout).map(slot => textOf(document, slot)).join(''), body);
  const lines = layout.pages[0].lines;
  assert.equal(layout.pages[0].slots[0].row, layout.pages[0].slots[1].row);
  assert.equal(layout.pages[0].slots.at(-1).row, layout.pages[0].slots.at(-2).row);
  assert.ok(lines.length > 2);
});

test('tracing selects only Han glyph faces, never the canonical slot widths or page breaks', () => {
  for (const id of ['essay-grid', 'tian-grid', 'mi-grid']) {
    const trusted = getDevelopmentPreset(id);
    const filled = create({ body: '春夏abc 3.14\n秋冬' }, trusted).layout;
    const tracing = create({ body: '春夏abc 3.14\n秋冬', tracing: true }, trusted).layout;
    assert.deepEqual(filled.pages.map(({ lines, slots }) => ({ lines, slots })), tracing.pages.map(({ lines, slots }) => ({ lines, slots })));
    assert.equal(tracing.pages[0].glyphs[0].fontId, id === 'essay-grid' ? 'misans-regular' : 'lxgw-wenkai-gb-regular');
    assert.equal(tracing.pages[0].glyphs.find(g => g.source.start === 2).fontId, 'misans-regular');
  }
});

test('all explicit trailing blank rows create pages, exact-full content creates no phantom page, limits refuse partial output', () => {
  assert.equal(create({ body: '春'.repeat(17 + 19 * 26) }).layout.pages.length, 1);
  const { layout } = create({ body: '春' + '\n'.repeat(54) });
  assert.equal(layout.pages.length, 3);
  assert.equal(layout.pages[2].lines.length, 1);
  assert.equal(layout.pages[2].lines[0].empty, true);
  const limited = JSON.parse(JSON.stringify(getDevelopmentPreset('essay-grid')));
  limited.limits.maxPages = 1;
  assert.throws(() => create({ body: '春' + '\n'.repeat(27) }, limited), error('PAGE_LIMIT_EXCEEDED'));
  assert.equal(create({ body: '\n'.repeat(54), tracing: true }).layout.pages.length, 1);
});

test('font version/resource failures and overlarge real ink become safe explicit errors', () => {
  assert.throws(() => create({ body: '春' }, undefined, { ...syntheticFont, fontBundleVersion: 'other' }), error('VERSION_MISMATCH'));
  assert.throws(() => create({ body: 'private essay' }, undefined, { ...syntheticFont, shape() { throw new Error('private essay'); } }), error('INVALID_FONT_METRICS'));
  const giant = JSON.parse(JSON.stringify(getDevelopmentPreset('essay-grid')));
  giant.textStyles.body.fontSizeMm = 30;
  assert.throws(() => create({ body: '春' }, giant), error('GLYPH_OUT_OF_BOUNDS'));
  assert.throws(() => create({ body: '春' }, getDevelopmentPreset('pinyin-lines')), error('INVALID_PRESET'));
});

test('new square output matches reviewed synthetic layout baseline', () => {
  const baselines = JSON.parse(readFileSync(new URL('./fixtures/square-layout.json', import.meta.url)));
  for (const fixture of baselines) {
    const { layout } = create(fixture.input, getDevelopmentPreset(fixture.templateId));
    assert.deepEqual(layout.pages.map(page => ({ lines: page.lines, slots: page.slots, glyphs: page.glyphs })), fixture.pages, fixture.id);
  }
});
