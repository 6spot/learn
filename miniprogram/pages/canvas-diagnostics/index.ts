import { buildPageGeometry, createPaperDocument, getDevelopmentPreset, layoutPinyinPaperDocument, layoutSquarePaperDocument } from '../../../packages/paper-core/src/index.js';
import type { PaperLayout } from '../../../packages/paper-core/src/contracts.js';
import type { TemplateId } from '../../../packages/paper-core/src/types.js';
import type { FontId, OriginalFontMetricsProvider } from '../../../packages/font-metrics/dist/index.js';
import type { PaperCanvasHandle } from '../../components/paper-canvas/index.js';
import { loadPreviewFonts, releasePreviewFonts } from '../../lib/font-loader.js';

type Instance = {
  setData(data: Record<string, unknown>): void;
  selectComponent(selector: string): PaperCanvasHandle | null;
};
declare function Page(options: {
  data: Record<string, unknown>;
  onReady(this: Instance): void; onUnload(this: Instance): void;
  runDiagnostic(this: Instance, name: string): void;
  onCase(this: Instance, event: { currentTarget: { dataset: { name: string } } }): void;
  onZoom(this: Instance): void; onPrevious(this: Instance): void; onNext(this: Instance): void;
}): void;
declare const wx: { getWindowInfo(): { windowWidth: number } };
type Session = { active: boolean; revision: number; layout: PaperLayout | null;
  fonts: OriginalFontMetricsProvider | null; pageIndex: number; zoom: number; widthPx: number };
const sessions = new WeakMap<Instance, Session>();
const cases = [
  { name: 'blank-essay', label: '空白作文', templateId: 'essay-grid' },
  { name: 'blank-tian', label: '空白田字', templateId: 'tian-grid' },
  { name: 'blank-mi', label: '空白米字', templateId: 'mi-grid' },
  { name: 'blank-pinyin', label: '空白拼音', templateId: 'pinyin-lines' },
  { name: 'filled', label: '真实填字', templateId: 'tian-grid' },
  { name: 'tracing', label: '真实描红', templateId: 'tian-grid' },
  { name: 'pinyin-filled', label: '拼音填字', templateId: 'pinyin-lines' },
  { name: 'pinyin-tracing', label: '拼音描红', templateId: 'pinyin-lines' },
  { name: 'multipage', label: '多页', templateId: 'mi-grid' },
  { name: 'resource-error', label: '资源缺失', templateId: 'tian-grid' },
] as const;

async function draw(instance: Instance, session: Session): Promise<void> {
  const revision = session.revision;
  if (!session.active || !session.layout) return;
  const result = await instance.selectComponent('#preview')?.display({ layout: session.layout,
    fonts: session.fonts, pageIndex: session.pageIndex, widthPx: session.widthPx, zoom: session.zoom });
  if (!session.active || revision !== session.revision) return;
  instance.setData({ status: result ? 'ready' : 'error', message: result ? '预览绘制完成' : '字体或画布资源不可用',
    pageIndex: session.pageIndex, pageCount: session.layout.pages.length, zoom: session.zoom,
    report: result ?? null });
}
function run(instance: Instance, name: string): void {
  const session = sessions.get(instance);
  const sample = cases.find(item => item.name === name);
  if (!session?.active || !sample) return;
  const revision = ++session.revision;
  session.layout = null; session.fonts = null; session.pageIndex = 0; session.zoom = 1;
  instance.selectComponent('#preview')?.clear();
  instance.setData({ status: 'loading', message: '正在准备预览', caseName: name, report: null });
  void (async () => {
    const preset = getDevelopmentPreset(sample.templateId as TemplateId);
    if (name.startsWith('blank-')) {
      session.layout = { mode: 'blank', versions: preset.versions, strokes: preset.strokes, textStyles: preset.textStyles,
        pages: [{ geometry: buildPageGeometry(preset.geometry), glyphs: [], lines: [], slots: [] }] };
    } else {
      const pinyin = sample.templateId === 'pinyin-lines';
      const tracing = name === 'tracing' || name === 'pinyin-tracing';
      const ids: FontId[] = [pinyin ? 'misans-latin-regular' : 'misans-regular'];
      if (tracing && !pinyin) ids.push('lxgw-wenkai-gb-regular');
      const fonts = await loadPreviewFonts(ids);
      if (!session.active || revision !== session.revision) return;
      const body = pinyin ? 'nǐ hǎo xi’an\nā á ǎ à ǖ ǘ ǚ ǜ\nĀ Á Ǎ À Ǖ Ǘ Ǚ Ǜ\nǖ  b p m f y g'
        : name === 'multipage' ? '春天来了，万物生长。'.repeat(60) : '春天来了，万物生长。\nHello 2026';
      const document = createPaperDocument({ templateId: preset.versions.templateId, body, tracing }, preset);
      session.layout = pinyin ? layoutPinyinPaperDocument(document, fonts) : layoutSquarePaperDocument(document, fonts);
      session.fonts = name === 'resource-error' ? null : fonts;
    }
    if (!session.active || revision !== session.revision) return;
    await draw(instance, session);
  })().catch(() => {
    if (session.active && revision === session.revision) instance.setData({ status: 'error', message: '字体资源不可用，请配置后重试', report: null });
  });
}
function navigate(instance: Instance, delta: number): void {
  const session = sessions.get(instance);
  if (!session?.layout) return;
  const index = Math.max(0, Math.min(session.layout.pages.length - 1, session.pageIndex + delta));
  session.pageIndex = index; session.revision++;
  void draw(instance, session);
}
Page({
  data: { cases, caseName: '', status: 'empty', message: '', pageIndex: 0, pageCount: 0, zoom: 1, report: null },
  onReady() {
    sessions.set(this, { active: true, revision: 0, layout: null, fonts: null, pageIndex: 0, zoom: 1,
      widthPx: wx.getWindowInfo().windowWidth - 32 });
    run(this, 'blank-essay');
  },
  onUnload() {
    const session = sessions.get(this);
    if (session) { session.active = false; session.revision++; session.layout = null; session.fonts = null; }
    sessions.delete(this); releasePreviewFonts();
  },
  runDiagnostic(name) { run(this, name); },
  onCase(event) { run(this, event.currentTarget.dataset.name); },
  onZoom() {
    const session = sessions.get(this);
    if (!session?.layout) return;
    session.zoom = session.zoom === 1 ? 1.5 : 1; session.revision++;
    void draw(this, session);
  },
  onPrevious() { navigate(this, -1); },
  onNext() { navigate(this, 1); },
});
