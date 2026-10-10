import { getLearnApp } from '../../lib/application.js';
import { PrivacySession } from '../../lib/privacy-session.js';
import type { NativePage } from '../../lib/native-page.js';
interface PrivacyPlatform {
  showModal(options: { title: string; content: string; confirmText: string; cancelText: string;
    success(result: { confirm: boolean; cancel: boolean }): void; fail(): void }): void;
}
declare const wx: PrivacyPlatform;
declare function Page(options: object & ThisType<NativePage>): void;
type State = { visible: boolean; session: PrivacySession };
const pages = new WeakMap<NativePage, State>();
function hide(page: NativePage): void {
  const state = pages.get(page); if (!state) return;
  state.visible = false; state.session.suspend(); page.setData({ phase: 'idle', canDelete: false });
}
Page({
  data: { phase: 'idle', message: '', uncertain: false, localClearFailed: false, canDelete: false, policy: null, deletion: null },
  onLoad() {
    const state: State = { visible: false, session: new PrivacySession(getLearnApp().client, () => getLearnApp().clearUserData(), view => {
      if (state.visible) this.setData({ ...view });
    }) };
    pages.set(this, state);
  },
  onShow() { const state = pages.get(this); if (!state || state.visible) return; state.visible = true; void state.session.load(); },
  onHide() { hide(this); },
  onUnload() { hide(this); pages.delete(this); },
  onRefresh() { const state = pages.get(this); if (state?.visible) void state.session.load(); },
  onCheckStatus() { const state = pages.get(this); if (state?.visible) void state.session.checkStatus(); },
  onRetryLocalClear() { const state = pages.get(this); if (state?.visible) state.session.retryLocalClear(); },
  onDelete() {
    const state = pages.get(this); if (!state?.visible) return;
    void state.session.deleteData(() => new Promise(resolve => wx.showModal({
      title: '删除我的数据', confirmText: '确认删除', cancelText: '保留数据',
      content: '将清空本机编辑内容、预览和临时 PDF，并申请删除云端数据。受理后无法生成或领取 PDF，已受理任务仍会结算。清理和保护期结束前不能重新使用，无法撤销。你另存或分享的文件不会删除。',
      success: result => resolve(result.confirm === true && result.cancel !== true), fail: () => resolve(false),
    })));
  },
});
