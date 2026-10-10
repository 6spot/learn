import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDevelopmentPreset, createLayoutDigest } from '../../packages/paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../packages/font-metrics/dist/index.js';
const root = new URL('../../', import.meta.url), output = new URL('dist/editor-tests/', root);
await mkdir(output, { recursive: true });
for (const name of ['text-cleanup', 'editor-session']) await build({ entryPoints: [fileURLToPath(new URL(`miniprogram/lib/${name}.ts`, root))],
  outfile: fileURLToPath(new URL(`${name}.mjs`, output)), bundle: true, format: 'esm', platform: 'neutral' });
const { cleanBodyNewlines } = await import(new URL('text-cleanup.mjs', output));
const { EditorSession } = await import(new URL('editor-session.mjs', output));
const resources = { 'misans-regular': 'MiSans-Regular.ttf', 'lxgw-wenkai-gb-regular': 'LXGWWenKaiGB-Regular.ttf', 'misans-latin-regular': 'MiSansLatin-Regular.ttf' };
const fonts = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION,
  fonts: Object.fromEntries(await Promise.all(Object.entries(resources).map(async ([id, name]) =>
    [id, new Uint8Array(await readFile(new URL(`assets/fonts/files/${name}`, root)))]))) });
const createSession = dependencies => new EditorSession({ presetFor: getDevelopmentPreset, loadFonts: async () => fonts, ...dependencies });

