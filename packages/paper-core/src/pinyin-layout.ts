import type {
  BoundsMm, GlyphPlacement, LayoutLine, PaperDocument, PaperLayout, SourceRange,
  TextParagraph, TextSlot, TextStylePreset, TextUnit,
} from './contracts.js';
import { createPaperDocument } from './document.js';
import { PaperError } from './errors.js';
import { assertExecutableEngine } from './engine.js';
import type { FontMetricsProvider } from './font-metrics.js';
import { buildPageGeometry } from './geometry.js';
import { positionShapedText, roundMm } from './glyph-placement.js';
import { deepFreeze } from './immutable.js';
import { createShapeCache } from './shape-cache.js';
import { isWhitespace } from './unicode.js';

type Run = Readonly<{ text: string; source: SourceRange; units: readonly TextUnit[] }>;
type PendingSlot = { run: Run; x: number; width: number };
type MutablePage = { geometry: ReturnType<typeof buildPageGeometry>; lines: LayoutLine[]; slots: TextSlot[]; glyphs: GlyphPlacement[] };
const EPSILON = 1e-6;
const TONES = ['\u0304', '\u0301', '\u030c', '\u0300'];
const MARKS = new Set([...TONES, '\u0308', '\u0302']);
const PUNCTUATION = new Set('.,;:!?\'"-()[]“”‘’');
const asciiLetter = (value: string) => /^[A-Za-z]$/.test(value);
// Static canonical decompositions keep validation independent of host Unicode tables.
const PINYIN_LETTERS = new Map<string, readonly string[]>();
for (const [base, forms, marks] of [
  ['a', 'āáǎà', TONES], ['e', 'ēéěè', TONES], ['i', 'īíǐì', TONES],
  ['o', 'ōóǒò', TONES], ['u', 'ūúǔù', TONES], ['u\u0308', 'ǖǘǚǜ', TONES],
  ['n', 'ńňǹ', ['\u0301', '\u030c', '\u0300']], ['m', 'ḿ', ['\u0301']],
  ['u', 'ü', ['\u0308']], ['e', 'ê', ['\u0302']],
  ['e\u0302', 'ếề', ['\u0301', '\u0300']],
] as const) {
  Array.from(forms).forEach((form, index) => {
    const decomposition = [...base, marks[index]!];
    PINYIN_LETTERS.set(form, decomposition);
    PINYIN_LETTERS.set(form.toUpperCase(), [decomposition[0]!.toUpperCase(), ...decomposition.slice(1)]);
  });
}
function supportedUnit(text: string): boolean {
  if (isWhitespace(text)) return true;
  const chars = Array.from(text);
  const first = chars[0]!;
  if (asciiLetter(first) || PINYIN_LETTERS.has(first)) {
    const decomposition = [...(PINYIN_LETTERS.get(first) ?? [first]), ...chars.slice(1)];
    const base = decomposition[0]!.toLowerCase();
    const marks = decomposition.slice(1);
    return marks.every(mark => MARKS.has(mark)) && marks.filter(mark => TONES.includes(mark)).length <= 1 &&
      marks.filter(mark => mark === '\u0308' || mark === '\u0302').length <= 1 &&
      (!marks.includes('\u0308') || base === 'u') && (!marks.includes('\u0302') || base === 'e');
  }
  return chars.length === 1 && (/^[0-9]$/.test(first) || PUNCTUATION.has(first));
}
function run(units: readonly TextUnit[]): Run {
  return { units, text: units.map(unit => unit.text).join(''),
    source: { ...units[0]!.source, end: units[units.length - 1]!.source.end } };
}
/** Word/isolated-space runs preserve source text and keep syllables/apostrophes together. */
function runs(paragraph: TextParagraph): readonly Run[] {
  const output: Run[] = [];
  let from = 0;
  for (let i = 0; i < paragraph.units.length; i++) {
    const unit = paragraph.units[i]!;
    if (!supportedUnit(unit.text)) throw new PaperError('UNSUPPORTED_TEXT', { block: unit.source.block, offset: unit.source.start });
    if (isWhitespace(unit.text)) {
      if (i > from) output.push(run(paragraph.units.slice(from, i)));
      output.push(run([unit]));
      from = i + 1;
    }
  }
  if (from < paragraph.units.length) output.push(run(paragraph.units.slice(from)));
  return output;
}

