import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import automator from 'miniprogram-automator';

if (process.argv.slice(2).join(' ') !== '--diagnostics') {
  console.error('Use node scripts/test-canvas-devtools.mjs --diagnostics.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../dist/canvas-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
let miniProgram, stage = 'launch', exceptions = 0;
let watchdog;
function checkpoint(name) {
  stage = name; clearTimeout(watchdog);
  watchdog = setTimeout(() => { miniProgram?.disconnect(); console.error(`Canvas diagnostics timed out during ${stage}.`); process.exit(1); }, 60000);
}
checkpoint('launch');
try {
  miniProgram = await automator.launch({ projectPath: root, timeout: 25000 });
  miniProgram.on('exception', () => exceptions++);
  // Only trusted local originals enter the simulator sandbox. No resource server,
  // user text, public font endpoint or committed font binary is involved.
  const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  for (const resource of manifest.fonts) {
    checkpoint(`seeding ${resource.id}`);
    const bytes = await readFile(new URL(`../assets/fonts/${resource.path}`, import.meta.url));
    assert.equal(bytes.length, resource.bytes);
    const filename = `${resource.sha256}.ttf`;
    checkpoint(`seeding ${resource.id} cache probe`);
    const exists = await miniProgram.evaluate(name => {
      const fs = wx.getFileSystemManager(), dir = `${wx.env.USER_DATA_PATH}/learn-fonts`;
      try { fs.mkdirSync(dir, true); } catch { /* already exists */ }
      try { return fs.statSync(`${dir}/${name}`).size; } catch { return 0; }
    }, filename);
    if (exists !== bytes.length) {
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        checkpoint(`seeding ${resource.id} at byte ${offset}`);
        await miniProgram.evaluate((name, data, position, total) => {
          // Assemble original bytes in diagnostic memory and perform one public
          // filesystem write, avoiding repeated growth of large files.
          const app = getApp();
          if (position === 0) app.__learnCanvasFontSeed = new Uint8Array(total);
          const chunk = new Uint8Array(wx.base64ToArrayBuffer(data));
          app.__learnCanvasFontSeed.set(chunk, position);
          if (position + chunk.byteLength === total) {
            const fs = wx.getFileSystemManager(), path = `${wx.env.USER_DATA_PATH}/learn-fonts/${name}`;
            try { fs.writeFileSync(path, app.__learnCanvasFontSeed.buffer); }
            finally { delete app.__learnCanvasFontSeed; }
          }
        }, filename, bytes.subarray(offset, offset + 262144).toString('base64'), offset, bytes.length);
      }
    }
    console.log(`Seeded verified-source candidate: ${resource.id} (${bytes.length} bytes).`);
  }
  checkpoint('opening diagnostic page');
  const page = await miniProgram.reLaunch('/pages/canvas-diagnostics/index');
  assert.equal(page?.path, 'pages/canvas-diagnostics/index');
  await page.waitFor(async () => await page.data('status') === 'ready');
  const reports = [];
  async function run(name, expected = 'ready') {
    checkpoint(name);
    await page.callMethod('runDiagnostic', name);
    await page.waitFor(async () => ['ready', 'error'].includes(await page.data('status')));
    assert.equal(await page.data('status'), expected);
    assert.equal(await page.data('caseName'), name);
    // The SDK's dotted getter maps a null leaf to undefined. Read the object to
    // verify the explicit cleared-report state after a failed render.
    const result = (await page.data()).report;
    const pageCount = await page.data('pageCount');
    if (expected === 'ready') {
      assert.ok(result.segmentCount > 0); assert.ok(result.bitmapWidth > result.cssWidth);
      assert.equal(result.glyphCount === 0, name.startsWith('blank-'));
    } else assert.equal(result, null);
    reports.push({ name, status: expected, pageCount, result });
    await miniProgram.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
    return result;
  }
  for (const name of ['blank-essay', 'blank-tian', 'blank-mi', 'blank-pinyin', 'filled', 'tracing', 'pinyin-filled', 'pinyin-tracing', 'multipage']) await run(name);
  assert.ok(await page.data('pageCount') > 1);
  checkpoint('next page and zoom');
  await page.callMethod('onNext');
  await page.waitFor(async () => await page.data('pageIndex') === 1);
  const before = await page.data('report');
  await page.callMethod('onZoom');
  await page.waitFor(async () => await page.data('zoom') === 1.5);
  const enlarged = await page.data('report');
  assert.deepEqual(enlarged.inkBoundsMm, before.inkBoundsMm);
  assert.equal(enlarged.glyphCount, before.glyphCount);
  assert.equal(enlarged.cssWidth, before.cssWidth * 1.5);
  await miniProgram.screenshot({ path: fileURLToPath(new URL('multipage-zoom.png', output)) });
  await run('resource-error', 'error');
  await run('filled'); // explicit recovery through the same native component
  checkpoint('runtime metadata');
  const system = await miniProgram.systemInfo();
  assert.equal(system.platform, 'devtools'); assert.equal(exceptions, 0);
  const report = { platform: 'devtools', baseLibraryVersion: system.SDKVersion,
    simulatedWechatVersion: system.version, fontBundleVersion: manifest.candidateResourceSetId,
    reports, pagingAndZoom: 'passed', resourceFailureAndRecovery: 'passed', appExceptions: exceptions,
    deviceConfigurationAndPrintingAcceptance: 'pending' };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ platform: report.platform, baseLibraryVersion: report.baseLibraryVersion,
    casesPassed: reports.length, pagingAndZoom: 'passed', appExceptions: exceptions,
    evidence: 'dist/canvas-evidence/report.json', actualDeviceAcceptance: 'pending' }, null, 2));
} catch (error) {
  console.error(`Canvas diagnostics failed during ${stage}; no raw exception or page content was logged.`);
  console.error(`Error class: ${/^[A-Za-z0-9_]+$/.test(error?.name) ? error.name : 'unavailable'}.`);
  console.error(JSON.stringify({ storageLimit: /limit|maximum|storage|quota/i.test(String(error?.message)),
    connectionClosed: /connection.*closed/i.test(String(error?.message)), timeout: /timeout/i.test(String(error?.message)) }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog); miniProgram?.disconnect();
}
