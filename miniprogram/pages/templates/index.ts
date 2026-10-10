import { getLearnApp } from '../../lib/application.js';
import { PAPER_TEMPLATES, templateId } from '../../lib/templates.js';
import type { NativePage, PagePlatform, TemplateTap } from '../../lib/native-page.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
const pages = new WeakMap<NativePage, { ready: boolean; visible: boolean; navigating: boolean }>();
async function paint(page: NativePage): Promise<void> {
  const state = pages.get(page);
  if (!state?.ready || !state.visible) return;
  const widthPx = Math.min(124, (wx.getWindowInfo().windowWidth - 64) / 2);
  for (const template of PAPER_TEMPLATES) {
    if (!state.visible) return;
    const paper = getLearnApp().editor.blankLayout(template.id);
    // Home thumbnails are UI illustrations: increase screen contrast here only.
    // The session's paper layout, digest and export strokes remain untouched.
    const layout = { ...paper, strokes: {
      grid: { ...paper.strokes.grid, widthMm: 0.65, gray: 0.48 },
      guide: { ...paper.strokes.guide, widthMm: 0.35, gray: 0.64 },
      'writing-line': { ...paper.strokes['writing-line'], widthMm: 0.55, gray: 0.5 },
    } };
    await page.selectComponent(`#paper-${template.id}`)?.display({ layout, fonts: null, pageIndex: 0, widthPx });
  }
}
Page({
  data: { templates: PAPER_TEMPLATES },
  onLoad() { pages.set(this, { ready: false, visible: false, navigating: false }); },
  onShow() { const state = pages.get(this)!; state.visible = true; void paint(this); },
  onReady() { pages.get(this)!.ready = true; void paint(this); },
  onHide() {
    const state = pages.get(this); if (state) state.visible = false;
    for (const template of PAPER_TEMPLATES) this.selectComponent(`#paper-${template.id}`)?.clear();
  },
  onUnload() { pages.delete(this); },
  onSelect(event: TemplateTap) {
    const id = templateId(event.currentTarget.dataset.template), state = pages.get(this);
    if (!id || !state?.visible || state.navigating) return;
    state.navigating = true;
    wx.navigateTo({ url: `/pages/editor/index?template=${id}`, complete: () => { state.navigating = false; } });
  },
  onShareAppMessage() { return { title: '学习纸张 · A4 打印', path: '/pages/templates/index', imageUrl: '/assets/share-paper.png' }; },
});
