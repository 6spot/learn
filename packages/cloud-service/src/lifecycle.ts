import { ServiceError, type LifecycleService, type LifecycleSweepResult, type RecoveryDependencies, type ServiceConfig } from './contracts.js';
import { validateConfig } from './config.js';
import { invariant, LifecycleRecords, time } from './lifecycle-records.js';
import { cleanLifecycleFile } from './lifecycle-files.js';

const phases = ['users', 'files', 'jobs', 'requests', 'reservations', 'ledger', 'buckets', 'activity', 'audits', 'publishers', 'history', 'rates', 'deletions', 'coverage'] as const;
type Phase = typeof phases[number];
const collections: Record<Phase, string> = { users: 'users', files: 'pdf_candidates', jobs: 'generation_jobs', requests: 'generation_requests',
  reservations: 'credit_reservations', ledger: 'credit_ledger', buckets: 'credit_buckets', activity: 'daily_activity', audits: 'admin_audit_logs',
  publishers: 'preset_versions', history: 'generation_history', rates: 'generation_rate', deletions: 'account_deletions', coverage: 'stats_coverage_gaps' };
type Checkpoint = { schemaVersion: 1; revision: number; phase: Phase; afterId: string | null; updatedAt: number };
function validateCheckpoint(value: Checkpoint | null): void {
  if (!value) return;
  invariant(value.schemaVersion === 1 && Number.isSafeInteger(value.revision) && value.revision >= 1 && phases.includes(value.phase) &&
    (value.afterId === null || typeof value.afterId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.afterId)));
  time(value.updatedAt);
}

/** Trusted maintenance only. No user RPC, renderer, body or input replay capability. */
export function createLifecycleService(deps: RecoveryDependencies, rawConfig: ServiceConfig): LifecycleService {
  const config = validateConfig(rawConfig);
  if (!config.lifecycle || !config.generation) throw new ServiceError('PRIVACY_UNAVAILABLE');
  const policy = config.lifecycle;
  const work = new LifecycleRecords(deps, config);
  async function run(): Promise<LifecycleSweepResult> {
    const startedAt = time(deps.clock.now());
    const original = await deps.store.get<Checkpoint>('maintenance_cursors', 'lifecycle_v1');
    validateCheckpoint(original);
    let phase: Phase = original?.phase ?? 'users', afterId = original?.afterId ?? null;
    let cycleComplete = false;
    const counts = { visitedRecords: 0, deletedRecords: 0, scrubbedRequests: 0, removedFiles: 0, removedFileBytes: 0,
      deletedCandidates: 0, indexedJobs: 0, startedDeletions: 0, completedDeletions: 0, protectedRecords: 0,
      retryableRecords: 0, recordErrors: 0, pagesRead: 0, oldestDeletionAgeMs: 0 };
    const inTime = () => { const now = time(deps.clock.now()); invariant(now >= startedAt); return now - startedAt < policy.maxRunMs; };
    await work.advanceFloors();
    while (!cycleComplete && counts.visitedRecords < policy.maxRecordsPerRun && inTime()) {
      const limit = Math.min(policy.pageSize, policy.maxRecordsPerRun - counts.visitedRecords);
      const rows = await deps.store.list(collections[phase], { limit, ...(afterId ? { afterId } : {}) });
      counts.pagesRead++;
      invariant(rows.length <= limit);
      let completePage = true;
      for (const row of rows) {
        if (!inTime()) { completePage = false; break; }
        invariant(typeof row.id === 'string' && (!afterId || row.id > afterId));
        counts.visitedRecords++;
        try {
          const result = phase === 'files' ? await cleanLifecycleFile(deps, policy, row) : await work[phase](row);
          for (const [key, value] of Object.entries(result)) {
            const field = key as keyof typeof result;
            if (field === 'oldestDeletionAgeMs') counts[field] = Math.max(counts[field], value);
            else counts[field] += value;
          }
        } catch { counts.recordErrors++; }
        afterId = row.id;
      }
      if (!completePage) break;
      if (rows.length < limit) {
        const index = phases.indexOf(phase);
        if (index === phases.length - 1) { cycleComplete = true; phase = 'users'; }
        else phase = phases[index + 1]!;
        afterId = null;
      }
    }
    const checkpointSaved = await deps.store.transaction(async tx => {
      const current = await tx.get<Checkpoint>('maintenance_cursors', 'lifecycle_v1');
      validateCheckpoint(current);
      if ((current?.revision ?? 0) !== (original?.revision ?? 0)) return false;
      const revision = (current?.revision ?? 0) + 1;
      invariant(Number.isSafeInteger(revision));
      await tx.set('maintenance_cursors', 'lifecycle_v1', { schemaVersion: 1, revision, phase, afterId, updatedAt: time(deps.clock.now()) });
      return true;
    });
    const budgetExhausted = !cycleComplete && (counts.visitedRecords >= policy.maxRecordsPerRun || !inTime());
    const alerts: LifecycleSweepResult['alerts'][number][] = [];
    if (counts.retryableRecords) alerts.push('CLEANUP_RETRY');
    if (counts.recordErrors) alerts.push('CLEANUP_ERROR');
    if (budgetExhausted) alerts.push('BUDGET_EXHAUSTED');
    return { ...counts, startedAt, finishedAt: time(deps.clock.now()), cycleComplete, checkpointSaved, budgetExhausted, alerts };
  }
  return { async runSweep() { try { return await run(); } catch { throw new ServiceError('INTERNAL_ERROR'); } } };
}
