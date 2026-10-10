import type { PageGeometry, PaperPreset, PointMm, StrokeRole, TemplateId } from './types.js';
import type { ContentMode } from './layout.js';

export type TitleAlignment = 'left' | 'center' | 'right';
export type BodyIndent = 'default' | 'none';
export type PaperUserOptions = Readonly<{ titleAlign?: TitleAlignment; bodyIndent?: BodyIndent }>;
/** Only these fields may cross the user-input boundary. No trusted dimensions or font choices. */
export type PaperInput = Readonly<{
  templateId: TemplateId;
  title?: string;
  body?: string;
  tracing?: boolean;
  options?: PaperUserOptions;
}>;
export type ValidatedPaperInput = Readonly<{
  templateId: TemplateId; title: string; body: string; tracing: boolean; options: PaperUserOptions;
}>;
export type LayoutVersionTuple = Readonly<{
  engineVersion: string;
  templateId: TemplateId;
  templateVersion: string;
  fontBundleVersion: string;
}>;
export type ResourceLimits = Readonly<{
  maxInputCodeUnits: number;
  maxGraphemes: number;
  maxPages: number;
}>;
export type TextStylePreset = Readonly<{
  id: string;
  canonicalFontId: string;
  tracingHanFontId: string;
  /** Em size shared by filled and tracing. No renderer-selected font size. */
  fontSizeMm: number;
  gray: number;
  tracingGray: number;
}>;
export type StrokeStylePreset = Readonly<{
  widthMm: number;
  gray: number;
  dashMm: readonly number[];
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
}>;
export type TextCarrier =
  | Readonly<{ kind: 'square-grid'; glyphInsetMm: number }>
  | Readonly<{ kind: 'pinyin-lines'; baselineOffsetMm: number; indentUnitMm: number }>;
export type TrustedPaperPreset = Readonly<{
  versions: LayoutVersionTuple;
  stage: 'development-candidate' | 'validated-release';
  geometry: PaperPreset;
  defaults: Readonly<{ titleAlign: TitleAlignment; bodyIndentUnits: number }>;
  titleBodyGapRows: number;
  carrier: TextCarrier;
  textStyles: Readonly<{ title: TextStylePreset; body: TextStylePreset }>;
  strokes: Readonly<Record<StrokeRole, StrokeStylePreset>>;
  limits: ResourceLimits;
}>;
export type SourceRange = Readonly<{ block: 'title' | 'body'; start: number; end: number }>;
export type TextUnit = Readonly<{ text: string; source: SourceRange }>;
export type TextParagraph = Readonly<{
  index: number;
  source: SourceRange;
  units: readonly TextUnit[];
  /** Original line terminator is kept separately, including CRLF as two UTF-16 units. */
  separator: '' | '\n' | '\r' | '\r\n';
  separatorSource: SourceRange;
}>;
export type TextBlock = Readonly<{
  kind: 'title' | 'body';
  sourceText: string;
  paragraphs: readonly TextParagraph[];
}>;
export type ResolvedTextOptions = Readonly<{ titleAlign: TitleAlignment; bodyIndentUnits: number }>;
export type PaperDocument = Readonly<{
  input: ValidatedPaperInput;
  versions: LayoutVersionTuple;
  mode: ContentMode;
  options: ResolvedTextOptions;
  blocks: readonly TextBlock[];
  preset: TrustedPaperPreset;
}>;

/** Page coordinates: millimetres, positive x right, positive y down; precision 1e-6 mm. */
export type BoundsMm = Readonly<{ x: number; y: number; width: number; height: number }>;
export type GlyphPlacement = Readonly<{
  source: SourceRange;
  fontId: string;
  glyphId: number;
  styleId: string;
  fontSizeMm: number;
  /** Baseline origin already includes shaping offsets; renderers must not position again. */
  originMm: PointMm;
  advanceMm: PointMm;
  inkBoundsMm: BoundsMm | null;
}>;
export type TextSlot = Readonly<{
  source: SourceRange;
  row: number;
  boundsMm: BoundsMm;
  /** End-of-row punctuation has a separate source span while sharing the last cell. */
  sharesCell: boolean;
}>;
export type LayoutLine = Readonly<{
  block: 'title' | 'body';
  paragraphIndex: number;
  row: number;
  source: SourceRange;
  breakAfter: 'explicit' | 'wrap' | 'end';
  empty: boolean;
}>;
export type PaperLayoutPage = Readonly<{
  geometry: PageGeometry;
  lines: readonly LayoutLine[];
  slots: readonly TextSlot[];
  glyphs: readonly GlyphPlacement[];
}>;
/** T05/T06 populate this single renderer contract; this type itself is not a layout implementation. */
export type PaperLayout = Readonly<{
  versions: LayoutVersionTuple;
  mode: ContentMode;
  pages: readonly PaperLayoutPage[];
  textStyles: TrustedPaperPreset['textStyles'];
  strokes: TrustedPaperPreset['strokes'];
}>;
