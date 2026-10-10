import {
  PDFDocument, PDFWriter, PDFName, PDFString, PDFHexString, PDFOperator, PDFOperatorNames, PDFNumber,
  type PDFContext, type PDFRef, decodeFromBase64, pushGraphicsState, popGraphicsState,
  setStrokingGrayscaleColor, setFillingGrayscaleColor, setLineWidth, setDashPattern,
  setLineCap, setLineJoin, moveTo, lineTo, stroke, beginText, endText, setFontAndSize, setTextMatrix, showText,
} from 'pdf-lib';
import { sha256 } from '@noble/hashes/sha256';
import { serializePaperLayout, PAPER_ENGINE_VERSION, type PaperLayout, type BoundsMm, type StrokeStylePreset,
  type SegmentMm } from '../../paper-core/dist/index.js';
import type { OriginalFontMetricsProvider } from '../../font-metrics/dist/index.js';
import { FONT_BUNDLE_VERSION, FONT_RESOURCES, PDF_LICENSES, FONT_LICENSE_KEYS } from './licenses.generated.js';
import { PdfRenderError, invalid } from './errors.js';
import { readTtf } from './ttf.js';

export { PdfRenderError } from './errors.js';
export type { PdfRenderErrorCode } from './errors.js';
export type PdfFontProvider = Pick<OriginalFontMetricsProvider, 'fontBundleVersion' | 'glyphOutline' | 'originalFontBytes'>;
export type PdfRenderOptions = Readonly<{ maxBytes?: number }>;
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;
export const MAX_PDF_GLYPHS = 100_000;
export const MM_TO_PDF_POINTS = 72 / 25.4;
const FONT_NAMES: Readonly<Record<string, string>> = {
  'misans-regular': 'MiSans-Regular', 'misans-latin-regular': 'MiSansLatin-Regular', 'lxgw-wenkai-gb-regular': 'LXGWWenKaiGB-Regular',
};
type FontPlan = { bytes: Uint8Array; metadata: ReturnType<typeof readTtf>; glyphIds: Set<number> };
const hash = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const insidePage = (bounds: BoundsMm, width: number, height: number) =>
  Object.values(bounds).every(Number.isFinite) && bounds.x >= -1e-6 && bounds.y >= -1e-6 && bounds.width >= 0 && bounds.height >= 0 &&
  bounds.x + bounds.width <= width + 1e-6 && bounds.y + bounds.height <= height + 1e-6;

/** Check the full cap outline, not just centerline endpoints; each segment is its own PDF path. */
function strokeInsidePage(segment: SegmentMm, style: StrokeStylePreset, width: number, height: number): boolean {
  const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy), radius = style.widthMm / 2;
  if (!length) return false;
  const normal = { x: -dy / length * radius, y: dx / length * radius };
  const extension = style.lineCap === 'square' ? { x: dx / length * radius, y: dy / length * radius } : { x: 0, y: 0 };
  for (const [point, sign] of [[segment.from, -1], [segment.to, 1]] as const) {
    if (style.lineCap === 'round') {
      if (!insidePage({ x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 }, width, height)) return false;
    } else for (const side of [-1, 1]) {
      const x = point.x + sign * extension.x + side * normal.x;
      const y = point.y + sign * extension.y + side * normal.y;
      if (!insidePage({ x, y, width: 0, height: 0 }, width, height)) return false;
    }
  }
  return true;
}

