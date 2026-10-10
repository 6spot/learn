import type { LayoutVersionTuple, PaperDocument, PaperLayout } from './contracts.js';
import { assertExecutableEngine } from './engine.js';
import { createPaperDocument } from './document.js';
import { PaperError } from './errors.js';
import type { FontMetricsProvider } from './font-metrics.js';
import { decodeProtocolData, VERSION_SCHEMA } from './protocol-data.js';
import { layoutPinyinPaperDocument } from './pinyin-layout.js';
import { layoutSquarePaperDocument } from './square-layout.js';

/** Structure only; the authenticated registry remains the source of supported tuples. */
export function validateLayoutVersions(value: unknown): LayoutVersionTuple {
  return Object.freeze(decodeProtocolData(value, VERSION_SCHEMA, 'VERSION_MISMATCH', 'versions') as LayoutVersionTuple);
}
export function assertLayoutVersionsMatch(expected: LayoutVersionTuple, actual: LayoutVersionTuple): void {
  const a = validateLayoutVersions(expected);
  const b = validateLayoutVersions(actual);
  if (a.engineVersion !== b.engineVersion || a.templateId !== b.templateId ||
    a.templateVersion !== b.templateVersion || a.fontBundleVersion !== b.fontBundleVersion) {
    throw new PaperError('VERSION_MISMATCH', { field: 'versions' });
  }
}
/** Never re-label this compiled algorithm as a retired/unknown engine. */
export function assertLayoutVersionsSupported(versions: LayoutVersionTuple, supported: readonly LayoutVersionTuple[]): void {
  const requested = validateLayoutVersions(versions);
  assertExecutableEngine(requested.engineVersion);
  const allowed = decodeProtocolData(supported, { array: VERSION_SCHEMA }, 'VERSION_MISMATCH', 'versions') as unknown as LayoutVersionTuple[];
  if (!allowed.some(value => value.engineVersion === requested.engineVersion && value.templateId === requested.templateId &&
    value.templateVersion === requested.templateVersion && value.fontBundleVersion === requested.fontBundleVersion)) {
    throw new PaperError('UNSUPPORTED_VERSION', { field: 'versions' });
  }
}

/** Single production-facing dispatch; caller supplies a registry-authenticated immutable preset. */
export function layoutPaperDocument(input: PaperDocument, metrics: FontMetricsProvider): PaperLayout {
  if (!input || typeof input !== 'object') throw new PaperError('INVALID_INPUT', { field: 'input' });
  const document = createPaperDocument(input.input, input.preset);
  assertLayoutVersionsMatch(input.versions, document.versions);
  assertExecutableEngine(document.versions.engineVersion);
  if (!metrics || metrics.fontBundleVersion !== document.versions.fontBundleVersion) {
    throw new PaperError('VERSION_MISMATCH', { field: 'versions' });
  }
  return document.preset.geometry.kind === 'pinyin-lines'
    ? layoutPinyinPaperDocument(document, metrics) : layoutSquarePaperDocument(document, metrics);
}
