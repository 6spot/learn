import type { AccountResponse, CompatibilityRequest, CompatibilityResponse, GenerationRequest,
  JobSummary, JobDetail, ListJobsRequest, ListJobsResponse, PdfInfo, PdfChunk, PdfChunkRequest,
  PublishedPreset, ReleaseAcceptance, SubmissionWindow, SubmitGenerationResponse } from '../../packages/cloud-service/dist/index.js';
import type { LayoutVersionTuple, TrustedPaperPreset } from '../../packages/paper-core/src/index.js';

export class CloudClientError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CloudClientError'; }
}
export type RpcTransport = (method: string, params: object) => Promise<unknown>;
export type CloudClientConfig = Readonly<{ environmentId: string; functionName: string }>;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Bounded canonical base64 without Node, atob or a host codec. */
function decodeChunk(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > 349528 || value.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new CloudClientError('INVALID_RESPONSE');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (padding && (BASE64.indexOf(value[value.length - padding - 1]!) & (padding === 2 ? 15 : 3))) throw new CloudClientError('INVALID_RESPONSE');
  const result = new Uint8Array(value.length / 4 * 3 - padding);
  if (result.length > 262144) throw new CloudClientError('INVALID_RESPONSE');
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const word = BASE64.indexOf(value[index]!) << 18 | BASE64.indexOf(value[index + 1]!) << 12 |
      Math.max(0, BASE64.indexOf(value[index + 2]!)) << 6 | Math.max(0, BASE64.indexOf(value[index + 3]!));
    for (const shift of [16, 8, 0]) if (offset < result.length) result[offset++] = word >>> shift & 255;
  }
  return result;
}
export interface CloudPlatform {
  cloud?: {
    init(options: { env: string; traceUser: false }): void;
    callFunction(options: { name: string; data: { method: string; params: object };
      success(result: { result: unknown }): void; fail(): void }): void;
  };
}

/** One transport belongs to App. Diagnostic harnesses inject it in memory;
 * deployed code contains no simulator identity, credentials or local service. */
export class CloudClient {
  constructor(public transport: RpcTransport) {}
  private async call<T>(method: string, params: object): Promise<T> {
    let value: unknown;
    try { value = await this.transport(method, params); }
    catch (error) { throw error instanceof CloudClientError ? error : new CloudClientError('NETWORK_UNAVAILABLE'); }
    if (!value || typeof value !== 'object' || !('ok' in value)) throw new CloudClientError('INVALID_RESPONSE');
    if (value.ok === true && 'data' in value) return value.data as T;
    if (value.ok === false && 'error' in value && value.error && typeof value.error === 'object' &&
        'code' in value.error && typeof value.error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.error.code)) {
      throw new CloudClientError(value.error.code);
    }
    throw new CloudClientError('INVALID_RESPONSE');
  }
  getAccount(): Promise<AccountResponse> { return this.call('getAccount', {}); }
  getCompatibility(params: CompatibilityRequest): Promise<CompatibilityResponse> { return this.call('getCompatibility', params); }
  getSubmissionWindow(): Promise<SubmissionWindow> { return this.call('getSubmissionWindow', {}); }
  submitGeneration(params: GenerationRequest): Promise<SubmitGenerationResponse> { return this.call('submitGeneration', params); }
  findJobByRequest(requestId: string): Promise<JobSummary | null> { return this.call('findJobByRequest', { requestId }); }
  listJobs(params: ListJobsRequest = {}): Promise<ListJobsResponse> { return this.call('listJobs', params); }
  getJob(jobId: string): Promise<JobDetail> { return this.call('getJob', { jobId }); }
  getPdfInfo(jobId: string): Promise<PdfInfo> { return this.call('getPdfInfo', { jobId }); }
  async readPdfChunk(params: PdfChunkRequest): Promise<PdfChunk> {
    const value = await this.call<Omit<PdfChunk, 'bytes'> & { bytes: unknown }>('readPdfChunk', params);
    if (!value || typeof value !== 'object') throw new CloudClientError('INVALID_RESPONSE');
    return { ...value, bytes: decodeChunk(value.bytes) };
  }
  publishPreset(preset: TrustedPaperPreset, acceptance?: ReleaseAcceptance): Promise<PublishedPreset> {
    return this.call('publishPreset', { preset, ...(acceptance ? { acceptance } : {}) });
  }
  activatePreset(versions: LayoutVersionTuple): Promise<void> { return this.call('activatePreset', { versions }); }
  retirePreset(versions: LayoutVersionTuple): Promise<void> { return this.call('retirePreset', { versions }); }
  removePreset(versions: LayoutVersionTuple): Promise<void> { return this.call('removePreset', { versions }); }
}

/** Missing deployment configuration is a recoverable unavailable state. */
export function createCloudClient(platform: CloudPlatform, config: CloudClientConfig | null): CloudClient {
  const unavailable: RpcTransport = async () => { throw new CloudClientError('SERVICE_UNAVAILABLE'); };
  if (!config || !platform.cloud || !/^[A-Za-z0-9_-]{1,128}$/.test(config.environmentId) ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(config.functionName)) return new CloudClient(unavailable);
  const cloud = platform.cloud;
  try { cloud.init({ env: config.environmentId, traceUser: false }); }
  catch { return new CloudClient(unavailable); }
  return new CloudClient((method, params) => new Promise((resolve, reject) => {
    try { cloud.callFunction({ name: config.functionName, data: { method, params },
      success: response => resolve(response.result), fail: () => reject(new CloudClientError('NETWORK_UNAVAILABLE')) }); }
    catch { reject(new CloudClientError('NETWORK_UNAVAILABLE')); }
  }));
}
