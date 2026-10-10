import type { JsonObject, MetadataReader, MetadataTransaction } from '@learn/cloud-runtime';
import { DEFAULT_PRESETS, validateLayoutVersions, validateTrustedPreset, type LayoutVersionTuple, type TrustedPaperPreset } from '@learn/paper-core';
import { ServiceError, type CompatibilityRequest, type CompatibilityResponse, type FontBundleDescriptor,
  type PresetAvailability, type PublishedPreset, type ReleaseAcceptance, type ServiceConfig, type ServiceDependencies } from './contracts.js';
import type { UserRecord } from './model.js';

type VersionState = { state: 'supported' | 'retired' | 'removed'; references: number };
type StoredVersion = { registryId: string; preset: JsonObject; resources: JsonObject;
  publishedBy: string | null; publishedAt: number; acceptance: JsonObject | null };
type ActiveVersion = { registryId: string; versions: JsonObject };
type VersionUse = { registryId: string; state: 'held' | 'released' };

function json(value: unknown): JsonObject { return JSON.parse(JSON.stringify(value)) as JsonObject; }
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
export function validateVersions(raw: unknown): asserts raw is LayoutVersionTuple {
  try { validateLayoutVersions(raw); } catch { throw new ServiceError('INVALID_ARGUMENT'); }
}

export async function presetRegistryId(crypto: ServiceDependencies['crypto'], versions: LayoutVersionTuple): Promise<string> {
  validateVersions(versions);
  const digest = await crypto.sha256(JSON.stringify(['learn.preset.v1', versions.engineVersion, versions.templateId,
    versions.templateVersion, versions.fontBundleVersion]));
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new ServiceError('INTERNAL_ERROR');
  return `p_${digest}`;
}

function published(record: StoredVersion): PublishedPreset {
  try { validateTrustedPreset(record.preset); }
  catch { throw new ServiceError('INVALID_PRESET'); }
  return { registryId: record.registryId, preset: record.preset, resources: record.resources as unknown as FontBundleDescriptor };
}

function releaseAccepted(record: StoredVersion): boolean {
  return record.preset.stage === 'validated-release' && record.acceptance?.fontLicense === true &&
    record.acceptance.print === true && record.acceptance.resources === true && validId(record.acceptance.evidenceId);
}

function assertState(state: VersionState | null): asserts state is VersionState {
  if (!state || !Number.isSafeInteger(state.references) || state.references < 0 ||
      !['supported', 'retired', 'removed'].includes(state.state)) throw new ServiceError('INVARIANT_VIOLATION');
}

function assertUseId(useId: string): void {
  if (typeof useId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(useId)) throw new ServiceError('INVALID_ARGUMENT');
}

/** T14 must compose this with job+reservation creation in one transaction. */
export async function retainPresetInTransaction(tx: MetadataTransaction, registryId: string, useId: string): Promise<void> {
  assertUseId(useId);
  const existing = await tx.get<VersionUse>('preset_uses', useId);
  if (existing) {
    if (existing.registryId !== registryId || existing.state !== 'held') throw new ServiceError('RESERVATION_CONFLICT');
    return;
  }
  const state = await tx.get<VersionState>('preset_states', registryId);
  assertState(state);
  if (state.state !== 'supported') throw new ServiceError('VERSION_RETIRED');
  if (!await tx.get('preset_versions', registryId)) throw new ServiceError('NOT_FOUND');
  await tx.create('preset_uses', useId, { registryId, state: 'held' });
  await tx.set('preset_states', registryId, { ...state, references: state.references + 1 });
}

/** T15/T16 release only alongside the committed terminal job state. */
export async function releasePresetInTransaction(tx: MetadataTransaction, registryId: string, useId: string): Promise<void> {
  assertUseId(useId);
  const use = await tx.get<VersionUse>('preset_uses', useId);
  if (!use || use.registryId !== registryId) throw new ServiceError('NOT_FOUND');
  if (use.state === 'released') return;
  const state = await tx.get<VersionState>('preset_states', registryId);
  assertState(state);
  if (state.references < 1 || state.state === 'removed') throw new ServiceError('INVARIANT_VIOLATION');
  await tx.set('preset_uses', useId, { ...use, state: 'released' });
  await tx.set('preset_states', registryId, { ...state, references: state.references - 1 });
}

/** Existing held jobs may load retired versions; a caller must already authorize that job. */
export async function loadPresetForJob(store: MetadataReader, registryId: string, useId: string): Promise<PublishedPreset> {
  const use = await store.get<VersionUse>('preset_uses', useId);
  if (!use || use.registryId !== registryId || use.state !== 'held') throw new ServiceError('NOT_FOUND');
  const record = await store.get<StoredVersion>('preset_versions', registryId);
  if (!record || record.registryId !== registryId) throw new ServiceError('NOT_FOUND');
  return published(record);
}

/** Internal registry: CloudService owns per-request authentication and admin authorization. */
export class PresetRegistry {
  constructor(private readonly dependencies: ServiceDependencies, private readonly config: ServiceConfig) {
    if (!config.registry || !dependencies.resources) throw new ServiceError('REGISTRY_UNAVAILABLE');
  }

