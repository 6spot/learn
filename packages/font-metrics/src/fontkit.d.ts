/** Narrow verified surface of fontkit 2.0.4; Uint8Array browser API. */
declare module 'fontkit' {
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    numGlyphs: number;
    hasGlyphForCodePoint(point: number): boolean;
    getGlyph(id: number, codePoints?: number[]): Glyph;
    layout(text: string): {
      glyphs: Glyph[];
      positions: Position[];
      direction: string;
    };
  }
  export interface Position {
    xAdvance: number; yAdvance: number; xOffset: number; yOffset: number;
  }
  export interface Glyph {
    id: number;
    codePoints: number[];
    isMark: boolean;
    isLigature: boolean;
    path: {
      bbox: { minX: number; minY: number; maxX: number; maxY: number };
      commands: { command: string; args: number[] }[];
    };
  }
  export function create(bytes: Uint8Array): Font;
}

declare module 'unicode-properties' {
  export function isMark(codePoint: number): boolean;
}
