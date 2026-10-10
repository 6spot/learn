import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderPdf } from '../dist/index.js';
import { provider, templateIds, sampleInput, layoutFor, repository } from '../test/fixtures.mjs';

const output = new URL('dist/pdf-evidence/t09/', repository);
await mkdir(output, { recursive: true });
const reports = [];
for (const templateId of templateIds) for (const mode of ['blank', 'filled', 'tracing']) {
  const layout = layoutFor(templateId, sampleInput(templateId, mode));
  const start = performance.now();
  const bytes = await renderPdf(layout, mode === 'blank' ? null : provider);
  const elapsedMs = Math.round(performance.now() - start);
  const name = `${templateId}-${mode}.pdf`, file = new URL(name, output);
  await writeFile(file, bytes);
  const info = execFileSync('pdfinfo', ['-box', fileURLToPath(file)], { encoding: 'utf8' });
  const fonts = execFileSync('pdffonts', [fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(Number(info.match(/^Pages:\s+(\d+)/m)?.[1]), layout.pages.length);
  assert.match(info, /Page size:\s+595\.276 x 841\.89 pts \(A4\)/);
  assert.match(info, /^JavaScript:\s+no$/m);
  const fontRows = fonts.trim().split('\n').slice(2);
  for (const row of fontRows) assert.match(row, /CID TrueType\s+Identity-H\s+yes\s+no\s+no\s+\d+\s+\d+$/);
  const expectedFonts = new Set(layout.pages.flatMap(page => page.glyphs.map(glyph => glyph.fontId)));
  assert.equal(fontRows.length, expectedFonts.size);
  reports.push({ templateId, mode, file: name, pages: layout.pages.length,
    glyphCount: layout.pages.reduce((sum, page) => sum + page.glyphs.length, 0), bytes: bytes.length,
    elapsedMs, sha256: createHash('sha256').update(bytes).digest('hex'), fonts: [...expectedFonts],
    originalFontEmbedding: true, subset: false, textExtractionGuaranteed: false });
  await writeFile(new URL(`${templateId}-${mode}.inspection.txt`, output), info + '\n' + fonts);
}
const toolVersion = spawnSync('pdfinfo', ['-v'], { encoding: 'utf8' });
assert.equal(toolVersion.status, 0);
await writeFile(new URL('report.json', output), JSON.stringify({
  engineVersion: layoutFor('pinyin-lines').versions.engineVersion,
  toolVersions: { pdfinfo: (toolVersion.stdout + toolVersion.stderr).trim() },
  outputs: reports, deviceVerified: false, printVerified: false,
}, null, 2) + '\n');
console.log(`Generated and independently inspected ${reports.length} synthetic PDFs under dist/pdf-evidence/t09.`);
console.log(`Largest PDF: ${Math.max(...reports.map(report => report.bytes))} bytes.`);
