import type { Clock, ExecutionBridge, MetadataStore, PrivateStorage, TrustedIdentityProvider } from '@learn/cloud-runtime';
import type { LayoutVersionTuple, PaperInput, PaperLayout, TrustedPaperPreset, ValidatedPaperInput } from '@learn/paper-core';

/** These operations are supplied by trusted server composition, never a request. */
export interface CryptoPort {
  hmacSha256(keyId: string, value: string): Promise<string>;
  randomId(): string;
  sha256(value: string | Uint8Array): Promise<string>;
}

export type FontResourceDescriptor = Readonly<{
  id: string; bytes: number; sha256: string; fontVersion: string; location: string;
}>;
export type FontBundleDescriptor = Readonly<{
  fontBundleVersion: string; fonts: readonly FontResourceDescriptor[];
}>;
export interface ResourceProvider {
  describeBundle(version: string): Promise<FontBundleDescriptor | null>;
  readFontBytes(fontId: string, bundleVersion: string): Promise<Uint8Array>;
}
export type RegistryConfig = Readonly<{
  cloudEngineVersions: readonly string[];
  clientReadyEngineVersions: readonly string[];
}>;

export type ReleaseAcceptance = Readonly<{
  fontLicense: boolean; print: boolean; resources: boolean; evidenceId: string;
}>;
export type PublishedPreset = Readonly<{
  registryId: string; preset: TrustedPaperPreset; resources: FontBundleDescriptor;
}>;
export type PresetAvailability = Readonly<{
  versions: LayoutVersionTuple;
  status: 'ready' | 'update-required' | 'retired' | 'resource-unavailable' | 'not-found';
  published?: PublishedPreset;
}>;
export type CompatibilityRequest = Readonly<{ engineVersion: string; lockedVersions?: readonly LayoutVersionTuple[] }>;
export type CompatibilityResponse = Readonly<{
  engineSupported: boolean; current: readonly PresetAvailability[];
  locked: readonly PresetAvailability[]; serverTime: number;
}>;

export type GenerationConfig = Readonly<{
  windowKeyId: string; retainedWindowKeyIds: readonly string[];
  fingerprintKeyId: string; retainedFingerprintKeyIds: readonly string[];
  fingerprintVersion: 'learn-request-v1';
  windowTtlMs: number; requestRetentionMs: number; recordRetentionMs: number; pdfRetentionMs: number;
  jobTimeoutMs: number; maxInputCodeUnits: number; maxGraphemes: number;
  maxPages: number; maxPdfBytes: number; maxConcurrentJobs: number;
  rateWindowMs: number; maxStartsPerWindow: number;
}>;
export type SubmissionWindow = Readonly<{ windowId: string; expiresAt: number }>;
export type GenerationRequest = Readonly<{
  requestId: string; input: PaperInput; versions: LayoutVersionTuple; layoutDigest: string;
}>;
export type JobStatus = 'RESERVED' | 'GENERATING' | 'SUCCEEDED' | 'FAILED';
export type GenerationFailureCode = 'PREPARATION_FAILED' | 'LAYOUT_MISMATCH' | 'PAGE_LIMIT_EXCEEDED' |
  'EXECUTION_FAILED' | 'EXECUTION_TIMEOUT' | 'PDF_INVALID' | 'PDF_RESOURCE_LIMIT' | 'RESOURCE_UNAVAILABLE';
export type JobSummary = Readonly<{
  jobId: string; requestId: string; templateId: LayoutVersionTuple['templateId']; status: JobStatus;
  createdAt: number; startedAt: number | null; finishedAt: number | null;
  pageCount: number | null; errorCode: GenerationFailureCode | null; fileExpiresAt: number | null;
}>;
export type SubmitGenerationResponse = Readonly<{ job: JobSummary; submission: 'pending' | 'settled' }>;
export const PDF_CHUNK_BYTES = 256 * 1024;
export type FileAccessConfig = Readonly<{ maxFileBytes: number; maxCacheBytes: number; cacheTtlMs: number; maxListScanRecords: number }>;
export type JobDetail = JobSummary & Readonly<{ delivery: 'not-ready' | 'ready' | 'expired' | 'unavailable' }>;
export type ListJobsRequest = Readonly<{ cursor?: string; limit?: number }>;
export type ListJobsResponse = Readonly<{ items: readonly JobDetail[]; nextCursor: string | null; serverTime: number }>;
export type PdfInfo = Readonly<{ jobId: string; bytes: number; sha256: string; pageCount: number; expiresAt: number; chunkBytes: number }>;
export type PdfChunkRequest = Readonly<{ jobId: string; offset: number }>;
export type PdfChunk = Readonly<{ jobId: string; offset: number; nextOffset: number | null; totalBytes: number;
  sha256: string; expiresAt: number; bytes: Uint8Array }>;
export interface GenerationPreparer {
  prepare(input: ValidatedPaperInput, preset: TrustedPaperPreset): Promise<{ layout: PaperLayout; digest: string }>;
}
export type GenerationExecution = Readonly<{
  jobId: string; batchId: string; userId: string; published: PublishedPreset; layout: PaperLayout;
}>;
export interface GenerationExecutor {
  /** Must await all work and commit a terminal job state; never retain/replay the input. */
  execute(execution: GenerationExecution): Promise<void>;
}

