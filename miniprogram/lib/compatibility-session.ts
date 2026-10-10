import { PAPER_ENGINE_VERSION } from '../../packages/paper-core/src/index.js';
import type { CompatibilityResponse } from '../../packages/cloud-service/dist/index.js';
import type { CloudClient } from './cloud-client.js';
import type { EditorSession } from './editor-session.js';
import { CompatibilityPresets } from './compatibility-presets.js';

export interface NativeUpdateManager {
  onCheckForUpdate(listener: (value: { hasUpdate: boolean }) => void): void;
  onUpdateReady(listener: () => void): void;
  onUpdateFailed(listener: () => void): void;
  applyUpdate(): void;
}
export interface UpdatePlatform {
  getUpdateManager?(): NativeUpdateManager;
  showModal?(options: { title: string; content: string; confirmText: string; cancelText: string;
    success(value: { confirm: boolean }): void; fail(): void }): void;
}
export type CompatibilityStatus = 'idle' | 'checking' | 'ready' | 'network-error' | 'service-unavailable' |
  'account-unavailable' | 'resource-unavailable' | 'refresh-required' | 'update-required';
export type UpdateStatus = 'checking' | 'none' | 'downloading' | 'ready' | 'failed' | 'unavailable';
export type CompatibilityView = Readonly<{ status: CompatibilityStatus; message: string; canGenerate: boolean;
  checking: boolean; canRefresh: boolean; updateStatus: UpdateStatus; updateMessage: string; canUpdate: boolean }>;
const messages: Record<CompatibilityStatus, string> = {
  idle: '正在准备纸张配置', checking: '正在检查纸张配置', ready: '',
  'network-error': '暂时无法检查纸张配置，请检查网络后重试；当前文字已保留',
  'service-unavailable': '生成服务暂不可用，可继续编辑和预览',
  'account-unavailable': '账户当前不可用于生成，可在“我的”查看数据状态',
  'resource-unavailable': '纸张或字体资源暂不可用，请稍后重试；当前文字已保留',
  'refresh-required': '纸张配置需要刷新；刷新后会保留文字并重新预览',
  'update-required': '当前版本暂不支持生成，请更新小程序；当前文字已保留',
};

