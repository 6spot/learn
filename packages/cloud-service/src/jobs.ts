import type { MetadataTransaction } from '@learn/cloud-runtime';
import { ServiceError, type GenerationFailureCode, type JobSummary, type SubmitGenerationResponse } from './contracts.js';
import type { GenerationJob } from './model.js';
import { settleCreditInTransaction } from './credits.js';
import { releasePresetInTransaction } from './presets.js';
import { quotaPeriod } from './config.js';

export function isTerminal(job: GenerationJob): boolean { return job.status === 'SUCCEEDED' || job.status === 'FAILED'; }
export function jobSummary(job: GenerationJob): JobSummary {
  return { jobId: job.jobId, requestId: job.requestId, templateId: job.versions.templateId, status: job.status,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, pageCount: job.pageCount,
    errorCode: job.errorCode, fileExpiresAt: job.fileExpiresAt };
}
export function submissionResponse(job: GenerationJob): SubmitGenerationResponse {
  return { job: jobSummary(job), submission: isTerminal(job) ? 'settled' : 'pending' };
}

/** Shared safe state failure. Caller supplies a trustworthy failure/timeout basis and current batch. */
export async function failJobInTransaction(tx: MetadataTransaction, jobId: string, batchId: string, now: number,
  errorCode: GenerationFailureCode, expectedStatus?: 'RESERVED' | 'GENERATING'): Promise<GenerationJob> {
  const job = await tx.get<GenerationJob>('generation_jobs', jobId);
  if (!job) throw new ServiceError('NOT_FOUND');
  if (isTerminal(job) || job.batchId !== batchId || (expectedStatus && job.status !== expectedStatus)) return job;
  const codes: GenerationFailureCode[] = ['PREPARATION_FAILED', 'LAYOUT_MISMATCH', 'PAGE_LIMIT_EXCEEDED', 'EXECUTION_FAILED',
    'EXECUTION_TIMEOUT', 'PDF_INVALID', 'PDF_RESOURCE_LIMIT', 'RESOURCE_UNAVAILABLE'];
  if (!codes.includes(errorCode)) throw new ServiceError('INVALID_ARGUMENT');
  if (errorCode === 'EXECUTION_TIMEOUT' && now < job.deadline) throw new ServiceError('INVALID_ARGUMENT');
  const settled = await settleCreditInTransaction(tx, job.userId, job.jobId, 'released', now);
  if (settled.state !== 'released') throw new ServiceError('INVARIANT_VIOLATION');
  await releasePresetInTransaction(tx, job.registryId, job.jobId);
  const failed: GenerationJob = { ...job, status: 'FAILED', errorCode, finishedAt: now };
  await tx.set('generation_jobs', jobId, failed);
  return failed;
}

/** D-049: one safe fact per trusted user per Shanghai day, never article events. */
export async function recordDailyActivity(tx: MetadataTransaction, userId: string, now: number,
  event: 'generation' | 'pdf-download'): Promise<void> {
  quotaPeriod(now);
  const date = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const id = `${userId}_${date.replace(/-/g, '')}`;
  if (!await tx.get('daily_activity', id)) await tx.create('daily_activity', id, { userId, date, firstEventAt: now, firstEvent: event });
}
