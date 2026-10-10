import type { StoredDocument } from '@learn/cloud-runtime';
import type { LifecycleConfig, RecoveryDependencies } from './contracts.js';
import type { GenerationJob, PdfCandidate } from './model.js';
import { assertCandidateLocation } from './artifacts.js';
import { isTerminal } from './jobs.js';
import { extendDeletionInTransaction } from './privacy.js';
import { deletionFor, invariant, protectedRecord, time, userKey, type ChangeCounts } from './lifecycle-records.js';

/** Revokes the authorized reference before backend I/O, keeping terminal status/ledger intact. */
export async function cleanLifecycleFile(deps: RecoveryDependencies, policy: LifecycleConfig,
  row: StoredDocument): Promise<ChangeCounts> {
  const candidate = await deps.store.transaction(async tx => {
    const current = await tx.get<PdfCandidate>('pdf_candidates', row.id);
    if (!current) return null;
    invariant(current.candidateId === row.id); userKey(current.userId); time(current.createdAt);
    invariant(['pending', 'committed', 'deleting', 'deleted'].includes(current.state));
    invariant(Number.isSafeInteger(current.bytes) && current.bytes > 0);
    invariant(current.deletionCounted === undefined || typeof current.deletionCounted === 'boolean');
    assertCandidateLocation(deps.storage, current);
    const job = await tx.get<GenerationJob>('generation_jobs', current.jobId);
    if (job) invariant(job.jobId === current.jobId && job.userId === current.userId && ['RESERVED', 'GENERATING', 'SUCCEEDED', 'FAILED'].includes(job.status));
    const deletion = await deletionFor(tx, current.userId);
    const now = time(deps.clock.now());
    if (job && !isTerminal(job) && job.batchId === current.batchId) {
      await extendDeletionInTransaction(tx, deletion, time(job.deadline) + policy.lateIoProtectionMs);
      return null;
    }
    if (job?.status === 'SUCCEEDED' && job.fileId === current.fileId) {
      invariant(job.batchId === current.batchId && job.candidatePath === current.path && current.state === 'committed');
      if (!deletion && now < time(job.fileExpiresAt)) return null;
      await tx.set('generation_jobs', job.jobId, { ...job, fileId: null, fileBytes: null, fileSha256: null });
    }
    const cleanupAfter = current.cleanupAfter === undefined ? Math.max(current.createdAt, job ? time(job.deadline) : now) + policy.lateIoProtectionMs : time(current.cleanupAfter);
    await extendDeletionInTransaction(tx, deletion, cleanupAfter);
    const claimed: PdfCandidate = { ...current, state: 'deleting', cleanupAfter,
      deletionCounted: current.deletionCounted ?? current.state === 'deleted' };
    await tx.set('pdf_candidates', row.id, claimed);
    return claimed;
  });
  if (!candidate) return protectedRecord();
  try { await deps.storage.remove(candidate.fileId); }
  catch { return { retryableRecords: 1 }; }
  const outcome = await deps.store.transaction(async tx => {
    const current = await tx.get<PdfCandidate>('pdf_candidates', row.id);
    if (!current) return { deleted: false, counted: false };
    invariant(current.candidateId === candidate.candidateId && current.fileId === candidate.fileId && current.path === candidate.path &&
      current.cleanupAfter === candidate.cleanupAfter && ['deleting', 'deleted'].includes(current.state));
    const job = await tx.get<GenerationJob>('generation_jobs', current.jobId);
    invariant(!job || !(job.status === 'SUCCEEDED' && job.fileId === current.fileId) && !(job.batchId === current.batchId && !isTerminal(job)));
    const counted = current.deletionCounted !== true;
    if (time(deps.clock.now()) >= current.cleanupAfter!) { await tx.delete('pdf_candidates', row.id); return { deleted: true, counted }; }
    await tx.set('pdf_candidates', row.id, { ...current, state: 'deleted', deletionCounted: true });
    return { deleted: false, counted };
  });
  return { removedFiles: outcome.counted ? 1 : 0, removedFileBytes: outcome.counted ? candidate.bytes : 0,
    deletedCandidates: outcome.deleted ? 1 : 0, deletedRecords: outcome.deleted ? 1 : 0, protectedRecords: outcome.deleted ? 0 : 1 };
}
