import { cloneDocument, type JsonObject, type MetadataTransaction } from '@learn/cloud-runtime';
import { ServiceError, type DeletionStatus, type LifecycleConfig, type PrivacyInfo, type ServiceConfig,
  type ServiceDependencies } from './contracts.js';
import type { AccountDeletion, UserRecord } from './model.js';
import { quotaPeriod } from './config.js';
import { shanghaiDate } from './stats-date.js';

export function assertDeletion(value: AccountDeletion, userId: string): void {
  if (value.userId !== userId || !/^u_[a-f0-9]{64}$/.test(userId)) throw new ServiceError('INVARIANT_VIOLATION');
  shanghaiDate(value.requestedAt); shanghaiDate(value.earliestReuseAt);
  if (value.earliestReuseAt < value.requestedAt) throw new ServiceError('INVARIANT_VIOLATION');
}

/** Starts the finite protection in the same transaction that revokes account access. */
export async function startDeletionInTransaction(tx: MetadataTransaction, userId: string, now: number,
  policy: LifecycleConfig): Promise<AccountDeletion | null> {
  const existing = await tx.get<AccountDeletion>('account_deletions', userId);
  if (existing) { assertDeletion(existing, userId); return existing; }
  const user = await tx.get<UserRecord>('users', userId);
  if (!user) return null;
  if (user.userId !== userId || !['active', 'disabled', 'deleted'].includes(user.status)) throw new ServiceError('INVARIANT_VIOLATION');
  const earliestReuseAt = Math.max(quotaPeriod(now).endsAt, now + policy.maxWindowTtlMs, now + policy.deletionProtectionMs);
  shanghaiDate(earliestReuseAt);
  const deletion: AccountDeletion = { userId, requestedAt: now, earliestReuseAt };
  await tx.set('users', userId, { ...user, status: 'deleted' });
  await tx.create('account_deletions', userId, deletion);
  return deletion;
}

export async function extendDeletionInTransaction(tx: MetadataTransaction, deletion: AccountDeletion | null,
  until: number): Promise<void> {
  if (!deletion || until <= deletion.earliestReuseAt) return;
  shanghaiDate(until);
  await tx.set('account_deletions', deletion.userId, { ...deletion, earliestReuseAt: until });
}

export function assertDeleteConfirmation(raw: unknown): void {
  let input: JsonObject;
  try { input = cloneDocument(raw as JsonObject); } catch { throw new ServiceError('INVALID_ARGUMENT'); }
  if (Object.keys(input).length !== 1 || input.confirm !== true) throw new ServiceError('INVALID_ARGUMENT');
}

export async function deletionStatus(deps: ServiceDependencies, userId: string): Promise<DeletionStatus> {
  return deps.store.transaction(async tx => {
    const serverTime = deps.clock.now();
    shanghaiDate(serverTime);
    const deletion = await tx.get<AccountDeletion>('account_deletions', userId);
    if (deletion) {
      assertDeletion(deletion, userId);
      return { state: 'deleting', requestedAt: deletion.requestedAt, earliestReuseAt: deletion.earliestReuseAt, serverTime };
    }
    const user = await tx.get<UserRecord>('users', userId);
    if (user && (user.userId !== userId || !['active', 'disabled', 'deleted'].includes(user.status))) throw new ServiceError('INVARIANT_VIOLATION');
    return { state: !user ? 'none' : user.status === 'active' ? 'active' : 'disabled', requestedAt: null, earliestReuseAt: null, serverTime };
  });
}

export async function privacyInfo(deps: ServiceDependencies, config: ServiceConfig, userId: string): Promise<PrivacyInfo> {
  if (!config.lifecycle || !config.generation) throw new ServiceError('PRIVACY_UNAVAILABLE');
  const p = config.lifecycle, g = config.generation;
  const deletion = await deletionStatus(deps, userId);
  return { policyVersion: 'learn-privacy-v1', timeZone: 'Asia/Shanghai', serverTime: deletion.serverTime, deletion,
    retention: { pdfMs: g.pdfRetentionMs, recordMs: g.recordRetentionMs, requestMs: g.requestRetentionMs,
      ledgerMs: p.ledgerRetentionMs, activityMs: p.activityRetentionMs, auditMs: p.auditRetentionMs,
      inactiveUserMs: p.inactiveUserRetentionMs, lateIoProtectionMs: p.lateIoProtectionMs, deletionProtectionMs: p.deletionProtectionMs } };
}
