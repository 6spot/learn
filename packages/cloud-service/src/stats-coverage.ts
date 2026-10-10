import type { MetadataTransaction } from '@learn/cloud-runtime';
import { ServiceError, type AdminStatsResponse, type StatsGapReason, type StatsSource } from './contracts.js';
import { isStatsDate, shanghaiDate } from './stats-date.js';

export const statsSources: readonly StatsSource[] = ['users', 'activity', 'jobs', 'credits'];
type CoverageState = { revision: number; floors: Partial<Record<StatsSource, string>> };
type CoverageGap = { source: StatsSource; date: string; reason: StatsGapReason; markedAt: number };
const gapId = (source: StatsSource, date: string) => `${source}_${date.replace(/-/g, '')}`;

export async function readStatsCoverageState(tx: MetadataTransaction): Promise<CoverageState> {
  const state = await tx.get<CoverageState>('stats_coverage', 'state');
  if (!state) return { revision: 0, floors: {} };
  if (!Number.isSafeInteger(state.revision) || state.revision < 1 || !state.floors ||
      typeof state.floors !== 'object' || Array.isArray(state.floors) ||
      Object.entries(state.floors).some(([key, value]) => !statsSources.includes(key as StatsSource) || !isStatsDate(value))) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
  return state;
}

async function readGap(tx: MetadataTransaction, source: StatsSource, date: string): Promise<CoverageGap | null> {
  const gap = await tx.get<CoverageGap>('stats_coverage_gaps', gapId(source, date));
  if (gap) {
    if (gap.source !== source || gap.date !== date || !['account-deletion', 'retention'].includes(gap.reason)) {
      throw new ServiceError('INVARIANT_VIOLATION');
    }
    shanghaiDate(gap.markedAt);
  }
  return gap;
}

async function saveState(tx: MetadataTransaction, state: CoverageState): Promise<void> {
  if (!Number.isSafeInteger(state.revision + 1)) throw new ServiceError('INVARIANT_VIOLATION');
  await tx.set('stats_coverage', 'state', { revision: state.revision + 1, floors: state.floors });
}

/** Internal only: call in the SAME transaction that deletes source data. No user identifiers. */
export async function markStatsCoverageGapInTransaction(tx: MetadataTransaction, source: StatsSource, date: string,
  reason: StatsGapReason, now: number): Promise<void> {
  if (!statsSources.includes(source) || !isStatsDate(date) || !['account-deletion', 'retention'].includes(reason)) {
    throw new ServiceError('INVALID_ARGUMENT');
  }
  shanghaiDate(now);
  const state = await readStatsCoverageState(tx);
  if (state.floors[source] && date < state.floors[source]!) return;
  if (await readGap(tx, source, date)) return;
  await tx.create('stats_coverage_gaps', gapId(source, date), { source, date, reason, markedAt: now });
  await saveState(tx, state);
}

/** Advance before retention deletes dates strictly older than this floor. Never goes backward. */
export async function advanceStatsCoverageFloorInTransaction(tx: MetadataTransaction, source: StatsSource,
  date: string): Promise<void> {
  if (!statsSources.includes(source) || !isStatsDate(date)) throw new ServiceError('INVALID_ARGUMENT');
  const state = await readStatsCoverageState(tx);
  if (state.floors[source] && state.floors[source]! >= date) return;
  state.floors[source] = date;
  await saveState(tx, state);
}

export async function readStatsCoverage(tx: MetadataTransaction, date: string, configuredStart: string): Promise<{
  revision: number; coverage: AdminStatsResponse['coverage'];
}> {
  const state = await readStatsCoverageState(tx);
  const sourceStarts = {} as Record<StatsSource, string>;
  const gaps: { source: StatsSource; reason: StatsGapReason | 'before-coverage-start' }[] = [];
  for (const source of statsSources) {
    sourceStarts[source] = state.floors[source] && state.floors[source]! > configuredStart ? state.floors[source]! : configuredStart;
    if (date < sourceStarts[source]) gaps.push({ source, reason: 'before-coverage-start' });
    else {
      const gap = await readGap(tx, source, date);
      if (gap) gaps.push({ source, reason: gap.reason });
    }
  }
  return { revision: state.revision, coverage: { complete: gaps.length === 0, sourceStarts, gaps } };
}