test('D046 merges only eligible boundaries and preserves line endings, spaces, lists and sentence endings', () => {
  const cases = [
    ['', ''], ['春天来了\n小草发芽。', '春天来了小草发芽。'], ['hello\r\nworld', 'hello world'],
    ['nǐ\nhǎo', 'nǐ hǎo'], ['ǖ\nxī', 'ǖ xī'], ['hello,\nworld', 'hello, world'],
    ['第一段。\r\n第二段', '第一段。\r\n第二段'], ['他说：“你好！”\n她回答', '他说：“你好！”\n她回答'],
    ['第一段\r\n\r\n第二段\r', '第一段\r\n\r\n第二段\r'], ['一\n  \n二', '一\n  \n二'],
    ['hello  \nworld', 'hello  world'], ['hello\n world', 'hello\n world'],
    ['正文\n\t缩进', '正文\n\t缩进'], ['正文\n　缩进', '正文\n　缩进'],
    ['前言\n1. 项目\n2、项目\n（一）项目\n- 项目\n•项目', '前言\n1. 项目\n2、项目\n（一）项目\n- 项目\n•项目'],
    ['abc\n3.14', 'abc 3.14'], ['well-\nknown', 'well-known'], ['中文\nEnglish', '中文English'],
    ['A\rB\nC\r\n\r\nD', 'A B C\r\n\r\nD'], ['\n\r\n\r', '\n\r\n\r'],
    ['你好；\n下一段', '你好；\n下一段'], ['hello:\nworld', 'hello:\nworld'],
  ];
  for (const [before, after] of cases) {
    assert.equal(cleanBodyNewlines(before), after);
    assert.equal(cleanBodyNewlines(after), after, 'cleanup must be idempotent');
  }
});
test('cleanup preview is opt-in, cancel/no-change are inert, and undo survives title/settings/tracing changes', () => {
  const s = createSession(), before = '春天来了\r\n小草发芽。\n\n保留段落';
  s.setBody(before); assert.equal(s.draft.body, before);
  assert.equal(s.prepareCleanup().after, '春天来了小草发芽。\n\n保留段落');
  s.cancelCleanup(); assert.equal(s.draft.body, before); assert.equal(s.canUndo, false);
  s.prepareCleanup(); assert.equal(s.applyCleanup(), 'applied'); assert.equal(s.canUndo, true);
  s.setTitle('新标题'); s.setTracing(true); s.setOptions({ titleAlign: 'right', bodyIndent: 'none' }); s.resetOptions();
  assert.equal(s.canUndo, true); assert.equal(s.undoCleanup(), true); assert.equal(s.draft.body, before);
  assert.equal(s.draft.title, '新标题'); assert.equal(s.draft.tracing, true); assert.equal(s.undoCleanup(), false);
  s.setBody('无换行。'); s.prepareCleanup(); assert.equal(s.applyCleanup(), 'unchanged'); assert.equal(s.draft.body, '无换行。');
});
test('stale cleanup cannot overwrite newer edits; even edit-and-revert invalidates preview and old undo', () => {
  const s = createSession(); s.setBody('one\ntwo'); s.prepareCleanup(); s.setBody('new input');
  assert.equal(s.applyCleanup(), 'stale'); assert.equal(s.draft.body, 'new input');
  s.setBody('one\ntwo'); s.prepareCleanup(); s.setBody('one\nthree'); s.setBody('one\ntwo');
  assert.equal(s.applyCleanup(), 'stale');
  s.prepareCleanup(); s.applyCleanup(); s.setBody('one two!'); assert.equal(s.canUndo, false);
  assert.equal(s.undoCleanup(), false); assert.equal(s.draft.body, 'one two!');
});
test('all four templates preview blank without fonts; real Unicode input/settings survive template switches', async () => {
  let loads = 0; const s = createSession({ loadFonts: async () => { loads++; return fonts; } });
  for (const id of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    s.selectTemplate(id); const preview = await s.preparePreview();
    assert.equal(preview.layout.mode, 'blank'); assert.equal(preview.layout.pages.length, 1);
    assert.equal(preview.digest, createLayoutDigest(preview.layout));
  }
  assert.equal(loads, 0);
  const body = '  nǐ hǎo\r\n\r\nǖ 2026\n';
  s.setBody(body); s.setTitle('标题\r\n第二行'); s.setTracing(true); s.setOptions({ titleAlign: 'right', bodyIndent: 'none' });
  for (const id of ['tian-grid', 'mi-grid', 'essay-grid']) {
    s.selectTemplate(id); const preview = await s.preparePreview();
    assert.ok(preview); assert.equal(preview.input.body, body); assert.equal(preview.input.title, '标题\r\n第二行');
    assert.equal(preview.input.options.titleAlign, 'right'); assert.equal(preview.input.options.bodyIndent, 'none');
  }
  assert.throws(() => { s.draft.options.titleAlign = 'left'; }, TypeError);
});
test('current preset stays locked across active changes and same-template reentry until explicit reload', async () => {
  const original = getDevelopmentPreset('essay-grid'), next = structuredClone(original);
  next.versions.templateVersion = 'v1-development.99'; next.geometry.version = next.versions.templateVersion;
  let active = original; const s = createSession({ presetFor: () => active });
  s.setBody('春天'); active = next; s.selectTemplate('essay-grid');
  assert.equal((await s.preparePreview()).layout.versions.templateVersion, original.versions.templateVersion);
  s.reloadPreset(); assert.equal((await s.preparePreview()).layout.versions.templateVersion, next.versions.templateVersion);
  assert.equal(s.draft.body, '春天');
});
test('font loading deduplicates per revision and late results cannot replace newer inputs/layouts', async () => {
  const pending = []; const s = createSession({ loadFonts: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  s.setBody('旧输入'); const old = s.preparePreview(); assert.equal(old, s.preparePreview());
  s.setBody('新输入'); const current = s.preparePreview(); assert.equal(pending.length, 2);
  pending[1].resolve(fonts); const result = await current; assert.equal(result.input.body, '新输入');
  pending[0].reject(new Error('must never appear in UI')); assert.equal(await old, null);
  assert.equal(s.preview, result); assert.equal(s.status, 'ready'); assert.equal(s.message, '');
});
test('missing resources and unsupported input preserve text, expose safe retry state, and never substitute fonts', async () => {
  let fail = true; const s = createSession({ loadFonts: async () => { if (fail) throw { code: 'PREVIEW_FONT_UNAVAILABLE', message: 'private-source' }; return fonts; } });
  s.setBody('春天'); assert.equal(await s.preparePreview(), null); assert.equal(s.status, 'error');
  assert.equal(s.draft.body, '春天'); assert.equal(s.message.includes('private-source'), false);
  fail = false; assert.ok(await s.preparePreview());
  s.selectTemplate('pinyin-lines'); assert.equal(await s.preparePreview(), null); assert.equal(s.draft.body, '春天');
  s.setBody('nǐ hǎo'); assert.ok(await s.preparePreview()); assert.equal(s.status, 'ready');
});
