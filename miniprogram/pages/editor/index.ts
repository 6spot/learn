import { getLearnApp } from '../../lib/application.js';
import { templateId, templateName } from '../../lib/templates.js';
import type { NativePage, PagePlatform, TextInputEvent } from '../../lib/native-page.js';
import type { TitleAlignment, BodyIndent } from '../../../packages/paper-core/src/contracts.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
declare function setTimeout(callback: () => void, delay: number): number;
declare function clearTimeout(timer: number): void;
type State = { ready: boolean; visible: boolean; expanded: boolean; unsubscribe: (() => void) | null;
  timer: number | null; renderKey: string; rendering: number; navigating: boolean };
const pages = new WeakMap<NativePage, State>();
function geometry() {
  const preset = getLearnApp().editor.preset, width = wx.getWindowInfo().windowWidth, scale = width / preset.geometry.page.width;
  const heightMm = preset.geometry.kind === 'square-grid'
    ? preset.geometry.cellMm * (preset.geometry.cellMm <= 10 ? 5 : 3) + 1 : 52;
  // Three pinyin bands keep title + blank separator + first body row visible.
  return { paperWidth: width, cropHeight: heightMm * scale, viewport: { topMm: Math.max(0, preset.geometry.origin.y - 0.5), heightMm } };
}
function sync(page: NativePage): void {
  const state = pages.get(page); if (!state?.visible) return;
  const app = getLearnApp(), session = app.editor, draft = session.draft;
  const alignment = draft.options.titleAlign ?? session.preset.defaults.titleAlign;
  const indent = draft.options.bodyIndent ?? 'default';
  const aligned = { left: '左对齐', center: '居中', right: '右对齐' }[alignment];
  const { paperWidth, cropHeight } = geometry();
  page.setData({ paperWidth, cropHeight, title: draft.title, body: draft.body, tracing: draft.tracing,
    bodyLabel: draft.templateId === 'pinyin-lines' ? '拼音' : '正文',
    bodyPlaceholder: draft.templateId === 'pinyin-lines' ? '直接输入拼音，例如 nǐ hǎo' : '输入或粘贴文字，保留你的换行与空行',
    expanded: state.expanded, alignment, indent, settingsSummary: `标题${aligned} · ${indent === 'none' ? '首行不缩进' : '首行按模板默认缩进'}`,
    canCleanup: draft.body.length > 0, canUndo: session.canUndo, cleanup: session.cleanup,
    previewStatus: session.status, previewMessage: session.message,
    canGenerate: app.generation.available && session.status === 'ready', generationMessage: app.generation.message });
  void paint(page);
}
async function paint(page: NativePage): Promise<void> {
  const state = pages.get(page), session = getLearnApp().editor;
  if (!state?.ready || !state.visible) return;
  const preview = session.preview;
  if (!preview) { state.renderKey = ''; page.selectComponent('#crop-paper')?.clear(); return; }
  const { paperWidth: widthPx, viewport } = geometry(), key = `${preview.revision}:${widthPx}`;
  if (state.renderKey === key) return;
  state.renderKey = key;
  const rendering = ++state.rendering;
  const result = await page.selectComponent('#crop-paper')?.display({ layout: preview.layout, fonts: preview.fonts, pageIndex: 0, widthPx, viewport, snapshot: true });
  if (!state.visible || rendering !== state.rendering || session.revision !== preview.revision) return;
  if (!result) { state.renderKey = ''; page.setData({ previewStatus: 'error', previewMessage: '预览未能完成，请重试', canGenerate: false }); }
}
function prepare(page: NativePage, delay = 180): void {
  const state = pages.get(page); if (!state?.visible) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.timer = null; if (state.visible) void getLearnApp().editor.preparePreview(); }, delay);
}
function hide(page: NativePage): void {
  const state = pages.get(page); if (!state) return;
  state.visible = false; state.rendering++; state.renderKey = '';
  state.unsubscribe?.(); state.unsubscribe = null;
  if (state.timer !== null) clearTimeout(state.timer); state.timer = null;
  page.selectComponent('#crop-paper')?.clear();
}
function openPreview(page: NativePage): void {
  const state = pages.get(page); if (!state?.visible || state.navigating) return;
  state.navigating = true;
  wx.navigateTo({ url: '/pages/preview/index', complete: () => { state.navigating = false; } });
}
Page({
  data: { title: '', body: '', bodyLabel: '正文', bodyPlaceholder: '', tracing: false, expanded: false,
    alignment: 'center', indent: 'default', settingsSummary: '', canCleanup: false, canUndo: false, cleanup: null,
    previewStatus: 'idle', previewMessage: '', cropHeight: 90, paperWidth: 1,
    canGenerate: false, generationMessage: '' },
  onLoad(options: { template?: string }) {
    const id = templateId(options.template);
    if (id) getLearnApp().editor.selectTemplate(id);
    wx.setNavigationBarTitle({ title: templateName(getLearnApp().editor.draft.templateId) });
    pages.set(this, { ready: false, visible: false, expanded: false, unsubscribe: null, timer: null,
      renderKey: '', rendering: 0, navigating: false });
  },
  onShow() {
    const state = pages.get(this)!; state.visible = true;
    state.unsubscribe?.(); state.unsubscribe = getLearnApp().editor.subscribe(() => sync(this));
    sync(this); prepare(this, 0);
  },
  onReady() { pages.get(this)!.ready = true; sync(this); prepare(this, 0); },
  onHide() { hide(this); },
  onUnload() { hide(this); pages.delete(this); getLearnApp().editor.cancelCleanup(); },
  onResize() { sync(this); },
  onTitleInput(event: TextInputEvent) { getLearnApp().editor.setTitle(event.detail.value); prepare(this); },
  onBodyInput(event: TextInputEvent) { getLearnApp().editor.setBody(event.detail.value); prepare(this); },
  onTracing(event: { detail: { value: boolean } }) { getLearnApp().editor.setTracing(event.detail.value); prepare(this, 0); },
  onToggleSettings() { const state = pages.get(this)!; state.expanded = !state.expanded; sync(this); },
  onAlignment(event: TextInputEvent) {
    if (!['left', 'center', 'right'].includes(event.detail.value)) return;
    getLearnApp().editor.setOptions({ titleAlign: event.detail.value as TitleAlignment }); prepare(this, 0);
  },
  onIndent(event: TextInputEvent) {
    if (!['default', 'none'].includes(event.detail.value)) return;
    getLearnApp().editor.setOptions({ bodyIndent: event.detail.value as BodyIndent }); prepare(this, 0);
  },
  onResetSettings() { getLearnApp().editor.resetOptions(); prepare(this, 0); },
  onCleanup() { if (getLearnApp().editor.draft.body.length) getLearnApp().editor.prepareCleanup(); },
  onCancelCleanup() { getLearnApp().editor.cancelCleanup(); },
  onApplyCleanup() {
    const result = getLearnApp().editor.applyCleanup();
    if (result === 'stale') wx.showToast({ title: '正文已变化，请重新整理', icon: 'none' });
    if (result === 'applied') prepare(this, 0);
  },
  onUndoCleanup() { if (getLearnApp().editor.undoCleanup()) prepare(this, 0); },
  onPreview() { openPreview(this); },
  onRetryPreview() { pages.get(this)!.renderKey = ''; prepare(this, 0); void paint(this); },
  onGenerate() { wx.showToast({ title: getLearnApp().generation.message, icon: 'none' }); },
  onBlockTouch() {},
  onShareAppMessage() {
    const id = getLearnApp().editor.draft.templateId;
    return { title: `${templateName(id)} · A4 打印`, path: `/pages/editor/index?template=${id}`, imageUrl: '/assets/share-paper.png' };
  },
});
