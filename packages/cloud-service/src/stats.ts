import { cloneDocument, type JsonObject, type ListOptions, type StoredDocument } from '@learn/cloud-runtime';
import { ServiceError, type AdminStatsRequest, type AdminStatsResponse, type ServiceConfig,
  type ServiceDependencies, type StatsSource } from './contracts.js';
import type { UserRecord } from './model.js';
import { isStatsDate, shanghaiDate, statsPeriod } from './stats-date.js';
import { readStatsCoverage, readStatsCoverageState } from './stats-coverage.js';

const templates = ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'] as const;
const validUser = (value: unknown): value is string => typeof value === 'string' && /^u_[a-f0-9]{64}$/.test(value);
const validJob = (value: unknown): value is string => typeof value === 'string' && /^j_[a-f0-9-]{36}$/.test(value);
function invariant(condition: unknown): asserts condition {
  if (!condition) throw new ServiceError('INVARIANT_VIOLATION');
}
function eventTime(value: unknown): number {
  invariant(typeof value === 'number');
  shanghaiDate(value);
  return value;
}

export function snapshotStatsRequest(value: unknown): AdminStatsRequest {
  let input: JsonObject;
  try { input = cloneDocument((value === undefined ? {} : value) as JsonObject); }
  catch { throw new ServiceError('INVALID_ARGUMENT'); }
  if (Object.keys(input).some(key => key !== 'date')) throw new ServiceError('INVALID_ARGUMENT');
  const date = input.date;
  if (date === undefined) return {};
  if (!isStatsDate(date)) throw new ServiceError('INVALID_ARGUMENT');
  return { date };
}