/** Independent four-line bands: fixed baselines and true shaped widths, never square cells. */
export function layoutPinyinPaperDocument(input: PaperDocument, metrics: FontMetricsProvider): PaperLayout {
  if (!input || typeof input !== 'object') throw new PaperError('INVALID_INPUT', { field: 'input' });
  const document = createPaperDocument(input.input, input.preset);
  const { preset } = document;
  assertExecutableEngine(document.versions.engineVersion);
  if (preset.geometry.kind !== 'pinyin-lines' || preset.carrier.kind !== 'pinyin-lines') {
    throw new PaperError('INVALID_PRESET', { field: 'preset' });
  }
  if (!metrics || metrics.fontBundleVersion !== document.versions.fontBundleVersion) {
    throw new PaperError('VERSION_MISMATCH', { field: 'versions' });
  }
  const geometry = buildPageGeometry(preset.geometry);
  const { groupCount: rows, lineLengthMm: lineWidth, lineGapMm, groupGapMm, origin } = preset.geometry;
  const bandHeight = lineGapMm * 3;
  const rowStep = bandHeight + groupGapMm;
  const { baselineOffsetMm, indentUnitMm } = preset.carrier;
  const pages: MutablePage[] = [{ geometry, lines: [], slots: [], glyphs: [] }];
  const result = (): PaperLayout => deepFreeze({ versions: document.versions, mode: document.mode,
    pages, textStyles: preset.textStyles, strokes: preset.strokes });
  if (document.mode === 'blank') return result();
  const shape = createShapeCache(metrics);
  function width(value: Run, style: TextStylePreset): number {
    const shaped = shape(style.canonicalFontId, value);
    const left = Math.min(0, shaped.inkBounds?.xMin ?? 0);
    const right = Math.max(shaped.advanceWidth, shaped.inkBounds?.xMax ?? 0);
    const measured = roundMm((right - left) * style.fontSizeMm / shaped.unitsPerEm);
    if (measured <= 0) throw new PaperError('INVALID_FONT_METRICS', { block: value.source.block, offset: value.source.start });
    return measured;
  }
  let globalRow = 0;
  function pageForRow(): MutablePage {
    const index = Math.floor(globalRow / rows);
    if (index >= preset.limits.maxPages) throw new PaperError('PAGE_LIMIT_EXCEEDED', { field: 'layout', limit: preset.limits.maxPages });
    while (pages.length <= index) pages.push({ geometry, lines: [], slots: [], glyphs: [] });
    return pages[index]!;
  }
  function renderParagraph(paragraph: TextParagraph, style: TextStylePreset): void {
    let pending: PendingSlot[] = [];
    let pen = paragraph.source.block === 'body' ? document.options.bodyIndentUnits * indentUnitMm : 0;
    let nextSource = paragraph.source.start;
    function commitLine(breakAfter: LayoutLine['breakAfter']): void {
      const page = pageForRow();
      const row = globalRow % rows;
      const top = origin.y + row * rowStep;
      const shift = paragraph.source.block === 'title'
        ? document.options.titleAlign === 'center' ? (lineWidth - pen) / 2 : document.options.titleAlign === 'right' ? lineWidth - pen : 0
        : 0;
      for (const slot of pending) {
        const bounds: BoundsMm = { x: roundMm(origin.x + slot.x + shift), y: roundMm(top),
          width: slot.width, height: bandHeight };
        page.slots.push({ source: slot.run.source, row, boundsMm: bounds, sharesCell: false });
        const shaped = shape(style.canonicalFontId, slot.run);
        const x = bounds.x - Math.min(0, shaped.inkBounds?.xMin ?? 0) * style.fontSizeMm / shaped.unitsPerEm;
        page.glyphs.push(...positionShapedText(shaped, slot.run.source,
          { x, y: top + baselineOffsetMm }, style.fontSizeMm, style.id, bounds));
      }
      const start = pending[0]?.run.source.start ?? nextSource;
      const end = pending[pending.length - 1]?.run.source.end ?? start;
      page.lines.push({ block: paragraph.source.block, paragraphIndex: paragraph.index, row,
        source: { block: paragraph.source.block, start, end }, breakAfter,
        empty: pending.every(slot => isWhitespace(slot.run.text)) });
      nextSource = end;
      globalRow++;
      pending = [];
      pen = 0;
    }
    function add(value: Run, measured: number): void {
      pending.push({ run: value, x: pen, width: measured });
      pen = roundMm(pen + measured);
    }
    function placeLongRun(value: Run): void {
      let from = 0;
      while (from < value.units.length) {
        const remaining = value.units.length - from;
        const chunk = (count: number) => run(value.units.slice(from, from + count));
        const fits = (count: number) => pen + width(chunk(count), style) <= lineWidth + EPSILON;
        if (!fits(1)) {
          if (pending.length > 0 || pen > 0) { commitLine('wrap'); continue; }
          throw new PaperError('GLYPH_OUT_OF_BOUNDS', { block: value.source.block, offset: value.units[from]!.source.start });
        }
        let low = 1;
        let high = Math.min(2, remaining);
        while (high < remaining && fits(high)) { low = high; high = Math.min(high * 2, remaining); }
        if (fits(high)) low = high;
        else while (low + 1 < high) {
          const middle = Math.floor((low + high) / 2);
          if (fits(middle)) low = middle; else high = middle;
        }
        const part = chunk(low);
        add(part, width(part, style));
        from += low;
        if (from < value.units.length) commitLine('wrap');
      }
    }
    for (const value of runs(paragraph)) {
      const measured = width(value, style);
      if (measured > lineWidth + EPSILON) { placeLongRun(value); continue; }
      if (pen + measured > lineWidth + EPSILON) commitLine('wrap');
      add(value, measured);
    }
    commitLine(paragraph.separator ? 'explicit' : 'end');
  }
  const title = document.blocks[0]!;
  const body = document.blocks[1]!;
  if (title.sourceText.length > 0) {
    for (const paragraph of title.paragraphs) renderParagraph(paragraph, preset.textStyles.title);
    if (body.sourceText.length > 0) globalRow += preset.titleBodyGapRows;
  }
  if (body.sourceText.length > 0) for (const paragraph of body.paragraphs) renderParagraph(paragraph, preset.textStyles.body);
  return result();
}
