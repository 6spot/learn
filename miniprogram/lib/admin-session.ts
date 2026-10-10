import type { AdminStatsResponse, StatsSource } from '../../packages/cloud-service/dist/index.js';
import type { CloudClient } from './cloud-client.js';
import { PAPER_TEMPLATES } from './templates.js';

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'denied';
type Metric = Readonly<{ id: string; label: string; value: string; note: string }>;
type Summary = Readonly<{ date: string; generatedAt: string; complete: boolean; metrics: readonly Metric[];
  templates: readonly Readonly<{ id: string; label: string; value: string }>[];
  coverage: readonly Readonly<{ id: string; label: string; starts: string; note: string }>[] }>;
export type AdminView = Readonly<{ status: Status; message: string; selectedDate: string; today: string;
  historical: boolean; summary: Summary | null }>;
const SOURCES: readonly StatsSource[] = ['users', 'activity', 'jobs', 'credits'];
const SOURCE_LABELS = { users: '新增用户', activity: '有效活跃', jobs: '生成任务', credits: '额度消耗' } as const;
const GAP_LABELS = { 'before-coverage-start': '所选日期早于覆盖起点', 'account-deletion': '账户删除造成数据缺口',
  retention: '保留期清理造成数据缺口' } as const;
const DAY = 86400000;

function invalid(): never { throw { code: 'INVALID_RESPONSE' }; }
function dateStart(value: unknown): number {
  if (typeof value !== 'string' || !/^[2-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return NaN;
  const at = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at - 8 * 3600000 : NaN;
}
/** Fixed UTC offset, independent of host locale and Intl timezone support. */
function shanghaiTime(at: number): string {
  if (!Number.isSafeInteger(at)) return invalid();
  const time = new Date(at + 8 * 3600000);
  if (!Number.isFinite(time.getTime())) return invalid();
  return time.toISOString().slice(0, 19).replace('T', ' ');
}
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function numberLabel(value: number | null): string { return value === null ? '不可用' : String(value); }

/** Whitelist display fields instead of copying the service response into page data. */
function project(response: AdminStatsResponse, requestedDate: string | undefined): { summary: Summary; today: string } {
  if (!response || typeof response !== 'object' || response.timeZone !== 'Asia/Shanghai') return invalid();
  const startsAt = dateStart(response.date), generatedAt = shanghaiTime(response.generatedAt), today = generatedAt.slice(0, 10);
  if (!Number.isFinite(startsAt) || response.date > today || (requestedDate && response.date !== requestedDate) ||
      (!requestedDate && response.date !== today) || response.period?.startsAt !== startsAt || response.period.endsAt !== startsAt + DAY) return invalid();
  const coverage = response.coverage;
  if (!coverage || typeof coverage.complete !== 'boolean' || !coverage.sourceStarts || !Array.isArray(coverage.gaps) || coverage.gaps.length > 4) return invalid();
  const gaps = new Map<StatsSource, keyof typeof GAP_LABELS>();
  for (const gap of coverage.gaps) {
    if (!gap || !SOURCES.includes(gap.source) || !Object.prototype.hasOwnProperty.call(GAP_LABELS, gap.reason) || gaps.has(gap.source)) return invalid();
    gaps.set(gap.source, gap.reason);
  }
  if (coverage.complete !== (gaps.size === 0)) return invalid();
  for (const source of SOURCES) {
    if (!Number.isFinite(dateStart(coverage.sourceStarts[source])) ||
        (response.date < coverage.sourceStarts[source]) !== (gaps.get(source) === 'before-coverage-start')) return invalid();
  }
  const metrics = response.metrics;
  if (!metrics || typeof metrics !== 'object') return invalid();
  for (const [key, source] of [['newUsers', 'users'], ['dau', 'activity'], ['succeeded', 'jobs'], ['failed', 'jobs'], ['creditsConsumed', 'credits']] as const) {
    if (gaps.has(source) ? metrics[key] !== null : !count(metrics[key])) return invalid();
  }
  const terminal = (metrics.succeeded ?? 0) + (metrics.failed ?? 0);
  if (!Number.isSafeInteger(terminal)) return invalid();
  if (gaps.has('jobs') || terminal === 0) { if (metrics.failureRate !== null) return invalid(); }
  else if (typeof metrics.failureRate !== 'number' || !Number.isFinite(metrics.failureRate) ||
      metrics.failureRate < 0 || metrics.failureRate > 1 ||
      Math.abs(metrics.failureRate - metrics.failed! / terminal) > Number.EPSILON) return invalid();
  if (!Array.isArray(response.templates) || response.templates.length !== PAPER_TEMPLATES.length) return invalid();
  const templateCounts = new Map<string, number | null>();
  for (const row of response.templates) {
    if (!row || !PAPER_TEMPLATES.some(template => template.id === row.templateId) || templateCounts.has(row.templateId) ||
        (gaps.has('jobs') ? row.succeeded !== null : !count(row.succeeded))) return invalid();
    templateCounts.set(row.templateId, row.succeeded);
  }
  if (!gaps.has('jobs') && [...templateCounts.values()].reduce<number>((sum, value) => sum + value!, 0) !== metrics.succeeded) return invalid();
  return { today, summary: { date: response.date, generatedAt, complete: coverage.complete,
    metrics: [
      { id: 'newUsers', label: '新增用户', value: numberLabel(metrics.newUsers), note: '当日首次建号' },
      { id: 'dau', label: '有效活跃用户', value: numberLabel(metrics.dau), note: '新生成受理或有效 PDF 领取' },
      { id: 'succeeded', label: '成功生成', value: numberLabel(metrics.succeeded), note: '按任务完成时间' },
      { id: 'failed', label: '失败生成', value: numberLabel(metrics.failed), note: '已结束的失败任务' },
      { id: 'failureRate', label: '失败率', value: gaps.has('jobs') ? '不可用' : metrics.failureRate === null ? '暂无' : `${(metrics.failureRate * 100).toFixed(1)}%`,
        note: gaps.has('jobs') ? '任务数据不完整' : terminal === 0 ? '暂无已结束任务' : '失败任务 / 全部已结束任务' },
      { id: 'creditsConsumed', label: '额度消耗', value: numberLabel(metrics.creditsConsumed), note: '成功生成的消费流水' },
    ],
    templates: PAPER_TEMPLATES.map(template => ({ id: template.id, label: template.name, value: numberLabel(templateCounts.get(template.id)!) })),
    coverage: SOURCES.map(source => ({ id: source, label: SOURCE_LABELS[source], starts: coverage.sourceStarts[source],
      note: gaps.has(source) ? GAP_LABELS[gaps.get(source)!] : '所选日期数据完整' })),
  } };
}
function errorState(error: unknown): { status: 'error' | 'denied'; message: string } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') return { status: 'denied', message: '仅管理员可查看运营数据' };
  if (code === 'ACCOUNT_DISABLED' || code === 'ACCOUNT_DELETING') return { status: 'denied', message: '当前账户无法查看运营数据' };
  const messages: Record<string, string> = {
    NETWORK_UNAVAILABLE: '网络暂不可用，请重试', SERVICE_UNAVAILABLE: '统计服务暂不可用，请稍后重试',
    STATS_UNAVAILABLE: '统计服务暂不可用，请稍后重试', STATS_LIMIT_EXCEEDED: '本次统计未能完成，请稍后重试',
    STATS_CHANGED: '数据覆盖范围已变化，请刷新重试', INVALID_ARGUMENT: '查询日期无效，请重新选择',
    INVALID_RESPONSE: '统计结果未能校验，请重试',
  };
  return { status: 'error', message: typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code]! : '统计查询失败，请稍后重试' };
}

