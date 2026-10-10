import { PdfRenderError } from './errors.js';

/** Read-only sfnt metadata for an already hash-pinned complete original TTF. */
export function readTtf(bytes: Uint8Array) {
  const invalid = (): never => { throw new PdfRenderError('PDF_RESOURCE_MISMATCH'); };
  if (bytes.length < 12) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x00010000) invalid();
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.length) invalid();
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;
    const name = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (offset + length > bytes.length || tables.has(name)) invalid();
    tables.set(name, { offset, length });
  }
  const table = (name: string, minimum: number) => {
    const value = tables.get(name);
    if (!value || value.length < minimum) return invalid();
    return value.offset;
  };
  const head = table('head', 54), hhea = table('hhea', 36), maxp = table('maxp', 6);
  const unitsPerEm = view.getUint16(head + 18), numGlyphs = view.getUint16(maxp + 4), hMetrics = view.getUint16(hhea + 34);
  if (!unitsPerEm || !numGlyphs || !hMetrics || hMetrics > numGlyphs) invalid();
  const hmtx = table('hmtx', hMetrics * 4 + (numGlyphs - hMetrics) * 2);
  const os2 = table('OS/2', 2), os2Record = tables.get('OS/2')!;
  const ascent = view.getInt16(hhea + 4), descent = view.getInt16(hhea + 6);
  const capHeight = view.getUint16(os2) >= 2 && os2Record.length >= 90 ? view.getInt16(os2 + 88) : ascent;
  const italicAngle = view.getInt32(table('post', 8) + 4) / 65536;
  return { unitsPerEm, numGlyphs, ascent, descent, capHeight, italicAngle,
    bbox: [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)],
    width(glyphId: number): number {
      if (!Number.isInteger(glyphId) || glyphId <= 0 || glyphId >= numGlyphs) return invalid();
      return view.getUint16(hmtx + Math.min(glyphId, hMetrics - 1) * 4) * 1000 / unitsPerEm;
    },
  };
}
