import { createPaperDocument, getDevelopmentPreset, PAPER_ENGINE_VERSION, validateLayoutVersions,
  type LayoutVersionTuple, type TrustedPaperPreset, type TemplateId } from '../../packages/paper-core/src/index.js';
import { FONT_BUNDLE_VERSION, FONT_RESOURCES, type FontId } from '../../packages/font-metrics/dist/index.js';
import type { CompatibilityResponse, PresetAvailability, PublishedPreset } from '../../packages/cloud-service/dist/index.js';
import { CloudClientError } from './cloud-client.js';
import { PREVIEW_FONT_URLS } from './font-sources.js';

export const versionKey = (v: LayoutVersionTuple): string => JSON.stringify([v.engineVersion, v.templateId, v.templateVersion, v.fontBundleVersion]);
const invalid = (): never => { throw new CloudClientError('INVALID_RESPONSE'); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Native JSON bridges can supply plain data from another realm. Copy data
 * descriptors into this realm without invoking getters or serialization hooks. */
function localCompatibilityJson(value: unknown): unknown {
  let remaining = 10000;
  const copy = (input: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 32) return invalid();
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object' || Object.getOwnPropertySymbols(input).length) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const prototype = Object.getPrototypeOf(input);
    if (Array.isArray(input)) {
      // Accept each realm's ordinary Array.prototype, but no subclasses or
      // replaced prototypes. Inspect inherited hooks without reading them.
      if (!Array.isArray(prototype)) return invalid();
      const parent = Object.getPrototypeOf(prototype);
      if (!parent || Object.getPrototypeOf(parent) !== null ||
          Object.getOwnPropertyDescriptor(prototype, 'toJSON') || Object.getOwnPropertyDescriptor(parent, 'toJSON')) return invalid();
      if (Object.keys(descriptors).length !== input.length + 1) return invalid();
      return Array.from({ length: input.length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
        return copy(descriptor.value, depth + 1);
      });
    }
    if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || Object.getOwnPropertyDescriptor(prototype, 'toJSON'))) return invalid();
    const output = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor) || !descriptor.enumerable) return invalid();
      output[key] = copy(descriptor.value, depth + 1);
    }
    return output;
  };
  return copy(value, 0);
}
const stableValue = (data: unknown): string => JSON.stringify(data, (_key, value: unknown) =>
  object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);

