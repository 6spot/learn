import { GRAPHEME_IMPLEMENTATION } from '../../paper-core/src/index.js';

export type RuntimeCapabilities = Readonly<{
  intlSegmenter: boolean;
  unicodePropertyEscapes: boolean;
  arrayAt: boolean;
  graphemeImplementation: string;
  textLayoutSupported: boolean;
}>;

/** Native probes only; never install a semantically different segmentation fallback. */
export function probeRuntimeCapabilities(): RuntimeCapabilities {
  let intlSegmenter = false;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
      const units = Array.from(segmenter.segment('e\u0301👨‍👩‍👧‍👦'), unit => unit.segment);
      intlSegmenter = units.length === 2 && units[0] === 'e\u0301' && units[1] === '👨‍👩‍👧‍👦';
    }
  } catch { /* A present but broken implementation is unsupported. */ }
  let unicodePropertyEscapes = false;
  try {
    unicodePropertyEscapes = new RegExp('^\\p{Script=Han}$', 'u').test('春') &&
      new RegExp('^\\p{M}$', 'u').test('\u0301') && new RegExp('^\\p{Cc}$', 'u').test('\t');
  } catch { /* Constructor avoids a syntax error at module load in older engines. */ }
  const arrayAt = typeof Array.prototype.at === 'function';
  return { intlSegmenter, unicodePropertyEscapes, arrayAt, graphemeImplementation: GRAPHEME_IMPLEMENTATION,
    textLayoutSupported: unicodePropertyEscapes };
}
