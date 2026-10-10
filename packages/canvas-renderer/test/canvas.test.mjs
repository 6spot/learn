import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canvasDimensions, renderPaperPage, segmentInkBounds } from '../dist/index.js';
import { createPaperDocument, getDevelopmentPreset, buildPageGeometry, layoutPaperDocument, createLayoutDigest } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';

export function surface() {
  const calls = [];
  const context = { fillStyle: '', strokeStyle: '' };
  for (const name of ['save', 'restore', 'setTransform', 'translate', 'scale', 'fillRect', 'beginPath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'setLineDash', 'stroke', 'fill']) {
    context[name] = (...args) => calls.push({ name, args, fill: context.fillStyle, stroke: context.strokeStyle });
  }
  return { width: 1, height: 1, calls, getContext: () => context };
}
function blank(templateId) {
  const p = getDevelopmentPreset(templateId);
  return { versions: p.versions, mode: 'blank', textStyles: p.textStyles, strokes: p.strokes,
    pages: [{ geometry: buildPageGeometry(p.geometry), glyphs: [], slots: [], lines: [] }] };
}
const view = { widthPx: 315, pixelRatio: 2 };
test('four complete blank templates paint every original segment without clipping or text measurement', () => {
  for (const id of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const canvas = surface(), layout = blank(id), before = JSON.stringify(layout);
    const result = renderPaperPage(canvas, layout, 0, null, view);
    assert.equal(result.segmentCount, layout.pages[0].geometry.segments.length);
    assert.equal(canvas.calls.filter(c => c.name === 'stroke').length, result.segmentCount);
    assert.equal(result.glyphCount, 0);
    assert.equal(JSON.stringify(layout), before);
    assert.equal(result.cssHeight, 445.5);
    assert.deepEqual([canvas.width, canvas.height], [630, 891]);
    const moves = canvas.calls.filter(c => c.name === 'moveTo');
    assert.deepEqual(moves.map(c => c.args), layout.pages[0].geometry.segments.map(s => [s.from.x, s.from.y]));
    assert.ok(result.inkBoundsMm.x < layout.pages[0].geometry.bounds.x || id === 'pinyin-lines');
  }
});
test('DPR and zoom change transforms and backing dimensions, never millimetre path coordinates', () => {
  const layout = blank('mi-grid');
  const a = surface(), b = surface();
  renderPaperPage(a, layout, 0, null, view);
  renderPaperPage(b, layout, 0, null, { ...view, pixelRatio: 3, zoom: 1.5 });
  const paths = canvas => canvas.calls.filter(c => ['moveTo', 'lineTo'].includes(c.name));
  assert.deepEqual(paths(a), paths(b));
  assert.equal(b.width, Math.ceil(315 * 1.5 * 3));
  assert.deepEqual(a.calls.filter(c => c.name === 'setTransform')[1].args, [3, 0, 0, 3, 0, 0]);
  assert.deepEqual(b.calls.filter(c => c.name === 'setTransform')[1].args, [6.75, 0, 0, 6.75, 0, 0]);
});
test('cap-aware ink accounts for diagonal, round and square ends and does not crop dashed lines', () => {
  const style = { widthMm: 2, gray: 0, dashMm: [2, 2], lineCap: 'butt', lineJoin: 'miter', miterLimit: 10 };
  const horizontal = { from: { x: 10, y: 10 }, to: { x: 20, y: 10 }, role: 'grid' };
  assert.deepEqual(segmentInkBounds(horizontal, style), { x: 10, y: 9, width: 10, height: 2 });
  assert.deepEqual(segmentInkBounds(horizontal, { ...style, lineCap: 'round' }), { x: 9, y: 9, width: 12, height: 2 });
  const diagonal = { ...horizontal, to: { x: 20, y: 20 } };
  assert.ok(Math.abs(segmentInkBounds(diagonal, { ...style, lineCap: 'square' }).x - (10 - Math.SQRT2)) < 1e-12);
  assert.throws(() => segmentInkBounds(horizontal, { ...style, dashMm: [-1] }), { code: 'CANVAS_INVALID_LAYOUT' });
});
test('resource limits and invalid page/style fail before drawing', () => {
  assert.throws(() => canvasDimensions(210, 297, { widthPx: 10000, pixelRatio: 3 }), { code: 'CANVAS_RESOURCE_LIMIT' });
  assert.throws(() => canvasDimensions(210, 297, { widthPx: NaN, pixelRatio: 1 }), { code: 'CANVAS_INVALID_LAYOUT' });
  const canvas = surface(), layout = blank('tian-grid');
  assert.throws(() => renderPaperPage(canvas, layout, 1, null, view), { code: 'CANVAS_PAGE_OUT_OF_RANGE' });
  const bad = { ...layout, strokes: { ...layout.strokes, grid: { ...layout.strokes.grid, gray: 2 } } };
  assert.throws(() => renderPaperPage(canvas, bad, 0, null, view), { code: 'CANVAS_INVALID_LAYOUT' });
  assert.equal(canvas.calls.length, 0);
});

test('unsupported Canvas methods fail before resizing or painting any part of a page', () => {
  for (const name of ['save', 'restore', 'setTransform', 'translate', 'scale', 'fillRect', 'beginPath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'setLineDash', 'stroke', 'fill']) {
    const canvas = surface();
    canvas.width = 640; canvas.height = 900;
    canvas.getContext()[name] = undefined;
    assert.throws(() => renderPaperPage(canvas, blank('essay-grid'), 0, null, view),
      { code: 'CANVAS_UNSUPPORTED_API' }, name);
    assert.deepEqual([canvas.width, canvas.height], [640, 900], name);
    assert.equal(canvas.calls.length, 0, name);
  }
});

const resources = { 'misans-regular': 'MiSans-Regular.ttf', 'lxgw-wenkai-gb-regular': 'LXGWWenKaiGB-Regular.ttf', 'misans-latin-regular': 'MiSansLatin-Regular.ttf' };
const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION,
  fonts: Object.fromEntries(await Promise.all(Object.entries(resources).map(async ([id, file]) =>
    [id, new Uint8Array(await readFile(new URL(`../../../assets/fonts/files/${file}`, import.meta.url)))]))) });
