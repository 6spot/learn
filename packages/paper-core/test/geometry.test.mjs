import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageGeometry, getDefaultPreset, validatePreset } from '../dist/index.js';

// D-038: these are fixed centerline measurements, not rendered ink bounds.
for (const [id, x, y, width, height, lineCount] of [
  ['essay-grid', 10, 13.5, 190, 270, 48],
  ['tian-grid', 15, 21, 180, 255, 439],
  ['mi-grid', 15, 21, 180, 255, 847],
  ['pinyin-lines', 15, 25.5, 180, 246, 56],
]) {
  test(id + ': full fixed A4 centerline geometry', () => {
    const p = getDefaultPreset(id);
    const result = buildPageGeometry(p);
    assert.deepEqual(result.page, { width: 210, height: 297 });
    assert.deepEqual(result.bounds, { x, y, width, height });
    assert.deepEqual(p.margin, { top: y, right: 210 - x - width, bottom: 297 - y - height, left: x });
    assert.equal(result.segments.length, lineCount);
    assert.equal(result.templateVersion, 'v1-design');
    if (id !== 'pinyin-lines') {
      const cell = id === 'essay-grid' ? 10 : 15;
      const grid = result.segments.filter(line => line.role === 'grid');
      const vertical = grid.filter(line => line.from.x === line.to.x);
      const horizontal = grid.filter(line => line.from.y === line.to.y);
      assert.deepEqual(vertical.map(line => [line.from.x, line.from.y, line.to.x, line.to.y]),
        Array.from({ length: width / cell + 1 }, (_, col) => [x + col * cell, y, x + col * cell, y + height]));
      assert.deepEqual(horizontal.map(line => [line.from.x, line.from.y, line.to.x, line.to.y]),
        Array.from({ length: height / cell + 1 }, (_, row) => [x, y + row * cell, x + width, y + row * cell]));
    }
    for (const line of result.segments) {
      for (const pt of [line.from, line.to]) {
        assert.ok(pt.x >= result.bounds.x && pt.x <= result.bounds.x + width, 'x bounds');
        assert.ok(pt.y >= result.bounds.y && pt.y <= result.bounds.y + height, 'y bounds');
      }
    }
  });
}

test('pinyin: fourteen fixed groups with 4mm and 6mm centerline spacing', () => {
  const result = buildPageGeometry(getDefaultPreset('pinyin-lines'));
  for (let group = 0; group < 14; group++) {
    const lines = result.segments.slice(group * 4, group * 4 + 4);
    const top = 25.5 + group * 18;
    assert.deepEqual(lines.map(line => [line.from.x, line.from.y, line.to.x, line.to.y]),
      [0, 4, 8, 12].map(offset => [15, top + offset, 195, top + offset]));
    if (group > 0) {
      assert.equal(lines[0].from.y - result.segments[group * 4 - 1].from.y, 6);
    }
  }
  assert.equal(result.segments.at(-1).from.y, 271.5);
});

test('all geometry is deterministic and no preset gets mutated', () => {
  for (const id of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const p = getDefaultPreset(id);
    const original = JSON.stringify(p);
    assert.deepEqual(buildPageGeometry(p), buildPageGeometry(p));
    assert.equal(JSON.stringify(p), original);
  }
});

test('reject invalid geometry instead of clipping or shrinking cells', () => {
  assert.throws(() => validatePreset({ ...getDefaultPreset('essay-grid'), columns: 20 }), RangeError);
  assert.throws(() => validatePreset({ ...getDefaultPreset('tian-grid'), rows: 17.5 }), RangeError);
  assert.throws(() => validatePreset({ ...getDefaultPreset('pinyin-lines'), groupGapMm: 100 }), RangeError);
});
