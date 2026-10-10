import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageGeometry, getDefaultPreset, validatePreset } from '../dist/index.js';

for (const [id, width, height, lineCount] of [
  ['essay-grid', 190, 270, 48],
  ['tian-grid', 180, 255, 439],
  ['mi-grid', 180, 255, 847],
  ['pinyin-lines', 180, 246, 56],
]) {
  test(id + ': full fixed A4 geometry', () => {
    const p = getDefaultPreset(id);
    const result = buildPageGeometry(p);
    assert.deepEqual(result.page, { width: 210, height: 297 });
    assert.deepEqual([result.bounds.width, result.bounds.height], [width, height]);
    assert.equal(result.segments.length, lineCount);
    assert.equal(result.templateVersion, 'v1-design');
    for (const line of result.segments) {
      for (const pt of [line.from, line.to]) {
        assert.ok(pt.x >= result.bounds.x && pt.x <= result.bounds.x + width, 'x bounds');
        assert.ok(pt.y >= result.bounds.y && pt.y <= result.bounds.y + height, 'y bounds');
      }
    }
  });
}

test('pinyin: exactly fourteen 4-line groups with 4mm within and 6mm between', () => {
  const result = buildPageGeometry(getDefaultPreset('pinyin-lines'));
  const starts = [0, 4, 8, 12, 18, 22, 26, 30];
  assert.deepEqual(result.segments.slice(0, 8).map(x => x.from.y), starts.map(y => y + 25.5));
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
