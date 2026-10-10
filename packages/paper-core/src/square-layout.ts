import type {
  BoundsMm, GlyphPlacement, LayoutLine, PaperDocument, PaperLayout, SourceRange,
  TextParagraph, TextSlot, TextStylePreset,
} from './contracts.js';
import { createPaperDocument } from './document.js';
import { PaperError } from './errors.js';
import { assertExecutableEngine } from './engine.js';
import type { FontMetricsProvider } from './font-metrics.js';
import { buildPageGeometry } from './geometry.js';
import { positionShapedText, roundMm } from './glyph-placement.js';
import { createShapeCache } from './shape-cache.js';
import { deepFreeze } from './immutable.js';
import { punctuationAtoms, sliceWord, tokenizeParagraph, type TextToken } from './text-tokens.js';
import { isWhitespace } from './unicode.js';

type PendingSlot = { token: TextToken; x: number; width: number; shared: boolean };
type MutablePage = { geometry: ReturnType<typeof buildPageGeometry>; lines: LayoutLine[]; slots: TextSlot[]; glyphs: GlyphPlacement[] };
const EPSILON = 1e-6;

/** Three square templates share this layout; a renderer never chooses line breaks or fits glyphs. */
export function layoutSquarePaperDocument(input: PaperDocument, metrics: FontMetricsProvider): PaperLayout {
  if (!input || typeof input !== 'object') throw new PaperError('INVALID_INPUT', { field: 'input' });
  // Rebuild derived fields instead of trusting caller-created mode/blocks/options.
  const document = createPaperDocument(input.input, input.preset);
  const { preset } = document;
  assertExecutableEngine(document.versions.engineVersion);
  if (preset.geometry.kind !== 'square-grid' || preset.carrier.kind !== 'square-grid') {
    throw new PaperError('INVALID_PRESET', { field: 'preset' });
  }
  if (!metrics || metrics.fontBundleVersion !== document.versions.fontBundleVersion) {
    throw new PaperError('VERSION_MISMATCH', { field: 'versions' });
  }
  const geometry = buildPageGeometry(preset.geometry);
  const { cellMm: cell, columns, rows, origin } = preset.geometry;
  const inset = preset.carrier.glyphInsetMm;
  const lineWidth = cell * columns;
  const pages: MutablePage[] = [{ geometry, lines: [], slots: [], glyphs: [] }];
  const result = (): PaperLayout => deepFreeze({ versions: document.versions, mode: document.mode,
    pages, textStyles: preset.textStyles, strokes: preset.strokes });
  if (document.mode === 'blank') return result();

  const shape = createShapeCache(metrics);
  function width(token: TextToken, style: TextStylePreset): number {
    if (token.kind === 'cell') return cell * token.units.length;
    const shaped = shape(style.canonicalFontId, token);
    const left = Math.min(0, shaped.inkBounds?.xMin ?? 0);
    const right = Math.max(shaped.advanceWidth, shaped.inkBounds?.xMax ?? 0);
    return roundMm((right - left) * style.fontSizeMm / shaped.unitsPerEm);
  }
  function planned(atom: readonly TextToken[], pen: number, style: TextStylePreset): { end: number; slots: PendingSlot[] } {
    const slots: PendingSlot[] = [];
    for (const token of atom) {
      const x = token.kind === 'cell' ? roundMm(Math.ceil((pen - EPSILON) / cell) * cell) : pen;
      const w = width(token, style);
      if (w <= 0) throw new PaperError('INVALID_FONT_METRICS', { block: token.source.block, offset: token.source.start });
      slots.push({ token, x, width: w, shared: false });
      pen = roundMm(x + w);
    }
    return { end: pen, slots };
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
    let pen = paragraph.source.block === 'body' ? document.options.bodyIndentUnits * cell : 0;
    let nextSource = paragraph.source.start;
    function commitLine(breakAfter: LayoutLine['breakAfter']): void {
      const page = pageForRow();
      const row = globalRow % rows;
      const top = origin.y + row * cell;
      const shift = paragraph.source.block === 'title'
        ? document.options.titleAlign === 'center' ? (lineWidth - pen) / 2 : document.options.titleAlign === 'right' ? lineWidth - pen : 0
        : 0;
      // Actual ink of all flow runs supplies one baseline for this visual row.
      let lower = 0;
      let upper = 0;
      for (const slot of pending) {
        if (slot.token.kind !== 'flow') continue;
        const shaped = shape(style.canonicalFontId, slot.token);
        const scale = style.fontSizeMm / shaped.unitsPerEm;
        lower = Math.min(lower, (shaped.inkBounds?.yMin ?? 0) * scale);
        upper = Math.max(upper, (shaped.inkBounds?.yMax ?? 0) * scale);
      }
      const flowBaseline = top + (cell - (upper - lower)) / 2 + upper;
      for (const slot of pending) {
        const token = slot.token;
        const bounds: BoundsMm = { x: roundMm(origin.x + slot.x + shift),
          y: roundMm(top + (slot.shared ? cell * 2 / 3 : 0)), width: roundMm(slot.width), height: roundMm(slot.shared ? cell / 3 : cell) };
        page.slots.push({ source: token.source, row, boundsMm: bounds, sharesCell: slot.shared });
        const fontId = document.mode === 'tracing' && token.role === 'han' ? style.tracingHanFontId : style.canonicalFontId;
        const shaped = shape(fontId, token);
        const fontSize = slot.shared ? style.fontSizeMm / 3 : style.fontSizeMm;
        const scale = fontSize / shaped.unitsPerEm;
        let x: number;
        let baseline: number;
        let constraint: BoundsMm;
        if (token.kind === 'flow') {
          x = bounds.x - Math.min(0, shaped.inkBounds?.xMin ?? 0) * scale;
          baseline = flowBaseline;
          constraint = { x: bounds.x, y: bounds.y + inset, width: bounds.width, height: bounds.height - 2 * inset };
        } else {
          const ink = shaped.inkBounds;
          const inkWidth = ink ? (ink.xMax - ink.xMin) * scale : 0;
          const inkHeight = ink ? (ink.yMax - ink.yMin) * scale : 0;
          x = bounds.x + (bounds.width - inkWidth) / 2 - (ink?.xMin ?? 0) * scale;
          baseline = bounds.y + (bounds.height - inkHeight) / 2 + (ink?.yMax ?? 0) * scale;
          const padding = Math.min(inset, bounds.width / 4, bounds.height / 4);
          constraint = { x: bounds.x + padding, y: bounds.y + padding,
            width: bounds.width - 2 * padding, height: bounds.height - 2 * padding };
        }
        page.glyphs.push(...positionShapedText(shaped, token.source, { x, y: baseline }, fontSize, style.id, constraint));
      }
      const start = pending[0]?.token.source.start ?? nextSource;
      const end = pending[pending.length - 1]?.token.source.end ?? start;
      page.lines.push({ block: paragraph.source.block, paragraphIndex: paragraph.index, row,
        source: { block: paragraph.source.block, start, end }, breakAfter,
        empty: pending.every(slot => isWhitespace(slot.token.text)) });
      nextSource = end;
      globalRow++;
      pen = 0;
      pending = [];
    }
    function addPlan(plan: ReturnType<typeof planned>): void { pending.push(...plan.slots); pen = plan.end; }
    function unsupported(source: SourceRange): never { throw new PaperError('UNSUPPORTED_TEXT', { block: source.block, offset: source.start }); }
    function placeLongAtom(atom: readonly TextToken[], wordIndex: number): void {
      const word = atom[wordIndex]!;
      let prefix = atom.slice(0, wordIndex);
      const suffix = atom.slice(wordIndex + 1);
      let from = 0;
      while (from < word.units.length) {
        const remaining = word.units.length - from;
        const chunk = (count: number) => [...prefix, sliceWord(word, from, from + count), ...(count === remaining ? suffix : [])];
        const fits = (count: number) => planned(chunk(count), pen, style).end <= lineWidth + EPSILON;
        if (!fits(1)) {
          if (pending.length > 0 || pen > 0) { commitLine('wrap'); continue; }
          if (width(sliceWord(word, from, from + 1), style) > lineWidth + EPSILON) {
            throw new PaperError('GLYPH_OUT_OF_BOUNDS', { block: word.source.block, offset: word.units[from]!.source.start });
          }
          unsupported(word.source);
        }
        let low = 1;
        let high = Math.min(2, remaining);
        while (high < remaining && fits(high)) { low = high; high = Math.min(high * 2, remaining); }
        if (fits(high)) low = high;
        else while (low + 1 < high) {
          const middle = Math.floor((low + high) / 2);
          if (fits(middle)) low = middle; else high = middle;
        }
        addPlan(planned(chunk(low), pen, style));
        from += low;
        prefix = [];
        if (from < word.units.length) commitLine('wrap');
      }
    }
    for (const atom of punctuationAtoms(tokenizeParagraph(paragraph))) {
      const whole = planned(atom, 0, style);
      if (whole.end > lineWidth + EPSILON) {
        const longIndex = atom.findIndex(token => token.role === 'word' && width(token, style) > lineWidth + EPSILON);
        if (longIndex < 0) unsupported(atom[0]!.source);
        placeLongAtom(atom, longIndex);
        continue;
      }
      let plan = planned(atom, pen, style);
      if (plan.end > lineWidth + EPSILON) {
        const first = atom[0]!;
        const previous = pending[pending.length - 1];
        if (atom.length === 1 && first.role === 'stop' && previous?.token.role === 'han' &&
          previous.token.source.end === first.source.start && Math.abs(previous.x + previous.width - lineWidth) < EPSILON) {
          pending.push({ token: first, x: lineWidth - cell / 3, width: cell / 3, shared: true });
          continue;
        }
        if (first.role === 'stop' || first.role === 'close') unsupported(first.source);
        commitLine('wrap');
        plan = planned(atom, 0, style);
      }
      addPlan(plan);
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
