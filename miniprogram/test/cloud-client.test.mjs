import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
const bundle = await build({ entryPoints: [new URL('../lib/cloud-client.ts', import.meta.url).pathname], bundle: true, platform: 'neutral', target: 'es2017', format: 'cjs', write: false });
const module = { exports: {} }; vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports });
const { CloudClient, createCloudClient } = module.exports;

test('native client initializes once and sends only method/params without identity', async () => {
  const initialized = [], calls = [];
  const client = createCloudClient({ cloud: { init: value => initialized.push(value), callFunction: request => {
    calls.push(request); request.success({ result: { ok: true, data: { available: 2 } } });
  } } }, { environmentId: 'test-env', functionName: 'learn-service' });
  assert.equal((await client.getAccount()).available, 2); await client.getAccount();
  assert.equal(initialized.length, 1); assert.equal(initialized[0].traceUser, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), { method: 'getAccount', params: {} });
});

test('absent config, network loss and unsafe error payloads become safe states', async () => {
  await assert.rejects(createCloudClient({}, null).getAccount(), { code: 'SERVICE_UNAVAILABLE' });
  for (const [reply, code] of [[null, 'INVALID_RESPONSE'], [{ ok: true }, 'INVALID_RESPONSE'],
    [{ ok: false, error: { code: 'private article!' } }, 'INVALID_RESPONSE'], [{ ok: false, error: { code: 'QUOTA_EXHAUSTED' } }, 'QUOTA_EXHAUSTED']]) {
    await assert.rejects(new CloudClient(async () => reply).getAccount(), { code });
  }
  await assert.rejects(new CloudClient(async () => { throw new Error('private body'); }).getAccount(), { code: 'NETWORK_UNAVAILABLE' });
});

test('in-memory transport injection uses the same API and preserves exact request data', async () => {
  let seen;
  const client = createCloudClient({}, null);
  client.transport = async (method, params) => { seen = { method, params }; return { ok: true, data: null }; };
  const input = { requestId: 'stable', input: { templateId: 'essay-grid', body: 'one\r\ntwo' }, versions: {}, layoutDigest: 'same' };
  await client.submitGeneration(input); assert.equal(seen.params, input); assert.equal(seen.method, 'submitGeneration');
  await client.findJobByRequest('stable'); assert.equal(seen.params.requestId, 'stable');
});

test('wire PDF chunks decode exact bounded canonical base64 without a native codec', async () => {
  for (const length of [1, 2, 3, 262144]) {
    const bytes = Buffer.alloc(length, 197);
    const client = new CloudClient(async () => ({ ok: true, data: { bytes: bytes.toString('base64') } }));
    const chunk = await client.readPdfChunk({ jobId: 'j_test', offset: 0 });
    assert.deepEqual(Array.from(chunk.bytes), Array.from(bytes));
  }
});

test('malformed, noncanonical and oversized encoded chunks are rejected', async () => {
  for (const encoded of ['', 'YQ', 'YR==', 'YQ=\n', '=AAA', 'A===', Buffer.alloc(262145).toString('base64'), 'A'.repeat(349528) + '!']) {
    const client = new CloudClient(async () => ({ ok: true, data: { bytes: encoded } }));
    await assert.rejects(client.readPdfChunk({ jobId: 'j_test', offset: 0 }), { code: 'INVALID_RESPONSE' });
  }
});
