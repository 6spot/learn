import type { Clock, MetadataStore, TrustedIdentityProvider } from '@learn/cloud-runtime';
import type { LayoutVersionTuple, TrustedPaperPreset } from '@learn/paper-core';

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

export type ServiceConfig = Readonly<{
  stage: 'development' | 'production';
  monthlyFreeCredits: number;
  quotaTimeZone: 'Asia/Shanghai';
  /** Stable identity lookup key; rotating it requires an explicit identity migration. */
  identityKeyId: string;
  adminUserIds: readonly string[];
  registry?: RegistryConfig;
}>;

export type ServiceDependencies = Readonly<{
  store: MetadataStore;
  identity: TrustedIdentityProvider;
  clock: Clock;
  crypto: CryptoPort;
  resources?: ResourceProvider;
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
  'RELEASE_NOT_ACCEPTED' | 'CLIENT_NOT_READY' | 'VERSION_RETIRED' | 'VERSION_IN_USE';

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode) {
    super(code);
    this.name = 'ServiceError';
  }
}
