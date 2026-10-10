import { getLearnApp } from '../../lib/application.js';
import type { RecordDetailSession, DetailView } from '../../lib/record-sessions.js';
import type { NativePage, PagePlatform } from '../../lib/native-page.js';
declare const wx: PagePlatform & { navigateBack(options: { delta: number; complete?(): void }): void };
declare function getCurrentPages(): { route: string }[];
declare function Page(options: object & ThisType<NativePage>): void;
type State = { visible: boolean; navigating: boolean; session: RecordDetailSession };
const pages = new WeakMap<NativePage, State>();
function navigate(page: NativePage, url: string): void {
  const state = pages.get(page); if (!state?.visible || state.navigating) return;
  state.navigating = true;
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [], route = url.slice(1).split('?')[0];
  for (let index = stack.length - 2; index >= 0; index--) {
    if (stack[index]!.route === route) { wx.navigateBack({ delta: stack.length - 1 - index, complete: () => { state.navigating = false; } }); return; }
  }
  wx.navigateTo({ url, complete: () => { state.navigating = false; } });
}
Page({
  data: { phase: 'idle', message: '', record: null, canOpen: false, downloading: false, downloadMessage: '', downloadProgress: '', hasEditorInput: false },
  onLoad(options: { jobId?: string }) {
    const state: State = { visible: false, navigating: false, session: getLearnApp().records.createDetailSession(options.jobId ?? '', (view: DetailView) => {
      if (state.visible) this.setData({ ...view });
    }) }; pages.set(this, state);
  },
  onShow() {
    const state = pages.get(this); if (!state) return; state.visible = true; state.session.setVisible(true);
    const draft = getLearnApp().editor.draft;
    this.setData({ ...state.session.view, hasEditorInput: Boolean(draft.title || draft.body) });
  },
  onHide() { const state = pages.get(this); if (state) { state.visible = false; state.session.setVisible(false); } },
  onUnload() { const state = pages.get(this); if (state) { state.visible = false; getLearnApp().records.release(state.session); pages.delete(this); } },
  onRefresh() { const state = pages.get(this); if (state?.visible) void state.session.refresh(); },
  onOpenPdf() { const state = pages.get(this); if (state?.visible) void state.session.openPdf(); },
  onSaveShare() { const state = pages.get(this); if (state?.visible) void state.session.openPdf(); },
  onRecords() { navigate(this, '/pages/records/index'); },
  onReturnEditor() {
    const draft = getLearnApp().editor.draft;
    if (draft.title || draft.body) navigate(this, `/pages/editor/index?template=${draft.templateId}`);
    else wx.switchTab({ url: '/pages/templates/index' });
  },
  onChoosePaper() { wx.switchTab({ url: '/pages/templates/index' }); },
});
