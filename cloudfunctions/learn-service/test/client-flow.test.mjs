import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createLocalService } from '../../../scripts/diagnostics/local-service.mjs';
import { createRequestId } from '../../../packages/cloud-service/dist/index.js';
import { getDevelopmentPreset, createPaperDocument } from '../../../packages/paper-core/dist/index.js';

const native = await build({ stdin: { contents: "export {CloudClient} from './miniprogram/lib/cloud-client.ts'; export {createPdfDownloader} from './miniprogram/lib/pdf-download.ts';", resolveDir: new URL('../../../', import.meta.url).pathname },
  bundle: true, platform: 'neutral', target: 'es2017', format: 'esm', write: false });
const { CloudClient, createPdfDownloader } = await import(`data:text/javascript;base64,${Buffer.from(native.outputFiles[0].text).toString('base64')}`);

test('actual shared layout -> RPC/PDF -> JSON base64 chunks -> native downloader round trip', async () => {
  const local = await createLocalService(), rpc = local.rpcFor('flow-user');
  const client = new CloudClient(async (method, params) => JSON.parse(JSON.stringify(await rpc(JSON.parse(JSON.stringify({ method, params }))))));
  const before = await client.getAccount();
  const preset = getDevelopmentPreset('tian-grid');
  const input = { templateId: 'tian-grid', title: '模拟验收', body: '春天来了，学习快乐。', tracing: true };
  const preview = await local.preparer.prepare(createPaperDocument(input, preset).input, preset);
  const request = { requestId: createRequestId((await client.getSubmissionWindow()).windowId, randomUUID()), input, versions: preset.versions, layoutDigest: preview.digest };
  const accepted = await client.submitGeneration(request);
  assert.equal(accepted.job.status, 'SUCCEEDED');
  assert.equal((await client.getAccount()).available, before.available - 1);
  const listing = await client.listJobs({ limit: 10 }); assert.equal(listing.items[0].jobId, accepted.job.jobId);
  assert.equal((await client.getJob(accepted.job.jobId)).delivery, 'ready');
  const info = await client.getPdfInfo(accepted.job.jobId); assert.ok(info.bytes > 18_000_000);
  const files = new Map(); let opened = 0, progress = 0;
  const fs = { mkdirSync() {}, readdirSync: () => [], unlinkSync: path => files.delete(path),
    writeFile(options) { files.set(options.filePath, new Uint8Array(options.data)); options.success(); } };
  const downloader = createPdfDownloader(client, { env: { USER_DATA_PATH: '/diagnostic' }, getFileSystemManager: () => fs,
    openDocument(options) { const bytes = files.get(options.filePath); assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256);
      assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-'); opened++; options.success(); } });
  await downloader.open(accepted.job.jobId, () => { progress++; });
  assert.equal(opened, 1); assert.ok(progress > 70);
  assert.equal((await client.submitGeneration(request)).job.jobId, accepted.job.jobId);
  assert.equal((await client.getAccount()).available, before.available - 1);
  const other = new CloudClient((method, params) => local.rpcFor('other-flow-user')({ method, params }));
  await assert.rejects(other.getPdfInfo(accepted.job.jobId), { code: 'NOT_FOUND' });
  await assert.rejects(other.readPdfChunk({ jobId: accepted.job.jobId, offset: 0 }), { code: 'NOT_FOUND' });
  // Only safe metadata is persisted; article text exists transiently and in the private PDF.
  for (const collection of ['generation_jobs', 'generation_requests', 'generation_history']) {
    const records = JSON.stringify(await local.store.list(collection)); assert.ok(!records.includes(input.body)); assert.ok(!records.includes(input.title));
  }
});
