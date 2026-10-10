import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if (process.argv.slice(2).join(' ') !== '--diagnostics') {
  console.error('Use --diagnostics for synthetic input and simulated update events.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url)), output = new URL('../dist/compatibility-evidence/', import.meta.url);
await mkdir(output, { recursive: true }); await rm(new URL('report.json', output), { force: true });
let miniProgram, stage = 'local service', watchdog, exceptions = 0, mode = 'normal', calls = 0, restored = false;
const checks = [];
function checkpoint(name) {
  stage = name; clearTimeout(watchdog);
  watchdog = setTimeout(() => { miniProgram?.disconnect(); console.error(`Compatibility diagnostics timed out during ${stage}.`); process.exit(1); }, 60000);
}
async function waitFor(check) {
  const end = Date.now() + 45000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error('DIAGNOSTIC_TIMEOUT');
}
async function screenshot(name) { await new Promise(resolve => setTimeout(resolve, 400)); await miniProgram.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) }); }
async function status(expected) { await waitFor(() => miniProgram.evaluate(value => getApp().compatibility.view.status === value, expected)); }
async function stateComponent(page) { return page.$('#application-status'); }
async function restoreDiagnosticState() {
  if (!miniProgram || restored) return;
  await miniProgram.evaluate(() => {
    const app = getApp();
    if (app.__t19) {
      app.__t19.restoreUpdates(); app.clearUserData();
      delete app.__t19; delete app.__learnRpcCallbacks; app.onLaunch();
    }
  });
  // Navigation dismisses the simulator modal; Native.cancelModal does not.
  await miniProgram.reLaunch('/pages/templates/index'); restored = true;
}
checkpoint('local service');
try {
  const { default: automator } = await import('miniprogram-automator');
  const { createLocalService } = await import('./diagnostics/local-service.mjs');
  const { getDevelopmentPreset } = await import('../packages/paper-core/dist/index.js');
  const local = await createLocalService(), rpc = local.rpcFor('diagnostic-update-user');
  checkpoint('launch'); miniProgram = await automator.launch({ projectPath: root, timeout: 25000 });
  miniProgram.on('exception', () => exceptions++);
  await miniProgram.reLaunch('/pages/templates/index');
  checkpoint('install diagnostic bridge');
  // Reuse the diagnostic-only official bridge; the release app has no local identity.
  const { installServiceBridge } = await import('./diagnostics/automator-bridge.mjs');
  await installServiceBridge(miniProgram, async request => {
    calls++;
    return mode === 'normal' || request.method !== 'getCompatibility' ? rpc(request)
      : { ok: false, error: { code: mode === 'network' ? 'NETWORK_UNAVAILABLE' : 'UPDATE_REQUIRED' } };
  });
  checkpoint('application lifecycle');
  await miniProgram.evaluate(() => {
    const app = getApp(), transport = app.client.transport;
    const originalUpdateManager = wx.getUpdateManager, originalShowModal = wx.showModal;
    const state = app.__t19 = { managers: 0, registrations: 0, applied: 0, modalCalls: 0 };
    state.originalShowModal = originalShowModal;
    state.restoreUpdates = () => { wx.getUpdateManager = originalUpdateManager; wx.showModal = originalShowModal; };
    wx.showModal = options => { state.modal = options; state.modalCalls++; };
    wx.getUpdateManager = () => {
      state.managers++;
      return { onCheckForUpdate(callback) { state.registrations++; state.check = callback; },
        onUpdateReady(callback) { state.registrations++; state.ready = callback; },
        onUpdateFailed(callback) { state.registrations++; state.failed = callback; }, applyUpdate() { state.applied++; } };
    };
    app.onLaunch(); app.client.transport = async (method, params) => {
      const response = await transport(method, params);
      if (method === 'getCompatibility' && response.ok) {
        state.responsePrototypeMatches = Object.getPrototypeOf(response.data.current[0].versions) === Object.getPrototypeOf(app.editor.preset.versions);
      }
      return response;
    };
    app.onShow(); app.onShow();
  });
  checkpoint('first compatibility response');
  await waitFor(() => miniProgram.evaluate(() => getApp().compatibility.view.status !== 'checking'));
  assert.equal(await miniProgram.evaluate(() => getApp().compatibility.view.status), 'ready'); assert.equal(calls, 1);
  assert.deepEqual(await miniProgram.evaluate(() => ({ managers: getApp().__t19.managers, registrations: getApp().__t19.registrations })), { managers: 1, registrations: 3 });
  checks.push('single-app-client-launch-foreground-and-update-registration');
  checkpoint('pinned original fonts');
  const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  for (const resource of manifest.fonts) {
    const filename = `${resource.sha256}.ttf`;
    const size = await miniProgram.evaluate(name => {
      const fs = wx.getFileSystemManager(), directory = `${wx.env.USER_DATA_PATH}/learn-fonts`;
      try { fs.mkdirSync(directory, true); } catch { /* existing */ }
      try { return fs.statSync(`${directory}/${name}`).size; } catch { return 0; }
    }, filename);
    if (size === resource.bytes) continue;
    const bytes = await readFile(new URL(`../assets/fonts/${resource.path}`, import.meta.url));
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      checkpoint('pinned font cache');
      await miniProgram.evaluate((name, encoded, position, length) => {
        const state = getApp().__t19; if (!position) state.fontSeed = new Uint8Array(length);
        const bytes = new Uint8Array(wx.base64ToArrayBuffer(encoded)); state.fontSeed.set(bytes, position);
        if (position + bytes.length === length) {
          try { wx.getFileSystemManager().writeFileSync(`${wx.env.USER_DATA_PATH}/learn-fonts/${name}`, state.fontSeed.buffer); }
          finally { delete state.fontSeed; }
        }
      }, filename, bytes.subarray(offset, offset + 262144).toString('base64'), offset, bytes.length);
    }
  }
  checkpoint('native editing and shared status');
  const page = await miniProgram.reLaunch('/pages/editor/index?template=essay-grid');
  await (await page.$('#body-input')).input('春天来了\r\n小草发芽。');
  await (await page.$('#title-input')).input('更新流程练习');
  await waitFor(async () => await page.data('previewStatus') === 'ready');
  const draftBefore = await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft));
  const originalVersion = await miniProgram.evaluate(() => getApp().editor.preset.versions.templateVersion);
  assert.equal(calls, 1); mode = 'network';
  await miniProgram.evaluate(() => { void getApp().compatibility.retry(); }); await status('network-error');
  assert.equal(await (await stateComponent(page)).data('status'), 'network-error'); await screenshot('network-error-preserves-input');
  mode = 'normal'; await (await (await stateComponent(page)).$('#compatibility-retry')).tap(); await status('ready');
  assert.equal(await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft)), draftBefore);
  checks.push('native-shared-network-retry-preserves-exact-draft');
  checkpoint('published preset lock and explicit refresh');
  const admin = local.serviceFor('diagnostic-bootstrap'), old = getDevelopmentPreset('essay-grid'), next = JSON.parse(JSON.stringify(old));
  next.versions.templateVersion = 'v1-diagnostic-update.1'; next.geometry.version = next.versions.templateVersion;
  await admin.publishPreset(next); await admin.activatePreset(next.versions);
  await miniProgram.evaluate(() => { void getApp().compatibility.retry(); }); await status('ready');
  assert.equal(await miniProgram.evaluate(() => getApp().editor.preset.versions.templateVersion), originalVersion);
  await admin.retirePreset(old.versions);
  await miniProgram.evaluate(() => { void getApp().compatibility.retry(); }); await status('refresh-required');
  await screenshot('resource-refresh-required');
  await (await (await stateComponent(page)).$('#compatibility-refresh')).tap(); await status('ready');
  await waitFor(async () => await page.data('previewStatus') === 'ready');
  assert.equal(await miniProgram.evaluate(() => getApp().editor.preview.layout.versions.templateVersion), next.versions.templateVersion);
  assert.equal(await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft)), draftBefore);
  checks.push('real-service-old-lock-retirement-explicit-resource-refresh-and-repreview');
  checkpoint('code update unavailable and failed'); mode = 'update';
  await miniProgram.evaluate(() => { getApp().__t19.check({ hasUpdate: false }); void getApp().compatibility.retry(); }); await status('update-required');
  assert.match(await (await stateComponent(page)).data('updateMessage'), /暂未发现/);
  await miniProgram.evaluate(() => getApp().__t19.failed());
  assert.match(await (await stateComponent(page)).data('updateMessage'), /下载失败/); await screenshot('code-update-failed');
  // A safe history RPC remains usable even while export is incompatible.
  await miniProgram.evaluate(() => { getApp().client.listJobs().then(value => { getApp().__t19.historyReadable = Array.isArray(value.items); }); });
  await waitFor(() => miniProgram.evaluate(() => getApp().__t19.historyReadable === true));
  checks.push('code-update-failure-distinct-from-resources-history-still-readable');
  checkpoint('native update confirmation cancel');
  await miniProgram.evaluate(() => getApp().__t19.ready());
  assert.equal(await miniProgram.evaluate(() => getApp().__t19.applied), 0);
  await (await (await stateComponent(page)).$('#application-update')).tap();
  await waitFor(() => miniProgram.evaluate(() => getApp().__t19.modalCalls === 1));
  assert.equal(await miniProgram.evaluate(() => /不会保留.*复制保存/.test(getApp().__t19.modal.content)), true);
  await miniProgram.evaluate(() => getApp().__t19.modal.success({ confirm: false }));
  await waitFor(async () => await (await stateComponent(page)).data('canUpdate') === true);
  assert.equal(await miniProgram.evaluate(() => getApp().__t19.applied), 0);
  assert.equal(await miniProgram.evaluate(() => JSON.stringify(getApp().editor.draft)), draftBefore);
  checks.push('native-button-and-simulated-modal-cancel-preserve-input-without-restart');
  checkpoint('native update confirmation accept');
  await (await (await stateComponent(page)).$('#application-update')).tap();
  await waitFor(() => miniProgram.evaluate(() => getApp().__t19.modalCalls === 2));
  await miniProgram.evaluate(() => getApp().__t19.modal.success({ confirm: true }));
  await waitFor(() => miniProgram.evaluate(() => getApp().__t19.applied === 1));
  assert.equal(await (await stateComponent(page)).data('canUpdate'), false);
  checks.push('ready-plus-simulated-confirm-applies-mocked-update-once');
  checkpoint('actual native warning display');
  // Native.cancelModal/confirmModal do not deliver callbacks in DevTools 3.17.3.
  // Separately render the exact options captured from the real session via the
  // unmodified native API; state-machine callbacks above are explicitly simulated.
  await miniProgram.evaluate(() => {
    const state = getApp().__t19, options = state.modal;
    state.originalShowModal.call(wx, { title: options.title, content: options.content, confirmText: options.confirmText, cancelText: options.cancelText });
  });
  await screenshot('native-update-input-warning'); checks.push('actual-native-warning-rendered-with-product-options');
  checkpoint('restore native APIs and dismiss diagnostic modal');
  await restoreDiagnosticState(); await screenshot('cleanup-home');
  checkpoint('safe metadata');
  const system = await miniProgram.systemInfo(); assert.equal(system.platform, 'devtools'); assert.equal(exceptions, 0);
  const report = { platform: system.platform, baseLibraryVersion: system.SDKVersion, simulatedWechatVersion: system.version,
    checks, appExceptions: exceptions, compatibilityTransport: 'in-memory bridge to actual local CloudService',
    updateManager: 'simulated events/applyUpdate and confirmation callbacks; native buttons and warning rendering are real',
    nativeModalAutomation: 'SDK Native.cancelModal/confirmModal do not deliver DevTools callbacks; actual interaction remains device acceptance',
    actualPublishedUpdateAndDeviceAcceptance: 'pending' };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Compatibility diagnostics failed during ${stage}; no draft, RPC payload or raw exception logged.`);
  console.error(`Error class: ${/^[A-Za-z0-9_]+$/.test(error?.name) ? error.name : 'unavailable'}.`); process.exitCode = 1;
  const frame = error?.stack?.match(/test-compatibility-devtools\.mjs:\d+:\d+/)?.[0];
  if (frame) console.error(`Diagnostic location: ${frame}.`);
  if (miniProgram) console.error(JSON.stringify(await miniProgram.evaluate(() => ({
    status: getApp().compatibility?.view.status, updateStatus: getApp().compatibility?.view.updateStatus,
    simulatedManagers: getApp().__t19?.managers, simulatedRegistrations: getApp().__t19?.registrations, responsePrototypeMatches: getApp().__t19?.responsePrototypeMatches,
  })).catch(() => ({ diagnosticMetadataUnavailable: true }))));
} finally {
  clearTimeout(watchdog);
  if (miniProgram) { await restoreDiagnosticState().catch(() => {}); miniProgram.disconnect(); }
}
