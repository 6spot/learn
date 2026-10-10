import type { CloudClient } from './cloud-client.js';
import type { createPdfDownloader } from './pdf-download.js';
import { invalidRecord, projectAccount, projectRecord, recordError, recordErrorCode, recordTime, revokedRecordAccess, validJobId,
  type RecordAccount, type RecordItem } from './record-data.js';

export interface RecordTimers { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void }
type Client = Pick<CloudClient, 'getAccount' | 'listJobs' | 'getJob'>;
type Phase = 'idle' | 'loading' | 'ready' | 'error';
export type AccountView = Readonly<{ phase: Phase; message: string; account: RecordAccount | null; isAdmin: boolean }>;
export type ListView = Readonly<{ phase: Phase; message: string; items: readonly RecordItem[]; hasMore: boolean; loadingMore: boolean; checkedAt: string }>;
export type DetailView = Readonly<{ phase: Phase; message: string; record: RecordItem | null; canOpen: boolean;
  downloading: boolean; downloadMessage: string; downloadProgress: string }>;

/** Shared only by record/account pages: visibility fences responses and owns bounded polling. */
abstract class RecordSession {
  protected revision = 0;
  protected pending: Promise<void> | null = null;
  private timer: number | null = null;
  private visible = false;
  private foreground = true;
  protected abstract hasPending(): boolean;
  abstract refresh(): Promise<void>;
  abstract clear(): void;
  constructor(protected readonly timers: RecordTimers, protected readonly accessRevoked: () => void) {}
  setVisible(value: boolean): void {
    if (this.visible === value) return;
    this.visible = value;
    if (value && this.foreground) void this.refresh(); else this.invalidate();
  }
  setForeground(value: boolean): void {
    if (this.foreground === value) return;
    this.foreground = value;
    if (value && this.visible) void this.refresh(); else this.invalidate();
  }
  protected invalidate(): void {
    this.revision++; this.pending = null;
    if (this.timer !== null) this.timers.clearTimeout(this.timer); this.timer = null;
  }
  protected begin(): number { this.invalidate(); return this.revision; }
  protected current(revision: number): boolean { return this.revision === revision; }
  protected complete(revision: number, failed = false): void {
    if (!this.current(revision)) return;
    this.pending = null;
    if (this.visible && this.foreground && this.hasPending()) this.timer = this.timers.setTimeout(() => {
      this.timer = null; if (this.visible && this.foreground) void this.poll();
    }, failed ? 15000 : 5000);
  }
  protected poll(): Promise<void> { return this.refresh(); }
  protected checkRevocation(error: unknown): void {
    if (revokedRecordAccess(error)) { try { this.accessRevoked(); } catch { /* privacy page owns a retry for incomplete local cleanup */ } }
  }
}

export class RecordAccountSession extends RecordSession {
  view: AccountView = { phase: 'idle', message: '', account: null, isAdmin: false };
  private readonly listeners = new Set<(view: AccountView) => void>();
  constructor(private readonly client: Client, timers: RecordTimers, revoked: () => void) { super(timers, revoked); }
  subscribe(listener: (view: AccountView) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish(change: Partial<AccountView>): void { this.view = { ...this.view, ...change }; for (const listener of this.listeners) listener(this.view); }
  protected hasPending(): boolean { return false; }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const revision = this.begin(); this.publish({ phase: 'loading', message: '', isAdmin: false });
    const pending = Promise.resolve().then(() => this.current(revision) ? this.client.getAccount() : undefined).then(response => {
      if (!this.current(revision) || response === undefined) return;
      const account = projectAccount(response); this.publish({ phase: 'ready', message: '', account, isAdmin: account.isAdmin });
    }).catch(error => { if (this.current(revision)) { this.checkRevocation(error); this.publish({ phase: 'error', message: recordError(error),
      ...(revokedRecordAccess(error) ? { account: null } : {}), isAdmin: false }); } }).finally(() => this.complete(revision));
    this.pending = pending; return pending;
  }
  clear(): void { this.invalidate(); this.publish({ phase: 'idle', message: '', account: null, isAdmin: false }); }
}

