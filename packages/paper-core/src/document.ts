import type {
  PaperDocument, PaperUserOptions, ResourceLimits, SourceRange, TextBlock, TextParagraph,
  TextUnit, TrustedPaperPreset, ValidatedPaperInput, TitleAlignment,
} from './contracts.js';
import { PaperError } from './errors.js';
import { DEFAULT_PRESETS } from './presets.js';
import type { TemplateId } from './types.js';
import { graphemeSegments, isWhitespace } from './unicode.js';
import { deepFreeze } from './immutable.js';

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = Object.freeze({
  maxInputCodeUnits: 100_000, maxGraphemes: 50_000, maxPages: 50,
});
const TEMPLATE_IDS = Object.keys(DEFAULT_PRESETS);
const TITLE_ALIGNMENTS = ['left', 'center', 'right'];
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function record(value: unknown, field: 'input' | 'options' | 'preset'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new PaperError(field === 'preset' ? 'INVALID_PRESET' : 'INVALID_INPUT', { field });
  }
  // Accept stable JSON data only. In particular, never invoke accessors or a
  // hidden serialization hook while validating then snapshotting a preset.
  if (Object.getOwnPropertySymbols(value).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor) || !descriptor.enumerable)) {
    throw new PaperError(field === 'preset' ? 'INVALID_PRESET' : 'INVALID_INPUT', { field });
  }
  return value as Record<string, unknown>;
}
function allowedKeys(value: Record<string, unknown>, keys: readonly string[], field: 'input' | 'options'): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new PaperError('UNKNOWN_FIELD', { field });
}
function presetKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new PaperError('INVALID_PRESET', { field: 'preset' });
  }
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function gray(value: unknown): boolean { return finite(value) && value >= 0 && value <= 1; }
function validDash(value: unknown): boolean {
  if (!Array.isArray(value) || value.length % 2 !== 0 || Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !positive(descriptor.value)) return false;
  }
  return true;
}
function id(value: unknown): value is string { return typeof value === 'string' && VERSION_ID.test(value); }
function templateId(value: unknown): value is TemplateId { return typeof value === 'string' && TEMPLATE_IDS.includes(value); }
function alignment(value: unknown): value is TitleAlignment { return typeof value === 'string' && TITLE_ALIGNMENTS.includes(value); }
function validLimits(value: unknown): value is ResourceLimits {
  const limits = record(value, 'preset');
  presetKeys(limits, ['maxInputCodeUnits', 'maxGraphemes', 'maxPages']);
  return positiveInteger(limits.maxInputCodeUnits) && positiveInteger(limits.maxGraphemes) && positiveInteger(limits.maxPages);
}

function validateSource(text: string, block: 'title' | 'body'): void {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new PaperError('INVALID_UNICODE', { block, offset: i });
      i++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new PaperError('INVALID_UNICODE', { block, offset: i });
    } else if ((code < 32 && code !== 10 && code !== 13) || (code >= 0x7F && code <= 0x9F)) {
      throw new PaperError('UNSUPPORTED_CONTROL', { block, offset: i });
    }
  }
}

