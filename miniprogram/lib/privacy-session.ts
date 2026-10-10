import type { DeletionStatus, PrivacyInfo } from '../../packages/cloud-service/dist/index.js';
import { CloudClientError, type CloudClient } from './cloud-client.js';

type Phase = 'idle' | 'loading' | 'ready' | 'confirming' | 'submitting' | 'error';
type Policy = Readonly<{ loadedAt: string; rows: readonly Readonly<{ id: string; label: string; duration: string; note: string }>[] }>;
type Deletion = Readonly<{ state: DeletionStatus['state']; requestedAt: string; earliestReuseAt: string; checkedAt: string }>;
export type PrivacyView = Readonly<{ phase: Phase; message: string; uncertain: boolean; localClearFailed: boolean;
  canDelete: boolean; policy: Policy | null; deletion: Deletion | null }>;
type Client = Pick<CloudClient, 'getPrivacyInfo' | 'getDeletionStatus' | 'deleteMyData'>;
const RETENTION = [
  { id: 'pdfMs', label: 'PDF 领取有效期', note: '成功生成后计时；具体文件以生成记录中的到期时间为准。' },
  { id: 'recordMs', label: '生成记录有效期', note: '从任务受理起计；未结束任务仍需完成结算。' },
  { id: 'requestMs', label: '请求去重保护', note: '受理窗口失效或任务执行截止后继续保护，避免旧请求重复消费。' },
  { id: 'ledgerMs', label: '额度与结算流水', note: '按流水或结算时间计，处理结束后按规则清理。' },
  { id: 'activityMs', label: '有效活跃记录', note: '只保留必要活动事实，不记录文章内容。' },
  { id: 'auditMs', label: '管理操作审计', note: '从操作发生时计，保存必要的操作事实。' },
  { id: 'inactiveUserMs', label: '长期无活动账户', note: '超过该时长后进入分批删除流程。' },
  { id: 'lateIoProtectionMs', label: '迟到文件保护', note: '执行截止后继续清理迟到文件，不代表延长用户领取时间。' },
  { id: 'deletionProtectionMs', label: '删除基础保护', note: '还须等待当月额度周期、有效请求和必要结算保护结束。' },
] as const;
const invalid = (): never => { throw new CloudClientError('INVALID_RESPONSE'); };
function shanghaiTime(at: number): string {
  if (!Number.isSafeInteger(at)) return invalid();
  const date = new Date(at + 8 * 3600000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9999) return invalid();
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
function duration(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 10000000000) return invalid();
  const parts: string[] = [];
  for (const [size, label] of [[86400000, '天'], [3600000, '小时'], [60000, '分钟'], [1000, '秒'], [1, '毫秒']] as const) {
    const count = Math.floor(ms / size); if (count) parts.push(`${count} ${label}`); ms %= size;
  }
  return parts.join(' ');
}
function projectDeletion(value: DeletionStatus): Deletion {
  if (!value || typeof value !== 'object' || !['none', 'active', 'disabled', 'deleting'].includes(value.state)) return invalid();
  const checkedAt = shanghaiTime(value.serverTime);
  if (value.state === 'deleting') {
    if (typeof value.requestedAt !== 'number' || typeof value.earliestReuseAt !== 'number' ||
        value.requestedAt > value.serverTime || value.earliestReuseAt < value.requestedAt) return invalid();
    return { state: value.state, requestedAt: shanghaiTime(value.requestedAt), earliestReuseAt: shanghaiTime(value.earliestReuseAt), checkedAt };
  }
  if (value.requestedAt !== null || value.earliestReuseAt !== null) return invalid();
  return { state: value.state, requestedAt: '', earliestReuseAt: '', checkedAt };
}
function projectPolicy(value: PrivacyInfo): { policy: Policy; deletion: Deletion } {
  if (!value || typeof value !== 'object' || value.policyVersion !== 'learn-privacy-v1' || value.timeZone !== 'Asia/Shanghai' ||
      !value.retention || typeof value.retention !== 'object' || value.serverTime !== value.deletion?.serverTime) return invalid();
  return { policy: { loadedAt: shanghaiTime(value.serverTime), rows: RETENTION.map(item => ({ ...item, duration: duration(value.retention[item.id]) })) },
    deletion: projectDeletion(value.deletion) };
}
function errorCode(error: unknown): unknown { return error && typeof error === 'object' && 'code' in error ? error.code : ''; }
function errorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'NETWORK_UNAVAILABLE') return '网络暂不可用，请重试查询';
  if (code === 'PRIVACY_UNAVAILABLE' || code === 'SERVICE_UNAVAILABLE') return '隐私与数据服务暂不可用，请稍后重试';
  if (code === 'UNAUTHENTICATED') return '暂时无法确认当前账户，请稍后重试';
  if (code === 'ACCOUNT_DELETING') return '账户正在删除，请查询最新处理状态';
  if (code === 'ACCOUNT_DISABLED') return '账户已停用，请查询最新处理状态';
  return '数据状态未能确认，请重试查询';
}