export class RecordListSession extends RecordSession {
  view: ListView = { phase: 'idle', message: '', items: [], hasMore: false, loadingMore: false, checkedAt: '' };
  private cursor: string | null = null;
  private pollPosition = 0;
  constructor(private readonly client: Client, timers: RecordTimers, revoked: () => void, private readonly changed: (view: ListView) => void) { super(timers, revoked); }
  private publish(change: Partial<ListView>): void { this.view = { ...this.view, ...change }; this.changed(this.view); }
  protected hasPending(): boolean { return this.view.items.some(item => item.pending); }
  refresh(): Promise<void> { return this.read(false); }
  more(): Promise<void> { return this.view.hasMore ? this.read(true) : Promise.resolve(); }
  private read(more: boolean): Promise<void> {
    if (this.pending) return this.pending;
    const revision = this.begin(); let failed = false;
    this.publish({ phase: 'loading', message: '', loadingMore: more });
    const pending = Promise.resolve().then(async () => {
      let cursor = more ? this.cursor : null, checkedAt = '', items: RecordItem[] = [];
      const cursors = new Set<string>(); if (cursor) cursors.add(cursor);
      for (let page = 0; page < 3; page++) {
        if (!this.current(revision)) return;
        const response = await this.client.listJobs({ limit: 20, ...(cursor ? { cursor } : {}) });
        if (!this.current(revision)) return;
        if (!response || !Array.isArray(response.items) || response.items.length > 20 ||
            response.nextCursor !== null && (typeof response.nextCursor !== 'string' || !response.nextCursor || response.nextCursor.length > 256 || cursors.has(response.nextCursor))) return invalidRecord();
        checkedAt = recordTime(response.serverTime);
        const rows = response.items.map(projectRecord);
        for (const row of rows) {
          const previous = items[items.length - 1];
          if (previous && (row.createdAt > previous.createdAt || row.jobId === previous.jobId)) return invalidRecord();
          items.push(row);
        }
        cursor = response.nextCursor; if (cursor) cursors.add(cursor);
        if (cursor === null || items.length >= 20) break;
      }
      const combined = more ? [...this.view.items, ...items] : items;
      const seen = new Set<string>();
      for (let index = 0; index < combined.length; index++) {
        const row = combined[index]!, previous = combined[index - 1];
        if (seen.has(row.jobId) || previous && row.createdAt > previous.createdAt) return invalidRecord(); seen.add(row.jobId);
      }
      this.cursor = cursor; this.publish({ phase: 'ready', message: '', loadingMore: false, items: combined, hasMore: cursor !== null, checkedAt });
    }).catch(error => { if (this.current(revision)) { failed = true; this.checkRevocation(error);
      this.publish({ phase: 'error', message: recordError(error), loadingMore: false, ...(revokedRecordAccess(error) ? { items: [], hasMore: false } : {}) }); }
    }).finally(() => this.complete(revision, failed));
    this.pending = pending; return pending;
  }
  protected poll(): Promise<void> {
    if (this.pending) return this.pending;
    const waiting = this.view.items.filter(item => item.pending); if (!waiting.length) return Promise.resolve();
    const selected = Array.from({ length: Math.min(5, waiting.length) }, (_, index) => waiting[(this.pollPosition + index) % waiting.length]!);
    this.pollPosition = (this.pollPosition + selected.length) % waiting.length;
    const revision = this.begin(); let failed = false;
    const pending = Promise.resolve().then(async () => {
      for (const item of selected) {
        if (!this.current(revision)) return;
        try {
          const updated = projectRecord(await this.client.getJob(item.jobId));
          if (!this.current(revision)) return;
          if (updated.jobId !== item.jobId || updated.createdAt !== item.createdAt || updated.templateId !== item.templateId) return invalidRecord();
          this.publish({ items: this.view.items.map(row => row.jobId === item.jobId ? updated : row) });
        } catch (error) {
          if (!this.current(revision)) return;
          if (['NOT_FOUND', 'RECORD_EXPIRED'].includes(String(recordErrorCode(error)))) this.publish({ items: this.view.items.filter(row => row.jobId !== item.jobId) });
          else throw error;
        }
      }
      this.publish({ phase: 'ready', message: '' });
    }).catch(error => { if (this.current(revision)) { failed = true; this.checkRevocation(error);
      this.publish({ phase: 'error', message: recordError(error), ...(revokedRecordAccess(error) ? { items: [], hasMore: false } : {}) }); }
    }).finally(() => this.complete(revision, failed));
    this.pending = pending; return pending;
  }
  clear(): void { this.invalidate(); this.cursor = null; this.publish({ phase: 'idle', message: '', items: [], hasMore: false, loadingMore: false, checkedAt: '' }); }
}

