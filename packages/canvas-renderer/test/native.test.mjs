import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { getDevelopmentPreset, buildPageGeometry } from '../../paper-core/dist/index.js';
import { FONT_RESOURCES } from '../../font-metrics/dist/index.js';
const root = new URL('../../../', import.meta.url);
const output = new URL('dist/canvas-tests/', root);
await mkdir(output, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('miniprogram/lib/font-loader.ts', root))],
  outfile: fileURLToPath(new URL('font-loader.mjs', output)), bundle: true, format: 'esm', platform: 'neutral',
  plugins: [{ name: 'shared-font-test', setup(builder) {
    builder.onResolve({ filter: /font-metrics\/dist\/index\.js$/ }, () => ({
      path: fileURLToPath(new URL('packages/font-metrics/dist/index.js', root)), external: true }));
  } }] });
const { createNativeFontLoader } = await import(new URL('font-loader.mjs', output));
const latin = FONT_RESOURCES.find(font => font.id === 'misans-latin-regular');
const latinBytes = new Uint8Array(await readFile(new URL('assets/fonts/files/MiSansLatin-Regular.ttf', root)));
const path = `/private/learn-fonts/${latin.sha256}.ttf`;
function platform(initial = new Map()) {
  const files = new Map(initial), reads = [], writes = [], downloads = [];
  const fs = {
    readFile({ filePath, success, fail }) { reads.push(filePath); const bytes = files.get(filePath);
      queueMicrotask(() => bytes ? success({ data: bytes.slice().buffer }) : fail()); },
    writeFile({ filePath, data, success }) { writes.push(filePath); files.set(filePath, new Uint8Array(data).slice()); success(); },
    mkdirSync() {}, unlinkSync(filePath) { files.delete(filePath); },
  };
  return { env: { USER_DATA_PATH: '/private' }, files, reads, writes, downloads,
    getFileSystemManager: () => fs,
    downloadFile({ url, success }) { downloads.push(url); files.set('/temporary', latinBytes); success({ statusCode: 200, tempFilePath: '/temporary' }); } };
}
test('native font cache loads original bytes, deduplicates concurrent requests, and releases its provider', async () => {
  const host = platform(new Map([[path, latinBytes]])), loader = createNativeFontLoader(host);
  const first = loader.load([latin.id]), second = loader.load([latin.id]);
  assert.equal(first, second);
  const provider = await first;
  assert.equal(provider.hasFont(latin.id), true);
  assert.equal(await loader.load([latin.id]), provider);
  assert.equal(host.reads.length, 1); assert.equal(host.downloads.length, 0);
  loader.clear(); assert.notEqual(await loader.load([latin.id]), provider);
  assert.equal(host.reads.length, 2);
});
test('native font failure is explicit; corrupt private cache is removed and retry downloads a verified original', async () => {
  const corrupt = latinBytes.slice(); corrupt[100] ^= 1;
  const host = platform(new Map([[path, corrupt]]));
  const loader = createNativeFontLoader(host, { [latin.id]: 'https://fonts.example.test/pinned.ttf' });
  await assert.rejects(loader.load([latin.id]), { code: 'PREVIEW_FONT_INVALID' });
  assert.equal(host.files.has(path), false); assert.equal(host.writes.length, 0);
  const recovered = await loader.load([latin.id]);
  assert.equal(recovered.hasFont(latin.id), true);
  assert.deepEqual(host.writes, [path]); assert.equal(host.files.has('/temporary'), false);
  await assert.rejects(createNativeFontLoader(platform()).load([latin.id]), { code: 'PREVIEW_FONT_UNAVAILABLE' });
  await assert.rejects(createNativeFontLoader(platform(), { [latin.id]: 'http://insecure.test/font.ttf' }).load([latin.id]), { code: 'PREVIEW_FONT_CONFIGURATION' });
});
test('bad downloaded originals are never persisted as valid resources', async () => {
  const host = platform();
  host.downloadFile = ({ success }) => { host.files.set('/temporary', new Uint8Array(20)); success({ statusCode: 200, tempFilePath: '/temporary' }); };
  await assert.rejects(createNativeFontLoader(host, { [latin.id]: 'https://fonts.example.test/pinned.ttf' }).load([latin.id]), { code: 'PREVIEW_FONT_INVALID' });
  assert.equal(host.writes.length, 0); assert.equal(host.files.has('/temporary'), false);
});

