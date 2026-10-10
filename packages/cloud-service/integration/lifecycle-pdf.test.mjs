import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDevelopmentPreset } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';
import { renderPdf } from '../../pdf-renderer/dist/index.js';
import pdfLib from '../../pdf-renderer/node_modules/pdf-lib/cjs/index.js';
import { CloudService, createLifecycleService } from '../dist/index.js';
import { executionFixture } from '../test/execution-fixture.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', root)));
const fonts = Object.fromEntries(manifest.fonts.map(font => [font.id, new Uint8Array(readFileSync(new URL(`assets/fonts/${font.path}`, root)))]));
const metrics = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts });
const resources = { describeBundle: async version => ({ fontBundleVersion: version,
  fonts: manifest.fonts.map(({ id, bytes, sha256, fontVersion, path }) => ({ id, bytes, sha256, fontVersion, location: `local://${path}` })) }),
  readFontBytes: async id => fonts[id] };

for (const templateId of ['tian-grid', 'pinyin-lines']) {
  test(`real ${templateId} PDF is revoked, physically removed from private test storage and fully GCed without rerender`, async t => {
    const f = await executionFixture({ preset: getDevelopmentPreset(templateId), resources, metrics,
      render: (execution, { maxOutputBytes }) => renderPdf(execution.layout, metrics, { maxBytes: maxOutputBytes }),
      policy: { maxPdfBytes: 64 * 1024 * 1024 } });
    const day = 86400000;
    const config = { ...f.config, adminUserIds: [f.userId], lifecycle: {
      pageSize: 20, maxRecordsPerRun: 200, maxRunMs: 60000, maxWindowTtlMs: 3600000,
      lateIoProtectionMs: 60000, deletionProtectionMs: 300000, ledgerRetentionMs: 90 * day,
      activityRetentionMs: 7 * day, auditRetentionMs: day, inactiveUserRetentionMs: 90 * day } };
    const service = new CloudService(f.dependencies, config);
    const maintenance = createLifecycleService({ store: f.store, storage: f.storage, clock: f.clock, crypto: f.crypto }, config);
    const input = templateId === 'tian-grid' ? { title: '春天', body: '学习语文。', tracing: true }
      : { body: Array.from({ length: 40 }, () => 'nǐ hǎo').join('\n') };
    const result = await service.submitGeneration(await f.request(input));
    const candidate = await f.candidate();
    const bytes = await f.backend.read(candidate.fileId);
    const pdf = await pdfLib.PDFDocument.load(bytes);
    const count = { ...f.counts };
    const status = await service.deleteMyData({ confirm: true });
    await assert.rejects(service.readPdfChunk({ jobId: result.job.jobId, offset: 0 }), { code: 'ACCOUNT_DELETING' });
    const report = await maintenance.runSweep();
    assert.equal(report.removedFiles, 1); assert.equal(report.removedFileBytes, bytes.length);
    await assert.rejects(f.backend.read(candidate.fileId), { code: 'NOT_FOUND' });
    assert.equal((await f.job()).status, 'SUCCEEDED');
    assert.equal((await f.base.get('credit_accounts', f.userId)).reserved, 0);
    f.clock.advance(status.earliestReuseAt - f.clock.now());
    await maintenance.runSweep();
    assert.equal((await service.getDeletionStatus()).state, 'none');
    assert.ok(!JSON.stringify(f.base.snapshot()).includes(f.userId));
    assert.equal(f.counts.render, count.render); assert.equal(f.counts.prepare, count.prepare); assert.equal(f.counts.upload, count.upload);
    assert.equal(f.counts.read, count.read);
    t.diagnostic(`${bytes.length} bytes / ${pdf.getPageCount()} A4 page(s); real font/PDF, simulated private removal/metadata transactions`);
  });
}