export class RecordDetailSession extends RecordSession {
  view: DetailView = { phase: 'idle', message: '', record: null, canOpen: false, downloading: false, downloadMessage: '', downloadProgress: '' };
  private download: Promise<void> | null = null;
  constructor(readonly jobId: string, private readonly client: Client, private readonly downloader: Pick<ReturnType<typeof createPdfDownloader>, 'open'>,
    timers: RecordTimers, revoked: () => void, private readonly changed: (view: DetailView) => void) { super(timers, revoked); }
  private publish(change: Partial<DetailView>): void {
    const view = { ...this.view, ...change }; this.view = { ...view, canOpen: view.phase === 'ready' && view.record?.state === 'ready' && !view.downloading };
    this.changed(this.view);
  }
  protected hasPending(): boolean { return this.view.record?.pending ?? false; }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const revision = this.begin(); let failed = false;
    this.publish({ phase: 'loading', message: '', downloading: this.download !== null, downloadProgress: this.download ? '正在领取 PDF…' : '' });
    const pending = Promise.resolve().then(async () => {
      if (!this.current(revision)) return;
      if (!validJobId(this.jobId)) throw { code: 'INVALID_ARGUMENT' };
      const response = await this.client.getJob(this.jobId);
      if (!this.current(revision)) return;
      const record = projectRecord(response); if (record.jobId !== this.jobId) return invalidRecord();
      this.publish({ phase: 'ready', message: '', record });
    }).catch(error => { if (this.current(revision)) { failed = true; this.checkRevocation(error);
      const absent = revokedRecordAccess(error) || ['NOT_FOUND', 'RECORD_EXPIRED'].includes(String(recordErrorCode(error)));
      this.publish({ phase: 'error', message: recordError(error), ...(absent ? { record: null } : {}) }); }
    }).finally(() => this.complete(revision, failed));
    this.pending = pending; return pending;
  }
  openPdf(): Promise<void> {
    if (this.download) return this.download;
    if (!this.view.canOpen) return Promise.resolve();
    const revision = this.revision; this.publish({ downloading: true, downloadMessage: '', downloadProgress: '正在领取 PDF…' });
    const promise = Promise.resolve().then(() => {
      if (!this.current(revision)) return;
      return this.downloader.open(this.jobId, (received, total) => {
        if (this.current(revision)) this.publish({ downloadProgress: `已接收 ${Math.ceil(received / 1024)} / ${Math.ceil(total / 1024)} KB` });
      });
    }).then(() => { if (this.current(revision)) this.publish({ downloadMessage: '可在微信 PDF 阅读器中保存或分享文件。' }); })
      .catch(error => { if (this.current(revision)) { this.checkRevocation(error);
        const code = String(recordErrorCode(error));
        const absent = revokedRecordAccess(error) || ['NOT_FOUND', 'RECORD_EXPIRED'].includes(code);
        this.publish({ downloadMessage: recordError(error), ...(absent ? { phase: 'error', message: recordError(error), record: null }
          : ['FILE_EXPIRED', 'FILE_UNAVAILABLE', 'FILE_NOT_READY'].includes(code)
            ? { phase: 'error', message: '文件状态可能已变化，请刷新查询' } : {}) }); } })
      .finally(() => { if (this.download === promise) { this.download = null; this.publish({ downloading: false, downloadProgress: '' }); } });
    this.download = promise; return promise;
  }
  clear(): void { this.invalidate(); this.download = null; this.publish({ phase: 'idle', message: '', record: null, downloading: false, downloadMessage: '', downloadProgress: '' }); }
}
