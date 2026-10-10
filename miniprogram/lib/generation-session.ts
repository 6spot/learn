import { createRequestId, type GenerationRequest, type JobSummary, type SubmissionWindow, type SubmitGenerationResponse } from '../../packages/cloud-service/dist/index.js';
import { assertLayoutDigestMatches, validateLayoutVersions } from '../../packages/paper-core/src/index.js';
import type { PaperInput, LayoutVersionTuple } from '../../packages/paper-core/src/contracts.js';
import type { EditorPreview, EditorSession } from './editor-session.js';
import { CloudClientError, type CloudClient } from './cloud-client.js';

declare function setTimeout(callback: () => void, delay: number): number;
declare function clearTimeout(handle: number): void;
export interface GenerationTimers { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
export interface GenerationDependencies {
  client: Pick<CloudClient, 'getSubmissionWindow' | 'submitGeneration' | 'findJobByRequest'>;
  editor: Pick<EditorSession, 'revision' | 'preparePreview'>;
  canGenerate(): boolean;
  secureUuid(): Promise<string>;
  onJobKnown(jobId: string): void | Promise<void>;
  /** Local UI wait only, unrelated to the cloud task's authoritative deadline. */
  waitTimeoutMs: number;
  timers?: GenerationTimers;
}
export type GenerationResult = Readonly<{ kind: 'known'; jobId: string } | { kind: 'blocked' | 'unresolved' | 'cancelled' }>;
export type GenerationView = Readonly<{
  status: 'idle' | 'preparing' | 'submitting' | 'querying' | 'uncertain' | 'known' | 'error';
  busy: boolean; message: string; jobId: string | null; canRetry: boolean; canStartNew: boolean; hasRequest: boolean;
}>;
type Snapshot = Readonly<{ input: PaperInput; versions: LayoutVersionTuple; layoutDigest: string }>;
type Attempt = { revision: number; snapshot: Snapshot | null; request: GenerationRequest | null;
  nonce: string | null; mayExist: boolean; jobId: string | null; notified: boolean; retryable: boolean };
const definitive = new Set(['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'ACCOUNT_DELETING', 'FORBIDDEN', 'INVALID_ARGUMENT',
  'INVALID_INPUT', 'INPUT_LIMIT_EXCEEDED', 'REQUEST_INVALID', 'REQUEST_EXPIRED', 'RECORD_EXPIRED', 'IDEMPOTENCY_CONFLICT',
  'KEY_UNAVAILABLE', 'FINGERPRINT_UNSUPPORTED', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'CONCURRENCY_LIMITED', 'UPDATE_REQUIRED',
  'RESOURCE_UNAVAILABLE', 'VERSION_RETIRED', 'EXECUTION_UNAVAILABLE', 'NOT_FOUND', 'SERVICE_UNAVAILABLE']);
const noRetry = new Set(['REQUEST_INVALID', 'REQUEST_EXPIRED', 'RECORD_EXPIRED', 'IDEMPOTENCY_CONFLICT']);
const codeOf = (error: unknown) => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
function messageFor(code: string): string {
  const messages: Record<string, string> = {
    COMPATIBILITY_REQUIRED: '当前纸张配置暂不能生成，请先完成检查或刷新',
    PREVIEW_CHANGED: '内容已变化，请确认当前预览后重新生成', PREVIEW_UNAVAILABLE: '请先完成当前内容的预览后再生成',
    SECURE_RANDOM_UNAVAILABLE: '暂时无法安全创建生成请求，请重试',
    QUOTA_EXHAUSTED: '本月可用次数不足，请在“我的”查看额度', RATE_LIMITED: '操作较频繁，请稍后重试本次请求',
    CONCURRENCY_LIMITED: '仍有任务处理中，请稍后重试本次请求',
    UPDATE_REQUIRED: '当前版本需要更新，请先保留文字并查看更新提示',
    RESOURCE_UNAVAILABLE: '纸张或字体资源暂不可用，请稍后重试', VERSION_RETIRED: '本次纸张版本已停用，请刷新配置后重新预览',
    EXECUTION_UNAVAILABLE: '生成服务暂不可用，请稍后重试', SERVICE_UNAVAILABLE: '生成服务暂不可用，请稍后重试',
    ACCOUNT_DISABLED: '账户当前不能生成，请在“我的”查看数据状态', ACCOUNT_DELETING: '账户数据正在删除，暂不能生成',
    UNAUTHENTICATED: '暂时无法确认账户，请重试', FORBIDDEN: '当前账户无权执行该操作',
    REQUEST_EXPIRED: '本次请求已过期，请确认内容后主动重新生成', RECORD_EXPIRED: '原记录已到期或删除，需要时请主动重新生成',
    IDEMPOTENCY_CONFLICT: '本次请求参数未能核对，请查看已有记录后再操作',
    INVALID_INPUT: '输入内容暂不支持，请调整后重新预览', INPUT_LIMIT_EXCEEDED: '文字超过生成限制，请减少内容后重新预览',
    WAIT_TIMEOUT: '本次准备等待超时，可重试；尚未提交生成', NETWORK_UNAVAILABLE: '网络暂不可用，可重试本次操作',
  };
  return Object.prototype.hasOwnProperty.call(messages, code) ? messages[code]! : '本次操作未能完成，请重试或查看生成记录';
}
function capture(preview: EditorPreview): Snapshot {
  validateLayoutVersions(preview.layout.versions); assertLayoutDigestMatches(preview.layout, preview.digest);
  const input = preview.input, options = input.options ?? {};
  if (input.templateId !== preview.layout.versions.templateId || typeof (input.title ?? '') !== 'string' ||
      typeof (input.body ?? '') !== 'string' || typeof (input.tracing ?? false) !== 'boolean' ||
      options.titleAlign !== undefined && !['left', 'center', 'right'].includes(options.titleAlign) ||
      options.bodyIndent !== undefined && !['default', 'none'].includes(options.bodyIndent)) throw new CloudClientError('PREVIEW_UNAVAILABLE');
  return Object.freeze({ input: Object.freeze({ templateId: input.templateId, title: input.title ?? '', body: input.body ?? '',
    tracing: input.tracing ?? false, options: Object.freeze({ ...(options.titleAlign === undefined ? {} : { titleAlign: options.titleAlign }),
      ...(options.bodyIndent === undefined ? {} : { bodyIndent: options.bodyIndent }) }) }),
    versions: Object.freeze({ ...preview.layout.versions }), layoutDigest: preview.digest });
}
function knownJob(value: JobSummary, request: GenerationRequest): string {
  if (!value || typeof value !== 'object' || typeof value.jobId !== 'string' || !/^j_[a-f0-9-]{36}$/.test(value.jobId) ||
      value.requestId !== request.requestId || value.templateId !== request.input.templateId ||
      !['RESERVED', 'GENERATING', 'SUCCEEDED', 'FAILED'].includes(value.status)) throw new CloudClientError('INVALID_RESPONSE');
  return value.jobId;
}

/** App-owned transient submission. Cloud jobs/credits stay authoritative in T21/cloud. */
export class GenerationSession {
  private attempt: Attempt | null = null;
  private pending: Promise<GenerationResult> | null = null;
  private epoch = 0;
  private status: GenerationView['status'] = 'idle';
  private message = '';
  private readonly listeners = new Set<() => void>();
  private readonly cancelWaits = new Set<() => void>();
  private readonly timers: GenerationTimers;
  constructor(private readonly deps: GenerationDependencies) {
    if (!Number.isSafeInteger(deps.waitTimeoutMs) || deps.waitTimeoutMs <= 0 || deps.waitTimeoutMs > 2147483647) throw new CloudClientError('INVALID_CONFIG');
    this.timers = deps.timers ?? { set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as number) };
  }
  get view(): GenerationView {
    return Object.freeze({ status: this.status, busy: this.pending !== null, message: this.message, jobId: this.attempt?.jobId ?? null,
      canRetry: this.pending === null && !!this.attempt && !this.attempt.jobId && this.attempt.retryable,
      canStartNew: this.pending === null && (!this.attempt?.mayExist || !!this.attempt.jobId), hasRequest: !!this.attempt?.request });
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private show(status: GenerationView['status'], message: string): void { this.status = status; this.message = message; this.emit(); }
  private current(attempt: Attempt, epoch: number): boolean { return this.epoch === epoch && this.attempt === attempt; }
  private wait<T>(promise: Promise<T>, epoch: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let finished = false, handle: unknown;
      const finish = (action: () => void) => {
        if (finished) return; finished = true; this.timers.clear(handle); this.cancelWaits.delete(cancel); action();
      };
      const cancel = () => finish(() => reject(new CloudClientError('LOCAL_CANCELLED')));
      this.cancelWaits.add(cancel);
      handle = this.timers.set(() => finish(() => reject(new CloudClientError('WAIT_TIMEOUT'))), this.deps.waitTimeoutMs);
      promise.then(value => finish(() => this.epoch === epoch ? resolve(value) : reject(new CloudClientError('LOCAL_CANCELLED'))),
        error => finish(() => reject(error)));
      if (epoch !== this.epoch) cancel();
    });
  }
  private launch(work: () => Promise<GenerationResult>): Promise<GenerationResult> {
    if (this.pending) return this.pending;
    const promise = Promise.resolve().then(work).then(result => {
      if (this.pending === promise) { this.pending = null; this.emit(); } return result;
    }, () => {
      if (this.pending === promise) { this.pending = null; this.show('error', messageFor('')); }
      return { kind: 'blocked' } as const;
    });
    this.pending = promise; this.emit(); return promise;
  }
  submit(): Promise<GenerationResult> {
    if (this.pending) return this.pending;
    if (this.attempt) return this.retry();
    return this.startNew();
  }
  startNew(): Promise<GenerationResult> {
    if (this.pending) return this.pending;
    if (this.attempt?.mayExist && !this.attempt.jobId) return this.recover();
    if (!this.deps.canGenerate()) { this.show('error', messageFor('COMPATIBILITY_REQUIRED')); return Promise.resolve({ kind: 'blocked' }); }
    this.eraseAttempt(); this.epoch++;
    const attempt: Attempt = { revision: this.deps.editor.revision, snapshot: null, request: null, nonce: null,
      mayExist: false, jobId: null, notified: false, retryable: true };
    this.attempt = attempt;
    return this.launch(() => this.prepareAndSend(attempt, this.epoch));
  }
  retry(): Promise<GenerationResult> {
    if (this.pending) return this.pending;
    const attempt = this.attempt, epoch = this.epoch;
    if (!attempt) return this.startNew();
    if (attempt.jobId) return Promise.resolve({ kind: 'known', jobId: attempt.jobId });
    if (!attempt.retryable) return Promise.resolve({ kind: 'blocked' });
    return this.launch(async () => {
      if (attempt.mayExist) {
        const found = await this.query(attempt, epoch);
        if (found !== null) return found;
      }
      return this.prepareAndSend(attempt, epoch);
    });
  }
  recover(): Promise<GenerationResult> {
    if (this.pending) return this.pending;
    const attempt = this.attempt, epoch = this.epoch;
    if (!attempt?.request) return Promise.resolve({ kind: 'blocked' });
    if (attempt.jobId) return Promise.resolve({ kind: 'known', jobId: attempt.jobId });
    return this.launch(async () => await this.query(attempt, epoch) ?? { kind: 'unresolved' });
  }
  private async prepareAndSend(attempt: Attempt, epoch: number): Promise<GenerationResult> {
    try {
      if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
      if (!attempt.request) {
        this.show('preparing', '正在准备本次预览的生成请求');
        if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
        if (!attempt.snapshot) {
          const preview = await this.wait(this.deps.editor.preparePreview(), epoch);
          if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
          if (this.deps.editor.revision !== attempt.revision || preview && preview.revision !== attempt.revision) throw new CloudClientError('PREVIEW_CHANGED');
          if (!preview) throw new CloudClientError('PREVIEW_UNAVAILABLE');
          attempt.snapshot = capture(preview);
        }
        if (!attempt.nonce) attempt.nonce = await this.wait(this.deps.secureUuid(), epoch);
        if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
        const window: SubmissionWindow = await this.wait(this.deps.client.getSubmissionWindow(), epoch);
        if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
        if (!window || typeof window.windowId !== 'string' || !Number.isSafeInteger(window.expiresAt)) throw new CloudClientError('INVALID_RESPONSE');
        attempt.request = Object.freeze({ ...attempt.snapshot, requestId: createRequestId(window.windowId, attempt.nonce) });
      }
    } catch (error) {
      if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
      this.show('error', messageFor(codeOf(error))); return { kind: 'blocked' };
    }
    return this.send(attempt, epoch);
  }
  private async remember(attempt: Attempt, epoch: number, jobId: string): Promise<GenerationResult> {
    if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
    if (attempt.jobId && attempt.jobId !== jobId) throw new CloudClientError('INVALID_RESPONSE');
    attempt.jobId = jobId; attempt.mayExist = true;
    this.show('known', '已找到本次生成记录，可查看云端处理状态');
    if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
    if (!attempt.notified) {
      attempt.notified = true;
      try { await this.deps.onJobKnown(jobId); }
      catch { if (this.current(attempt, epoch)) this.show('known', '已找到生成记录，请从“我的 → 生成记录”查看'); }
    }
    return this.current(attempt, epoch) ? { kind: 'known', jobId } : { kind: 'cancelled' };
  }
  private async send(attempt: Attempt, epoch: number): Promise<GenerationResult> {
    if (!this.current(attempt, epoch) || !attempt.request) return { kind: 'cancelled' };
    const uncertainBefore = attempt.mayExist;
    attempt.mayExist = true;
    this.show('submitting', '正在提交本次预览，请稍候');
    if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
    try {
      // The observer also accepts a late response after the local wait times out.
      const response = this.deps.client.submitGeneration(attempt.request).then((value: SubmitGenerationResponse) => {
        if (!this.current(attempt, epoch) || !attempt.request) return { kind: 'cancelled' } as const;
        if (!value || !['pending', 'settled'].includes(value.submission) ||
            (value.submission === 'settled') !== ['SUCCEEDED', 'FAILED'].includes(value.job?.status)) throw new CloudClientError('INVALID_RESPONSE');
        return this.remember(attempt, epoch, knownJob(value.job, attempt.request));
      });
      return await this.wait(response, epoch);
    } catch (error) {
      if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
      if (attempt.jobId) return { kind: 'known', jobId: attempt.jobId };
      const code = codeOf(error);
      if (definitive.has(code) && !uncertainBefore) {
        attempt.mayExist = false; attempt.retryable = !noRetry.has(code);
        this.show('error', messageFor(code)); return { kind: 'blocked' };
      }
      this.show('uncertain', '暂未确认提交结果；云端任务可能仍在处理，将查询原请求');
      return await this.query(attempt, epoch) ?? { kind: 'unresolved' };
    }
  }
  private async query(attempt: Attempt, epoch: number): Promise<GenerationResult | null> {
    if (!this.current(attempt, epoch) || !attempt.request) return { kind: 'cancelled' };
    if (attempt.jobId) return { kind: 'known', jobId: attempt.jobId };
    this.show('querying', '正在查询本次请求的生成记录');
    if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
    try {
      // A verified lookup can arrive after the local wait, just like submission.
      const response = this.deps.client.findJobByRequest(attempt.request.requestId).then(value => {
        if (!this.current(attempt, epoch) || !attempt.request) return { kind: 'cancelled' } as const;
        if (attempt.jobId) return { kind: 'known', jobId: attempt.jobId } as const;
        return value === null ? null : this.remember(attempt, epoch, knownJob(value, attempt.request));
      });
      const found = await this.wait(response, epoch);
      if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
      if (attempt.jobId) return { kind: 'known', jobId: attempt.jobId };
      if (found !== null) return found;
      this.show('uncertain', '暂未查到生成记录，可查询或重试同一请求；不会另建请求号');
      return this.current(attempt, epoch) ? null : { kind: 'cancelled' };
    } catch (error) {
      if (!this.current(attempt, epoch)) return { kind: 'cancelled' };
      if (attempt.jobId) return { kind: 'known', jobId: attempt.jobId };
      const code = codeOf(error);
      if (code === 'REQUEST_EXPIRED' || code === 'RECORD_EXPIRED') {
        attempt.mayExist = false; attempt.retryable = false; this.show('error', messageFor(code)); return { kind: 'blocked' };
      }
      this.show('uncertain', '暂时无法确认云端状态，请稍后查询或重试；本次请求已保留');
      return { kind: 'unresolved' };
    }
  }
  private eraseAttempt(): void {
    if (this.attempt) { this.attempt.snapshot = null; this.attempt.request = null; this.attempt.nonce = null; }
    this.attempt = null;
  }
  clear(): void {
    this.epoch++; this.eraseAttempt(); this.pending = null;
    for (const cancel of [...this.cancelWaits]) cancel();
    this.show('idle', '');
  }
}