  private async activeAdmin(tx: MetadataTransaction, userId: string): Promise<void> {
    const user = await tx.get<UserRecord>('users', userId);
    if (!user || user.userId !== userId || user.status !== 'active') throw new ServiceError('ACCOUNT_DISABLED');
    if (!this.config.adminUserIds.includes(userId)) throw new ServiceError('FORBIDDEN');
  }

  private engineSupported(version: string): boolean { return this.config.registry!.cloudEngineVersions.includes(version); }

  private async bundle(version: string, requiredIds: readonly string[] = []): Promise<FontBundleDescriptor> {
    try {
      const raw = await this.dependencies.resources!.describeBundle(version);
      if (!raw || raw.fontBundleVersion !== version || !Array.isArray(raw.fonts) || !raw.fonts.length || raw.fonts.length > 16) {
        throw new ServiceError('RESOURCE_UNAVAILABLE');
      }
      const fonts = [];
      const ids = new Set<string>();
      for (const font of raw.fonts) {
        if (!validId(font.id) || ids.has(font.id) || !Number.isSafeInteger(font.bytes) || font.bytes < 1 ||
            !/^[a-f0-9]{64}$/.test(font.sha256) || typeof font.fontVersion !== 'string' || !font.fontVersion ||
            typeof font.location !== 'string' ||
            !(font.location.startsWith('https://') || (this.config.stage === 'development' && font.location.startsWith('local://')))) {
          throw new ServiceError('RESOURCE_UNAVAILABLE');
        }
        ids.add(font.id);
        const bytes = await this.dependencies.resources!.readFontBytes(font.id, version);
        if (!(bytes instanceof Uint8Array) || bytes.length !== font.bytes || await this.dependencies.crypto.sha256(bytes) !== font.sha256) {
          throw new ServiceError('RESOURCE_UNAVAILABLE');
        }
        fonts.push({ id: font.id, bytes: font.bytes, sha256: font.sha256, fontVersion: font.fontVersion, location: font.location });
      }
      if (requiredIds.some(id => !ids.has(id))) throw new ServiceError('RESOURCE_UNAVAILABLE');
      fonts.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      return { fontBundleVersion: version, fonts };
    } catch { throw new ServiceError('RESOURCE_UNAVAILABLE'); }
  }

  private auditId(): string {
    const id = this.dependencies.crypto.randomId();
    assertUseId(id);
    return `registry_${id}`;
  }

  async publish(userId: string, raw: unknown, acceptance?: ReleaseAcceptance): Promise<PublishedPreset> {
    try { validateTrustedPreset(raw); } catch { throw new ServiceError('INVALID_PRESET'); }
    const preset = JSON.parse(JSON.stringify(raw)) as TrustedPaperPreset;
    if (!this.engineSupported(preset.versions.engineVersion)) throw new ServiceError('UPDATE_REQUIRED');
    const isProduction = this.config.stage === 'production';
    if (isProduction && (preset.stage !== 'validated-release' || !acceptance || acceptance.fontLicense !== true ||
        acceptance.print !== true || acceptance.resources !== true || !validId(acceptance.evidenceId))) {
      throw new ServiceError('RELEASE_NOT_ACCEPTED');
    }
    const id = await presetRegistryId(this.dependencies.crypto, preset.versions);
    const needed = [...new Set([preset.textStyles.title.canonicalFontId, preset.textStyles.title.tracingHanFontId,
      preset.textStyles.body.canonicalFontId, preset.textStyles.body.tracingHanFontId])];
    const resources = await this.bundle(preset.versions.fontBundleVersion, needed);
    const auditId = this.auditId();
    await this.dependencies.store.transaction(async tx => {
      await this.activeAdmin(tx, userId);
      if (await tx.get('preset_states', id)) throw new ServiceError('VERSION_EXISTS');
      const now = this.dependencies.clock.now();
      await tx.create('preset_versions', id, { registryId: id, preset: json(preset), resources: json(resources),
        publishedBy: userId, publishedAt: now,
        acceptance: isProduction ? { fontLicense: true, print: true, resources: true, evidenceId: acceptance!.evidenceId } : null });
      await tx.create('preset_states', id, { state: 'supported', references: 0 });
      await tx.create('admin_audit_logs', auditId, { userId, action: 'PRESET_PUBLISH', registryId: id, createdAt: now });
    });
    return { registryId: id, preset, resources };
  }

  private async load(versions: LayoutVersionTuple): Promise<{ record: StoredVersion; state: VersionState }> {
    const id = await presetRegistryId(this.dependencies.crypto, versions);
    const [record, state] = await Promise.all([this.dependencies.store.get<StoredVersion>('preset_versions', id),
      this.dependencies.store.get<VersionState>('preset_states', id)]);
    if (!record || !state || state.state === 'removed') throw new ServiceError('NOT_FOUND');
    assertState(state);
    const actual = published(record).preset.versions;
    if (record.registryId !== id || actual.engineVersion !== versions.engineVersion || actual.templateId !== versions.templateId ||
        actual.templateVersion !== versions.templateVersion || actual.fontBundleVersion !== versions.fontBundleVersion) {
      throw new ServiceError('INVALID_PRESET');
    }
    return { record, state };
  }

