import { graphemeSegments } from '../dist/index.js';

/** Test-only measurable outlines. A deliberately wider tracing face catches accidental reflow. */
export const syntheticFont = {
  fontBundleVersion: 'learn-fonts-2026-10-10-candidate.1',
  shape(fontId, text) {
    const glyphs = [];
    let pen = 0;
    let inkBounds = null;
    for (const { segment, index } of graphemeSegments(text)) {
      const cp = segment.codePointAt(0);
      const han = cp >= 0x3400;
      const advance = segment === ' ' ? 300 : han ? fontId === 'lxgw-wenkai-gb-regular' ? 1200 : 1000 : segment[0] === 'W' ? 900 : segment[0] === 'i' ? 250 : 600;
      const ink = segment === ' ' ? null : { xMin: 0, yMin: 0, xMax: advance, yMax: segment.length > 1 ? 900 : 800 };
      glyphs.push({ glyphId: cp + 1, clusterStart: index, clusterEnd: index + segment.length,
        xAdvance: advance, yAdvance: 0, xOffset: 0, yOffset: 0, inkBounds: ink });
      if (ink) inkBounds = { xMin: 0, yMin: 0, xMax: pen + ink.xMax, yMax: Math.max(inkBounds?.yMax ?? 0, ink.yMax) };
      pen += advance;
    }
    return { fontId, unitsPerEm: 1000, advanceWidth: pen, ascender: 1000, descender: -200, glyphs, inkBounds };
  },
};
