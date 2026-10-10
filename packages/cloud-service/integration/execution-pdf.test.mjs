import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDevelopmentPreset } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';
import { renderPdf } from '../../pdf-renderer/dist/index.js';
import pdfLib from '../../pdf-renderer/node_modules/pdf-lib/cjs/index.js';
import { executionFixture } from '../test/execution-fixture.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', root)));
const fonts = Object.fromEntries(manifest.fonts.map(font => [font.id, new Uint8Array(readFileSync(new URL(`assets/fonts/${font.path}`, root)))]));
const metrics = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
const resources = { describeBundle: async version => ({ fontBundleVersion: version,
  fonts: manifest.fonts.map(({ id, bytes, sha256, fontVersion, path }) => ({ id, bytes, sha256, fontVersion, location: `local://${path}` })) }),
  readFontBytes: async id => fonts[id] };
const render = (execution, { maxOutputBytes }) => renderPdf(execution.layout, metrics, { maxBytes: maxOutputBytes });

for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
  for (const mode of ['blank', 'text']) {
    test(`real shared preparer/TTF/PDF/private storage/settlement: ${templateId} ${mode}`, async t => {
      const f = await executionFixture({ preset: getDevelopmentPreset(templateId), resources, metrics, render,
        policy: { maxPdfBytes: 64 * 1024 * 1024 } });
      const input = mode === 'blank' ? {} : templateId === 'pinyin-lines'
        ? { title: 'Pinyin', body: 'nǐ hǎo\n\nǖ Ǹ lǜ', tracing: true }
        : { title: '学习', body: '春夏秋冬。\n\n天地玄黄。', tracing: templateId !== 'essay-grid' };
      const request = await f.request(input);
      const result = await f.service.submitGeneration(request);
      assert.equal(result.job.status, 'SUCCEEDED');
      const job = await f.job(), candidate = await f.candidate();
      const bytes = await f.backend.read(job.fileId);
      assert.equal(job.fileBytes, bytes.length); assert.equal(job.fileSha256, await f.crypto.sha256(bytes));
      assert.equal(candidate.state, 'committed');
      const pdf = await pdfLib.PDFDocument.load(bytes);
      assert.equal(pdf.getPageCount(), result.job.pageCount);
      for (const page of pdf.getPages()) {
        assert.ok(Math.abs(page.getWidth() - 210 * 72 / 25.4) < 0.001);
        assert.ok(Math.abs(page.getHeight() - 297 * 72 / 25.4) < 0.001);
      }
      const counts = { ...f.counts };
      await f.service.submitGeneration(request);
      assert.equal(f.counts.render, counts.render); assert.equal(f.counts.prepare, counts.prepare);
      const account = await f.service.getAccount(); assert.equal(account.available, 19); assert.equal(account.reserved, 0);
      const durable = JSON.stringify(f.base.snapshot());
      for (const secret of ['春夏秋冬', 'Pinyin', 'nǐ hǎo', request.layoutDigest]) assert.equal(durable.includes(secret), false);
      t.diagnostic(`${bytes.length} bytes, ${pdf.getPageCount()} A4 page(s); real renderer, simulated private storage/transactions`);
    });
  }
}

test('real renderer byte cap failure releases credit without storing any partial PDF', async () => {
  const f = await executionFixture({ preset: getDevelopmentPreset('tian-grid'), resources, metrics, render,
    policy: { maxPdfBytes: 1000000 } });
  const result = await f.service.submitGeneration(await f.request({ body: '学习', tracing: true }));
  assert.equal(result.job.status, 'FAILED'); assert.equal(result.job.errorCode, 'PDF_RESOURCE_LIMIT');
  assert.equal(f.counts.upload, 0); assert.deepEqual(f.backend.fileIds(), []);
  const account = await f.service.getAccount(); assert.equal(account.available, 20); assert.equal(account.reserved, 0);
});

test('real multi-page pinyin PDF keeps the exact shared page count through private settlement', async t => {
  const f = await executionFixture({ preset: getDevelopmentPreset('pinyin-lines'), resources, metrics, render,
    policy: { maxPdfBytes: 64 * 1024 * 1024 } });
  const request = await f.request({ body: Array.from({ length: 40 }, () => 'nǐ hǎo').join('\n') });
  const response = await f.service.submitGeneration(request);
  assert.equal(response.job.status, 'SUCCEEDED'); assert.ok(response.job.pageCount > 1);
  const bytes = await f.backend.read((await f.job()).fileId);
  const pdf = await pdfLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), f.execution().layout.pages.length);
  assert.equal(pdf.getPageCount(), response.job.pageCount);
  t.diagnostic(`${bytes.length} bytes, ${pdf.getPageCount()} pages; no renderer repagination`);
});
