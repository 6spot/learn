import { getLearnApp } from '../../lib/application.js';
import { validJobId } from '../../lib/record-data.js';
import type { RecordListSession, ListView } from '../../lib/record-sessions.js';
import type { NativePage, PagePlatform } from '../../lib/native-page.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
type State = { visible: boolean; navigating: boolean; session: RecordListSession };
const pages = new WeakMap<NativePage, State>();
Page({
  data: { phase: 'idle', message: '', items: [], hasMore: false, loadingMore: false, checkedAt: '' },
  onLoad() {
    const state: State = { visible: false, navigating: false, session: getLearnApp().records.createListSession((view: ListView) => {
      if (state.visible) this.setData({ ...view });
    }) }; pages.set(this, state);
  },
  onShow() { const state = pages.get(this); if (state) { state.visible = true; state.session.setVisible(true); this.setData({ ...state.session.view }); } },
  onHide() { const state = pages.get(this); if (state) { state.visible = false; state.session.setVisible(false); } },
  onUnload() { const state = pages.get(this); if (state) { state.visible = false; getLearnApp().records.release(state.session); pages.delete(this); } },
  onRefresh() { const state = pages.get(this); if (state?.visible) void state.session.refresh(); },
  onMore() { const state = pages.get(this); if (state?.visible) void state.session.more(); },
  onReachBottom() { const state = pages.get(this); if (state?.visible && state.session.view.phase === 'ready') void state.session.more(); },
  onOpen(event: { currentTarget: { dataset: { jobId: string } } }) {
    const state = pages.get(this), jobId = event.currentTarget.dataset.jobId;
    if (!state?.visible || state.navigating || !validJobId(jobId) || !state.session.view.items.some(item => item.jobId === jobId)) return;
    state.navigating = true;
    wx.navigateTo({ url: `/pages/records/detail?jobId=${jobId}`, complete: () => { state.navigating = false; } });
  },
  onChoosePaper() { wx.switchTab({ url: '/pages/templates/index' }); },
});
