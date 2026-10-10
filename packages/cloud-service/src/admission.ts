import { assertLayoutDigestMatches, assertLayoutVersionsMatch, PaperError, validatePaperInput, type PaperLayout } from '@learn/paper-core';
import { ServiceError, type GenerationConfig, type GenerationFailureCode, type JobSummary,
  type PublishedPreset, type ServiceConfig, type ServiceDependencies, type SubmissionWindow, type SubmitGenerationResponse } from './contracts.js';
import { ensureAccountInTransaction, reserveCreditInTransaction } from './credits.js';
import type { GenerationJob, GenerationRequestRecord } from './model.js';
import { PresetRegistry, retainPresetInTransaction } from './presets.js';
import { assertSameRequest, assertWindowCurrent, generationFingerprint, issueWindow, parseRequestId,
  requestIdFromEnvelope, requestRecordId, validateGenerationRequest, verifyWindowSignature, type ValidatedGenerationRequest } from './requests.js';
import { failJobInTransaction, isTerminal, jobSummary, recordDailyActivity, submissionResponse } from './jobs.js';

type RateRecord = { windowStart: number; count: number };

/** CloudService authenticates each public call before invoking this internal module. */
export class JobAdmission {
  private readonly policy: GenerationConfig;

  constructor(private readonly dependencies: ServiceDependencies, private readonly config: ServiceConfig) {
    if (!config.generation) throw new ServiceError('EXECUTION_UNAVAILABLE');
    this.policy = config.generation;
  }

  window(userId: string): Promise<SubmissionWindow> {
    return issueWindow(this.dependencies.crypto, userId, this.policy, this.dependencies.clock.now());
  }

  private async record(userId: string, requestId: string): Promise<{ key: string; value: GenerationRequestRecord | null }> {
    const key = await requestRecordId(this.dependencies.crypto, userId, requestId);
    const value = await this.dependencies.store.get<GenerationRequestRecord>('generation_requests', key);
    return { key, value };
  }

  private async loadJob(userId: string, record: GenerationRequestRecord): Promise<GenerationJob> {
    if (record.userId !== userId) throw new ServiceError('NOT_FOUND');
    const job = await this.dependencies.store.get<GenerationJob>('generation_jobs', record.jobId);
    if (record.deleted || !job || (isTerminal(job) && job.recordExpiresAt <= this.dependencies.clock.now())) throw new ServiceError('RECORD_EXPIRED');
    if (job.userId !== userId || job.requestId !== record.requestId) throw new ServiceError('INVARIANT_VIOLATION');
    return job;
  }

  private async replay(userId: string, raw: unknown, record: GenerationRequestRecord): Promise<SubmitGenerationResponse> {
    const request = validateGenerationRequest(raw, { ...this.policy, ...record.inputLimits });
    await assertSameRequest(this.dependencies.crypto, this.policy, userId, request, record);
    return submissionResponse(await this.loadJob(userId, record));
  }

  async find(userId: string, requestId: string): Promise<JobSummary | null> {
    const parsed = parseRequestId(requestId);
    const { value } = await this.record(userId, requestId);
    if (value) return jobSummary(await this.loadJob(userId, value));
    await verifyWindowSignature(this.dependencies.crypto, userId, this.policy, parsed);
    assertWindowCurrent(parsed, this.dependencies.clock.now());
    return null;
  }

