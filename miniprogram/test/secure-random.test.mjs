import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const built = await build({ entryPoints: [new URL('../lib/secure-random.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2017', write: false });
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports });
const { secureUuidV4 } = module.exports;

test('wx.getRandomValues requests 16 bytes and creates canonical UUIDv4 across an API realm without mutating source bytes', async () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, n) => n);
  let count = 0;
  const platform = { getRandomValues(options) { assert.equal(this, platform); assert.equal(options.length, 16); count++; options.success({ randomValues: bytes.buffer }); } };
  assert.equal(await secureUuidV4(platform), '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.equal(count, 1); assert.equal(bytes[6], 6); assert.equal(bytes[8], 8);
  const all = new Uint8Array(16).fill(255);
  assert.equal(await secureUuidV4({ getRandomValues(options) { options.success({ randomValues: all.buffer }); } }), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('missing or failing native entropy never falls back to timestamps, host crypto or Math.random', async () => {
  const platforms = [{}, { get getRandomValues() { throw new Error('private provider details'); } },
    { getRandomValues() { throw new Error('private provider details'); } }, { getRandomValues(options) { options.fail(); } }];
  for (const platform of platforms) await assert.rejects(secureUuidV4(platform), error => error.code === 'SECURE_RANDOM_UNAVAILABLE' && error.message === 'SECURE_RANDOM_UNAVAILABLE');
});

test('wrong entropy type/length and duplicate callbacks fail safely or settle only once', async () => {
  for (const raw of [null, {}, new Uint8Array(16), new ArrayBuffer(0), new ArrayBuffer(15), new ArrayBuffer(17), 'private entropy']) {
    await assert.rejects(secureUuidV4({ getRandomValues(options) { options.success({ randomValues: raw }); } }), { code: 'SECURE_RANDOM_UNAVAILABLE' });
  }
  await assert.rejects(secureUuidV4({ getRandomValues(options) { options.fail(); options.success({ randomValues: new ArrayBuffer(16) }); } }), { code: 'SECURE_RANDOM_UNAVAILABLE' });
  assert.match(await secureUuidV4({ getRandomValues(options) { options.success({ randomValues: new ArrayBuffer(16) }); options.fail(); } }), /^[0-9a-f-]{36}$/);
});

test('spoofed ArrayBuffer tags and overridden byte lengths cannot become predictable UUID entropy', async () => {
  const spoofed = { [Symbol.toStringTag]: 'ArrayBuffer', byteLength: 16, length: 16 };
  const short = new ArrayBuffer(15); Object.defineProperty(short, 'byteLength', { value: 16 });
  for (const raw of [spoofed, short]) {
    await assert.rejects(secureUuidV4({ getRandomValues(options) { options.success({ randomValues: raw }); } }),
      { code: 'SECURE_RANDOM_UNAVAILABLE' });
  }
});
