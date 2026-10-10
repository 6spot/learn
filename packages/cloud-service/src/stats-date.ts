import { ServiceError } from './contracts.js';

const offset = 8 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

export function isStatsDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[2-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(parsed) && new Date(parsed + offset).toISOString().slice(0, 10) === value;
}

/** Fixed China standard time, independent of provider locale or Intl support. */
export function shanghaiDate(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > Date.parse('9999-12-31T15:59:59.999Z')) {
    throw new ServiceError('INVARIANT_VIOLATION');
  }
  const date = new Date(now + offset).toISOString().slice(0, 10);
  if (!isStatsDate(date)) throw new ServiceError('INVARIANT_VIOLATION');
  return date;
}

export function statsPeriod(date: string): { startsAt: number; endsAt: number } {
  if (!isStatsDate(date)) throw new ServiceError('INVALID_ARGUMENT');
  const startsAt = Date.parse(`${date}T00:00:00+08:00`);
  return { startsAt, endsAt: startsAt + dayMs };
}
