import type { StrokeStylePreset, TextStylePreset, TrustedPaperPreset } from './contracts.js';
import { DEFAULT_RESOURCE_LIMITS, validateTrustedPreset } from './document.js';
import { DEFAULT_PRESETS } from './presets.js';
import type { TemplateId } from './types.js';
import { deepFreeze } from './immutable.js';
import { PaperError } from './errors.js';

export const DEVELOPMENT_ENGINE_VERSION = 'learn-engine-dev.1';
export const DEVELOPMENT_FONT_BUNDLE_VERSION = 'learn-fonts-2026-10-10-candidate.1';

/** Local render-development candidates only. Publishing requires T10/T12 verification. */
export function getDevelopmentPreset(templateId: TemplateId): TrustedPaperPreset {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PRESETS, templateId)) throw new PaperError('INVALID_INPUT', { field: 'templateId' });
  const geometry = DEFAULT_PRESETS[templateId];
  if (!geometry) throw new PaperError('INVALID_INPUT', { field: 'templateId' });
  const templateVersion = 'v1-development.1';
  const canonicalFontId = templateId === 'pinyin-lines' ? 'misans-latin-regular' : 'misans-regular';
  const tracingHanFontId = templateId === 'tian-grid' || templateId === 'mi-grid' ? 'lxgw-wenkai-gb-regular' : canonicalFontId;
  const fontSizeMm = templateId === 'essay-grid' ? 7 : templateId === 'pinyin-lines' ? 8 : 10.5;
  const style = (kind: 'title' | 'body'): TextStylePreset => ({
    id: `${templateId}-${kind}-dev.1`, canonicalFontId, tracingHanFontId, fontSizeMm, gray: 0, tracingGray: 0.65,
  });
  const stroke = (guide: boolean): StrokeStylePreset => ({
    widthMm: guide ? 0.1 : 0.2, gray: guide ? 0.75 : 0.55,
    dashMm: guide ? [2, 2] : [], lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  });
  const preset: TrustedPaperPreset = {
    versions: { engineVersion: DEVELOPMENT_ENGINE_VERSION, templateId, templateVersion, fontBundleVersion: DEVELOPMENT_FONT_BUNDLE_VERSION },
    stage: 'development-candidate', geometry: { ...geometry, version: templateVersion,
      page: { ...geometry.page }, origin: { ...geometry.origin }, margin: { ...geometry.margin } },
    defaults: { titleAlign: 'center', bodyIndentUnits: 2 }, titleBodyGapRows: 1,
    carrier: geometry.kind === 'square-grid' ? { kind: 'square-grid', glyphInsetMm: 0.5 }
      : { kind: 'pinyin-lines', baselineOffsetMm: 8, indentUnitMm: 4 },
    textStyles: { title: style('title'), body: style('body') },
    strokes: { grid: stroke(false), guide: stroke(true), 'writing-line': stroke(false) },
    limits: DEFAULT_RESOURCE_LIMITS,
  };
  validateTrustedPreset(preset);
  return deepFreeze(preset);
}
