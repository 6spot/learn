export { DEFAULT_PRESETS, getDefaultPreset } from "./presets.js";
export { buildPageGeometry, validatePreset } from "./geometry.js";
export type {
  PageGeometry, PageSizeMm, InsetsMm, PaperPreset, PointMm,
  SegmentMm, StrokeRole, TemplateId, SquareGridPreset, PinyinLinesPreset,
} from "./types.js";

export { layoutSquareDocument } from "./layout.js";
export type { ContentMode, TextKind, TextPlacement, LayoutPage, DocumentLayout, SquareTextDocument, TextLayoutOptions } from "./layout.js";