function prepare(raw: PaperLayout, provider: PdfFontProvider | null) {
  // Own a stable snapshot across async PDF attachment/writer operations. It remains invocation-local.
  const layout = JSON.parse(serializePaperLayout(raw)).layout as PaperLayout;
  if (layout.versions.engineVersion !== PAPER_ENGINE_VERSION || layout.versions.fontBundleVersion !== FONT_BUNDLE_VERSION ||
    provider && provider.fontBundleVersion !== layout.versions.fontBundleVersion) throw new PdfRenderError('PDF_RESOURCE_MISMATCH');
  const glyphCount = layout.pages.reduce((count, page) => count + page.glyphs.length, 0);
  if (layout.pages.length > MAX_PDF_PAGES || glyphCount > MAX_PDF_GLYPHS) throw new PdfRenderError('PDF_RESOURCE_LIMIT');
  if (glyphCount && !provider) throw new PdfRenderError('PDF_RESOURCE_MISSING');
  const fonts = new Map<string, FontPlan>();
  const outlines = new Map<string, { unitsPerEm: number; inkBounds: ReturnType<PdfFontProvider['glyphOutline']>['inkBounds'] }>();
  for (const page of layout.pages) {
    const { width, height } = page.geometry.page;
    if (width !== 210 || height !== 297) invalid();
    for (const segment of page.geometry.segments) if (!strokeInsidePage(segment, layout.strokes[segment.role], width, height)) invalid();
    for (const glyph of page.glyphs) {
      const style = layout.textStyles[glyph.source.block];
      if (style.id !== glyph.styleId || !(glyph.fontId === style.canonicalFontId ||
        layout.mode === 'tracing' && glyph.fontId === style.tracingHanFontId)) invalid();
      let plan = fonts.get(glyph.fontId);
      if (!plan) {
        const pin = FONT_RESOURCES.find(value => value.id === glyph.fontId);
        if (!pin) throw new PdfRenderError('PDF_RESOURCE_MISMATCH');
        const supplied = provider!.originalFontBytes(glyph.fontId);
        if (!(supplied instanceof Uint8Array) || supplied.length !== pin.bytes) {
          throw new PdfRenderError('PDF_RESOURCE_MISMATCH');
        }
        // Embed exactly the bytes that were verified, even if the provider shares a mutable cache.
        const bytes = Uint8Array.from(supplied);
        if (hash(bytes) !== pin.sha256) {
          throw new PdfRenderError('PDF_RESOURCE_MISMATCH');
        }
        plan = { bytes, metadata: readTtf(bytes), glyphIds: new Set() };
        fonts.set(glyph.fontId, plan);
      }
      plan.metadata.width(glyph.glyphId);
      plan.glyphIds.add(glyph.glyphId);
      const key = `${glyph.fontId}:${glyph.glyphId}`;
      let outline = outlines.get(key);
      if (!outline) {
        const value = provider!.glyphOutline(glyph.fontId, glyph.glyphId);
        if (value.glyphId !== glyph.glyphId || value.unitsPerEm !== plan.metadata.unitsPerEm) invalid();
        outline = { unitsPerEm: value.unitsPerEm, inkBounds: value.inkBounds };
        outlines.set(key, outline);
      }
      const ink = outline.inkBounds, actual = glyph.inkBoundsMm;
      if ((ink === null) !== (actual === null)) invalid();
      if (ink && actual) {
        const factor = glyph.fontSizeMm / outline.unitsPerEm;
        const expected = { x: glyph.originMm.x + ink.xMin * factor, y: glyph.originMm.y - ink.yMax * factor,
          width: (ink.xMax - ink.xMin) * factor, height: (ink.yMax - ink.yMin) * factor };
        if (!Object.keys(expected).every(key => Math.abs(expected[key as keyof BoundsMm] - actual[key as keyof BoundsMm]) <= 0.000003) ||
          !insidePage(actual, width, height)) invalid();
      }
    }
  }
  return { layout, fonts };
}

/** Enforce exact final serialized size before pdf-lib allocates its output Uint8Array. */
class BoundedPdfWriter extends PDFWriter {
  constructor(context: PDFContext, private readonly maxBytes: number) { super(context, Infinity); }
  protected override async computeBufferSize() {
    const info = await super.computeBufferSize();
    if (info.size > this.maxBytes) throw new PdfRenderError('PDF_RESOURCE_LIMIT');
    return info;
  }
}

function embedOriginalFont(context: PDFContext, fontId: string, plan: FontPlan, maxBytes: number): PDFRef {
  const { metadata, bytes } = plan;
  const file = context.flateStream(bytes, { Length1: bytes.length });
  if (file.getContentsSize() > maxBytes) throw new PdfRenderError('PDF_RESOURCE_LIMIT');
  const fontFile = context.register(file);
  const scale = 1000 / metadata.unitsPerEm;
  const fontName = FONT_NAMES[fontId]!;
  const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: fontName,
    Flags: 4, FontBBox: metadata.bbox.map(value => value * scale), ItalicAngle: metadata.italicAngle,
    Ascent: metadata.ascent * scale, Descent: metadata.descent * scale, CapHeight: metadata.capHeight * scale,
    StemV: 80, FontFile2: fontFile }));
  const widths = [...plan.glyphIds].sort((a, b) => a - b).flatMap(id => [id, [metadata.width(id)]]);
  const descendant = context.register(context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: fontName,
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: descriptor, CIDToGIDMap: 'Identity', DW: 1000, W: widths }));
  return context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: fontName,
    Encoding: 'Identity-H', DescendantFonts: [descendant] }));
}

