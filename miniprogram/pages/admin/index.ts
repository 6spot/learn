import { getLearnApp } from '../../lib/application.js';
import { AdminSession } from '../../lib/admin-session.js';
import type { NativePage, PagePlatform, TextInputEvent } from '../../lib/native-page.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
type State = { visible: boolean; session: AdminSession };
const pages = new WeakMap<NativePage, State>();
function hide(page: NativePage): void {
  const state = pages.get(page); if (!state) return;
  state.visible = false; state.session.clear();
  page.setData({ status: 'idle', message: '', summary: null });
}
Page({
  data: { status: 'idle', message: '', selectedDate: '', today: '', historical: false, summary: null },
  onLoad() {
    const state: State = { visible: false, session: new AdminSession(getLearnApp().client, view => {
      if (state.visible) this.setData({ ...view });
    }) };
    pages.set(this, state);
  },
  onShow() { const state = pages.get(this); if (!state || state.visible) return; state.visible = true; void state.session.load(); },
  onHide() { hide(this); },
  onUnload() { hide(this); pages.delete(this); },
  onRefresh() { const state = pages.get(this); if (state?.visible) void state.session.load(); },
  onDateChange(event: TextInputEvent) { const state = pages.get(this); if (state?.visible) void state.session.load(event.detail.value); },
  onToday() { const state = pages.get(this); if (state?.visible) void state.session.today(); },
  onBackToMe() { wx.switchTab({ url: '/pages/me/index' }); },
});
