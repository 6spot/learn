import type { MetadataStore, PrivateStorage, Clock } from '@learn/cloud-runtime';
import { ServiceError, type CryptoPort } from './contracts.js';
import type { CreditReservation, GenerationJob, PdfCandidate } from './model.js';
import { failJobInTransaction, isTerminal } from './jobs.js';
import { settleCreditInTransaction } from './credits.js';
import { releasePresetInTransaction } from './presets.js';

type ArtifactDependencies = { store: MetadataStore; storage: PrivateStorage; crypto: CryptoPort; clock: Clock };

/** Envelope sanity only. Complete PDF encoding is the trusted renderer's contract. */
export function isPdfEnvelope(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return false;
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 32)));
  return /^%PDF-1\.[0-7]/.test(head) && /%%EOF[\r\n\t ]*$/.test(tail);
}

export function candidateId(jobId: string, batchId: string): string {
  if (!/^j_[a-f0-9-]{36}$/.test(jobId) || !/^x_[a-f0-9-]{36}$/.test(batchId)) throw new ServiceError('INVARIANT_VIOLATION');
  return `${jobId}_${batchId}`;
}

export function candidatePath(jobId: string, batchId: string): string {
  candidateId(jobId, batchId);
  return `candidates/${jobId}/${batchId}.pdf`;
}

/** Corrupt metadata must never turn cleanup into deletion of an unrelated private object. */
export function assertCandidateLocation(storage: PrivateStorage, candidate: PdfCandidate): void {
  if (candidate.candidateId !== candidateId(candidate.jobId, candidate.batchId) ||
      candidate.path !== candidatePath(candidate.jobId, candidate.batchId) || storage.resolve(candidate.path) !== candidate.fileId) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
}

/** A read failure, including a temporarily missing object, is not a failure/refund basis. */
export async function verifyCandidate(deps: ArtifactDependencies, candidate: PdfCandidate): Promise<'valid' | 'invalid' | 'unavailable'> {
  assertCandidateLocation(deps.storage, candidate);
  let bytes: Uint8Array;
  try { bytes = await deps.storage.read(candidate.fileId); } catch { return 'unavailable'; }
  if (!(bytes instanceof Uint8Array) || bytes.length !== candidate.bytes || !isPdfEnvelope(bytes)) return 'invalid';
  const hash = await deps.crypto.sha256(bytes);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ServiceError('INTERNAL_ERROR');
  return hash === candidate.sha256 ? 'valid' : 'invalid';
}

function sameCandidate(left: PdfCandidate, right: PdfCandidate): boolean {
  return left.candidateId === right.candidateId && left.jobId === right.jobId && left.batchId === right.batchId &&
    left.userId === right.userId && left.path === right.path && left.fileId === right.fileId &&
    left.bytes === right.bytes && left.sha256 === right.sha256 && left.pageCount === right.pageCount &&
    left.pdfRetentionMs === right.pdfRetentionMs;
}

/** Call only after verifyCandidate returned valid. Recovery reuses this, never a renderer. */
export async function settleCandidate(deps: ArtifactDependencies, verified: PdfCandidate): Promise<GenerationJob> {
  return deps.store.transaction(async tx => {
    const job = await tx.get<GenerationJob>('generation_jobs', verified.jobId);
    if (!job) throw new ServiceError('NOT_FOUND');
    if (isTerminal(job) || job.batchId !== verified.batchId) return job;
    const candidate = await tx.get<PdfCandidate>('pdf_candidates', verified.candidateId);
    if (!candidate || !sameCandidate(candidate, verified) || candidate.state !== 'pending' ||
        job.status !== 'GENERATING' || job.userId !== candidate.userId || job.candidatePath !== candidate.path ||
        job.pageCount !== candidate.pageCount || !job.executionClaimed) throw new ServiceError('INVARIANT_VIOLATION');
    const now = deps.clock.now();
    if (now >= job.deadline) return failJobInTransaction(tx, job.jobId, job.batchId, now, 'EXECUTION_TIMEOUT', 'GENERATING');
    const reserved = await tx.get<CreditReservation>('credit_reservations', job.jobId);
    if (!reserved || reserved.userId !== job.userId || reserved.state !== 'pending') throw new ServiceError('INVARIANT_VIOLATION');
    const reservation = await settleCreditInTransaction(tx, job.userId, job.jobId, 'consumed', now);
    if (reservation.state !== 'consumed') throw new ServiceError('INVARIANT_VIOLATION');
    await releasePresetInTransaction(tx, job.registryId, job.jobId);
    const succeeded: GenerationJob = { ...job, status: 'SUCCEEDED', finishedAt: now, errorCode: null,
      fileId: candidate.fileId, fileBytes: candidate.bytes, fileSha256: candidate.sha256,
      fileExpiresAt: now + candidate.pdfRetentionMs };
    if (succeeded.fileExpiresAt! > job.recordExpiresAt) throw new ServiceError('INVARIANT_VIOLATION');
    await tx.set('generation_jobs', job.jobId, succeeded);
    await tx.set('pdf_candidates', candidate.candidateId, { ...candidate, state: 'committed' });
    return succeeded;
  });
}

/** Claim deletion in the same metadata domain as settlement, then do backend I/O. */
export async function cleanupCandidate(deps: Pick<ArtifactDependencies, 'store' | 'storage'>, id: string): Promise<boolean> {
  const candidate = await deps.store.transaction(async tx => {
    const current = await tx.get<PdfCandidate>('pdf_candidates', id);
    if (!current) return null;
    if (current.candidateId !== id) throw new ServiceError('INVARIANT_VIOLATION');
    assertCandidateLocation(deps.storage, current);
    const job = await tx.get<GenerationJob>('generation_jobs', current.jobId);
    if (job?.status === 'SUCCEEDED' && job.fileId === current.fileId) return null;
    if (job && !isTerminal(job) && job.batchId === current.batchId) return null;
    // Keep the tombstone: an already in-flight put may finish after deletion.
    // A finishing executor and T16 sweep can safely repeat this remove.
    await tx.set('pdf_candidates', id, { ...current, state: 'deleting' });
    return current;
  });
  if (!candidate) return false;
  try { await deps.storage.remove(candidate.fileId); } catch { return false; }
  await deps.store.transaction(async tx => {
    const current = await tx.get<PdfCandidate>('pdf_candidates', id);
    if (current?.state === 'deleting') await tx.set('pdf_candidates', id, { ...current, state: 'deleted' });
  });
  return true;
}
