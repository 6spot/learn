import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));

test('locked actual SDK has the adapter surface and patched legacy HTTP client', async () => {
  const sdk = require('wx-server-sdk');
  for (const method of ['init', 'database', 'getWXContext', 'uploadFile', 'downloadFile', 'deleteFile']) assert.equal(typeof sdk[method], 'function');
  const axios = require('axios');
  assert.equal(axios.VERSION, '0.34.0');
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', bytes => { body += bytes; });
    request.on('end', () => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ method: request.method, body })); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await axios.post(`http://127.0.0.1:${server.address().port}/test`, { value: 3 }, { proxy: false, timeout: 1000 });
    assert.deepEqual(result.data, { method: 'POST', body: '{"value":3}' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

for (const [name, code] of [['learn-service', 'SERVICE_UNAVAILABLE'], ['learn-maintenance', 'MAINTENANCE_UNAVAILABLE']]) {
test(`built ${name} is self contained except SDK, has no simulator, and fails closed without config`, async () => {
  const directory = new URL(`../../../dist/cloudfunctions/${name}/`, import.meta.url);
  const files = await readdir(directory);
  assert.deepEqual(files.sort(), ['build-info.json', 'index.js', 'package-lock.json', 'package.json']);
  const source = await readFile(new URL('index.js', directory), 'utf8');
  for (const pattern of ['StaticIdentityProvider', 'MemoryMetadataStore', 'trusted-test-user', 'synthetic execution fixture',
    '__learnDiagnosticRpc', 'diagnostic-bootstrap', 'diagnostic-app']) assert.ok(!source.includes(pattern), pattern);
  assert.ok(source.length < 8 * 1024 * 1024);
  const exports = {}, module = { exports };
  const sandbox = { module, exports, process: { env: {} }, Buffer, URL, Uint8Array, AbortController, setTimeout, clearTimeout,
    require: id => { if (id === 'wx-server-sdk') return {}; if (id.startsWith('node:')) return require(id); throw new Error(`unbundled import: ${id}`); } };
  vm.runInNewContext(source, sandbox, { timeout: 5000 });
  assert.equal(typeof module.exports.main, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(await module.exports.main({ Type: 'Timer', method: 'getAccount', params: {} }))), { ok: false, error: { code } });
  const manifest = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  assert.deepEqual(manifest.dependencies, { 'wx-server-sdk': '4.0.2' });
  assert.equal(manifest.overrides.axios, '0.34.0');
  for (const file of ['package.json', 'package-lock.json']) {
    assert.equal(await readFile(new URL(file, directory), 'utf8'), await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  const buildInfo = JSON.parse(await readFile(new URL('build-info.json', directory), 'utf8'));
  assert.equal(buildInfo.runtimeVerified, false);
  for (const input of buildInfo.inputs) assert.ok(!/(?:^|\/)(?:test|diagnostics)\/|\.(?:ttf|otf|pdf)$/.test(input), input);
});
}
