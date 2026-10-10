import type { PageGeometry, PaperPreset, PointMm, SegmentMm } from "./types.js";

const roundMm = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const point = (x: number, y: number): PointMm => ({ x: roundMm(x), y: roundMm(y) });

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(field + " must be positive and finite");
}

/** Fail explicitly on impossible presets, never clip or scale incomplete cells. */
export function validatePreset(preset: PaperPreset): void {
  assertFinitePositive(preset.page.width, "page.width");
  assertFinitePositive(preset.page.height, "page.height");
  if (!preset.version) throw new RangeError("preset.version is required");
  const width = preset.kind === "square-grid"
    ? preset.cellMm * preset.columns : preset.lineLengthMm;
  const height = preset.kind === "square-grid"
    ? preset.cellMm * preset.rows
    : (preset.groupCount - 1) * (3 * preset.lineGapMm + preset.groupGapMm) + 3 * preset.lineGapMm;

  if (preset.kind === "square-grid") {
    assertFinitePositive(preset.cellMm, "cellMm");
    if (!Number.isSafeInteger(preset.rows) || preset.rows <= 0) throw new RangeError("rows must be positive integers");
    if (!Number.isSafeInteger(preset.columns) || preset.columns <= 0) throw new RangeError("columns must be positive integers");
  } else {
    assertFinitePositive(preset.lineLengthMm, "lineLengthMm");
    assertFinitePositive(preset.lineGapMm, "lineGapMm");
    assertFinitePositive(preset.groupGapMm, "groupGapMm");
    if (!Number.isSafeInteger(preset.groupCount) || preset.groupCount <= 0) throw new RangeError("groupCount must be positive integers");
  }
  if (![preset.origin.x, preset.origin.y, ...Object.values(preset.margin)].every(x => Number.isFinite(x) && x >= 0)) {
    throw new RangeError("origin and margins must be non-negative finite values");
  }
  if (Math.abs(preset.origin.x - preset.margin.left) > 1e-6 || Math.abs(preset.origin.y - preset.margin.top) > 1e-6 ||
      Math.abs(preset.origin.x + width + preset.margin.right - preset.page.width) > 1e-6 ||
      Math.abs(preset.origin.y + height + preset.margin.bottom - preset.page.height) > 1e-6) {
    throw new RangeError("complete writing area must fit inside its fixed page and margins");
  }
}

/** Produce full-page, renderer-independent line coordinates; no text or I/O. */
export function buildPageGeometry(preset: PaperPreset): PageGeometry {
  validatePreset(preset);
  const segments: SegmentMm[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number, role: SegmentMm["role"]) => {
    segments.push({ from: point(x1, y1), to: point(x2, y2), role });
  };
  const x = preset.origin.x;
  const y = preset.origin.y;
  let width: number;
  let height: number;

  if (preset.kind === "square-grid") {
    const cell = preset.cellMm;
    width = preset.columns * cell;
    height = preset.rows * cell;
    for (let col = 0; col <= preset.columns; col++) {
      add(x + col * cell, y, x + col * cell, y + height, "grid");
    }
    for (let row = 0; row <= preset.rows; row++) {
      add(x, y + row * cell, x + width, y + row * cell, "grid");
    }
    if (preset.guides !== "none") {
      for (let row = 0; row < preset.rows; row++) {
        for (let col = 0; col < preset.columns; col++) {
          const left = x + col * cell;
          const top = y + row * cell;
          add(left + cell / 2, top, left + cell / 2, top + cell, "guide");
          add(left, top + cell / 2, left + cell, top + cell / 2, "guide");
          if (preset.guides === "rice") {
            add(left, top, left + cell, top + cell, "guide");
            add(left, top + cell, left + cell, top, "guide");
          }
        }
      }
    }
  } else {
    width = preset.lineLengthMm;
    const groupStep = 3 * preset.lineGapMm + preset.groupGapMm;
    height = (preset.groupCount - 1) * groupStep + 3 * preset.lineGapMm;
    for (let group = 0; group < preset.groupCount; group++) {
      for (let line = 0; line < 4; line++) {
        const lineY = y + group * groupStep + line * preset.lineGapMm;
        add(x, lineY, x + width, lineY, "writing-line");
      }
    }
  }

  return {
    templateId: preset.id,
    templateVersion: preset.version,
    page: { ...preset.page },
    bounds: { x, y, width: roundMm(width), height: roundMm(height) },
    segments,
  };
}
