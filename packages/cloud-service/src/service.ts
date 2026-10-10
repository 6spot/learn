import { RuntimeError } from '@learn/cloud-runtime';
import type { LayoutVersionTuple } from '@learn/paper-core';
import { ServiceError, type AccountResponse, type ServiceConfig, type ServiceDependencies,
  type CompatibilityRequest, type CompatibilityResponse, type PublishedPreset, type ReleaseAcceptance,
  type JobSummary, type SubmissionWindow, type SubmitGenerationResponse, type JobDetail,
  type ListJobsResponse, type PdfInfo, type PdfChunk } from './contracts.js';
import { validateConfig } from './config.js';
import { ensureAccountInTransaction } from './credits.js';
import { PresetRegistry } from './presets.js';
import { JobAdmission } from './admission.js';
import { snapshotGenerationRequest } from './requests.js';
import { RecordAccess, snapshotListJobs, snapshotPdfChunk, validateJobId } from './records.js';

export class CloudService {
  readonly config: ServiceConfig;
  private recordAccess: RecordAccess | undefined;

  constructor(private readonly dependencies: ServiceDependencies, config: ServiceConfig) {
    this.config = validateConfig(config);
  }

  /** Authenticates on every invocation. Caller input never participates in identity. */
  private async userId(): Promise<string> {
    const identity = this.dependencies.identity.current();
    if (typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 1024 ||
        typeof identity.appId !== 'string' || !identity.appId || identity.appId.length > 128) {
      throw new ServiceError('UNAUTHENTICATED');
    }
    const digest = await this.dependencies.crypto.hmacSha256(this.config.identityKeyId,
      JSON.stringify(['learn.identity.v1', identity.appId, identity.subject]));
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ServiceError('INTERNAL_ERROR');
    return `u_${digest}`;
  }

  async getAccount(): Promise<AccountResponse> {
    return this.safe(async () => {
      const userId = await this.userId();
      const account = await this.dependencies.store.transaction(tx => ensureAccountInTransaction(tx, userId,
        this.dependencies.clock.now(), this.config));
      return { userId, isAdmin: this.config.adminUserIds.includes(userId), period: account.period,
        available: account.available, reserved: account.reserved, monthlyGrant: account.monthlyGrant,
        periodEndsAt: account.periodEndsAt };
    });
  }

  private async adminId(): Promise<string> {
    const account = await this.getAccount();
    if (!account.isAdmin) throw new ServiceError('FORBIDDEN');
    return account.userId;
  }

  async getCompatibility(request: CompatibilityRequest): Promise<CompatibilityResponse> {
    return this.safe(async () => {
      await this.getAccount();
      return new PresetRegistry(this.dependencies, this.config).compatibility(request);
    });
  }

  async publishPreset(preset: unknown, acceptance?: ReleaseAcceptance): Promise<PublishedPreset> {
    return this.safe(async () => {
      const userId = await this.adminId();
      return new PresetRegistry(this.dependencies, this.config).publish(userId, preset, acceptance);
    });
  }

  async activatePreset(versions: LayoutVersionTuple): Promise<void> {
    return this.safe(async () => {
      const userId = await this.adminId();
      return new PresetRegistry(this.dependencies, this.config).activate(userId, versions);
    });
  }

  async retirePreset(versions: LayoutVersionTuple): Promise<void> {
    return this.safe(async () => {
      const userId = await this.adminId();
      return new PresetRegistry(this.dependencies, this.config).retire(userId, versions, false);
    });
  }

  async removePreset(versions: LayoutVersionTuple): Promise<void> {
    return this.safe(async () => {
      const userId = await this.adminId();
      return new PresetRegistry(this.dependencies, this.config).retire(userId, versions, true);
    });
  }

  async getSubmissionWindow(): Promise<SubmissionWindow> {
    return this.safe(async () => {
      const account = await this.getAccount();
      return new JobAdmission(this.dependencies, this.config).window(account.userId);
    });
  }

  async submitGeneration(request: unknown): Promise<SubmitGenerationResponse> {
    return this.safe(async () => {
      const snapshot = snapshotGenerationRequest(request);
      const account = await this.getAccount();
      return new JobAdmission(this.dependencies, this.config).submit(account.userId, snapshot);
    });
  }

  async findJobByRequest(requestId: string): Promise<JobSummary | null> {
    return this.safe(async () => {
      const account = await this.getAccount();
      return new JobAdmission(this.dependencies, this.config).find(account.userId, requestId);
    });
  }

  private records(): RecordAccess {
    if (!this.config.fileAccess) throw new ServiceError('FILE_ACCESS_UNAVAILABLE');
    return this.recordAccess ??= new RecordAccess(this.dependencies, this.config.fileAccess, this.config.identityKeyId);
  }

  async listJobs(request?: unknown): Promise<ListJobsResponse> {
    return this.safe(async () => {
      const input = snapshotListJobs(request);
      const account = await this.getAccount();
      return this.records().list(account.userId, input);
    });
  }

  async getJob(jobId: string): Promise<JobDetail> {
    return this.safe(async () => {
      validateJobId(jobId);
      const account = await this.getAccount();
      return this.records().get(account.userId, jobId);
    });
  }

  async getPdfInfo(jobId: string): Promise<PdfInfo> {
    return this.safe(async () => {
      validateJobId(jobId);
      const account = await this.getAccount();
      return this.records().info(account.userId, jobId);
    });
  }

  async readPdfChunk(request: unknown): Promise<PdfChunk> {
    return this.safe(async () => {
      const input = snapshotPdfChunk(request);
      const account = await this.getAccount();
      return this.records().chunk(account.userId, input);
    });
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof RuntimeError && error.code === 'UNAUTHENTICATED') throw new ServiceError('UNAUTHENTICATED');
      throw new ServiceError('INTERNAL_ERROR');
    }
  }
}
