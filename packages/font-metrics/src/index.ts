import { create, type Font, type Glyph } from 'fontkit';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { graphemeSegments } from 'unicode-segmenter/grapheme';
import { isMark } from 'unicode-properties';
import type { FontMetricsProvider, ShapedText, GlyphMetrics, FontInkBounds } from '../../paper-core/dist/font-metrics.js';
import { FONT_BUNDLE_VERSION, FONT_RESOURCES, type FontId } from './resources.generated.js';
import { outlineBounds } from './outline-bounds.js';

export { FONT_BUNDLE_VERSION, FONT_RESOURCES };
export type { FontId, FontMetricsProvider, ShapedText, GlyphMetrics, FontInkBounds };
/** Bump the supported bundle identity when this fixed shaping behavior changes. */
export const METRICS_ENGINE_VERSION = 'fontkit-2.0.4-nfc-grapheme-map-v1';

export type FontMetricsErrorCode =
  | 'FONT_BUNDLE_UNSUPPORTED' | 'FONT_ID_UNSUPPORTED' | 'FONT_RESOURCE_MISSING'
  | 'FONT_RESOURCE_INVALID' | 'FONT_GLYPH_MISSING' | 'FONT_TEXT_UNSUPPORTED'
  | 'FONT_SHAPING_UNSUPPORTED' | 'FONT_METRICS_INVALID' | 'FONT_GLYPH_ID_INVALID';

/** Contains only stable codes and optional source positions, never user text. */
export class FontMetricsError extends Error {
  constructor(readonly code: FontMetricsErrorCode, readonly clusterStart?: number, readonly clusterEnd?: number) {
    super(code);
    this.name = 'FontMetricsError';
  }
}

export type GlyphOutlineCommand = Readonly<{
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  args: readonly number[];
}>;
export type GlyphOutline = Readonly<{
  glyphId: number;
  unitsPerEm: number;
  commands: readonly GlyphOutlineCommand[];
  inkBounds: FontInkBounds | null;
}>;
export interface OriginalFontMetricsProvider extends FontMetricsProvider {
  readonly metricsEngineVersion: string;
  hasFont(fontId: string): boolean;
  glyphOutline(fontId: string, glyphId: number): GlyphOutline;
  /** Copy of the unchanged, verified original TTF, for the PDF embedding adapter. */
  originalFontBytes(fontId: string): Uint8Array;
}
export type FontProviderOptions = Readonly<{
  fontBundleVersion: string;
  fonts: Readonly<Partial<Record<FontId, Uint8Array>>>;
}>;

type SourcePoint = { point: number; start: number; end: number };
type LoadedFont = { font: Font; bytes: Uint8Array };
const resources = new Map<string, typeof FONT_RESOURCES[number]>(FONT_RESOURCES.map(resource => [resource.id, resource]));
const commandArity = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, closePath: 0 } as const;
const finite = (value: number) => Number.isFinite(value);

/** Fontkit caches Glyph by ID, including the first call's source codePoints.
 * Cmap aliases and outline-first access must not reuse that source metadata.
 * This instance-local view keeps geometry cached while attaching the provenance
 * supplied by each cmap/GSUB call. It does not patch vendor globals or bytes. */
function isolateGlyphProvenance(font: Font): void {
  const cachedGlyph = font.getGlyph.bind(font);
  font.getGlyph = (glyphId, codePoints = []) => {
    const glyph = cachedGlyph(glyphId);
    return Object.create(glyph, {
      codePoints: { value: [...codePoints] },
      isMark: { value: codePoints.length > 0 && codePoints.every(isMark) },
      isLigature: { value: codePoints.length > 1 },
      // Resolve on the cached glyph, so outline parsing stays shared rather
      // than being cached separately on every short-lived source view.
      path: { get: () => glyph.path },
    }) as Glyph;
  };
}

function validatePoint(point: number, start: number, end: number): void {
  // Fontkit hides default ignorables. Explicit rejection prevents silent loss of
  // variation selectors, joiners, controls and bidi instructions. Layout owns LF.
  if (point < 0x20 || (point >= 0x7f && point <= 0x9f) ||
      (point >= 0xd800 && point <= 0xdfff) || point === 0x00ad || point === 0x034f ||
      point === 0x061c || (point >= 0x17b4 && point <= 0x17b5) ||
      (point >= 0x180b && point <= 0x180e) || (point >= 0x200b && point <= 0x200f) ||
      (point >= 0x2028 && point <= 0x202e) || (point >= 0x2060 && point <= 0x206f) ||
      (point >= 0xfe00 && point <= 0xfe0f) || point === 0xfeff ||
      (point >= 0xfff0 && point <= 0xfff8) || (point >= 0x1bca0 && point <= 0x1bca3) ||
      (point >= 0x1d173 && point <= 0x1d17a) || (point >= 0xe0000 && point <= 0xe0fff)) {
    throw new FontMetricsError('FONT_TEXT_UNSUPPORTED', start, end);
  }
}

