import { buildPageGeometry } from './geometry.js';
import type { PageGeometry, SquareGridPreset } from './types.js';

/** Styles are resolved by renderers; this core only allocates logical positions. */
export type TextKind = 'title' | 'body';
export type ContentMode = 'blank' | 'filled' | 'tracing';
export type TextPlacement = Readonly<{
  text: string;
  kind: TextKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  row: number;
  /** True if an end-of-line Chinese stop shares the previous Hanzi's cell. */
  sharesCell?: boolean;
}>;
export type LayoutPage = Readonly<{ geometry: PageGeometry; placements: readonly TextPlacement[] }>;
export type DocumentLayout = Readonly<{ mode: ContentMode; pages: readonly LayoutPage[] }>;
export type SquareTextDocument = Readonly<{
  preset: SquareGridPreset;
  title?: string;
  body?: string;
  tracing?: boolean;
}>;
export type TextLayoutOptions = Readonly<{
  /** Font-aware width measurement provided by the actual renderer, in mm. No guessed Latin widths. */
  measureTextMm?: (text: string) => number;
  maxPages?: number;
}>;

type MutablePlacement = {
  text: string; kind: TextKind; xMm: number; yMm: number;
  widthMm: number; heightMm: number; row: number; sharesCell?: boolean;
};
type MutablePage = { geometry: PageGeometry; placements: MutablePlacement[] };
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
const segments = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const isLatinAlnum = (s: string) => /^(?:[A-Za-z]\p{M}*|[0-9])$/u.test(s);
const isHan = (s: string) => /^\p{Script=Han}$/u.test(s);
const chineseStop = new Set(['。', '，', '、', '；', '：', '！', '？']);

function tokenize(line: string): string[] {
  const units = Array.from(segments.segment(line), x => x.segment);
  const tokens: string[] = [];
  for (let i = 0; i < units.length;) {
    const c = units[i]!;
    if (isLatinAlnum(c)) {
      let j = i + 1;
      while (j < units.length && (
        isLatinAlnum(units[j]!) ||
        (units[j] === '.' && /^[0-9]$/.test(units[j - 1]!) && /^[0-9]$/.test(units[j + 1] ?? ''))
      )) j++;
      tokens.push(units.slice(i, j).join(''));
      i = j;
    } else { tokens.push(c); i++; }
  }
  return tokens;
}

