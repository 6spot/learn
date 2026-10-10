import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudBaseMetadataStore, CloudBasePrivateStorage } from '../dist/index.js';
import { createCloudRuntime, createInvocationHandler } from '../../../cloudfunctions/runtime-example/index.mjs';

function fakeDatabase() {
  const tables = new Map();
  const calls = [];
  function collection(name) {
    const rows = tables.get(name) ?? new Map(); tables.set(name, rows);
    let filter = {}, cap = 50;
    return {
      doc: id => ({
        get: async () => { if (!rows.has(id)) throw { code: 'VERIFIED_MISSING' }; return { data: { _id: id, ...rows.get(id) } }; },
        set: async ({ data }) => { rows.set(id, structuredClone(data)); },
        remove: async () => { rows.delete(id); },
      }),
      where(value) { filter = value; calls.push(['where', value]); return this; },
      orderBy(...args) { calls.push(['orderBy', ...args]); return this; },
      limit(value) { cap = value; return this; },
      get: async () => ({ data: [...rows].sort().filter(([id, row]) => Object.entries(filter).every(([key, value]) =>
        key === '_id' ? id > value.gt : row[key] === value)).slice(0, cap).map(([id, row]) => ({ _id: id, ...row })) }),
    };
  }
  return { calls, collection, command: { gt: value => ({ gt: value }) }, runTransaction: work => work({ collection }) };
}

test('CloudBase adapter maps metadata envelopes, transaction creates, and bounded owner queries', async () => {
  const sdk = fakeDatabase();
  const db = new CloudBaseMetadataStore(sdk, error => error?.code === 'VERIFIED_MISSING');
  assert.equal(await db.get('jobs', 'missing'), null);
  await db.transaction(async tx => {
    await tx.create('jobs', 'a', { owner: 'me', state: 'RESERVED' });
    await tx.create('jobs', 'b', { owner: 'other', state: 'RESERVED' });
    await tx.create('jobs', 'c', { owner: 'me', state: 'GENERATING' });
  });
  assert.deepEqual(await db.get('jobs', 'a'), { owner: 'me', state: 'RESERVED' });
  await assert.rejects(db.transaction(tx => tx.create('jobs', 'a', {})), { code: 'ALREADY_EXISTS' });
  assert.deepEqual(await db.list('jobs', { where: { owner: 'me' }, afterId: 'a', limit: 1 }), [
    { id: 'c', value: { owner: 'me', state: 'GENERATING' } },
  ]);
  assert.deepEqual(sdk.calls[0], ['where', { owner: 'me', _id: { gt: 'a' } }]);
});

test('provider failures are safe and never mistaken for absent records', async () => {
  const secretError = new Error('synthetic-content-and-credential');
  const sdk = fakeDatabase();
  sdk.collection = () => ({ doc: () => ({ get: async () => { throw secretError; } }) });
  const db = new CloudBaseMetadataStore(sdk, error => error?.code === 'VERIFIED_MISSING');
  await assert.rejects(db.get('jobs', 'job'), error => error.code === 'DATABASE_UNAVAILABLE' && !error.message.includes('credential'));
  const domainError = new Error('DOMAIN_REJECTION');
  await assert.rejects(db.transaction(async () => { throw domainError; }), error => error === domainError);
  sdk.runTransaction = async () => { throw secretError; };
  await assert.rejects(db.transaction(async () => 1), { code: 'DATABASE_UNAVAILABLE' });
});

test('SDK write failures inside a transaction are sanitized while domain failures remain recognizable', async () => {
  const sdk = fakeDatabase();
  const failure = async () => { throw new Error('synthetic-private-content'); };
  sdk.runTransaction = work => work({ collection: () => ({ doc: () => ({ set: failure, remove: failure }) }) });
  const db = new CloudBaseMetadataStore(sdk);
  await assert.rejects(db.transaction(tx => tx.set('jobs', 'job', { state: 'RESERVED' })), { message: 'DATABASE_UNAVAILABLE' });
  await assert.rejects(db.transaction(tx => tx.delete('jobs', 'job')), { message: 'DATABASE_UNAVAILABLE' });
});