/** App owns one instance. Compatibility never gates account/history/file RPCs. */
export class CompatibilitySession {
  private response: CompatibilityResponse | null = null;
  private error: CompatibilityStatus | null = null;
  private pending: Promise<boolean> | null = null;
  private refreshing: Promise<boolean> | null = null;
  private lastAttempt = -Infinity;
  private lastSucceeded = false;
  private epoch = 0;
  private started = false;
  private visible = true;
  private listeners = new Set<() => void>();
  private manager: NativeUpdateManager | null = null;
  private updateState: UpdateStatus = 'unavailable';
  private confirming = false;
  private updateApplied = false;
  private cancelConfirmation: (() => void) | null = null;
  constructor(private readonly client: Pick<CloudClient, 'getCompatibility'>, private readonly editor: EditorSession,
    readonly presets: CompatibilityPresets, private readonly platform: UpdatePlatform,
    private readonly resetFonts: () => void, private readonly now: () => number = Date.now) {
    editor.subscribe(() => this.emit());
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private status(): CompatibilityStatus {
    if (this.pending || this.refreshing) return 'checking';
    if (this.error) return this.error;
    if (!this.response) return 'idle';
    if (!this.response.engineSupported) return 'update-required';
    const selected = this.presets.checkedFor(this.editor.preset.versions);
    if (selected?.status === 'ready' && this.presets.isVerified(this.editor.preset)) return 'ready';
    const current = this.presets.currentFor(this.editor.draft.templateId);
    if (current?.status === 'ready') return 'refresh-required';
    if (selected?.status === 'update-required' || current?.status === 'update-required') return 'update-required';
    return 'resource-unavailable';
  }
  get view(): CompatibilityView {
    const status = this.status();
    const updateMessage = this.updateState === 'ready' ? '新版本已准备好，可更新并重启' : status === 'update-required'
      ? ({ checking: '微信正在检查更新', downloading: '微信正在下载更新，请稍候', failed: '更新下载失败，请稍后重新打开小程序',
        none: '暂未发现可用更新，请稍后重新打开小程序', unavailable: '当前环境暂无法更新，请稍后在微信中重新打开' }[this.updateState] ?? '') : '';
    return Object.freeze({ status, message: messages[status], canGenerate: status === 'ready', checking: !!this.pending || !!this.refreshing,
      canRefresh: !this.pending && !this.refreshing && ['ready', 'refresh-required', 'resource-unavailable'].includes(status) && !!this.response?.engineSupported &&
        this.presets.currentFor(this.editor.draft.templateId)?.status === 'ready',
      updateStatus: this.updateState, updateMessage, canUpdate: this.updateState === 'ready' && !!this.platform.showModal && !this.confirming && !this.updateApplied });
  }
  start(): Promise<boolean> {
    if (!this.started) {
      this.started = true;
      try {
        const manager = this.platform.getUpdateManager?.();
        if (manager) {
          this.manager = manager; this.updateState = 'checking';
          manager.onCheckForUpdate(value => { if (this.updateState !== 'ready') this.updateState = value.hasUpdate ? 'downloading' : 'none'; this.emit(); });
          manager.onUpdateReady(() => { this.updateState = 'ready'; this.emit(); });
          manager.onUpdateFailed(() => { this.updateState = 'failed'; this.emit(); });
        }
      } catch { this.manager = null; this.updateState = 'unavailable'; }
    }
    return this.check();
  }
  onShow(): Promise<boolean> { this.visible = true; return this.check(); }
  onHide(): void { this.visible = false; this.cancelConfirmation?.(); }
  retry(): Promise<boolean> { return this.check(true); }
  check(force = false): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!force && this.now() - this.lastAttempt < (this.lastSucceeded ? 60000 : 5000)) return Promise.resolve(this.lastSucceeded);
    const epoch = this.epoch, requested = [this.editor.preset.versions];
    this.lastAttempt = this.now(); this.error = null;
    // Begin in a microtask so pending is set before a synchronous transport/error
    // or empty-input preview can emit a state change.
    const work = Promise.resolve().then(async () => {
      try {
        if (epoch !== this.epoch) return false;
        const raw = await this.client.getCompatibility({ engineVersion: PAPER_ENGINE_VERSION, lockedVersions: requested });
        if (epoch !== this.epoch) return false;
        const wasVerified = this.presets.isVerified(this.editor.preset);
        this.response = this.presets.install(raw, requested);
        if (!wasVerified && this.response.engineSupported) {
          const current = this.presets.currentFor(this.editor.draft.templateId);
          const locked = this.presets.checkedFor(this.editor.preset.versions);
          const selected = current?.published ?? locked?.published;
          if (selected) { this.editor.replacePreset(selected.preset); void this.editor.preparePreview(); }
        }
        this.lastSucceeded = true; return true;
      } catch (error) {
        if (epoch !== this.epoch) return false;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
        this.error = code === 'ACCOUNT_DELETING' || code === 'ACCOUNT_DISABLED' ? 'account-unavailable'
          : code === 'UPDATE_REQUIRED' ? 'update-required' : code === 'NETWORK_UNAVAILABLE' ? 'network-error'
          : code === 'INVALID_RESPONSE' || code === 'RESOURCE_UNAVAILABLE' ? 'resource-unavailable' : 'service-unavailable';
        this.lastSucceeded = false; return false;
      } finally {
        if (epoch === this.epoch) { this.pending = null; this.emit(); }
      }
    });
    this.pending = work; this.emit(); return work;
  }
  refreshResources(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch, template = this.editor.draft.templateId;
    const checked = this.check(true);
    const work = (async () => {
      if (!await checked || epoch !== this.epoch || template !== this.editor.draft.templateId || !this.response?.engineSupported) return false;
      const selected = this.presets.currentFor(template)?.published;
      if (!selected) return false;
      this.resetFonts(); this.editor.replacePreset(selected.preset);
      return !!await this.editor.preparePreview();
    })().finally(() => { if (this.refreshing === work) { this.refreshing = null; this.emit(); } });
    this.refreshing = work; return work;
  }
  async requestUpdate(): Promise<boolean> {
    if (this.updateState !== 'ready' || !this.manager || !this.platform.showModal || this.confirming || this.updateApplied || !this.visible) return false;
    const revision = this.editor.revision, epoch = this.epoch;
    this.confirming = true; this.emit();
    try {
      const confirmed = await new Promise<boolean>(resolve => {
        this.cancelConfirmation = () => resolve(false);
        try { this.platform.showModal!({ title: '更新并重启',
          content: this.editor.hasInput ? '重启后当前文字不会保留。请先自行复制保存文字，确认已保存后再重启更新。'
            : '新版本已准备好，重启后会重新检查纸张配置。',
          confirmText: '重启更新', cancelText: '继续使用', success: result => resolve(result.confirm === true), fail: () => resolve(false) }); }
        catch { resolve(false); }
      });
      if (!confirmed || this.updateState !== 'ready' || !this.visible || this.editor.revision !== revision || this.epoch !== epoch) return false;
      this.updateApplied = true; this.manager.applyUpdate(); return true;
    } catch { this.updateApplied = false; this.updateState = 'failed'; return false; }
    finally { this.cancelConfirmation = null; this.confirming = false; this.emit(); }
  }
  clearUserData(): void {
    this.cancelConfirmation?.();
    this.epoch++; this.pending = null; this.refreshing = null; this.response = null; this.error = null;
    this.lastAttempt = -Infinity; this.lastSucceeded = false; this.presets.clear(); this.emit();
  }
}
