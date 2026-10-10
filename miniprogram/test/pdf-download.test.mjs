import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const result = await build({ entryPoints: [new URL('../lib/pdf-download.ts', import.meta.url).pathname], bundle: true, platform: 'neutral', target: 'es2017', format: 'esm', write: false });
const { createPdfDownloader } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function fixture() {
  const bytes = new Uint8Array(262145).fill(42), files = new Map(), events = [];
  const info = { jobId: 'j_test', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 1, expiresAt: 9999999999999, chunkBytes: 262144 };
  const client = { getPdfInfo: async () => info, readPdfChunk: async ({ jobId, offset }) => {
    events.push(['chunk', offset]);
    return { jobId, offset, nextOffset: offset + info.chunkBytes >= bytes.length ? null : offset + info.chunkBytes,
      totalBytes: bytes.length, sha256: info.sha256, expiresAt: info.expiresAt, bytes: bytes.slice(offset, offset + info.chunkBytes) };
  } };
  const fs = { mkdirSync() {}, readdirSync: () => [...files.keys()].map(path => path.split('/').pop()), unlinkSync: path => files.delete(path),
    writeFile: options => { files.set(options.filePath, new Uint8Array(options.data)); options.success(); } };
  const platform = { env: { USER_DATA_PATH: '/test' }, getFileSystemManager: () => fs,
    openDocument: options => { events.push(['open', options.fileType, options.showMenu]); options.success(); } };
  return { bytes, files, events, info, client, platform, fs };
}

test('complete ordered chunks and SHA256 are required before one native open; repeated taps merge', async () => {
  const f = fixture(), progress = [], downloader = createPdfDownloader(f.client, f.platform);
  const first = downloader.open('j_test', (received, total) => progress.push([received, total]));
  assert.equal(downloader.open('j_test'), first);
  await first;
  assert.deepEqual([...f.files.values()][0], f.bytes);
  assert.deepEqual(f.events, [['chunk', 0], ['chunk', 262144], ['open', 'pdf', true]]);
  assert.deepEqual(progress.at(-1), [262145, 262145]);
  downloader.clearLocalFiles(); assert.equal(f.files.size, 0);
});

test('truncated, reordered, stale metadata and corrupt chunks never open or write a file', async () => {
  for (const mutate of [chunk => { chunk.offset++; }, chunk => { chunk.nextOffset = null; },
    chunk => { chunk.bytes = chunk.bytes.slice(1); }, chunk => { chunk.sha256 = '0'.repeat(64); },
    chunk => { chunk.expiresAt--; }, chunk => { chunk.bytes[0] ^= 255; }]) {
    const f = fixture(), original = f.client.readPdfChunk;
    f.client.readPdfChunk = async request => { const chunk = await original(request); mutate(chunk); return chunk; };
    await assert.rejects(createPdfDownloader(f.client, f.platform).open('j_test'));
    assert.equal(f.files.size, 0); assert.ok(!f.events.some(event => event[0] === 'open'));
  }
});

test('mid-download authorization expiry, storage failure and viewer failure are safe and retryable', async () => {
  for (const failure of ['expiry', 'write', 'open']) {
    const f = fixture();
    if (failure === 'expiry') { const original = f.client.readPdfChunk; f.client.readPdfChunk = request => {
      if (request.offset) throw Object.assign(new Error('FILE_EXPIRED'), { code: 'FILE_EXPIRED' }); return original(request);
    }; }
    if (failure === 'write') f.fs.writeFile = options => options.fail();
    if (failure === 'open') f.platform.openDocument = options => options.fail();
    await assert.rejects(createPdfDownloader(f.client, f.platform).open('j_test'));
    assert.equal(f.files.size, 0);
  }
});

test('privacy cache clearing cancels an in-flight download before it can write or open', async () => {
  const f = fixture(); let release;
  f.client.getPdfInfo = () => new Promise(resolve => { release = () => resolve(f.info); });
  const downloader = createPdfDownloader(f.client, f.platform), pending = downloader.open('j_test');
  downloader.clearLocalFiles(); release();
  await assert.rejects(pending, { code: 'DOWNLOAD_CANCELLED' });
  assert.equal(f.files.size, 0); assert.deepEqual(f.events, []);
});