/** No account creation, timers or storage. Destructive calls require an awaited explicit confirmation. */
export class PrivacySession {
  view: PrivacyView = { phase: 'idle', message: '', uncertain: false, localClearFailed: false, canDelete: false, policy: null, deletion: null };
  private revision = 0;
  private pending: Promise<void> | null = null;
  private policyFresh = false;
  constructor(private readonly client: Client, private readonly clearUserData: () => void, private readonly changed: (view: PrivacyView) => void) {}
  private publish(change: Partial<PrivacyView>): void {
    const view = { ...this.view, ...change };
    this.view = { ...view, canDelete: this.policyFresh && view.phase === 'ready' && view.deletion !== null && view.deletion.state !== 'deleting' };
    this.changed(this.view);
  }
  private clearLocal(): void {
    try { this.clearUserData(); this.publish({ localClearFailed: false }); }
    catch { this.publish({ localClearFailed: true }); }
  }
  retryLocalClear(): void { if (this.view.localClearFailed) this.clearLocal(); }
  private accept(deletion: Deletion, policy?: Policy): void {
    if (deletion.state === 'deleting' || deletion.state === 'disabled') this.clearLocal();
    this.publish({ phase: 'ready', message: '', deletion, ...(policy ? { policy } : {}),
      uncertain: deletion.state === 'deleting' || deletion.state === 'none' ? false : this.view.uncertain });
  }
  private failure(error: unknown): void {
    if (errorCode(error) === 'ACCOUNT_DELETING' || errorCode(error) === 'ACCOUNT_DISABLED') this.clearLocal();
    this.publish({ phase: 'error', message: errorMessage(error) });
  }
  load(): Promise<void> { return this.read(true); }
  checkStatus(): Promise<void> { return this.read(false); }
  private read(full: boolean): Promise<void> {
    if (this.pending) return this.pending;
    const revision = ++this.revision;
    if (full) this.policyFresh = false;
    this.publish({ phase: 'loading', message: '' });
    const pending = Promise.resolve().then(async () => {
      if (revision !== this.revision) return;
      if (full) {
        const info = await this.client.getPrivacyInfo();
        if (revision !== this.revision) return;
        const projected = projectPolicy(info); this.policyFresh = true;
        this.accept(projected.deletion, projected.policy);
      } else {
        const status = await this.client.getDeletionStatus();
        if (revision === this.revision) this.accept(projectDeletion(status));
      }
    }).catch(error => { if (revision === this.revision) this.failure(error); })
      .finally(() => { if (revision === this.revision) this.pending = null; });
    this.pending = pending; return pending;
  }
  deleteData(confirm: () => Promise<boolean>): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.view.canDelete) return Promise.resolve();
    const revision = ++this.revision;
    this.publish({ phase: 'confirming', message: '' });
    const pending = Promise.resolve().then(() => revision === this.revision ? confirm() : false).then(async confirmed => {
      if (revision !== this.revision) return;
      if (!confirmed) { this.publish({ phase: 'ready' }); return; }
      this.publish({ phase: 'submitting', uncertain: true });
      this.clearLocal();
      const status = await this.client.deleteMyData({ confirm: true });
      if (revision !== this.revision) return;
      const deletion = projectDeletion(status);
      if (deletion.state !== 'deleting' && deletion.state !== 'none') return invalid();
      this.accept(deletion);
    }).catch(error => { if (revision === this.revision) this.failure(error); })
      .finally(() => { if (revision === this.revision) this.pending = null; });
    this.pending = pending; return pending;
  }
  suspend(): void {
    this.revision++; this.pending = null; this.policyFresh = false;
    this.view = { ...this.view, phase: 'idle', canDelete: false };
  }
}