/** Validate without trimming, normalizing Unicode, rewriting line endings, or truncating. */
export function validatePaperInput(raw: unknown, limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS): ValidatedPaperInput {
  if (!validLimits(limits)) throw new PaperError('INVALID_PRESET', { field: 'preset' });
  const input = record(raw, 'input');
  allowedKeys(input, ['templateId', 'title', 'body', 'tracing', 'options'], 'input');
  if (!templateId(input.templateId)) throw new PaperError('INVALID_INPUT', { field: 'templateId' });
  if (input.title !== undefined && typeof input.title !== 'string') throw new PaperError('INVALID_INPUT', { field: 'title' });
  if (input.body !== undefined && typeof input.body !== 'string') throw new PaperError('INVALID_INPUT', { field: 'body' });
  if (input.tracing !== undefined && typeof input.tracing !== 'boolean') throw new PaperError('INVALID_INPUT', { field: 'tracing' });
  const title = input.title ?? '';
  const body = input.body ?? '';
  if (title.length + body.length > limits.maxInputCodeUnits) {
    throw new PaperError('INPUT_LIMIT_EXCEEDED', { field: 'input', limit: limits.maxInputCodeUnits });
  }
  const rawOptions = input.options === undefined ? {} : record(input.options, 'options');
  allowedKeys(rawOptions, ['titleAlign', 'bodyIndent'], 'options');
  const options: { titleAlign?: TitleAlignment; bodyIndent?: 'default' | 'none' } = {};
  if (rawOptions.titleAlign !== undefined) {
    if (!alignment(rawOptions.titleAlign)) throw new PaperError('INVALID_INPUT', { field: 'titleAlign' });
    options.titleAlign = rawOptions.titleAlign;
  }
  if (rawOptions.bodyIndent !== undefined) {
    if (rawOptions.bodyIndent !== 'default' && rawOptions.bodyIndent !== 'none') throw new PaperError('INVALID_INPUT', { field: 'bodyIndent' });
    options.bodyIndent = rawOptions.bodyIndent;
  }
  validateSource(title, 'title');
  validateSource(body, 'body');
  let graphemeCount = 0;
  for (const source of [title, body]) {
    for (const _unit of graphemeSegments(source)) {
      if (++graphemeCount > limits.maxGraphemes) throw new PaperError('INPUT_LIMIT_EXCEEDED', { field: 'input', limit: limits.maxGraphemes });
    }
  }
  return Object.freeze({ templateId: input.templateId, title, body, tracing: input.tracing ?? false, options: Object.freeze(options) });
}

/** Preset input must come from an authenticated registry; this validates structure, not authority. */
export function validateTrustedPreset(raw: unknown): asserts raw is TrustedPaperPreset {
  const preset = record(raw, 'preset');
  presetKeys(preset, ['versions', 'stage', 'geometry', 'defaults', 'titleBodyGapRows', 'carrier', 'textStyles', 'strokes', 'limits']);
  const invalid = () => { throw new PaperError('INVALID_PRESET', { field: 'preset' }); };
  const versions = record(preset.versions, 'preset');
  presetKeys(versions, ['engineVersion', 'templateId', 'templateVersion', 'fontBundleVersion']);
  if (!templateId(versions.templateId) || !id(versions.engineVersion) || !id(versions.templateVersion) || !id(versions.fontBundleVersion)) invalid();
  if (preset.stage !== 'development-candidate' && preset.stage !== 'validated-release') invalid();
  const geometry = record(preset.geometry, 'preset');
  const expected = DEFAULT_PRESETS[versions.templateId as TemplateId];
  // Reject physical changes even when they would fit the page. Version is the only variable here.
  function matches(actual: unknown, baseline: unknown): boolean {
    if (baseline && typeof baseline === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
      const a = record(actual, 'preset');
      const b = baseline as Record<string, unknown>;
      return Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => matches(a[key], value));
    }
    return actual === baseline;
  }
  if (!matches(geometry, { ...expected, version: versions.templateVersion })) invalid();
  const defaults = record(preset.defaults, 'preset');
  presetKeys(defaults, ['titleAlign', 'bodyIndentUnits']);
  if (!alignment(defaults.titleAlign) || !finite(defaults.bodyIndentUnits) ||
    !Number.isSafeInteger(defaults.bodyIndentUnits) || defaults.bodyIndentUnits < 0) invalid();
  const carrier = record(preset.carrier, 'preset');
  let capacity: number;
  if (expected.kind === 'square-grid') {
    presetKeys(carrier, ['kind', 'glyphInsetMm']);
    if (carrier.kind !== 'square-grid' || !finite(carrier.glyphInsetMm) || carrier.glyphInsetMm < 0 || carrier.glyphInsetMm >= expected.cellMm / 2) invalid();
    capacity = expected.columns;
  } else {
    presetKeys(carrier, ['kind', 'baselineOffsetMm', 'indentUnitMm']);
    if (carrier.kind !== 'pinyin-lines' || !positive(carrier.baselineOffsetMm) || carrier.baselineOffsetMm >= expected.lineGapMm * 3 ||
      !positive(carrier.indentUnitMm) || carrier.indentUnitMm >= expected.lineLengthMm) invalid();
    capacity = expected.lineLengthMm / (carrier.indentUnitMm as number);
  }
  if ((defaults.bodyIndentUnits as number) >= capacity || !finite(preset.titleBodyGapRows) ||
    !Number.isSafeInteger(preset.titleBodyGapRows) || preset.titleBodyGapRows < 0) invalid();
  const textStyles = record(preset.textStyles, 'preset');
  presetKeys(textStyles, ['title', 'body']);
  const canonicalFont = expected.kind === 'pinyin-lines' ? 'misans-latin-regular' : 'misans-regular';
  const tracingFont = expected.id === 'tian-grid' || expected.id === 'mi-grid' ? 'lxgw-wenkai-gb-regular' : canonicalFont;
  for (const kind of ['title', 'body']) {
    const style = record(textStyles[kind], 'preset');
    presetKeys(style, ['id', 'canonicalFontId', 'tracingHanFontId', 'fontSizeMm', 'gray', 'tracingGray']);
    if (!id(style.id) || style.canonicalFontId !== canonicalFont || style.tracingHanFontId !== tracingFont ||
      !positive(style.fontSizeMm) || !gray(style.gray) || !gray(style.tracingGray)) invalid();
  }
  const strokes = record(preset.strokes, 'preset');
  presetKeys(strokes, ['grid', 'guide', 'writing-line']);
  for (const role of ['grid', 'guide', 'writing-line']) {
    const stroke = record(strokes[role], 'preset');
    presetKeys(stroke, ['widthMm', 'gray', 'dashMm', 'lineCap', 'lineJoin', 'miterLimit']);
    if (!positive(stroke.widthMm) || !gray(stroke.gray) || !validDash(stroke.dashMm) ||
      !['butt', 'round', 'square'].includes(stroke.lineCap as string) ||
      !['miter', 'round', 'bevel'].includes(stroke.lineJoin as string) || !positive(stroke.miterLimit)) invalid();
  }
  if (!validLimits(preset.limits)) invalid();
}

