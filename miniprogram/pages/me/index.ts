import type { NativePage, PagePlatform } from '../../lib/native-page.js';
import { getLearnApp } from '../../lib/application.js';
declare const wx: PagePlatform;
declare function Page(options: object & ThisType<NativePage>): void;
type State = { visible: boolean; navigating: boolean; unsubscribe: (() => void) | null };
const pages = new WeakMap<NativePage, State>();
function hide(page: NativePage): void {
  const state = pages.get(page); if (!state) return;
  state.visible = false; state.unsubscribe?.(); state.unsubscribe = null;
  getLearnApp().records.account.setVisible(false);
}
function navigate(page: NativePage, route: string): void {
  const state = pages.get(page); if (!state?.visible || state.navigating) return;
  state.navigating = true; wx.navigateTo({ url: route, complete: () => { state.navigating = false; } });
}
Page({
  data: { phase: 'idle', message: '', account: null, isAdmin: false },
  onLoad() { pages.set(this, { visible: false, navigating: false, unsubscribe: null }); },
  onShow() {
    const state = pages.get(this); if (!state || state.visible) return;
    state.visible = true;
    const account = getLearnApp().records.account;
    state.unsubscribe = account.subscribe(view => { if (state.visible) this.setData({ ...view }); });
    account.setVisible(true); this.setData({ ...account.view });
  },
  onHide() { hide(this); },
  onUnload() { hide(this); pages.delete(this); },
  onRefresh() { if (pages.get(this)?.visible) void getLearnApp().records.account.refresh(); },
  onRecords() { navigate(this, '/pages/records/index'); },
  onPrivacy() { navigate(this, '/pages/privacy/index'); },
  onAdmin() {
    const view = getLearnApp().records.account.view;
    if (view.phase === 'ready' && view.isAdmin) navigate(this, '/pages/admin/index');
  },
});