  async submit(userId: string, raw: unknown): Promise<SubmitGenerationResponse> {
    const requestId = requestIdFromEnvelope(raw);
    const found = await this.record(userId, requestId);
    if (found.value) return this.replay(userId, raw, found.value);

    const request = validateGenerationRequest(raw, this.policy);
    const parsed = parseRequestId(request.requestId);
    let published: PublishedPreset;
    try {
      await verifyWindowSignature(this.dependencies.crypto, userId, this.policy, parsed);
      assertWindowCurrent(parsed, this.dependencies.clock.now());
      if (!this.dependencies.preparer || !this.dependencies.executor) throw new ServiceError('EXECUTION_UNAVAILABLE');
      const result = await new PresetRegistry(this.dependencies, this.config).compatibility({
        engineVersion: request.versions.engineVersion, lockedVersions: [request.versions],
      });
      const availability = result.locked[0];
      if (!availability || availability.status === 'not-found') throw new ServiceError('NOT_FOUND');
      if (availability.status === 'retired') throw new ServiceError('VERSION_RETIRED');
      if (availability.status === 'update-required') throw new ServiceError('UPDATE_REQUIRED');
      if (availability.status !== 'ready' || !availability.published) throw new ServiceError('RESOURCE_UNAVAILABLE');
      published = availability.published;
      try { validatePaperInput(request.input, {
        maxInputCodeUnits: Math.min(this.policy.maxInputCodeUnits, published.preset.limits.maxInputCodeUnits),
        maxGraphemes: Math.min(this.policy.maxGraphemes, published.preset.limits.maxGraphemes),
        maxPages: Math.min(this.policy.maxPages, published.preset.limits.maxPages),
      }); } catch (error) {
        throw new ServiceError(error instanceof PaperError && error.code === 'INPUT_LIMIT_EXCEEDED' ? 'INPUT_LIMIT_EXCEEDED' : 'INVALID_INPUT');
      }
    } catch (error) {
      // A concurrent creator may have committed while this caller checked expiring
      // windows/resources. Existing idempotency still takes precedence.
      const raced = await this.record(userId, requestId);
      if (raced.value) return this.replay(userId, raw, raced.value);
      throw error;
    }

    const fingerprint = await generationFingerprint(this.dependencies.crypto, userId, request,
      this.policy.fingerprintKeyId, this.policy.fingerprintVersion, published.preset.defaults.titleAlign);
    const jobId = `j_${this.dependencies.crypto.randomId()}`;
    const batchId = `x_${this.dependencies.crypto.randomId()}`;
    const result = await this.dependencies.store.transaction(async tx => {
      const existing = await tx.get<GenerationRequestRecord>('generation_requests', found.key);
      if (existing) return { created: false as const, record: existing };
      const now = this.dependencies.clock.now();
      assertWindowCurrent(parsed, now);
      const account = await ensureAccountInTransaction(tx, userId, now, this.config);
      if (account.reserved >= this.policy.maxConcurrentJobs) throw new ServiceError('CONCURRENCY_LIMITED');
      const rate = await tx.get<RateRecord>('generation_rate', userId);
      const windowStart = Math.floor(now / this.policy.rateWindowMs) * this.policy.rateWindowMs;
      const starts = rate?.windowStart === windowStart ? rate.count : 0;
      if (!Number.isSafeInteger(starts) || starts < 0) throw new ServiceError('INVARIANT_VIOLATION');
      if (starts >= this.policy.maxStartsPerWindow) throw new ServiceError('RATE_LIMITED');
      await retainPresetInTransaction(tx, published.registryId, jobId);
      await reserveCreditInTransaction(tx, userId, jobId, now);
      const job: GenerationJob = { jobId, userId, requestId, requestKey: found.key, toolId: 'paper', usageType: 'pdf',
        registryId: published.registryId, versions: { ...request.versions }, batchId, status: 'RESERVED', createdAt: now,
        deadline: now + this.policy.jobTimeoutMs, startedAt: null, finishedAt: null, pageCount: null, errorCode: null,
        candidatePath: null, fileId: null, fileExpiresAt: null, fileBytes: null, fileSha256: null,
        recordExpiresAt: now + this.policy.recordRetentionMs };
      const record: GenerationRequestRecord = { userId, requestId, jobId, fingerprint,
        fingerprintKeyId: this.policy.fingerprintKeyId, fingerprintVersion: this.policy.fingerprintVersion,
        defaultTitleAlign: published.preset.defaults.titleAlign, windowExpiresAt: parsed.expiresAt,
        createdAt: now, retainUntil: Math.max(parsed.expiresAt, job.deadline) + this.policy.requestRetentionMs, deleted: false,
        inputLimits: { maxInputCodeUnits: this.policy.maxInputCodeUnits, maxGraphemes: this.policy.maxGraphemes, maxPages: this.policy.maxPages } };
      await tx.create('generation_jobs', jobId, job);
      await tx.create('generation_requests', found.key, record);
      await tx.set('generation_rate', userId, { windowStart, count: starts + 1 });
      return { created: true as const, record, job };
    });
    if (!result.created) return this.replay(userId, raw, result.record);
    return this.executeCreator(request, published, result.job);
  }

  private async executeCreator(request: ValidatedGenerationRequest, published: PublishedPreset, job: GenerationJob): Promise<SubmitGenerationResponse> {
    let layout: PaperLayout;
    let failure: GenerationFailureCode = 'PREPARATION_FAILED';
    try {
      const prepared = await this.dependencies.preparer!.prepare(request.input, published.preset);
      if (prepared.digest !== request.layoutDigest) { failure = 'LAYOUT_MISMATCH'; throw new Error(); }
      assertLayoutVersionsMatch(prepared.layout.versions, request.versions);
      if (!Array.isArray(prepared.layout.pages) || prepared.layout.pages.length < 1 ||
          prepared.layout.pages.length > Math.min(this.policy.maxPages, published.preset.limits.maxPages)) {
        failure = 'PAGE_LIMIT_EXCEEDED'; throw new Error();
      }
      assertLayoutDigestMatches(prepared.layout, request.layoutDigest);
      layout = prepared.layout;
    } catch (error) {
      if (error instanceof PaperError && error.code === 'LAYOUT_DIGEST_MISMATCH') failure = 'LAYOUT_MISMATCH';
      const failed = await this.dependencies.store.transaction(tx => failJobInTransaction(tx, job.jobId, job.batchId,
        this.dependencies.clock.now(), failure, 'RESERVED'));
      return submissionResponse(failed);
    }

    const started = await this.dependencies.store.transaction(async tx => {
      const current = await tx.get<GenerationJob>('generation_jobs', job.jobId);
      if (!current) throw new ServiceError('NOT_FOUND');
      if (current.status !== 'RESERVED' || current.batchId !== job.batchId) return current;
      const now = this.dependencies.clock.now();
      if (now >= current.deadline) return failJobInTransaction(tx, job.jobId, job.batchId, now, 'EXECUTION_TIMEOUT', 'RESERVED');
      const generating: GenerationJob = { ...current, status: 'GENERATING', startedAt: now, pageCount: layout.pages.length };
      await tx.set('generation_jobs', job.jobId, generating);
      await recordDailyActivity(tx, job.userId, now, 'generation');
      return generating;
    });
    if (isTerminal(started)) return submissionResponse(started);
    if (started.status !== 'GENERATING' || started.batchId !== job.batchId) throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    try { await this.dependencies.executor!.execute({ jobId: job.jobId, batchId: job.batchId,
      userId: job.userId, published, layout }); } catch {
      // Caller cannot infer whether an interrupted invocation already committed.
      const known = await this.dependencies.store.get<GenerationJob>('generation_jobs', job.jobId);
      if (known && isTerminal(known)) return submissionResponse(known);
      throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    }
    const finished = await this.dependencies.store.get<GenerationJob>('generation_jobs', job.jobId);
    if (!finished || !isTerminal(finished)) throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    return submissionResponse(finished);
  }
}
