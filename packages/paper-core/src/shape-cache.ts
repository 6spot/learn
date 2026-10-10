import type { SourceRange } from './contracts.js';
import { PaperError } from './errors.js';
import type { FontMetricsProvider, ShapedText } from './font-metrics.js';
import { positionShapedText } from './glyph-placement.js';

function providerFailure(failure: unknown, source: SourceRange): never {
  if (failure instanceof PaperError) throw failure;
  const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined;
  const details = { block: source.block, offset: source.start };
  if (code === 'FONT_GLYPH_MISSING') throw new PaperError('MISSING_GLYPH', details);
  if (code === 'FONT_TEXT_UNSUPPORTED' || code === 'FONT_SHAPING_UNSUPPORTED') throw new PaperError('UNSUPPORTED_TEXT', details);
  if (code === 'FONT_RESOURCE_MISSING' || code === 'FONT_ID_UNSUPPORTED') throw new PaperError('FONT_RESOURCE_MISSING', { field: 'font' });
  if (code === 'FONT_RESOURCE_INVALID') throw new PaperError('FONT_INTEGRITY_FAILED', { field: 'font' });
  if (code === 'FONT_BUNDLE_UNSUPPORTED') throw new PaperError('VERSION_MISMATCH', { field: 'versions' });
  throw new PaperError('INVALID_FONT_METRICS', { field: 'font' });
}

/** One invocation, one validated cache; never persist source text. */
export function createShapeCache(metrics: FontMetricsProvider) {
  // Per-invocation cache only; it is discarded with this call and never persisted/logged.
  const shapes = new Map<string, ShapedText>();
  function shape(fontId: string, token: Readonly<{ text: string; source: SourceRange }>): ShapedText {
    const key = `${fontId}\0${token.text}`;
    let shaped = shapes.get(key);
    if (!shaped) {
      try {
        shaped = metrics.shape(fontId, token.text);
        if (shaped.fontId !== fontId) throw new PaperError('INVALID_FONT_METRICS', { field: 'font' });
        // Validate once before trusting advances for pagination; no guessed dimensions.
        positionShapedText(shaped, token.source, { x: 0, y: 0 }, 1, 'metrics-validation');
      } catch (failure) { return providerFailure(failure, token.source); }
      shapes.set(key, shaped);
    }
    return shaped;
  }
  return shape;
}