function prepareText(font: Font, text: string): { normalized: string; points: SourcePoint[] } {
  const normalized: string[] = [];
  const points: SourcePoint[] = [];
  for (const { segment, index } of graphemeSegments(text)) {
    const end = index + segment.length;
    for (const char of segment) validatePoint(char.codePointAt(0)!, index, end);
    // NFC prevents unstacked generic marks replacing a font's designed pinyin
    // glyph. For a missing precomposed character (e.g. Ǹ), canonical NFD is
    // permitted only if every component is present. Never use compatibility forms.
    let value = segment.normalize('NFC');
    if ([...value].some(char => !font.hasGlyphForCodePoint(char.codePointAt(0)!))) {
      value = segment.normalize('NFD');
      if ([...value].some(char => !font.hasGlyphForCodePoint(char.codePointAt(0)!))) {
        throw new FontMetricsError('FONT_GLYPH_MISSING', index, end);
      }
    }
    normalized.push(value);
    for (const char of value) points.push({ point: char.codePointAt(0)!, start: index, end });
  }
  return { normalized: normalized.join(''), points };
}

function glyphBounds(glyph: Glyph): FontInkBounds | null {
  if (glyph.path.commands.length === 0) return null;
  const bounds = outlineBounds(glyph.path.commands)!;
  const { xMin, yMin, xMax, yMax } = bounds;
  if (![xMin, yMin, xMax, yMax].every(finite) || xMin > xMax || yMin > yMax) {
    throw new FontMetricsError('FONT_METRICS_INVALID');
  }
  return bounds;
}

function shapeRun(fontId: string, font: Font, text: string): ShapedText {
  const prepared = prepareText(font, text);
  const run = font.layout(prepared.normalized);
  if (run.direction !== 'ltr' || run.glyphs.length !== run.positions.length) {
    throw new FontMetricsError('FONT_SHAPING_UNSUPPORTED');
  }
  const glyphs: GlyphMetrics[] = [];
  let cursor = 0;
  let penX = 0;
  let penY = 0;
  let inkBounds: FontInkBounds | null = null;
  for (let index = 0; index < run.glyphs.length; index++) {
    const glyph = run.glyphs[index]!;
    const position = run.positions[index]!;
    if (glyph.id === 0) throw new FontMetricsError('FONT_GLYPH_MISSING');
    const first = prepared.points[cursor];
    // Codepoint provenance is checked, never guessed by glyph count or UTF-16
    // length. A ligature consumes the matching source sequence and spans all its
    // original graphemes; one-to-many/reordered mappings outside this contract fail.
    if (!first || glyph.codePoints.length === 0) throw new FontMetricsError('FONT_SHAPING_UNSUPPORTED');
    for (const point of glyph.codePoints) {
      if (prepared.points[cursor]?.point !== point) throw new FontMetricsError('FONT_SHAPING_UNSUPPORTED');
      cursor++;
    }
    const last = prepared.points[cursor - 1]!;
    const { xAdvance, yAdvance, xOffset, yOffset } = position;
    if (![xAdvance, yAdvance, xOffset, yOffset].every(finite)) throw new FontMetricsError('FONT_METRICS_INVALID');
    const bounds = glyphBounds(glyph);
    glyphs.push(Object.freeze({ glyphId: glyph.id, clusterStart: first.start, clusterEnd: last.end,
      xAdvance, yAdvance, xOffset, yOffset, inkBounds: bounds }));
    if (bounds) {
      const xMin = bounds.xMin + penX + xOffset;
      const yMin = bounds.yMin + penY + yOffset;
      const xMax = bounds.xMax + penX + xOffset;
      const yMax = bounds.yMax + penY + yOffset;
      inkBounds = inkBounds ? { xMin: Math.min(xMin, inkBounds.xMin), yMin: Math.min(yMin, inkBounds.yMin),
        xMax: Math.max(xMax, inkBounds.xMax), yMax: Math.max(yMax, inkBounds.yMax) } : { xMin, yMin, xMax, yMax };
    }
    penX += xAdvance;
    penY += yAdvance;
  }
  if (cursor !== prepared.points.length || !finite(penX) || penX < 0) throw new FontMetricsError('FONT_SHAPING_UNSUPPORTED');
  return Object.freeze({ fontId, unitsPerEm: font.unitsPerEm, advanceWidth: penX,
    ascender: font.ascent, descender: font.descent, glyphs: Object.freeze(glyphs),
    inkBounds: inkBounds && Object.freeze(inkBounds) });
}

