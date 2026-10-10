import { cloneDocument, type JsonObject, type MetadataReader, type MetadataTransaction } from '@learn/cloud-runtime';
import { PDF_CHUNK_BYTES, ServiceError, type FileAccessConfig, type JobDetail, type ListJobsRequest, type ListJobsResponse,
  type PdfChunk, type PdfChunkRequest, type PdfInfo, type ServiceDependencies } from './contracts.js';
import type { GenerationJob, GenerationRequestRecord, PdfCandidate, UserRecord } from './model.js';
import { isTerminal, jobSummary, recordDailyActivity } from './jobs.js';
import { assertCandidateLocation, candidateId, isPdfEnvelope } from './artifacts.js';
import { historyId, type HistoryEntry } from './history.js';

type Reader = Pick<MetadataReader, 'get'> | Pick<MetadataTransaction, 'get'>;
const indexPattern = /^h_[0-9]{16}_j_[a-f0-9-]{36}$/;
export function validateJobId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^j_[a-f0-9-]{36}$/.test(value)) throw new ServiceError('INVALID_ARGUMENT');
}
function snapshot(raw: unknown): JsonObject {
  try { return cloneDocument(raw as JsonObject); } catch { throw new ServiceError('INVALID_ARGUMENT'); }
}
export function snapshotListJobs(raw: unknown): ListJobsRequest {
  const input = snapshot(raw === undefined ? {} : raw);
  if (Object.keys(input).some(key => key !== 'cursor' && key !== 'limit') ||
      input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 256) ||
      input.limit !== undefined && (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 50)) {
    throw new ServiceError('INVALID_ARGUMENT');
  }
  return input as ListJobsRequest;
}
export function snapshotPdfChunk(raw: unknown): PdfChunkRequest {
  const input = snapshot(raw);
  if (Object.keys(input).length !== 2 || !Object.prototype.hasOwnProperty.call(input, 'jobId') ||
      !Object.prototype.hasOwnProperty.call(input, 'offset') || !Number.isSafeInteger(input.offset) ||
      (input.offset as number) < 0 || (input.offset as number) % PDF_CHUNK_BYTES !== 0) throw new ServiceError('INVALID_ARGUMENT');
  validateJobId(input.jobId);
  return input as PdfChunkRequest;
}

