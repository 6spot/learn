import type { MetadataTransaction } from '@learn/cloud-runtime';
import { ServiceError } from './contracts.js';
import type { GenerationJob } from './model.js';

export type HistoryEntry = { userId: string; jobId: string; createdAt: number };
const maxTime = 9_000_000_000_000_000;
export function historyId(createdAt: number, jobId: string): string {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > maxTime || !/^j_[a-f0-9-]{36}$/.test(jobId)) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
  return `h_${String(maxTime - createdAt).padStart(16, '0')}_${jobId}`;
}

/** Same transaction as admission; a trusted one-time migration can reuse this for older jobs. */
export async function indexJobInTransaction(tx: MetadataTransaction, job: GenerationJob): Promise<void> {
  const id = historyId(job.createdAt, job.jobId);
  const existing = await tx.get<HistoryEntry>('generation_history', id);
  if (existing) {
    if (existing.userId !== job.userId || existing.jobId !== job.jobId || existing.createdAt !== job.createdAt) {
      throw new ServiceError('INVARIANT_VIOLATION');
    }
    return;
  }
  await tx.create('generation_history', id, { userId: job.userId, jobId: job.jobId, createdAt: job.createdAt });
}
