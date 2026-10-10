import type { MetadataTransaction } from '@learn/cloud-runtime';
import { ServiceError, type ServiceConfig } from './contracts.js';
import { quotaPeriod } from './config.js';
import type { CreditAccount, CreditBucket, CreditLedgerEntry, CreditReservation, UserRecord } from './model.js';

function assertBucket(bucket: CreditBucket): void {
  const values = [bucket.granted, bucket.available, bucket.reserved, bucket.consumed, bucket.expired];
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0) ||
      bucket.available + bucket.reserved + bucket.consumed + bucket.expired !== bucket.granted) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
}

function assertAccount(account: CreditAccount): void {
  if (![account.available, account.reserved].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
}

function bucketId(userId: string, period: string): string { return `${userId}_${period.replace('-', '')}`; }

async function ledger(tx: MetadataTransaction, id: string, value: CreditLedgerEntry): Promise<void> {
  await tx.create('credit_ledger', id, value);
}

/** Internal primitive: caller has already authenticated userId. No external effects. */
export async function ensureAccountInTransaction(tx: MetadataTransaction, userId: string, now: number,
  config: ServiceConfig): Promise<CreditAccount> {
  const period = quotaPeriod(now);
  if (await tx.get('account_deletions', userId)) throw new ServiceError('ACCOUNT_DELETING');
  const user = await tx.get<UserRecord>('users', userId);
  if (user && user.status !== 'active') throw new ServiceError('ACCOUNT_DISABLED');
  if (user) await tx.set('users', userId, { ...user, lastActiveAt: now });
  else await tx.create('users', userId, { userId, createdAt: now, lastActiveAt: now, status: 'active' });

  const current = await tx.get<CreditAccount>('credit_accounts', userId);
  if (current) {
    assertAccount(current);
    if (current.period === period.period) return current;
    // A backwards provider clock must never reopen a historical bucket/grant.
    if (current.period > period.period) throw new ServiceError('INVARIANT_VIOLATION');
    const oldBucket = await tx.get<CreditBucket>('credit_buckets', current.bucketId);
    if (!oldBucket || oldBucket.userId !== userId) throw new ServiceError('INVARIANT_VIOLATION');
    assertBucket(oldBucket);
    if (oldBucket.available > 0) {
      await tx.set('credit_buckets', current.bucketId, { ...oldBucket, available: 0, expired: oldBucket.expired + oldBucket.available });
      await ledger(tx, `expire_${current.bucketId}`, { userId, bucketId: current.bucketId, operation: 'EXPIRE',
        reservationId: null, deltaAvailable: -oldBucket.available, deltaReserved: 0, deltaConsumed: 0,
        deltaExpired: oldBucket.available, createdAt: now });
    }
  }
  const id = bucketId(userId, period.period);
  const amount = config.monthlyFreeCredits;
  const bucket: CreditBucket = { userId, period: period.period, granted: amount, available: amount,
    reserved: 0, consumed: 0, expired: 0, createdAt: now, endsAt: period.endsAt };
  await tx.create('credit_buckets', id, bucket);
  const account: CreditAccount = { userId, period: period.period, bucketId: id, available: amount,
    reserved: current?.reserved ?? 0, monthlyGrant: amount, periodEndsAt: period.endsAt };
  if (current) await tx.set('credit_accounts', userId, account);
  else await tx.create('credit_accounts', userId, account);
  await ledger(tx, `grant_${id}`, { userId, bucketId: id, operation: 'GRANT', reservationId: null,
    deltaAvailable: amount, deltaReserved: 0, deltaConsumed: 0, deltaExpired: 0, createdAt: now });
  return account;
}

function assertReservationId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new ServiceError('INVALID_ARGUMENT');
}

