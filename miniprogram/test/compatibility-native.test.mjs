import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../dist/miniprogram/', import.meta.url));
function nativeRuntime() {
  let app, definition, calls = 0, applications = 0;
  const modules = new Map(), timers = new Map(), listeners = {}, registrations = [], modals = [];
  const platform = {
    env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ readFile({ fail }) { fail(); } }),
    getUpdateManager() { return { onCheckForUpdate(fn) { registrations.push('check'); listeners.check = fn; },
      onUpdateReady(fn) { registrations.push('ready'); listeners.ready = fn; }, onUpdateFailed(fn) { registrations.push('failed'); listeners.failed = fn; },
      applyUpdate() { applications++; } }; },
    showModal(options) { modals.push(options); },
  };
  const context = vm.createContext({ wx: platform, App(options) { app = options; }, getApp: () => app,
    Component(options) { definition = options; }, setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
  { codeGeneration: { strings: false, wasm: false } });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    assert.ok(file.startsWith(output)); const module = { exports: {} }; modules.set(file, module);
    const require = name => { assert.ok(name.startsWith('.')); return load(resolve(dirname(file), name)); };
    new vm.Script(`(function(require,module,exports){${readFileSync(file, 'utf8')}\n})`, { filename: file }).runInContext(context)(require, module, module.exports);
    return module.exports;
  }
  load(resolve(output, 'app.js')); app.onLaunch.call(app);
  const client = app.client;
  client.transport = async method => { calls++; return method === 'listJobs' ? { ok: true, data: { items: [], nextCursor: null, serverTime: 1000 } } : { ok: false, error: { code: 'NETWORK_UNAVAILABLE' } }; };
  load(resolve(output, 'components/application-status/index.js'));
  const component = () => {
    const instance = { data: {}, changes: 0, setData(value) { Object.assign(this.data, value); this.changes++; } };
    return { instance, attach() { definition.lifetimes.attached.call(instance); }, detach() { definition.lifetimes.detached.call(instance); },
      action(name) { definition.methods[name].call(instance); } };
  };
  return { app, client, component, registrations, listeners, modals, get calls() { return calls; }, get applications() { return applications; } };
}

test('actual emitted App and four native status instances share one request/client and once-only update listeners', async () => {
  const h = nativeRuntime(); h.app.onShow.call(h.app); await h.app.compatibility.check();
  assert.equal(h.app.client, h.client); assert.equal(h.calls, 1); assert.deepEqual(h.registrations, ['check', 'ready', 'failed']);
  const components = Array.from({ length: 4 }, () => h.component()); components.forEach(item => item.attach());
  assert.equal(h.calls, 1); components.forEach(item => assert.equal(item.instance.data.status, 'network-error'));
  components[0].action('onRetry'); components[1].action('onRetry'); await h.app.compatibility.check(); assert.equal(h.calls, 2);
  await h.app.client.listJobs(); assert.equal(h.calls, 3);
  h.listeners.ready(); assert.equal(h.applications, 0); assert.equal(h.modals.length, 0);
  components.forEach(item => assert.equal(item.instance.data.canUpdate, true));
  h.app.editor.setBody('合成练习'); components[0].action('onUpdate'); components[1].action('onUpdate'); assert.equal(h.modals.length, 1);
  h.modals[0].success({ confirm: false }); await Promise.resolve(); assert.equal(h.applications, 0);
  components[0].action('onUpdate'); h.app.onHide.call(h.app); h.app.onShow.call(h.app);
  h.modals[1].success({ confirm: true }); await Promise.resolve(); assert.equal(h.applications, 0);
  const first = components[0]; first.detach(); const changes = first.instance.changes;
  h.listeners.failed(); assert.equal(first.instance.changes, changes); assert.equal(components[1].instance.data.updateStatus, 'failed');
  components.slice(1).forEach(item => item.detach());
});

test('all initial product pages register shared status UI without adding checks or native update listeners', () => {
  for (const page of ['templates', 'editor', 'preview', 'me']) {
    const directory = resolve(output, `pages/${page}`), config = JSON.parse(readFileSync(resolve(directory, 'index.json')));
    assert.equal(resolve(directory, config.usingComponents['application-status']), resolve(output, 'components/application-status/index'));
    assert.match(readFileSync(resolve(directory, 'index.wxml'), 'utf8'), /<application-status[^>]*\/>/);
    assert.doesNotMatch(readFileSync(resolve(directory, 'index.js'), 'utf8'), /getUpdateManager|onUpdateReady|getCompatibility\(/);
  }
  const markup = readFileSync(resolve(output, 'components/application-status/index.wxml'), 'utf8');
  assert.match(markup, /<button[^>]*id="application-update"[^>]*bindtap="onUpdate"/);
});
