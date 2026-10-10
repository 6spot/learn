import type { BoundsMm, GlyphPlacement, SourceRange } from './contracts.js';
import { PaperError } from './errors.js';
import type { FontInkBounds, ShapedText } from './font-metrics.js';
import type { PointMm } from './types.js';

export function roundMm(value: number): number {
  const scaled = value * 1_000_000;
  if (!Number.isFinite(value) || !Number.isFinite(scaled)) throw new PaperError('INVALID_FONT_METRICS', { field: 'font' });
  const rounded = Math.round(scaled) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function validBounds(bounds: FontInkBounds | null): boolean {
  return bounds === null || !!bounds && typeof bounds === 'object' && [bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax].every(Number.isFinite) &&
    bounds.xMin <= bounds.xMax && bounds.yMin <= bounds.yMax;
}
function union(a: FontInkBounds | null, b: FontInkBounds): FontInkBounds {
  return a === null ? b : { xMin: Math.min(a.xMin, b.xMin), yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax), yMax: Math.max(a.yMax, b.yMax) };
}
function sameBounds(a: FontInkBounds | null, b: FontInkBounds | null): boolean {
  if (a === null || b === null) return a === b;
  return (['xMin', 'yMin', 'xMax', 'yMax'] as const).every(key => Math.abs(a[key] - b[key]) <= 1e-6);
}
export function containsInk(bounds: BoundsMm, ink: BoundsMm, toleranceMm = 1e-6): boolean {
  return ink.x >= bounds.x - toleranceMm && ink.y >= bounds.y - toleranceMm &&
    ink.x + ink.width <= bounds.x + bounds.width + toleranceMm &&
    ink.y + ink.height <= bounds.y + bounds.height + toleranceMm;
}

/** Convert shared shaping results once. Never resize a glyph or shift fixed geometry to make it fit. */
export function positionShapedText(
  shaped: ShapedText,
  source: SourceRange,
  originMm: PointMm,
  fontSizeMm: number,
  styleId: string,
  constraint?: BoundsMm,
): readonly GlyphPlacement[] {
  const invalid = (): never => { throw new PaperError('INVALID_FONT_METRICS', { field: 'font' }); };
  if (!shaped || !Array.isArray(shaped.glyphs) || !source || !originMm) invalid();
  if (source.block !== 'title' && source.block !== 'body') invalid();
  if (!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start < 0 || source.end < source.start ||
    ![originMm.x, originMm.y, fontSizeMm].every(Number.isFinite) || fontSizeMm <= 0 || typeof styleId !== 'string' || !styleId ||
    !Number.isSafeInteger(shaped.unitsPerEm) || shaped.unitsPerEm <= 0 || typeof shaped.fontId !== 'string' || !shaped.fontId ||
    ![shaped.advanceWidth, shaped.ascender, shaped.descender].every(Number.isFinite) || shaped.advanceWidth < 0 ||
    !validBounds(shaped.inkBounds)) invalid();
  if (constraint && (![constraint.x, constraint.y, constraint.width, constraint.height].every(Number.isFinite) ||
    constraint.width < 0 || constraint.height < 0)) invalid();
  const scale = fontSizeMm / shaped.unitsPerEm;
  const glyphs: GlyphPlacement[] = [];
  let penX = 0;
  let penY = 0;
  let inkUnion: FontInkBounds | null = null;
  const ranges: { start: number; end: number }[] = [];
  for (const glyph of shaped.glyphs) {
    if (!glyph || typeof glyph !== 'object') invalid();
    if (glyph.glyphId === 0) throw new PaperError('MISSING_GLYPH', { block: source.block, offset: source.start });
    if (!Number.isSafeInteger(glyph.glyphId) || glyph.glyphId < 0 ||
      !Number.isSafeInteger(glyph.clusterStart) || !Number.isSafeInteger(glyph.clusterEnd) ||
      glyph.clusterStart < 0 || glyph.clusterEnd <= glyph.clusterStart || glyph.clusterEnd > source.end - source.start ||
      ![glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset].every(Number.isFinite) || !validBounds(glyph.inkBounds)) invalid();
    ranges.push({ start: glyph.clusterStart, end: glyph.clusterEnd });
    const x = originMm.x + (penX + glyph.xOffset) * scale;
    const y = originMm.y - (penY + glyph.yOffset) * scale;
    let inkBoundsMm: BoundsMm | null = null;
    if (glyph.inkBounds) {
      const bounds = glyph.inkBounds;
      inkUnion = union(inkUnion, { xMin: penX + glyph.xOffset + bounds.xMin, xMax: penX + glyph.xOffset + bounds.xMax,
        yMin: penY + glyph.yOffset + bounds.yMin, yMax: penY + glyph.yOffset + bounds.yMax });
      inkBoundsMm = { x: roundMm(x + bounds.xMin * scale), y: roundMm(y - bounds.yMax * scale),
        width: roundMm((bounds.xMax - bounds.xMin) * scale), height: roundMm((bounds.yMax - bounds.yMin) * scale) };
      if (constraint && !containsInk(constraint, inkBoundsMm)) {
        throw new PaperError('GLYPH_OUT_OF_BOUNDS', { block: source.block, offset: source.start + glyph.clusterStart });
      }
    }
    glyphs.push({ source: { block: source.block, start: source.start + glyph.clusterStart, end: source.start + glyph.clusterEnd },
      fontId: shaped.fontId, glyphId: glyph.glyphId, styleId, fontSizeMm,
      originMm: { x: roundMm(x), y: roundMm(y) },
      advanceMm: { x: roundMm(glyph.xAdvance * scale), y: roundMm(-glyph.yAdvance * scale) }, inkBoundsMm });
    penX += glyph.xAdvance;
    penY += glyph.yAdvance;
  }
  let coveredUntil = 0;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start > coveredUntil) invalid();
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (coveredUntil !== source.end - source.start || Math.abs(penX - shaped.advanceWidth) > 1e-6 ||
    !sameBounds(inkUnion, shaped.inkBounds)) invalid();
  return glyphs;
}
