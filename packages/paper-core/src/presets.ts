import type { PaperPreset, TemplateId } from "./types.js";

/**
 * Owner-confirmed fixed V1 A4 geometry from docs/PAPER_PRESETS.md.
 * The version is a design snapshot, NOT a passed physical-print certification.
 * Server-published immutable presets will replace this built-in catalog later.
 */
export const DEFAULT_PRESETS = {
  "essay-grid": {
    kind: "square-grid", id: "essay-grid", version: "v1-design",
    page: { width: 210, height: 297 },
    origin: { x: 10, y: 13.5 },
    margin: { top: 13.5, right: 10, bottom: 13.5, left: 10 },
    cellMm: 10, columns: 19, rows: 27, guides: "none",
  },
  "tian-grid": {
    kind: "square-grid", id: "tian-grid", version: "v1-design",
    page: { width: 210, height: 297 },
    origin: { x: 15, y: 21 },
    margin: { top: 21, right: 15, bottom: 21, left: 15 },
    cellMm: 15, columns: 12, rows: 17, guides: "cross",
  },
  "mi-grid": {
    kind: "square-grid", id: "mi-grid", version: "v1-design",
    page: { width: 210, height: 297 },
    origin: { x: 15, y: 21 },
    margin: { top: 21, right: 15, bottom: 21, left: 15 },
    cellMm: 15, columns: 12, rows: 17, guides: "rice",
  },
  "pinyin-lines": {
    kind: "pinyin-lines", id: "pinyin-lines", version: "v1-design",
    page: { width: 210, height: 297 },
    origin: { x: 15, y: 25.5 },
    margin: { top: 25.5, right: 15, bottom: 25.5, left: 15 },
    lineLengthMm: 180, groupCount: 14, lineGapMm: 4, groupGapMm: 6,
  },
} as const satisfies Readonly<Record<TemplateId, PaperPreset>>;

export function getDefaultPreset(templateId: TemplateId): PaperPreset {
  return DEFAULT_PRESETS[templateId];
}