/** Pure synchronous construction over already-loaded original font bytes. */
export function createFontMetricsProvider(options: FontProviderOptions): OriginalFontMetricsProvider {
  if (!options || options.fontBundleVersion !== FONT_BUNDLE_VERSION) throw new FontMetricsError('FONT_BUNDLE_UNSUPPORTED');
  if (!options.fonts || typeof options.fonts !== 'object') throw new FontMetricsError('FONT_RESOURCE_MISSING');
  const loaded = new Map<string, LoadedFont>();
  for (const [fontId, source] of Object.entries(options.fonts)) {
    const resource = resources.get(fontId);
    if (!resource) throw new FontMetricsError('FONT_ID_UNSUPPORTED');
    if (!source) throw new FontMetricsError('FONT_RESOURCE_MISSING');
    if (Object.prototype.toString.call(source) !== '[object Uint8Array]' || source.byteLength !== resource.bytes) {
      throw new FontMetricsError('FONT_RESOURCE_INVALID');
    }
    // Copy before verification: caller mutation, views, and Node Buffers cannot
    // change the bytes after hashing. No source text enters provider caches.
    const bytes = new Uint8Array(source);
    if (bytesToHex(sha256(bytes)) !== resource.sha256) throw new FontMetricsError('FONT_RESOURCE_INVALID');
    try {
      const font = create(bytes);
      if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 ||
          ![font.ascent, font.descent].every(finite)) throw new FontMetricsError('FONT_METRICS_INVALID');
      isolateGlyphProvenance(font);
      loaded.set(fontId, { font, bytes });
    } catch (error) {
      if (error instanceof FontMetricsError) throw error;
      throw new FontMetricsError('FONT_RESOURCE_INVALID');
    }
  }
  if (loaded.size === 0) throw new FontMetricsError('FONT_RESOURCE_MISSING');
  function get(fontId: string): LoadedFont {
    if (!resources.has(fontId)) throw new FontMetricsError('FONT_ID_UNSUPPORTED');
    const value = loaded.get(fontId);
    if (!value) throw new FontMetricsError('FONT_RESOURCE_MISSING');
    return value;
  }
  return Object.freeze({
    fontBundleVersion: FONT_BUNDLE_VERSION,
    metricsEngineVersion: METRICS_ENGINE_VERSION,
    hasFont(fontId: string) { return loaded.has(fontId); },
    shape(fontId: string, text: string) {
      const { font } = get(fontId);
      if (typeof text !== 'string') throw new FontMetricsError('FONT_TEXT_UNSUPPORTED');
      try { return shapeRun(fontId, font, text); }
      catch (error) {
        if (error instanceof FontMetricsError) throw error;
        // Never expose vendor messages: they can contain input/codepoint details.
        throw new FontMetricsError('FONT_SHAPING_UNSUPPORTED');
      }
    },
    glyphOutline(fontId: string, glyphId: number) {
      const { font } = get(fontId);
      if (!Number.isSafeInteger(glyphId) || glyphId < 1 || glyphId >= font.numGlyphs) throw new FontMetricsError('FONT_GLYPH_ID_INVALID');
      const glyph = font.getGlyph(glyphId);
      const commands: GlyphOutlineCommand[] = glyph.path.commands.map(item => {
        if (!Object.prototype.hasOwnProperty.call(commandArity, item.command)) throw new FontMetricsError('FONT_METRICS_INVALID');
        const command = item.command as GlyphOutlineCommand['command'];
        if (item.args.length !== commandArity[command] || !item.args.every(finite)) throw new FontMetricsError('FONT_METRICS_INVALID');
        return Object.freeze({ command, args: Object.freeze([...item.args]) });
      });
      return Object.freeze({ glyphId, unitsPerEm: font.unitsPerEm, commands: Object.freeze(commands), inkBounds: glyphBounds(glyph) });
    },
    originalFontBytes(fontId: string) { return new Uint8Array(get(fontId).bytes); },
  });
}

/** Fixed canonical font only; tracing selection does not enter logical widths. */
export function createMeasureTextMm(provider: FontMetricsProvider, canonicalFontId: string, fontSizeMm: number): (text: string) => number {
  if (!Number.isFinite(fontSizeMm) || fontSizeMm <= 0) throw new FontMetricsError('FONT_METRICS_INVALID');
  return text => {
    const run = provider.shape(canonicalFontId, text);
    if (!Number.isFinite(run.advanceWidth) || run.advanceWidth < 0 ||
      !Number.isFinite(run.unitsPerEm) || run.unitsPerEm <= 0) throw new FontMetricsError('FONT_METRICS_INVALID');
    const width = run.advanceWidth * fontSizeMm / run.unitsPerEm;
    if (!Number.isFinite(width)) throw new FontMetricsError('FONT_METRICS_INVALID');
    return width;
  };
}
