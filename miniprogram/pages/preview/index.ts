import { getLearnApp } from '../../lib/application.js';
import { templateName } from '../../lib/templates.js';
import type { NativePage, PagePlatform } from '../../lib/native-page.js';
import { generationPageState } from '../../lib/generation-session.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
type State = { ready: boolean; visible: boolean; unsubscribe: (() => void) | null; pageIndex: number; zoom: number;
  hideGeneration: (() => void) | null;
  renderKey: string; revision: number; paintedRevision: number | null };
const pages = new WeakMap<NativePage, State>();
function syncGeneration(page: NativePage): void {
  const state = pages.get(page), app = getLearnApp();
  if (!state?.visible) return;
  page.setData(generationPageState(app.generation, app.compatibility.view.canGenerate,
    state.paintedRevision === app.editor.revision && app.editor.status === 'ready'));
}
async function render(page: NativePage): Promise<void> {
  const state = pages.get(page), app = getLearnApp();
  if (!state?.ready || !state.visible) return;
  const preview = app.editor.preview;
  if (!preview) {
    state.renderKey = ''; state.paintedRevision = null; page.selectComponent('#full-paper')?.clear();
    page.setData({ status: app.editor.status, message: app.editor.message }); syncGeneration(page); return;
  }
  state.pageIndex = Math.max(0, Math.min(state.pageIndex, preview.layout.pages.length - 1));
  const window = wx.getWindowInfo(), widthPx = Math.max(1, window.windowWidth - 32);
  const key = `${preview.revision}:${state.pageIndex}:${state.zoom}:${widthPx}`;
  if (state.renderKey === key) { syncGeneration(page); return; }
  state.renderKey = key; state.paintedRevision = null; const revision = ++state.revision;
  page.setData({ status: 'loading', message: '', pageIndex: state.pageIndex, pageCount: preview.layout.pages.length,
    zoom: state.zoom, contentWidth: widthPx * state.zoom + 32, readerHeight: Math.max(200, window.windowHeight - 180),
    scrollTop: 0, scrollLeft: 0, ...generationPageState(app.generation, app.compatibility.view.canGenerate, false) });
  const result = await page.selectComponent('#full-paper')?.display({ layout: preview.layout, fonts: preview.fonts,
    pageIndex: state.pageIndex, widthPx, zoom: state.zoom, snapshot: true });
  if (!state.visible || revision !== state.revision || preview.revision !== app.editor.revision) return;
  if (!result) state.renderKey = '';
  state.paintedRevision = result ? preview.revision : null;
  page.setData({ status: result ? 'ready' : 'error', message: result ? '' : '预览未能完成，请重试' });
  syncGeneration(page);
}
function hide(page: NativePage): void {
  const state = pages.get(page); if (!state) return;
  state.visible = false; state.revision++; state.renderKey = ''; state.paintedRevision = null; state.unsubscribe?.(); state.unsubscribe = null;
  state.hideGeneration?.(); state.hideGeneration = null;
  page.selectComponent('#full-paper')?.clear();
}
function move(page: NativePage, delta: number): void {
  const state = pages.get(page), preview = getLearnApp().editor.preview;
  if (!state || !preview) return;
  state.pageIndex = Math.max(0, Math.min(preview.layout.pages.length - 1, state.pageIndex + delta)); void render(page);
}
Page({
  data: { status: 'loading', message: '', pageIndex: 0, pageCount: 1, zoom: 1, contentWidth: 1, readerHeight: 400,
    scrollTop: 0, scrollLeft: 0, canGenerate: false, generationStatus: 'idle', generationBusy: false, generationMessage: '',
    generationCanRetry: false, generationCanQuery: false, generationLabel: '生成 PDF', generationHint: '' },
  onLoad() { pages.set(this, { ready: false, visible: false, unsubscribe: null, hideGeneration: null, pageIndex: 0, zoom: 1, renderKey: '', revision: 0, paintedRevision: null }); },
  onShow() {
    const state = pages.get(this)!; state.visible = true;
    state.hideGeneration?.(); state.hideGeneration = getLearnApp().generationNavigation.showPage('pages/preview/index');
    state.unsubscribe?.();
    const app = getLearnApp(), unsubscribeEditor = app.editor.subscribe(() => { void render(this); });
    const unsubscribeCompatibility = app.compatibility.subscribe(() => syncGeneration(this));
    const unsubscribeGeneration = app.generation.subscribe(() => syncGeneration(this));
    state.unsubscribe = () => { unsubscribeEditor(); unsubscribeCompatibility(); unsubscribeGeneration(); };
    syncGeneration(this);
    void getLearnApp().editor.preparePreview(); void render(this);
  },
  onReady() { pages.get(this)!.ready = true; void render(this); },
  onHide() { hide(this); },
  onUnload() { hide(this); pages.delete(this); },
  onResize() { void render(this); },
  onNext() { move(this, 1); },
  onPrevious() { move(this, -1); },
  onZoom() { const state = pages.get(this)!; state.zoom = state.zoom === 1 ? 1.5 : 1; void render(this); },
  onRetry() { pages.get(this)!.renderKey = ''; void getLearnApp().editor.preparePreview(); void render(this); },
  onGenerate() {
    const state = pages.get(this), app = getLearnApp();
    if (state?.visible && generationPageState(app.generation, app.compatibility.view.canGenerate,
      state.paintedRevision === app.editor.revision && app.editor.status === 'ready').canGenerate) return app.generation.startNew();
  },
  onGenerationQuery() { if (pages.get(this)?.visible) return getLearnApp().generation.recover(); },
  onGenerationRetry() { if (pages.get(this)?.visible && getLearnApp().generation.view.canRetry) return getLearnApp().generation.retry(); },
  onShareAppMessage() {
    const id = getLearnApp().editor.draft.templateId;
    return { title: `${templateName(id)} · A4 打印`, path: `/pages/editor/index?template=${id}`, imageUrl: '/assets/share-paper.png' };
  },
});
