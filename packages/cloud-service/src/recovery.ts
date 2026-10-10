import type { StoredDocument } from '@learn/cloud-runtime';
import { ServiceError, type RecoveryConfig, type RecoveryCursor, type RecoveryDependencies,
  type RecoveryJobResult, type RecoveryService, type RecoverySweepResult } from './contracts.js';
import { validateRecoveryConfig } from './config.js';
import type { GenerationJob, PdfCandidate } from './model.js';
import { failJobInTransaction, isTerminal } from './jobs.js';
import { assertCandidateLocation, candidateId, cleanupCandidate, settleCandidate, verifyCandidate } from './artifacts.js';

type Checkpoint = { schemaVersion: 1; revision: number; phase: RecoveryCursor['phase']; afterId: string | null; updatedAt: number };
type ReadBudget = { used: number };
type Attempt = { result: RecoveryJobResult; exhausted: boolean };
const checkpointId = 'recovery_v1';
const statuses: readonly string[] = ['RESERVED', 'GENERATING', 'SUCCEEDED', 'FAILED'];
const initialCursor = (): RecoveryCursor => ({ phase: 'reserved', afterId: null });
const key = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

function validateCheckpoint(value: Checkpoint | null): void {
  if (value && (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !['reserved', 'generating', 'candidates'].includes(value.phase) || value.afterId !== null && !key(value.afterId))) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
}