/** The catalog contains presets/resources only, never an input or layout snapshot. */
export class CompatibilityPresets {
  readonly fontUrls: Partial<Record<FontId, string>> = { ...PREVIEW_FONT_URLS };
  private current = new Map<TemplateId, PresetAvailability>();
  private checked = new Map<string, PresetAvailability>();
  private verified = new Map<string, TrustedPaperPreset>();
  constructor(private readonly allowLocalResources: boolean) {}
  presetFor(id: TemplateId): TrustedPaperPreset {
    return this.current.get(id)?.published?.preset ?? getDevelopmentPreset(id);
  }
  currentFor(id: TemplateId): PresetAvailability | undefined { return this.current.get(id); }
  checkedFor(versions: LayoutVersionTuple): PresetAvailability | undefined { return this.checked.get(versionKey(versions)); }
  isVerified(preset: TrustedPaperPreset): boolean {
    const known = this.verified.get(versionKey(preset.versions));
    return !!known && stableValue(known) === stableValue(preset);
  }
  private availability(raw: unknown): PresetAvailability {
    if (!object(raw)) return invalid();
    try { validateLayoutVersions(raw.versions); } catch { return invalid(); }
    const versions = Object.freeze({ ...(raw.versions as LayoutVersionTuple) });
    if (typeof raw.status !== 'string' || !['ready', 'update-required', 'retired', 'resource-unavailable', 'not-found'].includes(raw.status)) return invalid();
    if (raw.status !== 'ready') return { versions, status: raw.status as PresetAvailability['status'] };
    if (!object(raw.published) || typeof raw.published.registryId !== 'string' || !/^p_[a-f0-9]{64}$/.test(raw.published.registryId)) return invalid();
    let preset: TrustedPaperPreset;
    try { preset = createPaperDocument({ templateId: versions.templateId }, raw.published.preset as TrustedPaperPreset).preset; }
    catch { return invalid(); }
    if (versionKey(preset.versions) !== versionKey(versions)) return invalid();
    if (versions.engineVersion !== PAPER_ENGINE_VERSION) return { versions, status: 'update-required' };
    const resources = raw.published.resources;
    if (!object(resources) || resources.fontBundleVersion !== versions.fontBundleVersion || !Array.isArray(resources.fonts) ||
        !resources.fonts.length || resources.fonts.length > 16) return invalid();
    const ids = new Set<string>();
    let supported = resources.fontBundleVersion === FONT_BUNDLE_VERSION;
    const fonts = resources.fonts.map(font => {
      if (!object(font) || typeof font.id !== 'string' || ids.has(font.id) || !Number.isSafeInteger(font.bytes) ||
          typeof font.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(font.sha256) || typeof font.fontVersion !== 'string' ||
          typeof font.location !== 'string') return invalid();
      ids.add(font.id);
      const pin = FONT_RESOURCES.find(value => value.id === font.id);
      if (!pin || pin.bytes !== font.bytes || pin.sha256 !== font.sha256 || pin.fontVersion !== font.fontVersion ||
          !(/^https:\/\/[^/?#\s]+(?:\/[^\s]*)?$/.test(font.location) || this.allowLocalResources && /^local:\/\//.test(font.location))) supported = false;
      return { id: font.id, bytes: font.bytes as number, sha256: font.sha256, fontVersion: font.fontVersion, location: font.location };
    });
    const required = [preset.textStyles.title.canonicalFontId, preset.textStyles.title.tracingHanFontId,
      preset.textStyles.body.canonicalFontId, preset.textStyles.body.tracingHanFontId];
    if (required.some(id => !ids.has(id))) supported = false;
    if (!supported) return { versions, status: 'resource-unavailable' };
    const published: PublishedPreset = { registryId: raw.published.registryId, preset,
      resources: { fontBundleVersion: versions.fontBundleVersion, fonts } };
    return { versions, status: 'ready', published };
  }
  install(raw: unknown, requested: readonly LayoutVersionTuple[]): CompatibilityResponse {
    raw = localCompatibilityJson(raw);
    if (!object(raw) || typeof raw.engineSupported !== 'boolean' || !Array.isArray(raw.current) || raw.current.length > 4 ||
        !Array.isArray(raw.locked) || raw.locked.length !== requested.length || !Number.isSafeInteger(raw.serverTime)) return invalid();
    const current = raw.current.map(value => this.availability(value)), locked = raw.locked.map(value => this.availability(value));
    if (new Set(current.map(item => item.versions.templateId)).size !== current.length) return invalid();
    for (let i = 0; i < requested.length; i++) if (versionKey(locked[i]!.versions) !== versionKey(requested[i]!)) return invalid();
    const all = [...current, ...locked], seen = new Map<string, string>();
    for (const item of all) {
      const key = versionKey(item.versions), signature = stableValue(item);
      if (seen.has(key) && seen.get(key) !== signature) return invalid();
      seen.set(key, signature);
      if (item.published) {
        const known = this.verified.get(key);
        if (known && stableValue(known) !== stableValue(item.published.preset)) return invalid();
      }
    }
    // Commit only after validating the whole response; preserve old immutable
    // descriptors for held editing combinations, never old availability results.
    this.current = new Map(current.map(item => [item.versions.templateId, item]));
    this.checked = new Map(all.map(item => [versionKey(item.versions), item]));
    for (const item of all) if (item.published) {
      this.verified.set(versionKey(item.versions), item.published.preset);
      for (const font of item.published.resources.fonts) if (font.location.startsWith('https://')) this.fontUrls[font.id as FontId] = font.location;
    }
    return { engineSupported: raw.engineSupported, current, locked, serverTime: raw.serverTime as number };
  }
  clear(): void { this.current.clear(); this.checked.clear(); this.verified.clear(); }
}