  async activate(userId: string, versions: LayoutVersionTuple): Promise<void> {
    const { record } = await this.load(versions);
    const descriptor = published(record);
    if (!this.engineSupported(versions.engineVersion)) throw new ServiceError('UPDATE_REQUIRED');
    if (!this.config.registry!.clientReadyEngineVersions.includes(versions.engineVersion)) throw new ServiceError('CLIENT_NOT_READY');
    if (this.config.stage === 'production' && !releaseAccepted(record)) {
      throw new ServiceError('RELEASE_NOT_ACCEPTED');
    }
    if (JSON.stringify(await this.bundle(versions.fontBundleVersion)) !== JSON.stringify(descriptor.resources)) {
      throw new ServiceError('RESOURCE_UNAVAILABLE');
    }
    const auditId = this.auditId();
    await this.dependencies.store.transaction(async tx => {
      await this.activeAdmin(tx, userId);
      const state = await tx.get<VersionState>('preset_states', record.registryId);
      assertState(state);
      if (state.state !== 'supported') throw new ServiceError('VERSION_RETIRED');
      await tx.set('active_presets', versions.templateId, { registryId: record.registryId, versions: json(versions) });
      await tx.create('admin_audit_logs', auditId, { userId, action: 'PRESET_ACTIVATE', registryId: record.registryId,
        createdAt: this.dependencies.clock.now() });
    });
  }

  async retire(userId: string, versions: LayoutVersionTuple, remove: boolean): Promise<void> {
    const id = await presetRegistryId(this.dependencies.crypto, versions);
    const auditId = this.auditId();
    await this.dependencies.store.transaction(async tx => {
      await this.activeAdmin(tx, userId);
      const state = await tx.get<VersionState>('preset_states', id);
      if (!state || state.state === 'removed') throw new ServiceError('NOT_FOUND');
      assertState(state);
      const active = await tx.get<ActiveVersion>('active_presets', versions.templateId);
      if (active?.registryId === id || (remove && (state.state !== 'retired' || state.references > 0))) {
        throw new ServiceError('VERSION_IN_USE');
      }
      if (remove) await tx.delete('preset_versions', id);
      await tx.set('preset_states', id, { ...state, state: remove ? 'removed' : 'retired' });
      await tx.create('admin_audit_logs', auditId, { userId, action: remove ? 'PRESET_REMOVE' : 'PRESET_RETIRE',
        registryId: id, createdAt: this.dependencies.clock.now() });
    });
  }

  async compatibility(request: CompatibilityRequest): Promise<CompatibilityResponse> {
    if (!request || !validId(request.engineVersion) || (request.lockedVersions !== undefined &&
        (!Array.isArray(request.lockedVersions) || request.lockedVersions.length > 16))) throw new ServiceError('INVALID_ARGUMENT');
    const lockedVersions = request.lockedVersions ?? [];
    lockedVersions.forEach(validateVersions);
    const bundles = new Map<string, Promise<FontBundleDescriptor>>();
    const availability = async (versions: LayoutVersionTuple): Promise<PresetAvailability> => {
      let loaded;
      try { loaded = await this.load(versions); }
      catch (error) {
        if (error instanceof ServiceError && error.code === 'NOT_FOUND') return { versions, status: 'not-found' };
        throw error;
      }
      if (loaded.state.state !== 'supported') return { versions, status: 'retired' };
      if (!this.engineSupported(versions.engineVersion) || versions.engineVersion !== request.engineVersion) {
        return { versions, status: 'update-required' };
      }
      const descriptor = published(loaded.record);
      if (this.config.stage === 'production' && !releaseAccepted(loaded.record)) {
        return { versions, status: 'resource-unavailable' };
      }
      try {
        if (!bundles.has(versions.fontBundleVersion)) bundles.set(versions.fontBundleVersion, this.bundle(versions.fontBundleVersion));
        if (JSON.stringify(await bundles.get(versions.fontBundleVersion)) !== JSON.stringify(descriptor.resources)) {
          return { versions, status: 'resource-unavailable' };
        }
        return { versions, status: 'ready', published: descriptor };
      } catch { return { versions, status: 'resource-unavailable' }; }
    };
    const pointers = await Promise.all(Object.keys(DEFAULT_PRESETS).map(templateId =>
      this.dependencies.store.get<ActiveVersion>('active_presets', templateId)));
    const current: PresetAvailability[] = [];
    for (const pointer of pointers) {
      if (!pointer) continue;
      validateVersions(pointer.versions);
      current.push(await availability(pointer.versions));
    }
    const locked: PresetAvailability[] = [];
    for (const versions of lockedVersions) locked.push(await availability(versions));
    return { engineSupported: this.engineSupported(request.engineVersion), current, locked, serverTime: this.dependencies.clock.now() };
  }
}