test('optional cache write failures still return and reuse the verified in-memory provider', async () => {
  for (const writeFile of [({ fail }) => fail(), () => { throw new Error('private cache unavailable'); }]) {
    const host = platform();
    host.getFileSystemManager().writeFile = writeFile;
    const loader = createNativeFontLoader(host, { [latin.id]: 'https://fonts.example.test/pinned.ttf' });
    const provider = await loader.load([latin.id]);
    assert.ok(provider.hasFont(latin.id));
    assert.equal(await loader.load([latin.id]), provider);
    assert.equal(host.downloads.length, 1);
    assert.equal(host.files.has(path), false);
    assert.equal(host.files.has('/temporary'), false);
  }
});

const componentCode = await build({ entryPoints: [fileURLToPath(new URL('miniprogram/components/paper-canvas/index.ts', root))],
  bundle: true, format: 'iife', platform: 'neutral', write: false });
function component() {
  let definition;
  runInNewContext(componentCode.outputFiles[0].text, { Component: value => { definition = value; }, wx: { getWindowInfo: () => ({ pixelRatio: 2 }) } });
  const callbacks = [], events = [], bridge = [];
  const context = new Proxy({}, { get(target, name) { return name in target ? target[name] : () => {}; } });
  const canvas = { width: 1, height: 1, getContext: () => context };
  const instance = {
    data: {},
    setData(data, done) { Object.assign(this.data, data); bridge.push(data); if (done) callbacks.push(done); },
    triggerEvent(name, value) { events.push({ name, value }); },
    createSelectorQuery: () => ({ select: () => ({ fields: (options, callback) => ({ exec: () => callback({ node: canvas }) }) }) }),
  };
  definition.lifetimes.attached.call(instance);
  return { instance, definition, callbacks, canvas, bridge, events,
    display: request => definition.methods.display.call(instance, request),
    detach: () => definition.lifetimes.detached.call(instance) };
}
const preset = getDevelopmentPreset('mi-grid');
const layout = { versions: preset.versions, mode: 'blank', textStyles: preset.textStyles, strokes: preset.strokes,
  pages: [{ geometry: buildPageGeometry(preset.geometry), glyphs: [], lines: [], slots: [] }] };
const request = { layout, fonts: null, pageIndex: 0, widthPx: 320 };
test('native component suppresses stale asynchronous canvas queries and keeps layout off setData', async () => {
  const c = component();
  const stale = c.display(request), latest = c.display({ ...request, zoom: 1.5 });
  c.callbacks.splice(0).forEach(callback => callback());
  assert.equal(await stale, null);
  assert.equal((await latest).cssWidth, 480);
  assert.equal(c.events.length, 1); assert.equal(c.instance.data.status, 'ready');
  assert.ok(c.bridge.every(update => !('layout' in update) && !('fonts' in update) && !('glyphs' in update)));
  c.detach(); assert.equal(c.canvas.width, 1); assert.equal(c.canvas.height, 1);
});
test('native component detachment cancels pending render, and failures cannot display the prior page', async () => {
  const c = component(), pending = c.display(request);
  c.detach(); // A detached native node may never deliver its queued callback.
  assert.equal(await pending, null); assert.equal(c.events.length, 0);
  const d = component(), good = d.display(request);
  d.callbacks.splice(0).forEach(callback => callback()); await good;
  assert.equal(await d.display({ ...request, widthPx: 100000 }), null);
  assert.equal(d.instance.data.status, 'error'); assert.equal(d.canvas.width, 1);
  const unsupported = component();
  unsupported.instance.createSelectorQuery = () => { throw new Error('unsupported platform'); };
  const unavailable = unsupported.display(request);
  assert.doesNotThrow(() => unsupported.callbacks.splice(0).forEach(callback => callback()));
  assert.equal(await unavailable, null);
  assert.equal(unsupported.instance.data.status, 'error');
});