/** Trusted composition adapts T09 renderPdf to this port; callers cannot supply a renderer. */
export interface GenerationPdfRenderer {
  render(execution: GenerationExecution, options: { maxOutputBytes: number }): Promise<Uint8Array>;
}
export type GenerationExecutorDependencies = Readonly<{
  store: MetadataStore; clock: Clock; crypto: CryptoPort; storage: PrivateStorage;
  bridge: ExecutionBridge; renderer: GenerationPdfRenderer;
}>;

/** Maintenance-only capabilities; intentionally exclude any renderer or user RPC authority. */
export type RecoveryDependencies = Readonly<{ store: MetadataStore; storage: PrivateStorage; clock: Clock; crypto: CryptoPort }>;
export type RecoveryConfig = Readonly<{
  pageSize: number; maxRecordsPerRun: number;
  /** Soft sweep budget checked before starting a record; an in-flight record is fully awaited. */
  maxRunMs: number;
  maxCandidateBytes: number; maxReadBytesPerRun: number;
}>;
export type RecoveryCursor = Readonly<{ phase: 'reserved' | 'generating' | 'candidates'; afterId: string | null }>;
export type RecoveryJobResult = Readonly<{
  jobId: string; status: JobStatus | null; outcome: 'missing' | 'terminal' | 'pending' | 'reconciled' | 'retryable';
  reason: 'AWAITING_EXECUTION' | 'STORAGE_UNAVAILABLE' | 'CANDIDATE_UNVERIFIED' | 'READ_LIMIT' | 'OPERATION_FAILED' | null;
}>;
export type RecoverySweepResult = Readonly<{
  visitedJobs: number; visitedCandidates: number; reconciledJobs: number; pendingJobs: number;
  cleanedCandidates: number; protectedCandidates: number; retryableRecords: number; recordErrors: number;
  expectedReadBytes: number; startedAt: number; finishedAt: number;
  cycleComplete: boolean; checkpointSaved: boolean; nextCursor: RecoveryCursor;
}>;
export interface RecoveryService {
  recoverJob(jobId: string): Promise<RecoveryJobResult>;
  runSweep(): Promise<RecoverySweepResult>;
}

export type ServiceConfig = Readonly<{
  stage: 'development' | 'production';
  monthlyFreeCredits: number;
  quotaTimeZone: 'Asia/Shanghai';
  /** Stable identity lookup key; rotating it requires an explicit identity migration. */
  identityKeyId: string;
  adminUserIds: readonly string[];
  registry?: RegistryConfig;
  generation?: GenerationConfig;
  fileAccess?: FileAccessConfig;
}>;

export type ServiceDependencies = Readonly<{
  store: MetadataStore;
  identity: TrustedIdentityProvider;
  clock: Clock;
  crypto: CryptoPort;
  resources?: ResourceProvider;
  preparer?: GenerationPreparer;
  executor?: GenerationExecutor;
  storage?: PrivateStorage;
}>;

export type AccountResponse = Readonly<{
  userId: string;
  isAdmin: boolean;
  /** Calendar month in the configured quota timezone. */
  period: string;
  available: number;
  /** Outstanding reservations across current and older month buckets. */
  reserved: number;
  monthlyGrant: number;
  /** Unix milliseconds, exclusive. */
  periodEndsAt: number;
}>;

export type ServiceErrorCode = 'UNAUTHENTICATED' | 'ACCOUNT_DISABLED' | 'FORBIDDEN' |
  'INVALID_CONFIG' | 'INVALID_ARGUMENT' | 'QUOTA_EXHAUSTED' | 'RESERVATION_CONFLICT' |
  'INVARIANT_VIOLATION' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'REGISTRY_UNAVAILABLE' |
  'INVALID_PRESET' | 'VERSION_EXISTS' | 'UPDATE_REQUIRED' | 'RESOURCE_UNAVAILABLE' |
  'RELEASE_NOT_ACCEPTED' | 'CLIENT_NOT_READY' | 'VERSION_RETIRED' | 'VERSION_IN_USE' |
  'INVALID_INPUT' | 'INPUT_LIMIT_EXCEEDED' | 'REQUEST_INVALID' | 'REQUEST_EXPIRED' | 'RECORD_EXPIRED' |
  'IDEMPOTENCY_CONFLICT' | 'KEY_UNAVAILABLE' | 'FINGERPRINT_UNSUPPORTED' | 'RATE_LIMITED' |
  'CONCURRENCY_LIMITED' | 'EXECUTION_UNAVAILABLE' | 'EXECUTION_OUTCOME_UNKNOWN' |
  'FILE_ACCESS_UNAVAILABLE' | 'FILE_NOT_READY' | 'FILE_EXPIRED' | 'FILE_UNAVAILABLE' | 'FILE_LIMIT_EXCEEDED';

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode) {
    super(code);
    this.name = 'ServiceError';
  }
}
