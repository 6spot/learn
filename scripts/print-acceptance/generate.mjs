/** Local acceptance fixtures only. Never pass user input to this evidence tool. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const repository = new URL('../../', import.meta.url);
const output = new URL('dist/print-acceptance/', repository);
await mkdir(new URL('diagnostics/', output), { recursive: true });
// A failed new run must not leave an earlier passing report as current evidence.
await rm(new URL('manifest.json', output), { force: true });
await rm(new URL('measurements.json', output), { force: true });
await rm(new URL('index.html', output), { force: true });
// Font fixtures read files while their module loads. Invalidate old evidence
// before resolving any optional build output or reading those resources.
const { createLayoutDigest, getDevelopmentPreset } = await import('../../packages/paper-core/dist/index.js');
const { renderPaperPage } = await import('../../packages/canvas-renderer/dist/index.js');
const { renderPdf } = await import('../../packages/pdf-renderer/dist/index.js');
const { provider, templateIds, layoutFor, manifest: fontManifest } = await import('../../packages/pdf-renderer/test/fixtures.mjs');
const requirePdf = createRequire(new URL('../../packages/pdf-renderer/package.json', import.meta.url));
const { PDFDocument, PDFName, PDFRawStream } = requirePdf('pdf-lib');
const hash = value => createHash('sha256').update(value).digest('hex');
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Numeric output differs: ${actual} / ${expected}`);
const union = bounds => {
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
  return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x,
    height: Math.max(...bounds.map(b => b.y + b.height)) - y };
};

// Independent geometry checkpoints transcribed from PAPER_PRESETS, not computed
// from the layout being checked. These are test expectations, not runtime presets.
function expectedLines(id) {
  if (id === 'pinyin-lines') return Array.from({ length: 56 }, (_, i) => ({ axis: 'y',
    at: 25.5 + Math.floor(i / 4) * 18 + i % 4 * 4, from: 15, to: 195 }));
  const essay = id === 'essay-grid';
  const [x, y, cell, cols, rows] = essay ? [10, 13.5, 10, 19, 27] : [15, 21, 15, 12, 17];
  return [
    ...Array.from({ length: rows + 1 }, (_, i) => ({ axis: 'y', at: y + i * cell, from: x, to: x + cols * cell })),
    ...Array.from({ length: cols + 1 }, (_, i) => ({ axis: 'x', at: x + i * cell, from: y, to: y + rows * cell })),
  ];
}
function assertGeometry(page, id) {
  assert.deepEqual(page.geometry.page, { width: 210, height: 297 });
  const lines = page.geometry.segments.filter(s => s.role !== 'guide').map(s => s.from.y === s.to.y
    ? { axis: 'y', at: s.from.y, from: Math.min(s.from.x, s.to.x), to: Math.max(s.from.x, s.to.x) }
    : { axis: 'x', at: s.from.x, from: Math.min(s.from.y, s.to.y), to: Math.max(s.from.y, s.to.y) });
  const sort = values => values.map(v => JSON.stringify(v)).sort();
  assert.deepEqual(sort(lines), sort(expectedLines(id)));
}
function sample(id, specimen) {
  if (specimen === 'blank') return { templateId: id };
  const pinyin = id === 'pinyin-lines';
  const rows = pinyin ? 14 : id === 'essay-grid' ? 27 : 17;
  const cols = id === 'essay-grid' ? 19 : 12;
  const square = '永日月水火木土人山田中口\n' + '学'.repeat(cols - 2) + '。\n' +
    '“春天”（学习）\n\n你好 AV 3.14 e\u0301cole nǚ\r\n一二三四五六七八九十\n';
  const latin = "ā á ǎ à ē é ě è ī í ǐ ì\nō ó ǒ ò ū ú ǔ ù ǖ ǘ ǚ ǜ\nĀ Á Ǎ À Ǖ Ǘ Ǚ Ǜ\nǸ Ê\u0301 u\u0308\u0304\n\nb p m f g j q y\r\nnǐ hǎo xi’an 3.14\n";
  return { templateId: id, title: pinyin ? 'Pīn yīn' : '字形与打印', tracing: specimen === 'tracing',
    body: specimen === 'multipage'
      ? (pinyin ? 'nǐ hǎo g j q y\n' : '春夏秋冬，学习。\n').repeat(rows + 3) + (pinyin ? 'wán\n' : '完成\n')
      : pinyin ? latin : square };
}
function recordingSurface() {
  const calls = [], context = {};
  const names = ['save', 'restore', 'setTransform', 'translate', 'scale', 'fillRect', 'beginPath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'setLineDash', 'stroke', 'fill'];
  for (const name of names) context[name] = (...args) => calls.push({ name, args,
    lineWidth: context.lineWidth, color: context.fillStyle });
  return { calls, width: 1, height: 1, getContext: () => context };
}
function readOperations(doc, page) {
  const refs = page.node.Contents();
  return Array.from({ length: refs.size() }, (_, i) => {
    const stream = doc.context.lookup(refs.get(i), PDFRawStream);
    return Buffer.from(stream.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode'
      ? inflateSync(stream.getContents()) : stream.getContents()).toString('ascii');
  }).join('\n');
}
function compareOutputs(layout, pageIndex, operations) {
  const source = layout.pages[pageIndex];
  const gids = [...operations.matchAll(/<([a-fA-F0-9]+)> Tj/g)].map(m => parseInt(m[1], 16));
  assert.deepEqual(gids, source.glyphs.map(g => g.glyphId));
  const origins = [...operations.matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g)].map(m => [+m[1], +m[2]]);
  assert.equal(origins.length, source.glyphs.length);
  const fontSizes = [...operations.matchAll(/\/\S+ ([-\d.]+) Tf/g)].map(m => +m[1]);
  assert.equal(fontSizes.length, source.glyphs.length);
  const pdfPaths = [...operations.matchAll(/([-\d.]+) ([-\d.]+) m\n([-\d.]+) ([-\d.]+) l\nS/g)];
  assert.equal(pdfPaths.length, source.geometry.segments.length);
  const factor = 72 / 25.4;
  for (let i = 0; i < pdfPaths.length; i++) {
    const s = source.geometry.segments[i], p = pdfPaths[i];
    [+p[1], +p[2], +p[3], +p[4]].forEach((v, j) => close(v,
      [s.from.x * factor, (297 - s.from.y) * factor, s.to.x * factor, (297 - s.to.y) * factor][j]));
  }
  assert.equal(/\b(?:W|W\*)\b/.test(operations), false);
  let report;
  for (const view of [{ widthPx: 315, pixelRatio: 2 }, { widthPx: 358, pixelRatio: 3, zoom: 1.5 }]) {
    const canvas = recordingSurface(), requestedGlyphs = [];
    const observedProvider = { fontBundleVersion: provider.fontBundleVersion, glyphOutline(fontId, glyphId) {
      requestedGlyphs.push([fontId, glyphId]);
      return provider.glyphOutline(fontId, glyphId);
    } };
    report = renderPaperPage(canvas, layout, pageIndex, layout.mode === 'blank' ? null : observedProvider, view);
    assert.deepEqual(requestedGlyphs, source.glyphs.map(g => [g.fontId, g.glyphId]));
    const translations = canvas.calls.filter(c => c.name === 'translate').map(c => c.args);
    const scales = canvas.calls.filter(c => c.name === 'scale').map(c => c.args);
    assert.equal(translations.length, origins.length);
    assert.equal(scales.length, origins.length);
    for (let i = 0; i < origins.length; i++) {
      close(translations[i][0], origins[i][0] / factor);
      close(translations[i][1], 297 - origins[i][1] / factor);
      const glyph = source.glyphs[i];
      close(fontSizes[i] / factor, glyph.fontSizeMm);
      close(scales[i][0], glyph.fontSizeMm / provider.glyphOutline(glyph.fontId, glyph.glyphId).unitsPerEm);
      close(scales[i][1], -scales[i][0]);
    }
    const strokes = canvas.calls.filter(c => c.name === 'stroke');
    assert.equal(strokes.length, source.geometry.segments.length);
    const moves = canvas.calls.filter(c => c.name === 'moveTo').slice(0, strokes.length);
    const ends = canvas.calls.filter(c => c.name === 'lineTo').slice(0, strokes.length);
    assert.deepEqual(moves.map(c => c.args), source.geometry.segments.map(s => [s.from.x, s.from.y]));
    assert.deepEqual(ends.map(c => c.args), source.geometry.segments.map(s => [s.to.x, s.to.y]));
  }
  const glyphBoxes = source.glyphs.map(g => g.inkBoundsMm).filter(Boolean);
  return { page: pageIndex + 1, segmentCount: source.geometry.segments.length, glyphCount: source.glyphs.length,
    fullInkMm: report.inkBoundsMm, glyphInkMm: union(glyphBoxes), glyphBoxes };
}

const outputs = [];
for (const id of templateIds) {
  const preset = getDevelopmentPreset(id);
  assert.equal(preset.stage, 'development-candidate');
  for (const specimen of ['blank', 'filled', 'tracing', 'multipage']) {
    const input = sample(id, specimen), layout = layoutFor(id, input), digest = createLayoutDigest(layout);
    assert.equal(layout.pages.length, specimen === 'multipage' ? 2 : 1);
    for (const block of ['title', 'body']) {
      const text = input[block] ?? '';
      const represented = layout.pages.flatMap(page => page.slots).filter(slot => slot.source.block === block)
        .map(slot => text.slice(slot.source.start, slot.source.end)).join('');
      assert.equal(represented, text.replace(/\r\n|\r|\n/g, ''), `${id}/${specimen}: omitted or repeated ${block} content`);
    }
    if (specimen !== 'blank') {
      const paired = layoutFor(id, { ...input, tracing: !input.tracing });
      assert.deepEqual(layout.pages.map(p => p.slots), paired.pages.map(p => p.slots));
      assert.deepEqual(layout.pages.map(p => p.lines), paired.pages.map(p => p.lines));
    }
    const bytes = await renderPdf(layout, specimen === 'blank' ? null : provider);
    const file = `${id}-${specimen}.pdf`;
    await writeFile(new URL(file, output), bytes);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(doc.getPageCount(), layout.pages.length);
    const pages = [];
    for (let i = 0; i < layout.pages.length; i++) {
      assertGeometry(layout.pages[i], id);
      const page = doc.getPage(i), operations = readOperations(doc, page);
      close(page.getWidth(), 210 * 72 / 25.4); close(page.getHeight(), 297 * 72 / 25.4);
      pages.push(compareOutputs(layout, i, operations));
      // Diagnostic only: turn grid strokes into end-path operations, preserving
      // every original font resource, text matrix and glyph operator unchanged.
      const textOnly = operations.replace(/^S$/gm, 'n');
      assert.equal((textOnly.match(/^S$/gm) ?? []).length, 0);
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(textOnly)));
    }
    assert.equal(createLayoutDigest(layout), digest);
    let diagnostic = null, diagnosticSha256 = null;
    if (specimen !== 'blank') {
      diagnostic = `diagnostics/${id}-${specimen}-text-only.pdf`;
      const textBytes = await doc.save({ useObjectStreams: false });
      diagnosticSha256 = hash(textBytes);
      await writeFile(new URL(diagnostic, output), textBytes);
    }
    const info = execFileSync('pdfinfo', ['-box', fileURLToPath(new URL(file, output))], { encoding: 'utf8' });
    const fonts = execFileSync('pdffonts', [fileURLToPath(new URL(file, output))], { encoding: 'utf8' });
    const fontIds = [...new Set(layout.pages.flatMap(page => page.glyphs.map(glyph => glyph.fontId)))].sort();
    const expectedFonts = specimen === 'blank' ? [] : id === 'pinyin-lines' ? ['misans-latin-regular']
      : specimen === 'tracing' && id !== 'essay-grid' ? ['lxgw-wenkai-gb-regular', 'misans-regular'] : ['misans-regular'];
    assert.deepEqual(fontIds, expectedFonts);
    assert.equal(fonts.trim().split('\n').slice(2).length, expectedFonts.length);
    assert.equal(Number(info.match(/^Pages:\s+(\d+)/m)?.[1]), pages.length);
    assert.match(info, /Page size:\s+595\.276 x 841\.89 pts \(A4\)/);
    for (const row of fonts.trim().split('\n').slice(2)) assert.match(row, /CID TrueType\s+Identity-H\s+yes\s+no\s+no\s+\d+\s+\d+$/);
    await writeFile(new URL(`${id}-${specimen}.inspection.txt`, output), info + '\n' + fonts);
    outputs.push({ templateId: id, specimen, file, sha256: hash(bytes), bytes: bytes.length, versions: layout.versions,
      stage: preset.stage, layoutDigest: digest, fontIds, diagnostic, diagnosticSha256,
      expectedLines: expectedLines(id), strokes: preset.strokes, textStyles: preset.textStyles,
      pages, canvasPdfOperatorsAgree: true, pairedLogicalLayoutEqual: specimen !== 'blank' });
    console.log(`Prepared ${id} ${specimen}: ${pages.length} page(s).`);
  }
}
// Unknown scripts/glyphs/invalid tone combinations fail explicitly; these are
// synthetic negative specimens and must never become partially rendered pages.
const rejectionCases = [
  { templateId: 'essay-grid', body: '\u{1f600}' },
  { templateId: 'pinyin-lines', body: '汉字' },
  { templateId: 'pinyin-lines', body: 'a\u0304\u0301' },
];
const rejectionCodes = rejectionCases.map(input => {
  let result;
  try { layoutFor(input.templateId, input); } catch (error) { result = error.code; }
  assert.equal(typeof result, 'string');
  return result;
});
assert.deepEqual(rejectionCodes, ['MISSING_GLYPH', 'UNSUPPORTED_TEXT', 'UNSUPPORTED_TEXT']);
const report = { schema: 'learn-print-acceptance-v1', syntheticOnly: true, physicalPrintVerified: false,
  intendedUseLicenseVerified: false, canvasPixelsVerified: false, dpi: 600, threshold: 250,
  rasterTolerancePixels: 2, centerlineTolerancePixels: 1.5,
  fonts: fontManifest.fonts.map(({ id, fontVersion, sha256, bytes }) => ({ id, fontVersion, sha256, bytes })),
  rejectionCodes, outputs };
await writeFile(new URL('manifest.json', output), JSON.stringify(report, null, 2) + '\n');
const checklistSource = new URL('docs/PRINT_ACCEPTANCE.md', repository);
const checklist = (await readFile(checklistSource, 'utf8')).replace(/\]\(([^)]+)\)/g, (match, target) => {
  if (/^(?:[a-z]+:|#|\/)/i.test(target)) return match;
  const resolved = new URL(target, checklistSource);
  return `](${relative(fileURLToPath(output), fileURLToPath(resolved)).replaceAll('\\', '/')}${resolved.hash})`;
});
await writeFile(new URL('OWNER-CHECKLIST.md', output), checklist);
console.log(`Prepared ${outputs.length} candidate PDFs; next run measure.py. Physical acceptance remains pending.`);
