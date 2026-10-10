import type { MetadataTransaction, StoredDocument } from '@learn/cloud-runtime';
import { ServiceError, type LifecycleConfig, type LifecycleSweepResult, type RecoveryDependencies, type ServiceConfig } from './contracts.js';
import type { AccountDeletion, CreditAccount, CreditBucket, CreditLedgerEntry, CreditReservation,
  GenerationJob, GenerationRequestTombstone, StoredGenerationRequest, UserRecord } from './model.js';
import { assertDeletion, extendDeletionInTransaction, startDeletionInTransaction } from './privacy.js';
import { shanghaiDate } from './stats-date.js';
import { advanceStatsCoverageFloorInTransaction, markStatsCoverageGapInTransaction, readStatsCoverageState, statsSources } from './stats-coverage.js';
import { historyId, indexJobInTransaction, type HistoryEntry } from './history.js';
import { isTerminal, jobSummary } from './jobs.js';
import { candidateId } from './artifacts.js';

export type ChangeCounts = Partial<Pick<LifecycleSweepResult, 'deletedRecords' | 'scrubbedRequests' | 'removedFiles' |
  'removedFileBytes' | 'deletedCandidates' | 'indexedJobs' | 'startedDeletions' | 'completedDeletions' |
  'protectedRecords' | 'retryableRecords' | 'recordErrors' | 'oldestDeletionAgeMs'>>;
export const protectedRecord = (): ChangeCounts => ({ protectedRecords: 1 });
export function invariant(condition: unknown): asserts condition {
  if (!condition) throw new ServiceError('INVARIANT_VIOLATION');
}
export function userKey(value: unknown): asserts value is string {
  invariant(typeof value === 'string' && /^u_[a-f0-9]{64}$/.test(value));
}
export function time(value: unknown): number {
  invariant(typeof value === 'number'); shanghaiDate(value); return value;
}
export async function deletionFor(tx: MetadataTransaction, userId: string): Promise<AccountDeletion | null> {
  userKey(userId);
  const value = await tx.get<AccountDeletion>('account_deletions', userId);
  if (value) assertDeletion(value, userId);
  return value;
}
export function requestTombstone(record: StoredGenerationRequest, job: GenerationJob | null,
  deletion: AccountDeletion | null, policy: LifecycleConfig): GenerationRequestTombstone {
  userKey(record.userId); time(record.createdAt); time(record.windowExpiresAt); time(record.retainUntil);
  invariant(typeof record.requestId === 'string' && /^j_[a-f0-9-]{36}$/.test(record.jobId));
  const retainUntil = deletion ? Math.min(record.retainUntil, Math.max(record.windowExpiresAt,
    job?.deadline ?? record.windowExpiresAt, deletion.requestedAt + policy.deletionProtectionMs)) : record.retainUntil;
  return { userId: record.userId, requestId: record.requestId, jobId: record.jobId,
    windowExpiresAt: record.windowExpiresAt, createdAt: record.createdAt, retainUntil, deleted: true };
}

export class LifecycleRecords {
  readonly policy: LifecycleConfig;
  constructor(readonly deps: RecoveryDependencies, readonly config: ServiceConfig) { this.policy = config.lifecycle!; }
  now(): number { return time(this.deps.clock.now()); }