function filled(tracing = false, body = '春天来了，万物生长。\nHello 2026') {
  return layoutPaperDocument(createPaperDocument({ templateId: 'tian-grid', body, tracing }, getDevelopmentPreset('tian-grid')), provider);
}
test('real original filled and tracing fonts retain slots and pages, painting every glyph with one y flip', () => {
  const normal = filled(), tracing = filled(true);
  assert.deepEqual(normal.pages.map(p => p.slots), tracing.pages.map(p => p.slots));
  assert.equal(normal.pages.length, tracing.pages.length);
  for (const layout of [normal, tracing]) {
    const canvas = surface(), before = JSON.stringify(layout);
    const result = renderPaperPage(canvas, layout, 0, provider, view);
    assert.equal(result.glyphCount, layout.pages[0].glyphs.length);
    const translations = canvas.calls.filter(c => c.name === 'translate');
    assert.deepEqual(translations.map(c => c.args), layout.pages[0].glyphs.map(g => [g.originMm.x, g.originMm.y]));
    const scales = canvas.calls.filter(c => c.name === 'scale');
    for (let i = 0; i < scales.length; i++) {
      const g = layout.pages[0].glyphs[i], factor = g.fontSizeMm / provider.glyphOutline(g.fontId, g.glyphId).unitsPerEm;
      assert.deepEqual(scales[i].args, [factor, -factor]);
    }
    assert.ok(canvas.calls.filter(c => c.name === 'fill').every(c => c.fill === (layout.mode === 'tracing' ? 'rgb(166,166,166)' : 'rgb(0,0,0)')));
    assert.equal(JSON.stringify(layout), before);
  }
});
test('missing/mismatched fonts and inconsistent actual ink fail before touching the canvas', () => {
  const layout = filled(), canvas = surface();
  assert.throws(() => renderPaperPage(canvas, layout, 0, null, view), { code: 'CANVAS_RESOURCE_MISSING' });
  assert.throws(() => renderPaperPage(canvas, layout, 0, { ...provider, fontBundleVersion: 'different' }, view), { code: 'CANVAS_RESOURCE_MISMATCH' });
  const bad = structuredClone(layout); bad.pages[0].glyphs[0].originMm.x += 1;
  assert.throws(() => renderPaperPage(canvas, bad, 0, provider, view), { code: 'CANVAS_INVALID_LAYOUT' });
  const badOutline = { ...provider, glyphOutline(id, glyph) { return { ...provider.glyphOutline(id, glyph), commands: [{ command: 'lineTo', args: [NaN, 1] }] }; } };
  assert.throws(() => renderPaperPage(canvas, layout, 0, badOutline, view), { code: 'CANVAS_INVALID_LAYOUT' });
  assert.equal(canvas.calls.length, 0); assert.equal(canvas.width, 1);
});
test('multi-page renderer uses only the requested page', () => {
  const layout = filled(false, '春天来了，万物生长。'.repeat(80));
  assert.ok(layout.pages.length > 1);
  const canvas = surface();
  const result = renderPaperPage(canvas, layout, layout.pages.length - 1, provider, view);
  assert.equal(result.glyphCount, layout.pages.at(-1).glyphs.length);
  assert.equal(canvas.calls.filter(c => c.name === 'fill').length, result.glyphCount);
});
test('real pinyin tone marks and decomposed ü retain identical filled/tracing placements', () => {
  const preset = getDevelopmentPreset('pinyin-lines');
  const input = { templateId: 'pinyin-lines', body: 'nǐ hǎo xi’an\nā á ǎ à ǖ ǘ ǚ ǜ\nĀ Á Ǎ À Ǖ Ǘ Ǚ Ǜ\nǖ  b p m f y g' };
  const normal = layoutPaperDocument(createPaperDocument(input, preset), provider);
  const tracing = layoutPaperDocument(createPaperDocument({ ...input, tracing: true }, preset), provider);
  assert.deepEqual(normal.pages, tracing.pages);
  for (const layout of [normal, tracing]) {
    const canvas = surface(), result = renderPaperPage(canvas, layout, 0, provider, view);
    assert.equal(result.glyphCount, layout.pages[0].glyphs.length);
    assert.ok(result.glyphCount > 40);
    assert.deepEqual(canvas.calls.filter(c => c.name === 'translate').map(c => c.args),
      layout.pages[0].glyphs.map(g => [g.originMm.x, g.originMm.y]));
  }
});

test('T07 unified layouts and digests feed Canvas for all templates, modes and page views unchanged', () => {
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const preset = getDevelopmentPreset(templateId);
    const body = (templateId === 'pinyin-lines' ? 'nǐ hǎo u\u0308\u0304\n' : '春夏秋冬，学习记录。\n').repeat(30);
    for (const input of [{ templateId }, { templateId, body }, { templateId, body, tracing: true }]) {
      const layout = layoutPaperDocument(createPaperDocument(input, preset), provider);
      const digest = createLayoutDigest(layout);
      const pageIndex = layout.pages.length - 1;
      if (input.body) assert.ok(pageIndex > 0);
      for (const display of [view, { widthPx: 358, pixelRatio: 3, zoom: 1.5 }]) {
        const result = renderPaperPage(surface(), layout, pageIndex, provider, display);
        assert.equal(result.pageIndex, pageIndex);
        assert.equal(result.glyphCount, layout.pages[pageIndex].glyphs.length);
        assert.equal(createLayoutDigest(layout), digest);
      }
    }
  }
});