export class RecordAccess {
  private cached: { key: string; bytes: Uint8Array; until: number } | null = null;
  private readonly inFlight = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly deps: ServiceDependencies, private readonly config: FileAccessConfig, private readonly cursorKeyId: string) {}

  private async active(reader: Reader, userId: string): Promise<void> {
    const user = await reader.get<UserRecord>('users', userId);
    if (!user || user.userId !== userId || user.status !== 'active') throw new ServiceError('ACCOUNT_DISABLED');
  }

  private async visible(reader: Reader, userId: string, id: string): Promise<GenerationJob> {
    const job = await reader.get<GenerationJob>('generation_jobs', id);
    if (!job || job.userId !== userId || job.jobId !== id) throw new ServiceError('NOT_FOUND');
    jobSummary(job);
    if (!Number.isSafeInteger(job.recordExpiresAt) || job.recordExpiresAt < 0) throw new ServiceError('INVARIANT_VIOLATION');
    if (isTerminal(job) && this.deps.clock.now() >= job.recordExpiresAt) throw new ServiceError('RECORD_EXPIRED');
    const binding = await reader.get<GenerationRequestRecord>('generation_requests', job.requestKey);
    if (!binding || binding.userId !== userId || binding.jobId !== id || binding.requestId !== job.requestId) throw new ServiceError('NOT_FOUND');
    if (binding.deleted !== false) throw new ServiceError('RECORD_EXPIRED');
    return job;
  }

  private async fileInfo(reader: Reader, job: GenerationJob): Promise<PdfInfo> {
    if (job.status !== 'SUCCEEDED') throw new ServiceError('FILE_NOT_READY');
    if (job.fileExpiresAt === null) throw new ServiceError('FILE_UNAVAILABLE');
    if (job.fileExpiresAt <= this.deps.clock.now()) throw new ServiceError('FILE_EXPIRED');
    if (!this.deps.storage || typeof job.fileId !== 'string' || !job.fileId || !Number.isSafeInteger(job.fileBytes) ||
        job.fileBytes === null || job.fileBytes < 16 || typeof job.fileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(job.fileSha256) ||
        job.pageCount === null || job.fileExpiresAt > job.recordExpiresAt) throw new ServiceError('FILE_UNAVAILABLE');
    if (job.fileBytes > this.config.maxFileBytes) throw new ServiceError('FILE_LIMIT_EXCEEDED');
    const id = candidateId(job.jobId, job.batchId);
    const candidate = await reader.get<PdfCandidate>('pdf_candidates', id);
    if (!candidate || candidate.candidateId !== id || candidate.jobId !== job.jobId || candidate.batchId !== job.batchId ||
        candidate.state !== 'committed' || candidate.userId !== job.userId || candidate.path !== job.candidatePath ||
        candidate.fileId !== job.fileId || candidate.sha256 !== job.fileSha256 || candidate.bytes !== job.fileBytes ||
        candidate.pageCount !== job.pageCount) throw new ServiceError('FILE_UNAVAILABLE');
    try { assertCandidateLocation(this.deps.storage, candidate); } catch { throw new ServiceError('FILE_UNAVAILABLE'); }
    return { jobId: job.jobId, bytes: job.fileBytes, sha256: job.fileSha256, pageCount: job.pageCount,
      expiresAt: job.fileExpiresAt, chunkBytes: PDF_CHUNK_BYTES };
  }

  private async detail(reader: Reader, job: GenerationJob): Promise<JobDetail> {
    let delivery: JobDetail['delivery'] = 'not-ready';
    if (job.status === 'SUCCEEDED') {
      try { await this.fileInfo(reader, job); delivery = 'ready'; }
      catch (error) {
        if (!(error instanceof ServiceError) || !['FILE_EXPIRED', 'FILE_UNAVAILABLE', 'FILE_LIMIT_EXCEEDED'].includes(error.code)) throw error;
        delivery = error.code === 'FILE_EXPIRED' ? 'expired' : 'unavailable';
      }
    }
    return { ...jobSummary(job), delivery };
  }

  private async signCursor(userId: string, index: string): Promise<string> {
    const signature = await this.deps.crypto.hmacSha256(this.cursorKeyId, JSON.stringify(['learn.history-cursor.v1', userId, index]));
    if (!/^[a-f0-9]{64}$/.test(signature)) throw new ServiceError('INTERNAL_ERROR');
    return `hc1.${index}.${signature}`;
  }

  async list(userId: string, request: ListJobsRequest): Promise<ListJobsResponse> {
    let afterId: string | undefined;
    if (request.cursor !== undefined) {
      const parts = request.cursor.split('.');
      if (parts.length !== 3 || parts[0] !== 'hc1' || !indexPattern.test(parts[1]!) ||
          request.cursor !== await this.signCursor(userId, parts[1]!)) throw new ServiceError('INVALID_ARGUMENT');
      afterId = parts[1];
    }
    const limit = request.limit ?? 20;
    const ids: string[] = [];
    let scanned = 0, exhausted = false;
    while (ids.length < limit && scanned < this.config.maxListScanRecords && !exhausted) {
      const pageSize = Math.min(100, limit - ids.length, this.config.maxListScanRecords - scanned);
      const rows = await this.deps.store.list<HistoryEntry>('generation_history', {
        where: { userId }, limit: pageSize, ...(afterId === undefined ? {} : { afterId }),
      });
      exhausted = rows.length < pageSize;
      for (const row of rows) {
        scanned++; afterId = row.id;
        if (row.value.userId !== userId || row.id !== historyId(row.value.createdAt, row.value.jobId)) throw new ServiceError('INVARIANT_VIOLATION');
        try {
          const job = await this.visible(this.deps.store, userId, row.value.jobId);
          if (job.createdAt !== row.value.createdAt) throw new ServiceError('INVARIANT_VIOLATION');
          ids.push(job.jobId);
        } catch (error) {
          if (!(error instanceof ServiceError) || !['NOT_FOUND', 'RECORD_EXPIRED'].includes(error.code)) throw error;
        }
      }
    }
    const nextCursor = exhausted || afterId === undefined ? null : await this.signCursor(userId, afterId);
    return this.deps.store.transaction(async tx => {
      await this.active(tx, userId);
      const items: JobDetail[] = [];
      for (const id of ids) {
        try { items.push(await this.detail(tx, await this.visible(tx, userId, id))); }
        catch (error) { if (!(error instanceof ServiceError) || !['NOT_FOUND', 'RECORD_EXPIRED'].includes(error.code)) throw error; }
      }
      return { items, nextCursor, serverTime: this.deps.clock.now() };
    });
  }

  async get(userId: string, id: string): Promise<JobDetail> {
    return this.deps.store.transaction(async tx => { await this.active(tx, userId); return this.detail(tx, await this.visible(tx, userId, id)); });
  }
  async info(userId: string, id: string): Promise<PdfInfo> {
    return this.deps.store.transaction(async tx => { await this.active(tx, userId); return this.fileInfo(tx, await this.visible(tx, userId, id)); });
  }

  private cacheKey(job: GenerationJob): string {
    return JSON.stringify([job.userId, job.jobId, job.batchId, job.fileId, job.fileBytes, job.fileSha256]);
  }

  private async readVerified(job: GenerationJob, info: PdfInfo): Promise<Uint8Array> {
    const key = this.cacheKey(job);
    if (this.cached && this.cached.until <= this.deps.clock.now()) this.cached = null;
    if (this.cached?.key === key) return this.cached.bytes;
    const loading = this.inFlight.get(key);
    if (loading) return loading;
    const promise = (async () => {
      let result: Uint8Array;
      try { result = await this.deps.storage!.read(job.fileId!); } catch { throw new ServiceError('FILE_UNAVAILABLE'); }
      if (!(result instanceof Uint8Array) || result.length !== info.bytes || !isPdfEnvelope(result)) throw new ServiceError('FILE_UNAVAILABLE');
      const bytes = Uint8Array.from(result);
      if (await this.deps.crypto.sha256(bytes) !== info.sha256) throw new ServiceError('FILE_UNAVAILABLE');
      if (bytes.length <= this.config.maxCacheBytes) this.cached = { key, bytes,
        until: Math.min(info.expiresAt, this.deps.clock.now() + this.config.cacheTtlMs) };
      else this.cached = null;
      return bytes;
    })();
    this.inFlight.set(key, promise);
    try { return await promise; } finally { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); }
  }

  async chunk(userId: string, request: PdfChunkRequest): Promise<PdfChunk> {
    const start = await this.deps.store.transaction(async tx => {
      await this.active(tx, userId);
      const job = await this.visible(tx, userId, request.jobId), info = await this.fileInfo(tx, job);
      if (request.offset >= info.bytes) throw new ServiceError('INVALID_ARGUMENT');
      return { job, info };
    });
    const bytes = await this.readVerified(start.job, start.info);
    const info = await this.deps.store.transaction(async tx => {
      await this.active(tx, userId);
      const current = await this.visible(tx, userId, request.jobId), latest = await this.fileInfo(tx, current);
      if (this.cacheKey(current) !== this.cacheKey(start.job)) throw new ServiceError('FILE_UNAVAILABLE');
      await recordDailyActivity(tx, userId, this.deps.clock.now(), 'pdf-download');
      return latest;
    });
    const end = Math.min(request.offset + PDF_CHUNK_BYTES, info.bytes);
    return { jobId: request.jobId, offset: request.offset, nextOffset: end === info.bytes ? null : end,
      totalBytes: info.bytes, sha256: info.sha256, expiresAt: info.expiresAt,
      bytes: Uint8Array.from(bytes.subarray(request.offset, end)) };
  }
}
