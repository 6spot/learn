import test from 'node:test';
import assert from 'node:assert/strict';
import { positionShapedText, PaperError, roundMm } from '../dist/index.js';

const base = () => ({
  fontId: 'synthetic-font', unitsPerEm: 1000, advanceWidth: 600, ascender: 800, descender: -200,
  glyphs: [
    { glyphId: 1, clusterStart: 0, clusterEnd: 2, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0,
      inkBounds: { xMin: 20, yMin: -20, xMax: 550, yMax: 700 } },
    { glyphId: 2, clusterStart: 0, clusterEnd: 2, xAdvance: 0, yAdvance: 0, xOffset: -400, yOffset: 100,
      inkBounds: { xMin: 0, yMin: 620, xMax: 150, yMax: 730 } },
  ],
  inkBounds: { xMin: 20, yMin: -20, xMax: 550, yMax: 830 },
});
const source = { block: 'body', start: 10, end: 12 };
const place = (shape = base(), constraint) => positionShapedText(shape, source, { x: 20, y: 30 }, 10, 'body-style', constraint);
const error = code => value => value instanceof PaperError && value.code === code;

test('font-unit shaping offsets produce exact baseline origins and y-down ink bounds once', () => {
  const glyphs = place();
  assert.deepEqual(glyphs[0].originMm, { x: 20, y: 30 });
  assert.deepEqual(glyphs[0].inkBoundsMm, { x: 20.2, y: 23, width: 5.3, height: 7.2 });
  assert.deepEqual(glyphs[1].originMm, { x: 22, y: 29 });
  assert.deepEqual(glyphs[1].inkBoundsMm, { x: 22, y: 21.7, width: 1.5, height: 1.1 });
  assert.deepEqual(glyphs[1].advanceMm, { x: 0, y: 0 });
  assert.deepEqual(glyphs.map(g => g.source), [source, source]);
  assert.equal(glyphs[1].styleId, 'body-style');
  assert.equal(glyphs[1].fontSizeMm, 10);
});

test('space has advance/source mapping but no invented ink box', () => {
  const shaped = { ...base(), advanceWidth: 250, inkBounds: null,
    glyphs: [{ glyphId: 3, clusterStart: 0, clusterEnd: 2, xAdvance: 250, yAdvance: 0, xOffset: 0, yOffset: 0, inkBounds: null }] };
  const glyph = place(shaped)[0];
  assert.equal(glyph.inkBoundsMm, null);
  assert.equal(glyph.advanceMm.x, 2.5);
});

test('glyph overflow fails instead of scaling or cropping output, including combining accents', () => {
  assert.equal(place(base(), { x: 20, y: 21.7, width: 6, height: 9 }).length, 2);
  assert.throws(() => place(base(), { x: 20, y: 23, width: 6, height: 9 }), error('GLYPH_OUT_OF_BOUNDS'));
});

test('invalid metrics, .notdef, missing source coverage and inconsistent aggregate bounds are rejected', () => {
  assert.throws(() => place(null), error('INVALID_FONT_METRICS'));
  const mutations = [
    s => { s.unitsPerEm = 0; }, s => { s.advanceWidth = 999; },
    s => { s.glyphs[0].xOffset = NaN; }, s => { s.glyphs[0].clusterEnd = 3; },
    s => { s.inkBounds.yMax = 700; }, s => { for (const g of s.glyphs) g.clusterStart = 1; },
    s => { s.glyphs[0].inkBounds = undefined; },
  ];
  for (const mutate of mutations) { const shaped = base(); mutate(shaped); assert.throws(() => place(shaped), error('INVALID_FONT_METRICS')); }
  const missing = base(); missing.glyphs[0].glyphId = 0;
  assert.throws(() => place(missing), error('MISSING_GLYPH'));
});

test('malformed glyph records and source/style bindings fail with safe structured errors', () => {
  for (const glyphs of [[null], [undefined], new Array(1), [false]]) {
    assert.throws(() => place({ ...base(), glyphs }), error('INVALID_FONT_METRICS'));
  }
  for (const badSource of [null, { ...source, block: 'untrusted' }]) {
    assert.throws(() => positionShapedText(base(), badSource, { x: 20, y: 30 }, 10, 'body'), error('INVALID_FONT_METRICS'));
  }
  assert.throws(() => positionShapedText(base(), source, null, 10, 'body'), error('INVALID_FONT_METRICS'));
  assert.throws(() => positionShapedText(base(), source, { x: 20, y: 30 }, 10, {}), error('INVALID_FONT_METRICS'));
  assert.throws(() => place({ ...base(), fontId: {} }), error('INVALID_FONT_METRICS'));
});

test('finite metrics that overflow during conversion never produce nonfinite placements', () => {
  const hugeOffset = base(); hugeOffset.glyphs[0].xOffset = Number.MAX_VALUE;
  assert.throws(() => place(hugeOffset), error('INVALID_FONT_METRICS'));
  assert.throws(() => positionShapedText(base(), source, { x: 20, y: 30 }, Number.MAX_VALUE, 'body'), error('INVALID_FONT_METRICS'));
  assert.throws(() => positionShapedText(base(), source, { x: Number.MAX_VALUE, y: 30 }, 10, 'body'), error('INVALID_FONT_METRICS'));
});

test('millimetre precision is explicit and canonicalizes negative zero', () => {
  assert.equal(roundMm(1 / 3), 0.333333);
  assert.equal(Object.is(roundMm(-1e-9), -0), false);
  for (const value of [NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => roundMm(value), error('INVALID_FONT_METRICS'));
});
