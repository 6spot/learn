import type { BoundsMm, PaperLayout, PaperLayoutPage, StrokeStylePreset } from '../../paper-core/dist/contracts.js';
import type { SegmentMm } from '../../paper-core/dist/types.js';
import type { GlyphOutline, OriginalFontMetricsProvider } from '../../font-metrics/dist/index.js';

export interface CanvasContext2D {
  fillStyle: string; strokeStyle: string; lineWidth: number;
  lineCap: string; lineJoin: string; miterLimit: number;
  save(): void; restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void; scale(x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void; setLineDash(values: number[]): void; stroke(): void; fill(): void;
}
export interface CanvasSurface { width: number; height: number; getContext(type: '2d'): CanvasContext2D | null }
export type OutlineProvider = Pick<OriginalFontMetricsProvider, 'fontBundleVersion' | 'glyphOutline'>;
export type CanvasView = Readonly<{ widthPx: number; pixelRatio: number; zoom?: number }>;
export type CanvasRenderResult = Readonly<{
  cssWidth: number; cssHeight: number; bitmapWidth: number; bitmapHeight: number;
  pageIndex: number; segmentCount: number; glyphCount: number; inkBoundsMm: BoundsMm | null;
}>;
export class CanvasRenderError extends Error {
  constructor(readonly code: 'CANVAS_INVALID_LAYOUT' | 'CANVAS_RESOURCE_MISSING' | 'CANVAS_RESOURCE_MISMATCH' |
    'CANVAS_PAGE_OUT_OF_RANGE' | 'CANVAS_UNSUPPORTED_API' | 'CANVAS_RESOURCE_LIMIT') {
    super(code); this.name = 'CanvasRenderError';
  }
}
const invalid = (): never => { throw new CanvasRenderError('CANVAS_INVALID_LAYOUT'); };
const finite = Number.isFinite;
const gray = (value: number) => {
  if (!finite(value) || value < 0 || value > 1) return invalid();
  const n = Math.round(value * 255); return `rgb(${n},${n},${n})`;
};
function union(a: BoundsMm | null, b: BoundsMm): BoundsMm {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
export function segmentInkBounds(segment: SegmentMm, style: StrokeStylePreset): BoundsMm {
  const { from, to } = segment;
  if (![from.x, from.y, to.x, to.y, style.widthMm, style.miterLimit].every(finite) ||
      style.widthMm <= 0 || style.miterLimit <= 0 || !Array.isArray(style.dashMm) ||
      !style.dashMm.every(n => finite(n) && n > 0) || !['butt', 'round', 'square'].includes(style.lineCap) ||
      !['miter', 'round', 'bevel'].includes(style.lineJoin)) return invalid();
  gray(style.gray);
  const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y), length = Math.hypot(dx, dy);
  if (length === 0) return invalid();
  const half = style.widthMm / 2;
  const extendX = style.lineCap === 'round' ? half : (dy + (style.lineCap === 'square' ? dx : 0)) / length * half;
  const extendY = style.lineCap === 'round' ? half : (dx + (style.lineCap === 'square' ? dy : 0)) / length * half;
  return { x: Math.min(from.x, to.x) - extendX, y: Math.min(from.y, to.y) - extendY,
    width: dx + extendX * 2, height: dy + extendY * 2 };
}
export function canvasDimensions(widthMm: number, heightMm: number, view: CanvasView) {
  const zoom = view.zoom ?? 1;
  if (![widthMm, heightMm, view.widthPx, view.pixelRatio, zoom].every(n => finite(n) && n > 0)) return invalid();
  const cssWidth = view.widthPx * zoom, cssHeight = cssWidth * heightMm / widthMm;
  const bitmapWidth = Math.ceil(cssWidth * view.pixelRatio), bitmapHeight = Math.ceil(cssHeight * view.pixelRatio);
  // One current page; constrain backing allocation rather than silently lowering
  // user-requested scale or creating every page's bitmap at once.
  if (bitmapWidth * bitmapHeight > 16_777_216 || bitmapWidth > 8192 || bitmapHeight > 8192) {
    throw new CanvasRenderError('CANVAS_RESOURCE_LIMIT');
  }
  return { cssWidth, cssHeight, bitmapWidth, bitmapHeight, pixelsPerMm: cssWidth / widthMm * view.pixelRatio };
}

/** Paint exactly one already-laid-out page. No font shaping, measurement or reflow. */
export function renderPaperPage(canvas: CanvasSurface, layout: PaperLayout, pageIndex: number,
  fonts: OutlineProvider | null, view: CanvasView): CanvasRenderResult {
  if (!layout || !Array.isArray(layout.pages)) return invalid();
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= layout.pages.length) throw new CanvasRenderError('CANVAS_PAGE_OUT_OF_RANGE');
  const page: PaperLayoutPage = layout.pages[pageIndex]!;
  const { width: widthMm, height: heightMm } = page.geometry.page;
  const size = canvasDimensions(widthMm, heightMm, view);
  if (!['blank', 'filled', 'tracing'].includes(layout.mode) || !Array.isArray(page.glyphs)) return invalid();
  let ink: BoundsMm | null = null;
  for (const segment of page.geometry.segments) {
    const style = layout.strokes[segment.role];
    if (!style) return invalid();
    ink = union(ink, segmentInkBounds(segment, style));
  }
  const plans: { outline: GlyphOutline; color: string }[] = [];
  if (page.glyphs.length && !fonts) throw new CanvasRenderError('CANVAS_RESOURCE_MISSING');
  if (fonts && fonts.fontBundleVersion !== layout.versions.fontBundleVersion) throw new CanvasRenderError('CANVAS_RESOURCE_MISMATCH');
  for (const glyph of page.glyphs) {
    const style = Object.values(layout.textStyles).find(item => item.id === glyph.styleId);
    if (!style || ![glyph.originMm.x, glyph.originMm.y, glyph.fontSizeMm].every(finite) || glyph.fontSizeMm <= 0) return invalid();
    const outline = fonts!.glyphOutline(glyph.fontId, glyph.glyphId);
    if (outline.glyphId !== glyph.glyphId || !finite(outline.unitsPerEm) || outline.unitsPerEm <= 0) return invalid();
    const arity = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, closePath: 0 };
    for (const item of outline.commands) {
      if (!Object.prototype.hasOwnProperty.call(arity, item.command) || item.args.length !== arity[item.command] || !item.args.every(finite)) return invalid();
    }
    const b = outline.inkBounds, actual = glyph.inkBoundsMm;
    if ((b === null) !== (actual === null)) return invalid();
    if (b && actual) {
      const factor = glyph.fontSizeMm / outline.unitsPerEm;
      const expected = { x: glyph.originMm.x + b.xMin * factor, y: glyph.originMm.y - b.yMax * factor,
        width: (b.xMax - b.xMin) * factor, height: (b.yMax - b.yMin) * factor };
      if (!Object.keys(expected).every(key => Math.abs(expected[key as keyof BoundsMm] - actual[key as keyof BoundsMm]) <= 0.000003)) return invalid();
      ink = union(ink, actual);
    }
    plans.push({ outline, color: gray(layout.mode === 'tracing' ? style.tracingGray : style.gray) });
  }
  if (ink && (!Object.values(ink).every(finite) || ink.x < 0 || ink.y < 0 || ink.x + ink.width > widthMm || ink.y + ink.height > heightMm)) return invalid();
  const context = canvas.getContext('2d');
  const methods = ['save', 'restore', 'setTransform', 'translate', 'scale', 'fillRect', 'beginPath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'setLineDash', 'stroke', 'fill'] as const;
  if (!context || methods.some(name => typeof context[name] !== 'function')) throw new CanvasRenderError('CANVAS_UNSUPPORTED_API');
  // Resource, bounds and API errors cannot clear the old bitmap or leave a
  // partial page behind. Resizing resets context state, then drawing starts.
  canvas.width = size.bitmapWidth; canvas.height = size.bitmapHeight;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, size.bitmapWidth, size.bitmapHeight);
  context.save();
  try {
    context.setTransform(size.pixelsPerMm, 0, 0, size.pixelsPerMm, 0, 0);
    for (const segment of page.geometry.segments) {
      const style = layout.strokes[segment.role];
      context.strokeStyle = gray(style.gray); context.lineWidth = style.widthMm;
      context.lineCap = style.lineCap; context.lineJoin = style.lineJoin; context.miterLimit = style.miterLimit;
      context.setLineDash([...style.dashMm]); context.beginPath();
      context.moveTo(segment.from.x, segment.from.y); context.lineTo(segment.to.x, segment.to.y); context.stroke();
    }
    context.setLineDash([]);
    for (let i = 0; i < page.glyphs.length; i++) {
      const glyph = page.glyphs[i]!, { outline, color } = plans[i]!;
      context.save();
      try {
        context.translate(glyph.originMm.x, glyph.originMm.y);
        const factor = glyph.fontSizeMm / outline.unitsPerEm;
        context.scale(factor, -factor); context.fillStyle = color; context.beginPath();
        for (const { command, args } of outline.commands) {
          switch (command) {
            case 'moveTo': context.moveTo(args[0]!, args[1]!); break;
            case 'lineTo': context.lineTo(args[0]!, args[1]!); break;
            case 'quadraticCurveTo': context.quadraticCurveTo(args[0]!, args[1]!, args[2]!, args[3]!); break;
            case 'bezierCurveTo': context.bezierCurveTo(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!); break;
            case 'closePath': context.closePath(); break;
            default: invalid();
          }
        }
        context.fill();
      } finally { context.restore(); }
    }
  } finally { context.restore(); }
  return Object.freeze({ cssWidth: size.cssWidth, cssHeight: size.cssHeight, bitmapWidth: size.bitmapWidth,
    bitmapHeight: size.bitmapHeight, pageIndex, segmentCount: page.geometry.segments.length,
    glyphCount: page.glyphs.length, inkBoundsMm: ink && Object.freeze(ink) });
}
