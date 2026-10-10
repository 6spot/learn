import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('miniprogram-automator'));
const Jimp = sdkRequire('jimp');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const { decodeQrCode } = require('miniprogram-automator/out/util');

test('official automation SDK decodes QR PNGs with the patched image dependency', async () => {
  const payload = 'learn-official-automation-compatibility';
  const qr = new QRCode(6, 0);
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const scale = 8;
  const margin = 4;
  const size = (count + margin * 2) * scale;
  const canvas = new Jimp(size, size, 0xffffffff);
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (!qr.isDark(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          canvas.setPixelColor(0x000000ff, (x + margin) * scale + dx, (y + margin) * scale + dy);
        }
      }
    }
  }
  const png = await canvas.getBufferAsync(Jimp.MIME_PNG);
  assert.equal(await decodeQrCode(png.toString('base64')), payload);
});