  async users(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const user = await tx.get<UserRecord>('users', row.id);
      if (!user) return {};
      userKey(user.userId); invariant(user.userId === row.id); time(user.createdAt); time(user.lastActiveAt);
      invariant(['active', 'disabled', 'deleted'].includes(user.status));
      if (await deletionFor(tx, row.id)) return protectedRecord();
      if (user.status !== 'deleted' && this.now() < user.lastActiveAt + this.policy.inactiveUserRetentionMs) return {};
      await startDeletionInTransaction(tx, row.id, this.now(), this.policy);
      return { startedDeletions: 1 };
    });
  }

  async jobs(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const job = await tx.get<GenerationJob>('generation_jobs', row.id);
      if (!job) return {};
      invariant(job.jobId === row.id); jobSummary(job); userKey(job.userId); time(job.deadline); time(job.recordExpiresAt);
      const deletion = await deletionFor(tx, job.userId);
      if (!isTerminal(job)) {
        await extendDeletionInTransaction(tx, deletion, job.deadline + this.policy.lateIoProtectionMs);
        if (!deletion && !await tx.get('generation_history', historyId(job.createdAt, job.jobId))) {
          await indexJobInTransaction(tx, job); return { indexedJobs: 1, protectedRecords: 1 };
        }
        return protectedRecord();
      }
      if (!deletion && this.now() < job.recordExpiresAt) {
        if (!await tx.get('generation_history', historyId(job.createdAt, job.jobId))) {
          await indexJobInTransaction(tx, job); return { indexedJobs: 1 };
        }
        return {};
      }
      const request = await tx.get<StoredGenerationRequest>('generation_requests', job.requestKey);
      let scrubbedRequests = 0;
      if (request) {
        invariant(request.jobId === job.jobId && request.userId === job.userId && request.requestId === job.requestId);
        const tombstone = requestTombstone(request, job, deletion, this.policy);
        if (!request.deleted || 'fingerprint' in request) {
          await tx.set('generation_requests', job.requestKey, tombstone); scrubbedRequests = 1;
        }
        await extendDeletionInTransaction(tx, deletion, tombstone.retainUntil);
      }
      if (job.fileId || await tx.get('pdf_candidates', candidateId(job.jobId, job.batchId))) return { scrubbedRequests, protectedRecords: 1 };
      const reservation = await tx.get<CreditReservation>('credit_reservations', job.jobId);
      invariant(reservation && reservation.userId === job.userId && reservation.reservationId === job.jobId &&
        reservation.state === (job.status === 'SUCCEEDED' ? 'consumed' : 'released'));
      const use = await tx.get('preset_uses', job.jobId);
      if (use) { invariant(use.registryId === job.registryId && use.state === 'released'); await tx.delete('preset_uses', job.jobId); }
      await markStatsCoverageGapInTransaction(tx, 'jobs', shanghaiDate(time(job.finishedAt)), deletion ? 'account-deletion' : 'retention', this.now());
      const id = historyId(job.createdAt, job.jobId);
      const history = await tx.get('generation_history', id);
      await tx.delete('generation_history', id);
      await tx.delete('generation_jobs', row.id);
      return { scrubbedRequests, deletedRecords: 1 + (history ? 1 : 0) + (use ? 1 : 0) };
    });
  }

  async requests(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      let record = await tx.get<StoredGenerationRequest>('generation_requests', row.id);
      if (!record) return {};
      userKey(record.userId); time(record.windowExpiresAt); time(record.retainUntil);
      const deletion = await deletionFor(tx, record.userId);
      const job = await tx.get<GenerationJob>('generation_jobs', record.jobId);
      if (job) invariant(job.userId === record.userId && job.jobId === record.jobId && job.requestKey === row.id);
      let scrubbedRequests = 0;
      if (deletion || !job || isTerminal(job) && this.now() >= job.recordExpiresAt) {
        const tombstone = requestTombstone(record, job, deletion, this.policy);
        if (!record.deleted || 'fingerprint' in record || record.retainUntil !== tombstone.retainUntil) {
          await tx.set('generation_requests', row.id, tombstone); scrubbedRequests = 1;
        }
        record = tombstone;
      }
      await extendDeletionInTransaction(tx, deletion, Math.max(record.retainUntil, job?.deadline ?? 0));
      if (job && !isTerminal(job) || this.now() < Math.max(record.retainUntil, record.windowExpiresAt)) return { scrubbedRequests, protectedRecords: 1 };
      await tx.delete('generation_requests', row.id);
      return { scrubbedRequests, deletedRecords: 1 };
    });
  }

  async reservations(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get<CreditReservation>('credit_reservations', row.id);
      if (!value) return {};
      userKey(value.userId); invariant(value.reservationId === row.id && ['pending', 'consumed', 'released'].includes(value.state));
      const deletion = await deletionFor(tx, value.userId);
      if (value.state === 'pending' || await tx.get('generation_jobs', row.id)) return protectedRecord();
      const until = this.protectedUntil(time(value.settledAt), deletion);
      await extendDeletionInTransaction(tx, deletion, until);
      if (this.now() < until) return protectedRecord();
      await tx.delete('credit_reservations', row.id);
      return { deletedRecords: 1 };
    });
  }

  private protectedUntil(createdAt: number, deletion: AccountDeletion | null): number {
    const natural = createdAt + this.policy.ledgerRetentionMs;
    return deletion ? Math.min(natural, Math.max(createdAt, deletion.requestedAt) + this.policy.deletionProtectionMs) : natural;
  }

  async ledger(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get<CreditLedgerEntry>('credit_ledger', row.id);
      if (!value) return {};
      userKey(value.userId); time(value.createdAt);
      invariant(['GRANT', 'EXPIRE', 'RESERVE', 'CONSUME', 'RELEASE'].includes(value.operation));
      invariant(typeof value.bucketId === 'string' && new RegExp(`^${value.userId}_[2-9][0-9]{3}(0[1-9]|1[0-2])$`).test(value.bucketId));
      const expectedId = value.operation === 'GRANT' ? `grant_${value.bucketId}` : value.operation === 'EXPIRE' ? `expire_${value.bucketId}` :
        value.operation === 'RESERVE' ? `reserve_${value.reservationId}` : `settle_${value.reservationId}`;
      invariant(row.id === expectedId);
      invariant([value.deltaAvailable, value.deltaReserved, value.deltaConsumed, value.deltaExpired].every(Number.isSafeInteger));
      const deletion = await deletionFor(tx, value.userId);
      if (value.reservationId) {
        const reservation = await tx.get<CreditReservation>('credit_reservations', value.reservationId);
        if (reservation) invariant(reservation.userId === value.userId && reservation.bucketId === value.bucketId);
        if (reservation || await tx.get('generation_jobs', value.reservationId)) return protectedRecord();
      } else {
        const account = await tx.get<CreditAccount>('credit_accounts', value.userId);
        if (account && account.reserved > 0) return protectedRecord();
      }
      const until = this.protectedUntil(value.createdAt, deletion);
      await extendDeletionInTransaction(tx, deletion, until);
      if (this.now() < until) return protectedRecord();
      if (value.operation === 'CONSUME') await markStatsCoverageGapInTransaction(tx, 'credits', shanghaiDate(value.createdAt), deletion ? 'account-deletion' : 'retention', this.now());
      await tx.delete('credit_ledger', row.id);
      return { deletedRecords: 1 };
    });
  }

  async buckets(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get<CreditBucket>('credit_buckets', row.id);
      if (!value) return {};
      userKey(value.userId); time(value.endsAt);
      invariant(typeof value.period === 'string' && /^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(value.period) && row.id === `${value.userId}_${value.period.replace('-', '')}`);
      invariant([value.granted, value.available, value.reserved, value.consumed, value.expired].every(v => Number.isSafeInteger(v) && v >= 0) &&
        value.available + value.reserved + value.consumed + value.expired === value.granted);
      const deletion = await deletionFor(tx, value.userId);
      const account = await tx.get<CreditAccount>('credit_accounts', value.userId);
      if (value.reserved > 0 || !deletion && account?.bucketId === row.id) return protectedRecord();
      const until = deletion ? deletion.requestedAt + this.policy.deletionProtectionMs : value.endsAt + this.policy.ledgerRetentionMs;
      await extendDeletionInTransaction(tx, deletion, until);
      if (this.now() < until) return protectedRecord();
      await tx.delete('credit_buckets', row.id);
      return { deletedRecords: 1 };
    });
  }

  async activity(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get('daily_activity', row.id);
      if (!value) return {};
      userKey(value.userId); const at = time(value.firstEventAt);
      invariant(value.date === shanghaiDate(at) && row.id === `${value.userId}_${value.date.replace(/-/g, '')}`);
      const deletion = await deletionFor(tx, value.userId);
      if (!deletion && this.now() < at + this.policy.activityRetentionMs) return {};
      await markStatsCoverageGapInTransaction(tx, 'activity', value.date, deletion ? 'account-deletion' : 'retention', this.now());
      await tx.delete('daily_activity', row.id);
      return { deletedRecords: 1 };
    });
  }

  async audits(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get('admin_audit_logs', row.id);
      if (!value) return {};
      userKey(value.userId);
      const until = time(value.createdAt) + this.policy.auditRetentionMs;
      await extendDeletionInTransaction(tx, await deletionFor(tx, value.userId), until);
      if (this.now() < until) return protectedRecord();
      await tx.delete('admin_audit_logs', row.id);
      return { deletedRecords: 1 };
    });
  }

  async publishers(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get('preset_versions', row.id);
      if (!value || value.publishedBy === null) return {};
      userKey(value.publishedBy);
      if (await deletionFor(tx, value.publishedBy)) await tx.set('preset_versions', row.id, { ...value, publishedBy: null });
      return {};
    });
  }

  async history(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get<HistoryEntry>('generation_history', row.id);
      if (!value) return {};
      userKey(value.userId); invariant(row.id === historyId(value.createdAt, value.jobId));
      const job = await tx.get<GenerationJob>('generation_jobs', value.jobId);
      if (job) { invariant(job.userId === value.userId && job.createdAt === value.createdAt); return {}; }
      await tx.delete('generation_history', row.id);
      return { deletedRecords: 1 };
    });
  }

  async rates(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      userKey(row.id);
      const value = await tx.get('generation_rate', row.id);
      if (!value) return {};
      if (!await deletionFor(tx, row.id) && this.now() < time(value.windowStart) + this.config.generation!.rateWindowMs) return {};
      await tx.delete('generation_rate', row.id);
      return { deletedRecords: 1 };
    });
  }

  async deletions(row: StoredDocument): Promise<ChangeCounts> {
    const original = await this.deps.store.get<AccountDeletion>('account_deletions', row.id);
    if (!original) return {};
    assertDeletion(original, row.id);
    const age = Math.max(0, this.now() - original.requestedAt);
    if (this.now() < original.earliestReuseAt) return { ...protectedRecord(), oldestDeletionAgeMs: age };
    // New writers are fenced by deleted user state. Settlers still have jobs/reservations;
    // checking every dependency before the final transaction cannot race past a new writer.
    const collections = ['generation_jobs', 'pdf_candidates', 'generation_requests', 'credit_reservations',
      'credit_ledger', 'credit_buckets', 'daily_activity', 'admin_audit_logs', 'generation_history', 'preset_versions'];
    for (const collection of collections) {
      const where = collection === 'preset_versions' ? { publishedBy: row.id } : { userId: row.id };
      if ((await this.deps.store.list(collection, { where, limit: 1 })).length) return { ...protectedRecord(), oldestDeletionAgeMs: age };
    }
    return this.deps.store.transaction(async tx => {
      const current = await deletionFor(tx, row.id);
      if (!current) return {};
      if (current.requestedAt !== original.requestedAt || this.now() < current.earliestReuseAt) return protectedRecord();
      const user = await tx.get<UserRecord>('users', row.id);
      const account = await tx.get<CreditAccount>('credit_accounts', row.id);
      invariant(user?.userId === row.id && user.status === 'deleted');
      if (account) { invariant(account.userId === row.id && Number.isSafeInteger(account.reserved) && account.reserved >= 0); if (account.reserved) return protectedRecord(); }
      await markStatsCoverageGapInTransaction(tx, 'users', shanghaiDate(time(user.createdAt)), 'account-deletion', this.now());
      await tx.delete('users', row.id); await tx.delete('account_deletions', row.id);
      await tx.delete('credit_accounts', row.id); await tx.delete('generation_rate', row.id);
      return { completedDeletions: 1, deletedRecords: account ? 3 : 2, oldestDeletionAgeMs: age };
    });
  }

  async coverage(row: StoredDocument): Promise<ChangeCounts> {
    return this.deps.store.transaction(async tx => {
      const value = await tx.get('stats_coverage_gaps', row.id);
      if (!value) return {};
      invariant(typeof value.source === 'string' && statsSources.includes(value.source as typeof statsSources[number]));
      invariant(typeof value.date === 'string' && row.id === `${value.source}_${value.date.replace(/-/g, '')}`);
      const state = await readStatsCoverageState(tx);
      const floor = state.floors[value.source as typeof statsSources[number]];
      if (floor && value.date < floor) { await tx.delete('stats_coverage_gaps', row.id); return { deletedRecords: 1 }; }
      return {};
    });
  }

  async advanceFloors(): Promise<void> {
    const now = this.now();
    const minimum = Date.parse('2000-01-01T00:00:00+08:00');
    const dates = { users: this.policy.inactiveUserRetentionMs, activity: this.policy.activityRetentionMs,
      jobs: this.config.generation!.recordRetentionMs, credits: this.policy.ledgerRetentionMs };
    await this.deps.store.transaction(async tx => {
      for (const [source, duration] of Object.entries(dates)) {
        await advanceStatsCoverageFloorInTransaction(tx, source as keyof typeof dates, shanghaiDate(Math.max(minimum, now - duration)));
      }
    });
  }
}
