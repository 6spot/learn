/** Coordinates and dimensions are millimetres from the A4 page's top-left. */
export type PointMm = Readonly<{ x: number; y: number }>;
export type PageSizeMm = Readonly<{ width: number; height: number }>;
export type InsetsMm = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export type TemplateId = "essay-grid" | "tian-grid" | "mi-grid" | "pinyin-lines";

export type SquareGridPreset = Readonly<{
  kind: "square-grid";
  id: Exclude<TemplateId, "pinyin-lines">;
  version: string;
  page: PageSizeMm;
  origin: PointMm;
  margin: InsetsMm;
  cellMm: number;
  rows: number;
  columns: number;
  guides: "none" | "cross" | "rice";
}>;

export type PinyinLinesPreset = Readonly<{
  kind: "pinyin-lines";
  id: "pinyin-lines";
  version: string;
  page: PageSizeMm;
  origin: PointMm;
  margin: InsetsMm;
  lineLengthMm: number;
  groupCount: number;
  lineGapMm: number;
  groupGapMm: number;
}>;

export type PaperPreset = SquareGridPreset | PinyinLinesPreset;

/** Renderers choose stroke weight and colour from a versioned style preset. */
export type StrokeRole = "grid" | "guide" | "writing-line";
export type SegmentMm = Readonly<{
  from: PointMm;
  to: PointMm;
  role: StrokeRole;
}>;

/** Geometry only: text, font shaping and page breaking are separate stages. */
export type PageGeometry = Readonly<{
  templateId: TemplateId;
  templateVersion: string;
  page: PageSizeMm;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  segments: readonly SegmentMm[];
}>;