/** Render already positioned glyph IDs, never user text. No I/O, reshaping, reflow or font subsetting. */
export async function renderPdf(raw: PaperLayout, provider: PdfFontProvider | null, options: PdfRenderOptions = {}): Promise<Uint8Array> {
  try {
    const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PDF_BYTES) throw new PdfRenderError('PDF_RESOURCE_LIMIT');
    const { layout, fonts } = prepare(raw, provider);
    const document = await PDFDocument.create({ updateMetadata: false });
    document.setTitle('Learn A4 paper');
    document.setCreator('Learn');
    document.setProducer('Learn PDF renderer / pdf-lib 1.17.1');
    document.setSubject(fonts.size ? `Fonts: ${[...fonts.keys()].sort().map(id => FONT_NAMES[id]).join(', ')}. Original font licenses are attached.` : 'Learn A4 practice paper');
    const fontRefs = new Map<string, { name: PDFName; ref: PDFRef }>();
    for (const [id, plan] of [...fonts.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
      fontRefs.set(id, { name: PDFName.of(`F${fontRefs.size + 1}`), ref: embedOriginalFont(document.context, id, plan, maxBytes) });
    }
    const licenseKeys = new Set([...fonts.keys()].map(id => FONT_LICENSE_KEYS[id]));
    for (const license of PDF_LICENSES) if (licenseKeys.has(license.key)) {
      await document.attach(decodeFromBase64(license.base64), license.fileName,
        { mimeType: license.mimeType, description: 'Original font license retained by Learn' });
    }
    const point = (value: number) => value * MM_TO_PDF_POINTS;
    const caps = { butt: 0, round: 1, square: 2 } as const;
    const joins = { miter: 0, round: 1, bevel: 2 } as const;
    for (const source of layout.pages) {
      const page = document.addPage([point(210), point(297)]);
      for (const value of fontRefs.values()) page.node.setFontDictionary(value.name, value.ref);
      for (const segment of source.geometry.segments) {
        const style = layout.strokes[segment.role];
        page.pushOperators(pushGraphicsState(), setStrokingGrayscaleColor(style.gray), setLineWidth(point(style.widthMm)),
          setLineCap(caps[style.lineCap]), setLineJoin(joins[style.lineJoin]),
          PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [PDFNumber.of(style.miterLimit)]),
          setDashPattern(style.dashMm.map(point), 0), moveTo(point(segment.from.x), point(297 - segment.from.y)),
          lineTo(point(segment.to.x), point(297 - segment.to.y)), stroke(), popGraphicsState());
      }
      for (const glyph of source.glyphs) {
        const style = layout.textStyles[glyph.source.block];
        const font = fontRefs.get(glyph.fontId)!;
        page.pushOperators(pushGraphicsState(), beginText(), setFillingGrayscaleColor(layout.mode === 'tracing' ? style.tracingGray : style.gray),
          setFontAndSize(font.name, point(glyph.fontSizeMm)),
          setTextMatrix(1, 0, 0, 1, point(glyph.originMm.x), point(297 - glyph.originMm.y)),
          showText(PDFHexString.of(glyph.glyphId.toString(16).padStart(4, '0'))), endText(), popGraphicsState());
      }
    }
    await document.flush();
    const bytes = await new BoundedPdfWriter(document.context, maxBytes).serializeToBuffer();
    if (bytes.length > maxBytes) throw new PdfRenderError('PDF_RESOURCE_LIMIT');
    return bytes;
  } catch (error) {
    if (error instanceof PdfRenderError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'FONT_RESOURCE_MISSING') throw new PdfRenderError('PDF_RESOURCE_MISSING');
    if (code === 'FONT_RESOURCE_INVALID' || code === 'FONT_BUNDLE_UNSUPPORTED') throw new PdfRenderError('PDF_RESOURCE_MISMATCH');
    if (code === 'INVALID_LAYOUT') throw new PdfRenderError('PDF_INVALID_LAYOUT');
    throw new PdfRenderError('PDF_RENDER_FAILED');
  }
}
