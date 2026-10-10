import type { FontInkBounds } from '../../paper-core/dist/font-metrics.js';

type Command = Readonly<{ command: string; args: readonly number[] }>;

/** Exact curve extrema. Direct quadratics avoid fontkit's unstable conversion to
 * an almost-quadratic cubic (observed on 25 LXGW GB glyphs). No sampling/cbox. */
export function outlineBounds(commands: readonly Command[]): FontInkBounds | null {
  if (commands.length === 0) return null;
  let x = 0, y = 0, startX = 0, startY = 0;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  function point(px: number, py: number): void {
    xMin = Math.min(xMin, px); yMin = Math.min(yMin, py);
    xMax = Math.max(xMax, px); yMax = Math.max(yMax, py);
  }
  function quadratic(a: number, b: number, c: number): number[] {
    const denominator = a - 2 * b + c;
    return denominator === 0 ? [] : [(a - b) / denominator];
  }
  function cubic(a: number, b: number, c: number, d: number): number[] {
    const A = -a + 3 * b - 3 * c + d;
    const B = 2 * (a - 2 * b + c);
    const C = b - a;
    const epsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    if (Math.abs(A) <= epsilon) return Math.abs(B) <= epsilon ? [] : [-C / B];
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) return [];
    const q = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(discriminant));
    return q === 0 ? [-B / (2 * A)] : [q / A, C / q];
  }
  for (const { command, args } of commands) {
    if (command === 'moveTo' || command === 'lineTo') {
      [x, y] = args as [number, number];
      if (command === 'moveTo') { startX = x; startY = y; }
      point(x, y);
    } else if (command === 'quadraticCurveTo') {
      const [cx, cy, endX, endY] = args as [number, number, number, number];
      point(x, y); point(endX, endY);
      for (const t of [...quadratic(x, cx, endX), ...quadratic(y, cy, endY)]) {
        if (t > 0 && t < 1) {
          const s = 1 - t;
          point(s * s * x + 2 * s * t * cx + t * t * endX,
            s * s * y + 2 * s * t * cy + t * t * endY);
        }
      }
      x = endX; y = endY;
    } else if (command === 'bezierCurveTo') {
      const [c1x, c1y, c2x, c2y, endX, endY] = args as [number, number, number, number, number, number];
      point(x, y); point(endX, endY);
      for (const t of [...cubic(x, c1x, c2x, endX), ...cubic(y, c1y, c2y, endY)]) {
        if (t > 0 && t < 1) {
          const s = 1 - t;
          point(s ** 3 * x + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t ** 3 * endX,
            s ** 3 * y + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t ** 3 * endY);
        }
      }
      x = endX; y = endY;
    } else if (command === 'closePath') {
      point(startX, startY); x = startX; y = startY;
    } else {
      throw new Error('INVALID_OUTLINE_COMMAND');
    }
  }
  return Object.freeze({ xMin, yMin, xMax, yMax });
}