export function createRecoveryService(deps: RecoveryDependencies, rawConfig: RecoveryConfig): RecoveryService {
  const config = validateRecoveryConfig(rawConfig);
  const now = () => {
    const value = deps.clock.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError('INTERNAL_ERROR');
    return value;
  };

  async function recover(jobId: string, budget: ReadBudget): Promise<Attempt> {
    let job: GenerationJob | null = null;
    const result = (outcome: RecoveryJobResult['outcome'], reason: RecoveryJobResult['reason'] = null, exhausted = false): Attempt => {
      // Even an invalid metadata record must not put arbitrary values in a safe report.
      const status = job && statuses.includes(job.status) ? job.status : null;
      return { result: { jobId, status, outcome, reason }, exhausted };
    };
    try {
      job = await deps.store.get<GenerationJob>('generation_jobs', jobId);
      if (!job) return result('missing');
      if (job.jobId !== jobId || !Number.isSafeInteger(job.deadline) || job.deadline < 0 ||
          !statuses.includes(job.status)) throw new ServiceError('INVARIANT_VIOLATION');
      if (isTerminal(job)) return result('terminal');
      if (now() >= job.deadline) {
        const batchId = job.batchId;
        job = await deps.store.transaction(tx => failJobInTransaction(tx, jobId, batchId, now(), 'EXECUTION_TIMEOUT'));
        return result(isTerminal(job) ? 'reconciled' : 'pending');
      }
      if (job.status === 'RESERVED' || !job.candidatePath) return result('pending', 'AWAITING_EXECUTION');
      const id = candidateId(job.jobId, job.batchId);
      const candidate = await deps.store.get<PdfCandidate>('pdf_candidates', id);
      if (!candidate) return result('pending', 'CANDIDATE_UNVERIFIED');
      assertCandidateLocation(deps.storage, candidate);
      if (candidate.candidateId !== id || candidate.userId !== job.userId || candidate.path !== job.candidatePath ||
          candidate.pageCount !== job.pageCount || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 16 ||
          !/^[a-f0-9]{64}$/.test(candidate.sha256)) throw new ServiceError('INVARIANT_VIOLATION');
      if (candidate.state !== 'pending') return result('pending', 'CANDIDATE_UNVERIFIED');
      if (candidate.bytes > config.maxCandidateBytes) return result('retryable', 'READ_LIMIT');
      if (candidate.bytes > config.maxReadBytesPerRun - budget.used) return result('retryable', 'READ_LIMIT', true);
      budget.used += candidate.bytes;
      const verification = await verifyCandidate(deps, candidate);
      if (verification === 'unavailable') return result('pending', 'STORAGE_UNAVAILABLE');
      // An incomplete object may belong to an in-flight upload. Only the deadline
      // proves failure here; the live executor has its separate known-failure basis.
      if (verification === 'invalid') return result('pending', 'CANDIDATE_UNVERIFIED');
      job = await settleCandidate(deps, candidate);
      return result(isTerminal(job) ? 'reconciled' : 'pending');
    } catch { return result('retryable', 'OPERATION_FAILED'); }
  }

  async function sweep(): Promise<RecoverySweepResult> {
    const startedAt = now();
    const original = await deps.store.get<Checkpoint>('maintenance_cursors', checkpointId);
    validateCheckpoint(original);
    let cursor: RecoveryCursor = original ? { phase: original.phase, afterId: original.afterId } : initialCursor();
    let cycleComplete = false, exhausted = false;
    const budget: ReadBudget = { used: 0 };
    const counts = { visitedJobs: 0, visitedCandidates: 0, reconciledJobs: 0, pendingJobs: 0,
      cleanedCandidates: 0, protectedCandidates: 0, retryableRecords: 0, recordErrors: 0 };
    const visited = () => counts.visitedJobs + counts.visitedCandidates;
    const inTime = () => now() - startedAt < config.maxRunMs;
    while (!cycleComplete && !exhausted && visited() < config.maxRecordsPerRun && inTime()) {
      const phase = cursor.phase;
      const limit = Math.min(config.pageSize, config.maxRecordsPerRun - visited());
      const rows: StoredDocument[] = await deps.store.list(phase === 'candidates' ? 'pdf_candidates' : 'generation_jobs', {
        limit, ...(cursor.afterId === null ? {} : { afterId: cursor.afterId }),
        ...(phase === 'candidates' ? {} : { where: { status: phase === 'reserved' ? 'RESERVED' : 'GENERATING' } }),
      });
      let completedPage = true;
      for (const row of rows) {
        if (!inTime()) { completedPage = false; break; }
        if (phase === 'candidates') {
          counts.visitedCandidates++;
          try {
            const candidate = row.value as PdfCandidate;
            if (row.id !== candidate.candidateId) throw new ServiceError('INVARIANT_VIOLATION');
            assertCandidateLocation(deps.storage, candidate);
            if (await cleanupCandidate(deps, row.id)) counts.cleanedCandidates++;
            else {
              const current = await deps.store.get<PdfCandidate>('pdf_candidates', row.id);
              if (current?.state === 'deleting') counts.retryableRecords++;
              else counts.protectedCandidates++;
            }
          } catch { counts.recordErrors++; }
        } else {
          const attempt = await recover(row.id, budget);
          if (attempt.exhausted) { exhausted = true; completedPage = false; break; }
          counts.visitedJobs++;
          if (attempt.result.outcome === 'reconciled') counts.reconciledJobs++;
          else if (attempt.result.outcome === 'pending') counts.pendingJobs++;
          else if (attempt.result.reason === 'OPERATION_FAILED') counts.recordErrors++;
          else if (attempt.result.outcome === 'retryable') counts.retryableRecords++;
        }
        cursor = { phase, afterId: row.id };
      }
      if (!completedPage) break;
      if (rows.length < limit) {
        if (phase === 'candidates') { cycleComplete = true; cursor = initialCursor(); }
        else cursor = { phase: phase === 'reserved' ? 'generating' : 'candidates', afterId: null };
      }
    }
    const saved = await deps.store.transaction(async tx => {
      const current = await tx.get<Checkpoint>('maintenance_cursors', checkpointId);
      validateCheckpoint(current);
      if ((current?.revision ?? 0) !== (original?.revision ?? 0)) {
        return { checkpointSaved: false, nextCursor: current ? { phase: current.phase, afterId: current.afterId } : initialCursor() };
      }
      const revision = (current?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new ServiceError('INVARIANT_VIOLATION');
      await tx.set('maintenance_cursors', checkpointId, { schemaVersion: 1, revision,
        phase: cursor.phase, afterId: cursor.afterId, updatedAt: now() });
      return { checkpointSaved: true, nextCursor: cursor };
    });
    return { ...counts, expectedReadBytes: budget.used, startedAt, finishedAt: now(), cycleComplete, ...saved };
  }

  return {
    async recoverJob(jobId) {
      if (!key(jobId) || !/^j_[a-f0-9-]{36}$/.test(jobId)) throw new ServiceError('INVALID_ARGUMENT');
      return (await recover(jobId, { used: 0 })).result;
    },
    async runSweep() {
      try { return await sweep(); }
      catch { throw new ServiceError('INTERNAL_ERROR'); }
    },
  };
}