export async function aggregateAdminStats(dependencies: ServiceDependencies, config: ServiceConfig, userId: string,
  request: AdminStatsRequest): Promise<AdminStatsResponse> {
  if (!config.stats) throw new ServiceError('STATS_UNAVAILABLE');
  const policy = config.stats;
  const generatedAt = dependencies.clock.now();
  const today = shanghaiDate(generatedAt);
  const date = request.date ?? today;
  if (date > today) throw new ServiceError('INVALID_ARGUMENT');
  const period = statsPeriod(date);
  const initial = await dependencies.store.transaction(tx => readStatsCoverage(tx, date, policy.coverageStartDate));
  const available = (source: StatsSource) => !initial.coverage.gaps.some(gap => gap.source === source);
  const included = (at: number) => at >= period.startsAt && at < period.endsAt && at <= generatedAt;
  const scan = { recordsRead: 0, pagesRead: 0 };
  const checkTime = () => {
    const now = dependencies.clock.now();
    if (!Number.isSafeInteger(now) || now < generatedAt) throw new ServiceError('INVARIANT_VIOLATION');
    if (now - generatedAt >= policy.maxRunMs) throw new ServiceError('STATS_LIMIT_EXCEEDED');
  };
  async function scanSource(collection: string, visit: (row: StoredDocument) => void, where?: ListOptions['where']): Promise<void> {
    let afterId: string | undefined;
    for (;;) {
      checkTime();
      // A single look-ahead detects exhaustion when the total equals the budget.
      const remaining = policy.maxScanRecords - scan.recordsRead;
      const limit = Math.min(policy.pageSize, remaining + 1);
      const rows = await dependencies.store.list(collection, { ...(where ? { where } : {}), ...(afterId ? { afterId } : {}), limit });
      scan.pagesRead++;
      invariant(Array.isArray(rows) && rows.length <= limit);
      if (rows.length > remaining) throw new ServiceError('STATS_LIMIT_EXCEEDED');
      for (const row of rows) {
        checkTime();
        invariant(typeof row.id === 'string' && row.id.length > 0 && (!afterId || row.id > afterId));
        invariant(row.value && typeof row.value === 'object' && !Array.isArray(row.value));
        scan.recordsRead++;
        visit(row);
        afterId = row.id;
      }
      if (rows.length < limit) return;
    }
  }

  let newUsers = 0, dau = 0, succeeded = 0, failed = 0, creditsConsumed = 0;
  const templateCounts = new Map<string, number>(templates.map(id => [id, 0]));
  if (available('users')) await scanSource('users', ({ id, value }) => {
    invariant(validUser(value.userId) && id === value.userId && ['active', 'disabled', 'deleted'].includes(value.status as string));
    if (included(eventTime(value.createdAt))) newUsers++;
  });
  if (available('activity')) await scanSource('daily_activity', ({ id, value }) => {
    invariant(validUser(value.userId) && value.date === date && id === `${value.userId}_${date.replace(/-/g, '')}` &&
      ['generation', 'pdf-download'].includes(value.firstEvent as string));
    const at = eventTime(value.firstEventAt);
    invariant(shanghaiDate(at) === date);
    if (included(at)) dau++;
  }, { date });
  if (available('jobs')) await scanSource('generation_jobs', ({ id, value }) => {
    invariant(validJob(value.jobId) && id === value.jobId && validUser(value.userId) &&
      ['RESERVED', 'GENERATING', 'SUCCEEDED', 'FAILED'].includes(value.status as string));
    if (value.status === 'RESERVED' || value.status === 'GENERATING') {
      invariant(value.finishedAt === null);
      return;
    }
    const finishedAt = eventTime(value.finishedAt);
    invariant(finishedAt >= eventTime(value.createdAt));
    const templateId = (value.versions as JsonObject | null)?.templateId;
    invariant(typeof templateId === 'string' && templateCounts.has(templateId));
    if (!included(finishedAt)) return;
    if (value.status === 'FAILED') failed++;
    else { succeeded++; templateCounts.set(templateId, templateCounts.get(templateId)! + 1); }
  });
  if (available('credits')) await scanSource('credit_ledger', ({ id, value }) => {
    invariant(value.operation === 'CONSUME' && validUser(value.userId) && validJob(value.reservationId) &&
      id === `settle_${value.reservationId}` && typeof value.bucketId === 'string' &&
      new RegExp(`^${value.userId}_[2-9][0-9]{3}(0[1-9]|1[0-2])$`).test(value.bucketId) &&
      value.deltaConsumed === 1 && value.deltaReserved === -1 && value.deltaAvailable === 0 && value.deltaExpired === 0);
    if (included(eventTime(value.createdAt))) creditsConsumed++;
  }, { operation: 'CONSUME' });
  checkTime();

  const auditId = dependencies.crypto.randomId();
  invariant(typeof auditId === 'string' && /^[a-f0-9-]{36}$/.test(auditId));
  await dependencies.store.transaction(async tx => {
    const user = await tx.get<UserRecord>('users', userId);
    if (!user || user.userId !== userId || user.status !== 'active') throw new ServiceError('ACCOUNT_DISABLED');
    if (!config.adminUserIds.includes(userId)) throw new ServiceError('FORBIDDEN');
    if ((await readStatsCoverageState(tx)).revision !== initial.revision) throw new ServiceError('STATS_CHANGED');
    const now = dependencies.clock.now();
    shanghaiDate(now);
    await tx.create('admin_audit_logs', auditId, { userId, action: 'STATS_READ', date, createdAt: now });
  });
  return { date, timeZone: 'Asia/Shanghai', period, generatedAt, coverage: initial.coverage, scan,
    metrics: { newUsers: available('users') ? newUsers : null, dau: available('activity') ? dau : null,
      succeeded: available('jobs') ? succeeded : null, failed: available('jobs') ? failed : null,
      failureRate: available('jobs') && succeeded + failed > 0 ? failed / (succeeded + failed) : null,
      creditsConsumed: available('credits') ? creditsConsumed : null },
    templates: templates.map(templateId => ({ templateId, succeeded: available('jobs') ? templateCounts.get(templateId)! : null })) };
}