/** Internal primitive: compose with job/idempotency creation in the SAME transaction. */
export async function reserveCreditInTransaction(tx: MetadataTransaction, userId: string, reservationId: string,
  now: number): Promise<CreditReservation> {
  assertReservationId(reservationId);
  const existing = await tx.get<CreditReservation>('credit_reservations', reservationId);
  if (existing) {
    if (existing.userId !== userId) throw new ServiceError('RESERVATION_CONFLICT');
    return existing;
  }
  const account = await tx.get<CreditAccount>('credit_accounts', userId);
  if (!account) throw new ServiceError('NOT_FOUND');
  assertAccount(account);
  const bucket = await tx.get<CreditBucket>('credit_buckets', account.bucketId);
  if (!bucket || bucket.userId !== userId || bucket.period !== account.period) throw new ServiceError('INVARIANT_VIOLATION');
  assertBucket(bucket);
  if (now >= bucket.endsAt || bucket.available < 1 || account.available < 1) throw new ServiceError('QUOTA_EXHAUSTED');
  if (account.available !== bucket.available) throw new ServiceError('INVARIANT_VIOLATION');
  const reservation: CreditReservation = { reservationId, userId, bucketId: account.bucketId,
    state: 'pending', createdAt: now, settledAt: null };
  await tx.create('credit_reservations', reservationId, reservation);
  await tx.set('credit_buckets', account.bucketId, { ...bucket, available: bucket.available - 1, reserved: bucket.reserved + 1 });
  await tx.set('credit_accounts', userId, { ...account, available: account.available - 1, reserved: account.reserved + 1 });
  await ledger(tx, `reserve_${reservationId}`, { userId, bucketId: account.bucketId, operation: 'RESERVE', reservationId,
    deltaAvailable: -1, deltaReserved: 1, deltaConsumed: 0, deltaExpired: 0, createdAt: now });
  return reservation;
}

/** Internal primitive: caller enforces task/batch/deadline state in this transaction. */
export async function settleCreditInTransaction(tx: MetadataTransaction, userId: string, reservationId: string,
  outcome: 'consumed' | 'released', now: number): Promise<CreditReservation> {
  // Job status and credit outcome use different vocabularies. Reject a runtime
  // caller passing e.g. "failed" before it can reduce reserved without a delta.
  if (outcome !== 'consumed' && outcome !== 'released') throw new ServiceError('INVALID_ARGUMENT');
  assertReservationId(reservationId);
  const reservation = await tx.get<CreditReservation>('credit_reservations', reservationId);
  if (!reservation || reservation.userId !== userId) throw new ServiceError('NOT_FOUND');
  if (reservation.state !== 'pending') return reservation;
  const account = await tx.get<CreditAccount>('credit_accounts', userId);
  const bucket = await tx.get<CreditBucket>('credit_buckets', reservation.bucketId);
  if (!account || !bucket || bucket.userId !== userId) throw new ServiceError('INVARIANT_VIOLATION');
  assertAccount(account); assertBucket(bucket);
  if (account.reserved < 1 || bucket.reserved < 1) throw new ServiceError('INVARIANT_VIOLATION');
  const refundAvailable = outcome === 'released' && now < bucket.endsAt && account.bucketId === reservation.bucketId ? 1 : 0;
  const refundExpired = outcome === 'released' && !refundAvailable ? 1 : 0;
  const consumed = outcome === 'consumed' ? 1 : 0;
  const settled: CreditReservation = { ...reservation, state: outcome, settledAt: now };
  await tx.set('credit_reservations', reservationId, settled);
  await tx.set('credit_buckets', reservation.bucketId, { ...bucket, available: bucket.available + refundAvailable,
    reserved: bucket.reserved - 1, consumed: bucket.consumed + consumed, expired: bucket.expired + refundExpired });
  await tx.set('credit_accounts', userId, { ...account, available: account.available + refundAvailable, reserved: account.reserved - 1 });
  await ledger(tx, `settle_${reservationId}`, { userId, bucketId: reservation.bucketId,
    operation: consumed ? 'CONSUME' : 'RELEASE', reservationId, deltaAvailable: refundAvailable,
    deltaReserved: -1, deltaConsumed: consumed, deltaExpired: refundExpired, createdAt: now });
  return settled;
}