/** Page-scoped async state; auth and statistics always belong to the cloud service. */
export class AdminSession {
  view: AdminView = { status: 'idle', message: '', selectedDate: '', today: '', historical: false, summary: null };
  private revision = 0;
  private requestedDate: string | undefined;
  private pending: Promise<void> | null = null;
  constructor(private readonly client: Pick<CloudClient, 'getAdminStats'>, private readonly changed: (view: AdminView) => void) {}
  private publish(value: Partial<AdminView>): void { this.view = { ...this.view, ...value }; this.changed(this.view); }
  load(date: string | undefined = this.requestedDate): Promise<void> { return this.query(date); }
  today(): Promise<void> { return this.query(undefined); }
  private query(date: string | undefined): Promise<void> {
    if (date !== undefined && (!Number.isFinite(dateStart(date)) || (this.view.today && date > this.view.today))) return Promise.resolve();
    if (this.pending && date === this.requestedDate) return this.pending;
    this.requestedDate = date;
    const revision = ++this.revision;
    this.publish({ status: 'loading', message: '', selectedDate: date ?? '', historical: date !== undefined });
    const pending = Promise.resolve().then(() => this.client.getAdminStats(date ? { date } : {})).then(response => {
      if (revision !== this.revision) return;
      const { summary, today } = project(response, date);
      this.publish({ status: 'ready', message: '', selectedDate: summary.date, today, summary });
    }).catch(error => {
      if (revision !== this.revision) return;
      const failure = errorState(error);
      this.publish({ ...failure, ...(failure.status === 'denied' ? { summary: null } : {}) });
    }).finally(() => { if (revision === this.revision) this.pending = null; });
    this.pending = pending;
    return pending;
  }
  clear(): void {
    this.revision++; this.pending = null;
    this.view = { ...this.view, status: 'idle', message: '', summary: null };
  }
}