test('storage adapter exposes bytes only, copies Buffers and checks per-file delete status', async () => {
  const bytes = Buffer.from('%PDF-synthetic');
  const calls = [];
  const sdk = {
    uploadFile: async input => { calls.push(input); return { fileID: 'cloud://private-file' }; },
    downloadFile: async () => ({ fileContent: bytes }),
    deleteFile: async () => ({ fileList: [{ fileID: 'cloud://private-file', status: 0 }] }),
  };
  const storage = new CloudBasePrivateStorage(sdk, () => 'cloud://private-file');
  assert.equal(await storage.put('jobs/job/batch.pdf', bytes), 'cloud://private-file');
  assert.equal(calls[0].cloudPath, 'jobs/job/batch.pdf');
  const downloaded = await storage.read('cloud://private-file');
  downloaded[0] = 0;
  assert.equal(bytes[0], 37);
  await storage.remove('cloud://private-file');
  sdk.deleteFile = async () => ({ fileList: [{ fileID: 'cloud://private-file', status: -1 }] });
  await assert.rejects(storage.remove('cloud://private-file'), { code: 'STORAGE_UNAVAILABLE' });
  sdk.downloadFile = async () => { throw new Error('synthetic-content'); };
  await assert.rejects(storage.read('cloud://private-file'), { message: 'STORAGE_UNAVAILABLE' });
});

test('storage requires a verified deterministic resolver and rejects mismatching upload IDs', async () => {
  let removed;
  const sdk = {
    uploadFile: async () => ({ fileID: 'cloud://actual-file' }),
    deleteFile: async ({ fileList }) => {
      removed = fileList;
      return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
    },
  };
  assert.throws(() => new CloudBasePrivateStorage(sdk), { code: 'INVALID_ARGUMENT' });
  const storage = new CloudBasePrivateStorage(sdk, () => 'cloud://misconfigured-file');
  await assert.rejects(storage.put('jobs/job/batch.pdf', new Uint8Array([1])), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(removed, ['cloud://actual-file']);
});

test('deploy composition rejects unconfigured production and initializes only the selected trusted environment', () => {
  const initialized = [];
  const sdk = { init: value => initialized.push(value), database: fakeDatabase };
  const config = { stage: 'development', developmentEnvironmentId: 'dev_example', productionEnvironmentId: 'prod_example',
    appId: 'app_example', fileIdPrefix: 'cloud://private-example/', missingDocumentCodes: ['VERIFIED_MISSING'], platformVerified: false };
  const runtime = createCloudRuntime(sdk, config);
  assert.deepEqual(initialized, [{ env: 'dev_example' }]);
  assert.equal(runtime.storage.resolve('jobs/job/batch.pdf'), 'cloud://private-example/jobs/job/batch.pdf');
  assert.throws(() => createCloudRuntime(sdk, { ...config, stage: 'production' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => createCloudRuntime(sdk, { ...config, missingDocumentCodes: [] }), { code: 'INVALID_ARGUMENT' });
  assert.equal(initialized.length, 1);
});

test('invocation composition passes trusted identity and awaits the injected application service', async () => {
  const config = { stage: 'development', developmentEnvironmentId: 'dev_example', productionEnvironmentId: 'prod_example',
    appId: 'app_example', fileIdPrefix: 'cloud://private-example/', missingDocumentCodes: ['VERIFIED_MISSING'] };
  const runtime = createCloudRuntime({ init() {}, database: fakeDatabase,
    getWXContext: () => ({ APPID: 'app_example', OPENID: 'trusted_owner' }) }, config);
  let release;
  let returned = false;
  const main = createInvocationHandler(runtime, async ({ identity }) => {
    assert.equal(identity.subject, 'trusted_owner');
    await new Promise(resolve => { release = resolve; });
    return { state: 'SUCCEEDED' };
  });
  const invocation = main({ userId: 'attacker', OPENID: 'attacker' }).then(value => { returned = true; return value; });
  await Promise.resolve();
  assert.equal(returned, false);
  release();
  assert.deepEqual(await invocation, { state: 'SUCCEEDED' });
});
