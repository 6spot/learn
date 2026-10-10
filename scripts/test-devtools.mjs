import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import automator from 'miniprogram-automator';

// This entry only drives the synthetic development route, never an editor or
// account. A future production home page does not change the diagnostic target.
const diagnostics = process.argv.slice(2);
if (diagnostics.length !== 1 || diagnostics[0] !== '--diagnostics') {
  console.error('Use npm run test:devtools (explicit synthetic diagnostics mode).');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const port = process.env.LEARN_DEVTOOLS_PORT === undefined ? undefined : Number(process.env.LEARN_DEVTOOLS_PORT);
let miniProgram;
let stage = 'configuration';
let exceptions = 0;
// Bound API hangs as well as startup; disconnect below keeps the IDE open.
const watchdog = setTimeout(() => {
  miniProgram?.disconnect();
  console.error(`DevTools diagnostics failed: timeout during ${stage}.`);
  process.exit(1);
}, 60000);

function version(value) {
  return typeof value === 'string' && /^[0-9]+(?:\.[0-9A-Za-z_-]+)+$/.test(value) ? value : 'unavailable';
}

try {
  assert.ok(port === undefined || (Number.isInteger(port) && port >= 1024 && port <= 65535));
  const { runRuntimeSmoke } = require('../dist/runtime/cloud/runtime-smoke.cjs');
  const expected = runRuntimeSmoke().checks;
  assert.ok(expected.length > 0 && expected.every(check => check.status === 'passed'));
  stage = 'launch';
  // With no explicit port the SDK selects an available one. disconnect() leaves
  // the IDE's automation server alive, so reusing a fixed port would break reruns.
  miniProgram = await automator.launch({ projectPath: root, timeout: 25000, ...(port === undefined ? {} : { port }) });
  // Exception payloads may contain source/input: count only, never print them.
  miniProgram.on('exception', () => { exceptions++; });
  stage = 'runtime route';
  const page = await miniProgram.reLaunch('/pages/runtime/index');
  assert.equal(page?.path, 'pages/runtime/index');

  async function checkReport() {
    const checks = await page.data('checks');
    assert.ok(Array.isArray(checks));
    assert.deepEqual(checks.map(check => ({ id: check.id, status: check.status, detail: check.detail })), expected);
    assert.equal(await page.data('summary'), '合成检查通过');
    const capabilities = await page.data('capabilities');
    assert.ok(Array.isArray(capabilities) && capabilities.length > 0);
    assert.ok(capabilities.every(item => typeof item.name === 'string' && typeof item.supported === 'boolean'));
  }

  stage = 'initial report';
  await checkReport();
  stage = 'locating rerun button';
  const button = await page.$('button');
  assert.ok(button);
  // A sentinel proves the native tap actually reran the report, not stale data.
  await page.setData({ checks: [], summary: 'DIAGNOSTIC_TEST_PENDING' });
  stage = 'tapping rerun button';
  await button.tap();
  stage = 'waiting for rerun report';
  await page.waitFor(async () => await page.data('summary') === '合成检查通过');
  stage = 'validating rerun report';
  await checkReport();
  stage = 'runtime metadata';
  const system = await miniProgram.systemInfo();
  assert.equal(system.platform, 'devtools');
  assert.notEqual(version(system.SDKVersion), 'unavailable');
  assert.equal(exceptions, 0);
  console.log(JSON.stringify({
    mode: 'synthetic-development-diagnostics',
    platform: 'devtools',
    baseLibraryVersion: version(system.SDKVersion),
    simulatedWechatVersion: version(system.version),
    // systemInfo.version is the simulated WeChat version, not the IDE version.
    devtoolsVersion: 'not-exposed-by-public-automator-api',
    checksPassed: expected.length,
    rerunButton: 'passed',
    appExceptions: exceptions,
    deviceAndCloudAcceptance: 'pending',
  }, null, 2));
} catch {
  console.error(`DevTools diagnostics failed during ${stage}; no page data or raw exception was logged.`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  miniProgram?.disconnect();
}
