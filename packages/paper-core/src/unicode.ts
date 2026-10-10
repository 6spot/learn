import { graphemeSegments } from 'unicode-segmenter/grapheme';

/** Pinned with the engine version; never select a different native/fallback algorithm. */
export const GRAPHEME_IMPLEMENTATION = 'unicode-segmenter@0.17.3';
export { graphemeSegments };

/** Stable ECMAScript whitespace set; does not depend on host Unicode property support. */
export function isWhitespace(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (!(cp === 9 || cp === 10 || cp === 11 || cp === 12 || cp === 13 || cp === 32 || cp === 0xA0 ||
      cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200A) || cp === 0x2028 || cp === 0x2029 ||
      cp === 0x202F || cp === 0x205F || cp === 0x3000 || cp === 0xFEFF)) return false;
  }
  return true;
}
