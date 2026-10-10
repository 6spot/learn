import { sha256 } from '@noble/hashes/sha256';
import type { PaperLayout } from './contracts.js';
import { PaperError } from './errors.js';
import { decodeProtocolData, VERSION_SCHEMA, type Schema } from './protocol-data.js';

export const LAYOUT_PROTOCOL_VERSION = 'learn-layout-v1';
export const LAYOUT_DIGEST_PREFIX = `${LAYOUT_PROTOCOL_VERSION}:sha256:`;
export const LAYOUT_PRECISION_MM = 0.000001;
const point: Schema = { record: { x: 'finite', y: 'finite' } };
const bounds: Schema = { record: { x: 'finite', y: 'finite', width: 'nonnegative', height: 'nonnegative' } };
const source: Schema = { record: { block: { enum: ['title', 'body'] }, start: 'integer', end: 'integer' } };
const stroke: Schema = { record: { widthMm: 'positive', gray: 'nonnegative', dashMm: { array: 'positive' },
  lineCap: { enum: ['butt', 'round', 'square'] }, lineJoin: { enum: ['miter', 'round', 'bevel'] }, miterLimit: 'positive' } };
const textStyle: Schema = { record: { id: 'id', canonicalFontId: 'id', tracingHanFontId: 'id',
  fontSizeMm: 'positive', gray: 'nonnegative', tracingGray: 'nonnegative' } };
const LAYOUT_SCHEMA: Schema = { record: {
  versions: VERSION_SCHEMA,
  mode: { enum: ['blank', 'filled', 'tracing'] },
  textStyles: { record: { title: textStyle, body: textStyle } },
  strokes: { record: { grid: stroke, guide: stroke, 'writing-line': stroke } },
  pages: { array: { record: {
    geometry: { record: {
      templateId: { enum: ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'] }, templateVersion: 'id',
      page: { record: { width: 'positive', height: 'positive' } }, bounds,
      segments: { array: { record: { from: point, to: point, role: { enum: ['grid', 'guide', 'writing-line'] } } } },
    } },
    lines: { array: { record: { block: { enum: ['title', 'body'] }, paragraphIndex: 'integer', row: 'integer', source,
      breakAfter: { enum: ['explicit', 'wrap', 'end'] }, empty: 'boolean' } } },
    slots: { array: { record: { source, row: 'integer', boundsMm: bounds, sharesCell: 'boolean' } } },
    glyphs: { array: { record: { source, fontId: 'id', glyphId: 'positive-integer', styleId: 'id', fontSizeMm: 'positive',
      originMm: point, advanceMm: point, inkBoundsMm: { nullable: bounds } } } },
  } } },
} };

/** Canonical ASCII JSON; coordinates stay at core precision, no renderer or host rounding. */
export function serializePaperLayout(layout: PaperLayout): string {
  const data = decodeProtocolData(layout, LAYOUT_SCHEMA, 'INVALID_LAYOUT', 'layout') as unknown as PaperLayout;
  const invalid = (): never => { throw new PaperError('INVALID_LAYOUT', { field: 'layout' }); };
  if (!data.pages.length) invalid();
  if (data.textStyles.title.id === data.textStyles.body.id) invalid();
  for (const style of [data.textStyles.title, data.textStyles.body]) {
    if (style.gray > 1 || style.tracingGray > 1) invalid();
  }
  for (const style of Object.values(data.strokes)) if (style.gray > 1 || style.dashMm.length % 2 !== 0) invalid();
  for (const page of data.pages) {
    if (page.geometry.templateId !== data.versions.templateId || page.geometry.templateVersion !== data.versions.templateVersion) invalid();
    for (const value of [...page.lines, ...page.slots, ...page.glyphs]) if (value.source.start > value.source.end) invalid();
    for (const glyph of page.glyphs) {
      if (glyph.source.start === glyph.source.end || glyph.styleId !== data.textStyles[glyph.source.block].id) invalid();
    }
  }
  // The wrapper is itself in ASCII key order. No raw title/body text occurs in this contract.
  return JSON.stringify({ layout: data, protocol: LAYOUT_PROTOCOL_VERSION });
}

/** SHA-256 receives bytes only; no native TextEncoder/Buffer/crypto branch is used. */
export function createLayoutDigest(layout: PaperLayout): string {
  const serialized = serializePaperLayout(layout);
  const bytes = new Uint8Array(serialized.length);
  for (let index = 0; index < serialized.length; index++) bytes[index] = serialized.charCodeAt(index);
  const digest = sha256(bytes);
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return `${LAYOUT_DIGEST_PREFIX}${hex}`;
}
export function validateLayoutDigest(value: unknown): string {
  if (typeof value !== 'string' || value.length !== LAYOUT_DIGEST_PREFIX.length + 64 || !/^learn-layout-v1:sha256:[a-f0-9]{64}$/.test(value)) {
    throw new PaperError('LAYOUT_DIGEST_INVALID', { field: 'layout' });
  }
  return value;
}
export function assertLayoutDigestMatches(layout: PaperLayout, expected: string): void {
  validateLayoutDigest(expected);
  if (createLayoutDigest(layout) !== expected) throw new PaperError('LAYOUT_DIGEST_MISMATCH', { field: 'layout' });
}
