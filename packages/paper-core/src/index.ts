export { DEFAULT_PRESETS, getDefaultPreset } from "./presets.js";
export { buildPageGeometry, validatePreset } from "./geometry.js";
export type {
  PageGeometry, PageSizeMm, InsetsMm, PaperPreset, PointMm,
  SegmentMm, StrokeRole, TemplateId, SquareGridPreset, PinyinLinesPreset,
} from "./types.js";

export { layoutSquareDocument } from "./layout.js";
export type { ContentMode, TextKind, TextPlacement, LayoutPage, DocumentLayout, SquareTextDocument, TextLayoutOptions } from "./layout.js";
export type { FontMetricsProvider, ShapedText, GlyphMetrics, FontInkBounds } from './font-metrics.js';
export type {
  PaperInput, PaperUserOptions, ValidatedPaperInput, TitleAlignment, BodyIndent, LayoutVersionTuple,
  ResourceLimits, TextStylePreset, StrokeStylePreset, TextCarrier, TrustedPaperPreset,
  SourceRange, TextUnit, TextParagraph, TextBlock, ResolvedTextOptions, PaperDocument,
  BoundsMm, GlyphPlacement, TextSlot, LayoutLine, PaperLayoutPage, PaperLayout,
} from './contracts.js';
export { PaperError, safePaperFailure } from './errors.js';
export type { PaperErrorCode, PaperErrorDetails } from './errors.js';
export { validatePaperInput, validateTrustedPreset, parseTextBlock, createPaperDocument, getDefaultTextOptions, DEFAULT_RESOURCE_LIMITS } from './document.js';
export { getDevelopmentPreset, DEVELOPMENT_ENGINE_VERSION, DEVELOPMENT_FONT_BUNDLE_VERSION } from './development-presets.js';
export { graphemeSegments, GRAPHEME_IMPLEMENTATION, isWhitespace } from './unicode.js';
export { positionShapedText, containsInk, roundMm } from './glyph-placement.js';
