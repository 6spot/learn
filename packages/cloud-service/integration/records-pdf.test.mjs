import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDevelopmentPreset } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';
import { renderPdf } from '../../pdf-renderer/dist/index.js';
import pdfLib from '../../pdf-renderer/node_modules/pdf-lib/cjs/index.js';
import { PDF_CHUNK_BYTES } from '../dist/index.js';
import { executionFixture } from '../test/execution-fixture.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', root)));
const fonts = Object.fromEntries(manifest.fonts.map(font => [font.id, new Uint8Array(readFileSync(new URL(`assets/fonts/${font.path}`, root)))]));
const metrics = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
const resources = { describeBundle: async version => ({ fontBundleVersion: version,
  fonts: manifest.fonts.map(({ id, bytes, sha256, fontVersion, path }) => ({ id, bytes, sha256, fontVersion, location: `local://${path}` })) }),
  readFontBytes: async id => fonts[id] };

for (const templateId of ['tian-grid', 'pinyin-lines']) {
  test(`real ${templateId} PDF delivered in bounded chunks retains full bytes/hash/pages`, async t => {
    const f = await executionFixture({ preset: getDevelopmentPreset(templateId), resources, metrics,
      render: (execution, { maxOutputBytes }) => renderPdf(execution.layout, metrics, { maxBytes: maxOutputBytes }),
      policy: { maxPdfBytes: 64 * 1024 * 1024 } });
    const input = templateId === 'tian-grid' ? { title: '春天', body: '学习语文。', tracing: true }
      : { body: Array.from({ length: 40 }, () => 'nǐ hǎo').join('\n') };
    const response = await f.service.submitGeneration(await f.request(input)); assert.equal(response.job.status, 'SUCCEEDED');
    const info = await f.service.getPdfInfo(response.job.jobId), counts = { ...f.counts };
    const bytes = new Uint8Array(info.bytes); let offset = 0, chunks = 0;
    do {
      const result = await f.service.readPdfChunk({ jobId: response.job.jobId, offset });
      assert.ok(result.bytes.length <= PDF_CHUNK_BYTES); assert.equal(result.sha256, info.sha256); assert.equal(result.totalBytes, bytes.length);
      bytes.set(result.bytes, result.offset); offset = result.nextOffset; chunks++;
    } while (offset !== null);
    assert.equal(await f.crypto.sha256(bytes), info.sha256);
    assert.deepEqual(bytes, await f.backend.read((await f.job()).fileId));
    const pdf = await pdfLib.PDFDocument.load(bytes); assert.equal(pdf.getPageCount(), info.pageCount);
    if (templateId === 'tian-grid') { assert.ok(bytes.length > 18_000_000); assert.ok(chunks > 60); }
    else assert.equal(pdf.getPageCount(), 3);
    for (const page of pdf.getPages()) {
      assert.ok(Math.abs(page.getWidth() - 210 * 72 / 25.4) < 0.001); assert.ok(Math.abs(page.getHeight() - 297 * 72 / 25.4) < 0.001);
    }
    assert.equal(f.counts.read, counts.read + 1); assert.equal(f.counts.render, counts.render); assert.equal(f.counts.prepare, counts.prepare);
    const account = await f.service.getAccount(); assert.equal(account.available, 19); assert.equal(account.reserved, 0);
    const list = await f.service.listJobs(); assert.equal(list.items[0].jobId, response.job.jobId);
    assert.equal(list.items[0].delivery, 'ready');
    t.diagnostic(`${bytes.length} bytes in ${chunks} chunks; ${pdf.getPageCount()} A4 pages; one warm-instance full read`);
  });
}
