import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDevelopmentPreset } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';
import { renderPdf } from '../../pdf-renderer/dist/index.js';
import pdfLib from '../../pdf-renderer/node_modules/pdf-lib/cjs/index.js';
import { createRecoveryService } from '../dist/index.js';
import { executionFixture } from '../test/execution-fixture.mjs';

test('real multipage PDF is reconciled after interrupted settlement without input, fonts or renderer access', async t => {
  const root = new URL('../../../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', root)));
  const pin = manifest.fonts.find(font => font.id === 'misans-latin-regular');
  const bytes = new Uint8Array(readFileSync(new URL(`assets/fonts/${pin.path}`, root)));
  const metrics = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: { [pin.id]: bytes } });
  const f = await executionFixture({ preset: getDevelopmentPreset('pinyin-lines'), metrics,
    resources: { describeBundle: async version => ({ fontBundleVersion: version,
      fonts: [{ id: pin.id, bytes: pin.bytes, sha256: pin.sha256, fontVersion: pin.fontVersion, location: `local://${pin.path}` }] }),
      readFontBytes: async () => bytes },
    render: (execution, { maxOutputBytes }) => renderPdf(execution.layout, metrics, { maxBytes: maxOutputBytes }) });
  f.hooks.beforeCommit = writes => { if (writes.some(w => w.collection === 'generation_jobs' && w.value.status === 'SUCCEEDED')) throw new Error('simulate interruption'); };
  const request = await f.request({ body: Array.from({ length: 40 }, () => 'nǐ hǎo').join('\n') });
  await assert.rejects(f.service.submitGeneration(request), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  f.hooks.beforeCommit = undefined;
  const job = await f.job(), candidate = await f.candidate(); const counts = { ...f.counts };
  const recovery = createRecoveryService({ store: f.store, storage: f.storage, clock: f.clock, crypto: f.crypto },
    { pageSize: 10, maxRecordsPerRun: 20, maxRunMs: 10000, maxCandidateBytes: 1000000, maxReadBytesPerRun: 1000000 });
  f.clock.advance(1000);
  const report = await recovery.runSweep(); assert.equal(report.reconciledJobs, 1); assert.equal(report.cycleComplete, true);
  const recovered = await f.job(); assert.equal(recovered.status, 'SUCCEEDED');
  const stored = await f.backend.read(recovered.fileId); assert.equal(await f.crypto.sha256(stored), candidate.sha256);
  assert.equal(recovered.fileExpiresAt, f.clock.now() + candidate.pdfRetentionMs);
  const pdf = await pdfLib.PDFDocument.load(stored); assert.equal(pdf.getPageCount(), 3); assert.equal(recovered.pageCount, job.pageCount);
  await recovery.runSweep(); await f.service.submitGeneration(request);
  assert.equal(f.counts.render, counts.render); assert.equal(f.counts.prepare, counts.prepare); assert.equal(f.counts.upload, counts.upload);
  const account = await f.service.getAccount(); assert.equal(account.available, 19); assert.equal(account.reserved, 0);
  const metadata = JSON.stringify(f.base.snapshot()); assert.equal(metadata.includes('nǐ hǎo'), false); assert.equal(metadata.includes(request.layoutDigest), false);
  t.diagnostic(`${stored.length} bytes / 3 pages recovered using only private bytes and metadata`);
});
