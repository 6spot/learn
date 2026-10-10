import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

async function internal(file) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/${file}.ts`, import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'neutral', target: 'es2017' });
  const context = vm.createContext({ module: { exports: {} } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(result.outputFiles[0].text, context);
  return context.module.exports;
}

test('internal font codecs match native UTF encodings and do not install globals', async () => {
  const own = await internal('font-codecs');
  for (const text of ['', 'MiSans 春天 nǐ 𠮷', '\ud800A\udfff', '\ufefftest']) {
    const encoded = new own.TextEncoder().encode(text);
    assert.deepEqual(Array.from(encoded), Array.from(new TextEncoder().encode(text)));
    assert.equal(new own.TextDecoder().decode(encoded), new TextDecoder().decode(encoded));
  }
  for (const data of [[0xf0, 0x80, 0x80, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xe2, 0x28, 0xa1], [0x80, 65]]) {
    const bytes = new Uint8Array(data);
    assert.equal(new own.TextDecoder().decode(bytes), new TextDecoder().decode(bytes));
  }
  for (const encoding of ['utf-16be', 'utf-16le', 'ascii']) {
    for (const data of [[0, 65, 0x4e, 0x2d], [0xd8, 0x40, 0xdc, 0x00], [0xd8, 0x00, 0x00], [0x80, 0x9f, 0xff]]) {
      const bytes = new Uint8Array(data);
      assert.equal(new own.TextDecoder(encoding).decode(bytes), new TextDecoder(encoding).decode(bytes));
    }
  }
  assert.throws(() => new own.TextDecoder('unsupported'));
});

test('exact outline bounds handle quadratic and cubic extrema without control-box inflation', async () => {
  const { outlineBounds } = await internal('outline-bounds');
  const move = { command: 'moveTo', args: [0, 0] };
  const quad = outlineBounds([move, { command: 'quadraticCurveTo', args: [1000, 1000, 2000, 0] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(quad)), { xMin: 0, yMin: 0, xMax: 2000, yMax: 500 });
  const cubic = outlineBounds([move, { command: 'bezierCurveTo', args: [0, 1000, 1000, 1000, 1000, 0] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(cubic)), { xMin: 0, yMin: 0, xMax: 1000, yMax: 750 });
  assert.equal(outlineBounds([]), null);
});
