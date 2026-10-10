import type { AccountResponse, JobDetail, JobStatus } from '../../packages/cloud-service/dist/index.js';
import { CloudClientError } from './cloud-client.js';
import { templateId, templateName } from './templates.js';

export type RecordItem = Readonly<{ jobId: string; templateId: JobDetail['templateId']; template: string; status: JobStatus;
  delivery: JobDetail['delivery']; pending: boolean; state: 'waiting' | 'generating' | 'ready' | 'failed' | 'expired' | 'unavailable';
  heading: string; description: string; createdAt: number; created: string; finished: string; pages: string; expires: string }>;
export type RecordAccount = Readonly<{ available: number; reserved: number; monthlyGrant: number; period: string; periodEnds: string; isAdmin: boolean }>;
export const invalidRecord = (): never => { throw new CloudClientError('INVALID_RESPONSE'); };
export function validJobId(value: unknown): value is string { return typeof value === 'string' && /^j_[a-f0-9-]{36}$/.test(value); }
export function recordTime(at: number): string {
  if (!Number.isSafeInteger(at)) return invalidRecord();
  const date = new Date(at + 8 * 3600000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9999) return invalidRecord();
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
const FAILURES = { PREPARATION_FAILED: '文字排版未能完成', LAYOUT_MISMATCH: '排版版本不一致，请重新预览后提交',
  PAGE_LIMIT_EXCEEDED: '内容超过页数限制，请减少内容后重试', EXECUTION_FAILED: '生成未能完成，请重新提供内容后重试',
  EXECUTION_TIMEOUT: '生成未能在规定时间内完成', PDF_INVALID: 'PDF 未能通过完整性校验',
  PDF_RESOURCE_LIMIT: '文件超过生成限制，请减少内容后重试', RESOURCE_UNAVAILABLE: '字体或排版资源暂不可用' } as const;
export function projectRecord(value: JobDetail): RecordItem {
  if (!value || typeof value !== 'object' || !validJobId(value.jobId) || !templateId(value.templateId) ||
      !['RESERVED', 'GENERATING', 'SUCCEEDED', 'FAILED'].includes(value.status) ||
      !['not-ready', 'ready', 'expired', 'unavailable'].includes(value.delivery)) return invalidRecord();
  const created = recordTime(value.createdAt), pending = value.status === 'RESERVED' || value.status === 'GENERATING';
  if (value.startedAt !== null && (recordTime(value.startedAt), value.startedAt < value.createdAt)) return invalidRecord();
  if (pending ? value.finishedAt !== null : value.finishedAt === null || (recordTime(value.finishedAt), value.finishedAt < value.createdAt)) return invalidRecord();
  if (value.pageCount !== null && (!Number.isSafeInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 50)) return invalidRecord();
  if (value.status === 'SUCCEEDED' && (value.pageCount === null || value.delivery === 'not-ready') || value.status !== 'SUCCEEDED' && value.delivery !== 'not-ready') return invalidRecord();
  if (value.status === 'FAILED' ? !value.errorCode || !Object.prototype.hasOwnProperty.call(FAILURES, value.errorCode) : value.errorCode !== null) return invalidRecord();
  if (value.status !== 'SUCCEEDED' && value.fileExpiresAt !== null || value.status === 'SUCCEEDED' && ['ready', 'expired'].includes(value.delivery) && value.fileExpiresAt === null) return invalidRecord();
  const state = value.status === 'RESERVED' ? 'waiting' : value.status === 'GENERATING' ? 'generating' : value.status === 'FAILED' ? 'failed'
    : value.delivery === 'ready' ? 'ready' : value.delivery === 'expired' ? 'expired' : 'unavailable';
  const headings = { waiting: '等待处理', generating: '生成中', ready: 'PDF 已生成', failed: '生成失败', expired: '文件已过期', unavailable: '文件暂不可领取' };
  const description = pending ? '可以离开，稍后在生成记录查看。离页不会取消已受理任务。' : state === 'failed'
    ? `${FAILURES[value.errorCode!]}。本次未消费次数，预留次数已释放。`
    : state === 'ready' ? '有效期内重复领取同一份 PDF 不再扣次。'
    : state === 'expired' ? '原任务已经成功，文件到期后不能继续领取；不会自动重新生成或扣次。'
    : '原任务已经成功，当前文件无法领取，请稍后刷新查询。';
  return { jobId: value.jobId, templateId: value.templateId, template: templateName(value.templateId), status: value.status,
    delivery: value.delivery, pending, state, heading: headings[state], description, createdAt: value.createdAt, created,
    finished: value.finishedAt === null ? '' : recordTime(value.finishedAt), pages: value.pageCount === null ? '待确定' : `${value.pageCount} 页`,
    expires: value.fileExpiresAt === null ? '' : recordTime(value.fileExpiresAt) };
}
export function projectAccount(value: AccountResponse): RecordAccount {
  if (!value || typeof value !== 'object' || typeof value.isAdmin !== 'boolean' ||
      typeof value.period !== 'string' || !/^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(value.period) ||
      [value.available, value.reserved, value.monthlyGrant].some(number => !Number.isSafeInteger(number) || number < 0)) return invalidRecord();
  return { available: value.available, reserved: value.reserved, monthlyGrant: value.monthlyGrant,
    period: value.period, periodEnds: recordTime(value.periodEndsAt), isAdmin: value.isAdmin };
}
export function recordErrorCode(error: unknown): unknown { return error && typeof error === 'object' && 'code' in error ? error.code : ''; }
export function revokedRecordAccess(error: unknown): boolean { return ['ACCOUNT_DELETING', 'ACCOUNT_DISABLED', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(String(recordErrorCode(error))); }
export function recordError(error: unknown): string {
  const code = recordErrorCode(error);
  const messages: Record<string, string> = {
    NETWORK_UNAVAILABLE: '网络暂不可用，请重试查询', SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试',
    FILE_ACCESS_UNAVAILABLE: '记录与文件服务暂不可用，请稍后重试', ACCOUNT_DELETING: '账户正在删除，记录与文件访问已关闭',
    ACCOUNT_DISABLED: '当前账户已停用', UNAUTHENTICATED: '暂时无法确认当前账户', FORBIDDEN: '无权查看此记录',
    NOT_FOUND: '记录不存在或当前账户无权查看', RECORD_EXPIRED: '记录已过保留期限，无法继续查看', INVALID_ARGUMENT: '记录信息无效，请从生成记录重新进入',
    FILE_EXPIRED: '文件已过期，请刷新查看最新状态', FILE_UNAVAILABLE: '文件暂不可领取，请刷新后重试',
    FILE_NOT_READY: '文件尚未就绪，请刷新查看任务状态', FILE_INVALID: '文件校验未通过，请重新领取',
    FILE_WRITE_FAILED: '本机文件保存失败，请检查可用空间后重试', FILE_OPEN_FAILED: '微信未能打开 PDF，请重试',
    DOWNLOAD_IN_PROGRESS: '另一份 PDF 正在领取，请稍后再试', DOWNLOAD_CANCELLED: '本次文件领取已取消',
  };
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code) ? messages[code]! : '查询或文件操作未能完成，请重试';
}
