/** Font coordinates use the conventional baseline origin with positive y upwards. */
export type FontInkBounds = Readonly<{ xMin: number; yMin: number; xMax: number; yMax: number }>;

export type GlyphMetrics = Readonly<{
  glyphId: number;
  /** Half-open UTF-16 range in the original string passed to shape(). */
  clusterStart: number;
  clusterEnd: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  /** Exact outline bounds relative to the glyph origin, before the offsets above. */
  inkBounds: FontInkBounds | null;
}>;

export type ShapedText = Readonly<{
  fontId: string;
  unitsPerEm: number;
  advanceWidth: number;
  ascender: number;
  descender: number;
  /** Visual order; each glyph origin is cumulative advances plus its own offsets. */
  glyphs: readonly GlyphMetrics[];
  /** Union of exact positioned glyph bounds, relative to the run baseline origin. */
  inkBounds: FontInkBounds | null;
}>;

/** Loaded immutable resources only. No renderer or platform measurement API belongs here. */
export interface FontMetricsProvider {
  readonly fontBundleVersion: string;
  shape(fontId: string, text: string): ShapedText;
}