/** Square-gridded pages only. Pinyin glyph placement requires font-baseline validation. */
export function layoutSquareDocument(doc: SquareTextDocument, options: TextLayoutOptions = {}): DocumentLayout {
  const title = doc.title ?? '';
  const body = doc.body ?? '';
  if (typeof title !== 'string' || typeof body !== 'string') throw new TypeError('title and body must be strings');
  const maxPages = options.maxPages ?? 50;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError('maxPages must be a positive integer');
  if (doc.preset.kind !== 'square-grid') throw new TypeError('layoutSquareDocument requires a square-grid preset');
  const geometry = buildPageGeometry(doc.preset);
  const { cellMm: cell, columns, rows, origin } = doc.preset;
  const lineWidth = columns * cell;
  const visible = /\S/u.test(title) || /\S/u.test(body);
  const mode: ContentMode = !visible ? 'blank' : doc.tracing ? 'tracing' : 'filled';
  const pages: MutablePage[] = [{ geometry, placements: [] }];
  if (mode === 'blank') return { mode, pages };

  let pageIndex = 0;
  let row = 0;
  let x = 0;
  let currentKind: TextKind = 'body';
  let titleLineStart = 0;

  function currentPage(): MutablePage { return pages[pageIndex]!; }
  function ensurePage(): void {
    while (row >= rows) {
      if (pages.length >= maxPages) throw new RangeError('document exceeds maxPages; no partial layout returned');
      pages.push({ geometry, placements: [] });
      pageIndex++;
      row -= rows;
      titleLineStart = 0;
    }
  }
  function finalizeTitleLine(): void {
    if (currentKind !== 'title') return;
    const entries = currentPage().placements;
    const items = entries.slice(titleLineStart);
    if (items.length === 0) return;
    const lastEdge = Math.max(...items.map(t => t.xMm + t.widthMm)) - origin.x;
    const shift = rounded((lineWidth - lastEdge) / 2);
    for (let i = titleLineStart; i < entries.length; i++) entries[i]!.xMm = rounded(entries[i]!.xMm + shift);
    titleLineStart = entries.length;
  }
  function nextLine(): void {
    finalizeTitleLine();
    row++;
    x = 0;
    titleLineStart = currentPage().placements.length;
  }
  function measured(text: string): number {
    if (!options.measureTextMm) throw new Error('Latin text and spaces require measureTextMm from an actual font');
    const width = options.measureTextMm(text);
    if (!Number.isFinite(width) || width <= 0) throw new RangeError('measureTextMm must return a positive finite width');
    return width;
  }
  function add(text: string, start: number, width: number, sharesCell = false): void {
    ensurePage();
    const p: MutablePlacement = {
      text, kind: currentKind, xMm: rounded(origin.x + start),
      yMm: rounded(origin.y + row * cell), widthMm: rounded(width), heightMm: cell, row,
    };
    if (sharesCell) p.sharesCell = true;
    currentPage().placements.push(p);
  }
  function placeText(text: string): void {
    // Unambiguous ASCII words/numeric runs stay whole if they fit in a row.
    // Very long runs are broken only at Unicode grapheme boundaries.
    const latinOrSpace = /^(?:[A-Za-z0-9.]|\p{M}| )+$/u.test(text);
    if (latinOrSpace) {
      const width = measured(text);
      if (width > lineWidth + 1e-8) {
        if (Array.from(segments.segment(text)).length === 1) throw new RangeError('one glyph exceeds the entire writing width');
        for (const grapheme of segments.segment(text)) placeText(grapheme.segment);
        return;
      }
      if (x + width > lineWidth + 1e-8) nextLine();
      add(text, x, width);
      x = rounded(x + width);
      return;
    }
    if (/\p{Cc}/u.test(text)) throw new RangeError('unsupported control character in text');
    const position = rounded(Math.ceil((x - 1e-8) / cell) * cell);
    if (position + cell > lineWidth + 1e-8) {
      const last = currentPage().placements.at(-1);
      if (chineseStop.has(text) && last && last.kind === currentKind && last.row === row &&
        isHan(last.text) && Math.abs(last.xMm + last.widthMm - (origin.x + lineWidth)) < 1e-6) {
        // Renderer fits this punctuation in the final cell's lower-right corner.
        add(text, lineWidth - cell / 3, cell / 3, true);
        return;
      }
      nextLine();
      add(text, 0, cell);
      x = cell;
      return;
    }
    add(text, position, cell);
    x = rounded(position + cell);
  }
  function renderParagraph(text: string, kind: TextKind, indentCells: number): void {
    currentKind = kind;
    ensurePage();
    x = indentCells * cell;
    titleLineStart = currentPage().placements.length;
    for (const token of tokenize(text)) placeText(token);
    finalizeTitleLine();
  }

  if (/\S/u.test(title)) {
    const titleLines = title.split(/\r\n|\r|\n/u);
    for (let i = 0; i < titleLines.length; i++) {
      if (i > 0) nextLine();
      renderParagraph(titleLines[i]!, 'title', 0);
    }
    if (/\S/u.test(body)) { nextLine(); nextLine(); }
  }
  if (/\S/u.test(body)) {
    const paras = body.split(/\r\n|\r|\n/u);
    for (let i = 0; i < paras.length; i++) {
      if (i > 0) nextLine();
      if (paras[i]!.length) renderParagraph(paras[i]!, 'body', 2);
    }
  }
  return { mode, pages };
}