/** Empty/trailing paragraphs are real records; downstream layout must preserve their rows. */
export function parseTextBlock(sourceText: string, kind: 'title' | 'body'): TextBlock {
  if (typeof sourceText !== 'string' || (kind !== 'title' && kind !== 'body')) throw new PaperError('INVALID_INPUT', { field: 'input' });
  validateSource(sourceText, kind);
  const paragraphs: TextParagraph[] = [];
  let start = 0;
  let cursor = 0;
  const source = (a: number, b: number): SourceRange => ({ block: kind, start: a, end: b });
  function append(end: number, separator: TextParagraph['separator']): void {
    const units: TextUnit[] = [];
    for (const unit of graphemeSegments(sourceText.slice(start, end))) {
      units.push({ text: unit.segment, source: source(start + unit.index, start + unit.index + unit.segment.length) });
    }
    paragraphs.push({ index: paragraphs.length, source: source(start, end), units, separator,
      separatorSource: source(end, end + separator.length) });
  }
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === '\r' || char === '\n') {
      const separator = char === '\r' && sourceText[cursor + 1] === '\n' ? '\r\n' : char;
      append(cursor, separator);
      cursor += separator.length;
      start = cursor;
    } else cursor++;
  }
  append(sourceText.length, '');
  return deepFreeze({ kind, sourceText, paragraphs });
}

export function getDefaultTextOptions(preset: TrustedPaperPreset): PaperUserOptions {
  validateTrustedPreset(preset);
  return Object.freeze({ titleAlign: preset.defaults.titleAlign, bodyIndent: 'default' });
}

export function createPaperDocument(rawInput: unknown, trustedPreset: TrustedPaperPreset): PaperDocument {
  validateTrustedPreset(trustedPreset);
  const input = validatePaperInput(rawInput, trustedPreset.limits);
  if (input.templateId !== trustedPreset.versions.templateId) throw new PaperError('VERSION_MISMATCH', { field: 'templateId' });
  // Snapshot already validated JSON data so later registry mutation cannot change an open editor.
  const preset = deepFreeze(JSON.parse(JSON.stringify(trustedPreset)) as TrustedPaperPreset);
  return deepFreeze({ input, preset, versions: preset.versions,
    mode: isWhitespace(input.title) && isWhitespace(input.body) ? 'blank' : input.tracing ? 'tracing' : 'filled',
    options: { titleAlign: input.options.titleAlign ?? preset.defaults.titleAlign,
      bodyIndentUnits: input.options.bodyIndent === 'none' ? 0 : preset.defaults.bodyIndentUnits },
    blocks: [parseTextBlock(input.title, 'title'), parseTextBlock(input.body, 'body')],
  });
}
