import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import automator from 'miniprogram-automator';
if (process.argv.slice(2).join(' ') !== '--diagnostics') {
  console.error('Use node scripts/test-editor-devtools.mjs --diagnostics for fixed synthetic input only.'); process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../dist/editor-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
// An interrupted or failed run must not leave an earlier passing report as current.
await rm(new URL('report.json', output), { force: true });
let miniProgram, stage = 'launch', watchdog, exceptions = 0, maxPreviewDataUrlChars = 0;
const checks = [];
function checkpoint(name) {
  stage = name; clearTimeout(watchdog);
  watchdog = setTimeout(() => { miniProgram?.disconnect(); console.error(`Editor diagnostics timed out during ${stage}.`); process.exit(1); }, 60000);
}
async function waitFor(check) {
  const until = Date.now() + 45000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error('diagnostic wait expired');
}
async function screenshot(name) {
  // The native view transition can finish after the service layer reports ready.
  await new Promise(resolve => setTimeout(resolve, 500));
  await miniProgram.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
}
async function current(path) {
  await waitFor(async () => (await miniProgram.currentPage())?.path === path);
  return miniProgram.currentPage();
}
async function inputField(page, field, value) {
  await (await page.$(`#${field}-input`)).input(value);
  await waitFor(() => miniProgram.evaluate((name, expected) => getApp().editor.draft[name] === expected, field, value));
}
async function checkSnapshot(component) {
  const source = await component.data('imageSource');
  assert.equal(await component.data('snapshot'), true);
  assert.ok(typeof source === 'string' && source.startsWith('data:image/png;base64,') && source.length <= 900000);
  assert.equal(await (await component.$('#paper')).style('visibility'), 'hidden');
  maxPreviewDataUrlChars = Math.max(maxPreviewDataUrlChars, source.length);
}
async function readyEditor(page) {
  await waitFor(() => miniProgram.evaluate(() => {
    const session = getApp().editor; return session.status === 'ready' && session.preview?.revision === session.revision;
  }));
  await waitFor(async () => await page.data('previewStatus') === 'ready');
  const component = await page.$('#crop-paper');
  await waitFor(async () => await component.data('status') === 'ready' &&
    Math.abs(await component.data('cssHeight') - await page.data('cropHeight')) < 0.000001);
  await checkSnapshot(component);
}
async function readyPreview(page) {
  await waitFor(async () => await page.data('status') === 'ready');
  const component = await page.$('#full-paper');
  await waitFor(async () => await component.data('status') === 'ready');
  await checkSnapshot(component);
}
checkpoint('launch');
try {
  miniProgram = await automator.launch({ projectPath: root, timeout: 25000 });
  miniProgram.on('exception', () => exceptions++);
  checkpoint('local original fonts');
  const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  for (const resource of manifest.fonts) {
    const filename = `${resource.sha256}.ttf`;
    const size = await miniProgram.evaluate(name => {
      const fs = wx.getFileSystemManager(), directory = `${wx.env.USER_DATA_PATH}/learn-fonts`;
      try { fs.mkdirSync(directory, true); } catch { /* existing directory */ }
      try { return fs.statSync(`${directory}/${name}`).size; } catch { return 0; }
    }, filename);
    if (size === resource.bytes) continue;
    const bytes = await readFile(new URL(`../assets/fonts/${resource.path}`, import.meta.url));
    assert.equal(bytes.length, resource.bytes);
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      checkpoint(`seeding ${resource.id}`);
      await miniProgram.evaluate((name, encoded, position, total) => {
        const app = getApp();
        if (position === 0) app.__learnEditorFontSeed = new Uint8Array(total);
        const chunk = new Uint8Array(wx.base64ToArrayBuffer(encoded)); app.__learnEditorFontSeed.set(chunk, position);
        if (position + chunk.byteLength === total) {
          try { wx.getFileSystemManager().writeFileSync(`${wx.env.USER_DATA_PATH}/learn-fonts/${name}`, app.__learnEditorFontSeed.buffer); }
          finally { delete app.__learnEditorFontSeed; }
        }
      }, filename, bytes.subarray(offset, offset + 262144).toString('base64'), offset, bytes.length);
    }
  }
  checkpoint('four native template entries');
  let home = await miniProgram.reLaunch('/pages/templates/index');
  const entries = await home.$$('.template-entry'); assert.equal(entries.length, 4);
  await waitFor(async () => await (await home.$('#paper-pinyin-lines')).data('status') === 'ready');
  await screenshot('templates'); checks.push('four-native-template-thumbnails');
  await entries[1].tap(); let editor = await current('pages/editor/index'); await readyEditor(editor);
  checkpoint('initial collapsed settings');
  assert.equal(await editor.data('expanded'), false); assert.equal(await editor.$('#settings-reset'), null);
  checkpoint('unavailable generation is disabled');
  assert.equal(String(await (await editor.$('#generate-pdf')).property('disabled')), 'true');
  let body = await editor.$('#body-input'), title = await editor.$('#title-input');
  const original = '春天来了\r\n小草发芽。\n\nhello\nworld';
  checkpoint('native text and opt-in cleanup');
  await inputField(editor, 'title', '春日练习'); await inputField(editor, 'body', original); await readyEditor(editor);
  assert.equal(await body.value(), original); assert.equal(await title.value(), '春日练习');
  const cropCanvasHeight = await (await editor.$('#crop-paper')).data('cssHeight'), cropHeight = await editor.data('cropHeight');
  if (Math.abs(cropCanvasHeight - cropHeight) >= 0.000001) {
    console.error(JSON.stringify({ cropCanvasHeight, cropHeight })); await screenshot('crop-height-failure');
  }
  assert.ok(Math.abs(cropCanvasHeight - cropHeight) < 0.000001);
  await screenshot('editor-filled');
  await (await editor.$('#cleanup-open')).tap();
  await waitFor(async () => !!(await editor.data()).cleanup);
  assert.equal((await editor.data()).cleanup.before, original);
  assert.equal((await editor.data()).cleanup.after, '春天来了小草发芽。\n\nhello world');
  await screenshot('cleanup-preview');
  await (await editor.$('#cleanup-cancel')).tap(); assert.equal(await body.value(), original);
  await (await editor.$('#cleanup-open')).tap(); await (await editor.$('#cleanup-apply')).tap();
  await waitFor(async () => await body.value() === '春天来了小草发芽。\n\nhello world');
  checks.push('actual-text-cleanup-preview-cancel-apply');
  checkpoint('stable input nodes and advanced settings');
  await (await editor.$('#tracing-switch')).tap();
  await waitFor(async () => await editor.data('tracing') === true);
  await (await editor.$('#settings-toggle')).tap();
  await waitFor(async () => await editor.data('expanded') === true);
  const alignment = await editor.$$('#alignment-options label'); await alignment[2].tap();
  const indent = await editor.$$('#indent-options label'); await indent[1].tap();
  await waitFor(async () => await editor.data('alignment') === 'right' && await editor.data('indent') === 'none');
  await (await editor.$('#settings-reset')).tap();
  checkpoint('advanced reset view update');
  await waitFor(async () => await editor.data('alignment') === 'center' && await editor.data('indent') === 'default');
  assert.equal(await editor.data('alignment'), 'center'); assert.equal(await editor.data('indent'), 'default');
  checkpoint('stable original native inputs after reset');
  assert.equal(await body.value(), '春天来了小草发芽。\n\nhello world');
  assert.equal(await title.value(), '春日练习'); assert.equal(await editor.data('tracing'), true);
  await (await editor.$('#settings-toggle')).tap();
  await (await editor.$('#cleanup-undo')).tap();
  checkpoint('undo native view update');
  await waitFor(async () => (await editor.data()).body === original);
  assert.equal(await body.value(), original); checks.push('stable-inputs-tracing-settings-reset-undo');
  checkpoint('stale cleanup and undo invalidation');
  await (await editor.$('#cleanup-open')).tap();
  await waitFor(async () => !!(await editor.data()).cleanup && !!await editor.$('#cleanup-apply'));
  await inputField(editor, 'body', '更新后的正文');
  await waitFor(async () => (await editor.data()).body === '更新后的正文');
  const staleApply = await editor.$('#cleanup-apply'); assert.ok(staleApply);
  await staleApply.tap();
  await waitFor(async () => (await editor.data()).cleanup === null);
  assert.equal(await body.value(), '更新后的正文');
  assert.equal((await editor.data()).cleanup, null);
  assert.equal(await editor.$('#cleanup-undo'), null); checks.push('stale-preview-refuses-to-overwrite');
  checkpoint('same-page reading, paging and zoom');
  const longBody = '春天来了，万物生长。'.repeat(60);
  await inputField(editor, 'body', longBody); await readyEditor(editor);
  await miniProgram.pageScrollTo(0); await (await editor.$('.paper-crop')).tap();
  let preview = await current('pages/preview/index'); await readyPreview(preview);
  assert.ok(await preview.data('pageCount') > 1);
  const digest = await miniProgram.evaluate(() => getApp().editor.preview.digest);
  await screenshot('preview');
  await (await preview.$('#next-page')).tap();
  await waitFor(async () => await preview.data('pageIndex') === 1); await readyPreview(preview);
  await (await preview.$('#zoom-paper')).tap();
  await waitFor(async () => await preview.data('zoom') === 1.5); await readyPreview(preview);
  assert.equal(await miniProgram.evaluate(() => getApp().editor.preview.digest), digest);
  const reader = await preview.$('#paper-reader');
  assert.ok(Number(await reader.scrollWidth()) > 390);
  await reader.scrollTo(9999, 9999);
  await waitFor(async () => Number(await reader.property('scrollLeft')) > 0 && Number(await reader.property('scrollTop')) > 0);
  const readerSize = await reader.size();
  assert.ok(Math.abs(Number(await reader.property('scrollLeft')) - (Number(await reader.scrollWidth()) - readerSize.width)) < 2);
  assert.ok(Math.abs(Number(await reader.property('scrollTop')) - (Number(await reader.scrollHeight()) - readerSize.height)) < 2);
  await screenshot('preview-zoom-edges');
  checkpoint('reset zoom native view update');
  await (await preview.$('#zoom-paper')).tap();
  await waitFor(async () => await preview.data('zoom') === 1); await readyPreview(preview);
  assert.equal(await preview.data('zoom'), 1);
  editor = await miniProgram.navigateBack(); await readyEditor(editor);
  body = await editor.$('#body-input'); title = await editor.$('#title-input');
  assert.equal(await body.value(), longBody); assert.equal(await title.value(), '春日练习');
  assert.equal(await editor.data('tracing'), true); checks.push('paging-zoom-all-edges-back-preserves-input');
  checkpoint('explicit full-preview entry and private-safe sharing');
  await (await editor.$('#open-preview')).tap(); preview = await current('pages/preview/index'); await readyPreview(preview);
  const share = await preview.callMethod('onShareAppMessage');
  assert.equal(share.imageUrl, '/assets/share-paper.png'); assert.equal(share.path, '/pages/editor/index?template=tian-grid');
  assert.ok(!JSON.stringify(share).includes('春')); checks.push('two-preview-entries-and-fixed-safe-share');
  editor = await miniProgram.navigateBack();
  await miniProgram.navigateBack(); home = await current('pages/templates/index');
  checkpoint('pinyin with preserved draft and real original font');
  await (await home.$$('.template-entry'))[3].tap(); editor = await current('pages/editor/index');
  await waitFor(async () => await editor.data('previewStatus') === 'error');
  assert.equal(await (await editor.$('#body-input')).value(), longBody);
  await inputField(editor, 'title', 'Pīn yīn');
  await inputField(editor, 'body', 'nǐ hǎo xi’an\nā á ǎ à ǖ ǘ ǚ ǜ\nĀ Á Ǎ À Ǖ Ǘ Ǚ Ǜ\nǖ');
  await readyEditor(editor);
  const excerpt = await miniProgram.evaluate(() => {
    const session = getApp().editor;
    const glyph = session.preview.layout.pages[0].glyphs.find(value => value.source.block === 'body' && value.inkBoundsMm);
    return { topMm: Math.max(0, session.preset.geometry.origin.y - 0.5), pageWidthMm: session.preset.geometry.page.width,
      bodyInkBottomMm: glyph.inkBoundsMm.y + glyph.inkBoundsMm.height };
  });
  const visibleBottomMm = excerpt.topMm + await editor.data('cropHeight') * excerpt.pageWidthMm / await editor.data('paperWidth');
  assert.ok(excerpt.bodyInkBottomMm <= visibleBottomMm, 'title and separator must leave first body feedback visible');
  await screenshot('editor-pinyin'); checks.push('pinyin-real-font-and-unsupported-input-preserved');
  checkpoint('empty content remains valid across all templates');
  await inputField(editor, 'body', ''); await inputField(editor, 'title', ''); await readyEditor(editor);
  await miniProgram.navigateBack(); home = await current('pages/templates/index');
  for (const index of [0, 2]) {
    await (await home.$$('.template-entry'))[index].tap(); editor = await current('pages/editor/index'); await readyEditor(editor);
    assert.equal(await (await editor.$('#body-input')).value(), '');
    await miniProgram.navigateBack(); home = await current('pages/templates/index');
  }
  checks.push('blank-default-valid-for-four-templates');
  checks.push('native-png-decoding-bounded-bridge-and-scroll-extents');
  checkpoint('final metadata');
  const system = await miniProgram.systemInfo(); assert.equal(system.platform, 'devtools'); assert.equal(exceptions, 0);
  const report = { platform: 'devtools', baseLibraryVersion: system.SDKVersion, simulatedWechatVersion: system.version,
    checks, appExceptions: exceptions, maxPreviewDataUrlChars, externalConfigurationAndActualDeviceAcceptance: 'pending' };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Editor diagnostics failed during ${stage}; raw page data, source text and exceptions were not logged.`);
  console.error(`Error class: ${/^[A-Za-z0-9_]+$/.test(error?.name) ? error.name : 'unavailable'}.`); process.exitCode = 1;
  if (error?.name === 'AssertionError') console.error(JSON.stringify({ actualType: typeof error.actual, expectedType: typeof error.expected,
    actualNumber: typeof error.actual === 'number' ? error.actual : null,
    expectedNumber: typeof error.expected === 'number' ? error.expected : null,
    actualBoolean: typeof error.actual === 'boolean' ? error.actual : null,
    actualLength: typeof error.actual === 'string' ? error.actual.length : null,
    expectedLength: typeof error.expected === 'string' ? error.expected.length : null,
    actualCR: typeof error.actual === 'string' ? (error.actual.match(/\r/g) ?? []).length : null,
    expectedCR: typeof error.expected === 'string' ? (error.expected.match(/\r/g) ?? []).length : null }));
} finally { clearTimeout(watchdog); miniProgram?.disconnect(); }
