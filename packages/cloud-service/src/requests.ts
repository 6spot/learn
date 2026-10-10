import { PaperError, validateLayoutDigest, validatePaperInput, type ValidatedPaperInput } from '@learn/paper-core';
import { cloneDocument, type JsonObject } from '@learn/cloud-runtime';
import { ServiceError, type CryptoPort, type GenerationConfig, type GenerationRequest, type SubmissionWindow } from './contracts.js';
import type { GenerationRequestRecord } from './model.js';
import { validateVersions } from './presets.js';

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type ParsedRequestId = {
  windowId: string; keyId: string; issuedAt: number; expiresAt: number; windowNonce: string; signature: string; nonce: string;
};
export type ValidatedGenerationRequest = Omit<GenerationRequest, 'input'> & { input: ValidatedPaperInput };

function timePart(value: string): number {
  if (!/^[0-9a-z]{1,11}$/.test(value)) throw new ServiceError('REQUEST_INVALID');
  const parsed = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed.toString(36) !== value) throw new ServiceError('REQUEST_INVALID');
  return parsed;
}

export function parseRequestId(value: unknown): ParsedRequestId {
  if (typeof value !== 'string' || value.length > 320) throw new ServiceError('REQUEST_INVALID');
  const parts = value.split('.');
  if (parts.length !== 8 || parts[0] !== 'r1' || parts[1] !== 'w1' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(parts[2]!) || !UUID_V4.test(parts[5]!) ||
      !/^[a-f0-9]{64}$/.test(parts[6]!) || !UUID_V4.test(parts[7]!)) throw new ServiceError('REQUEST_INVALID');
  const issuedAt = timePart(parts[3]!);
  const expiresAt = timePart(parts[4]!);
  if (expiresAt <= issuedAt) throw new ServiceError('REQUEST_INVALID');
  return { windowId: parts.slice(1, 7).join('.'), keyId: parts[2]!, issuedAt, expiresAt,
    windowNonce: parts[5]!, signature: parts[6]!, nonce: parts[7]! };
}

/** Supply a UUIDv4 from a secure platform source. This helper never uses Math.random. */
export function createRequestId(windowId: string, secureNonce: string): string {
  const value = `r1.${windowId}.${secureNonce}`;
  parseRequestId(value);
  return value;
}

function windowMessage(userId: string, keyId: string, issuedAt: number, expiresAt: number, nonce: string): string {
  return JSON.stringify(['learn.submission-window.v1', userId, keyId, issuedAt, expiresAt, nonce]);
}

async function hmac(crypto: CryptoPort, keyId: string, value: string): Promise<string> {
  try {
    const digest = await crypto.hmacSha256(keyId, value);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ServiceError('KEY_UNAVAILABLE');
    return digest;
  } catch { throw new ServiceError('KEY_UNAVAILABLE'); }
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function issueWindow(crypto: CryptoPort, userId: string, config: GenerationConfig, now: number): Promise<SubmissionWindow> {
  const nonce = crypto.randomId();
  if (!UUID_V4.test(nonce) || !Number.isSafeInteger(now) || now < 0) throw new ServiceError('INTERNAL_ERROR');
  const expiresAt = now + config.windowTtlMs;
  const signature = await hmac(crypto, config.windowKeyId, windowMessage(userId, config.windowKeyId, now, expiresAt, nonce));
  const windowId = ['w1', config.windowKeyId, now.toString(36), expiresAt.toString(36), nonce, signature].join('.');
  // Reuse canonical syntax checks at issuance; there are no alternate encodings.
  createRequestId(windowId, nonce);
  return { windowId, expiresAt };
}

export async function verifyWindowSignature(crypto: CryptoPort, userId: string, config: GenerationConfig,
  parsed: ParsedRequestId): Promise<void> {
  if (!config.retainedWindowKeyIds.includes(parsed.keyId)) throw new ServiceError('KEY_UNAVAILABLE');
  const expected = await hmac(crypto, parsed.keyId,
    windowMessage(userId, parsed.keyId, parsed.issuedAt, parsed.expiresAt, parsed.windowNonce));
  if (!equalHex(expected, parsed.signature)) throw new ServiceError('REQUEST_INVALID');
}

export function assertWindowCurrent(parsed: ParsedRequestId, now: number): void {
  if (now < parsed.issuedAt || now >= parsed.expiresAt) throw new ServiceError('REQUEST_EXPIRED');
}

export async function requestRecordId(crypto: CryptoPort, userId: string, requestId: string): Promise<string> {
  const digest = await crypto.sha256(JSON.stringify(['learn.request-key.v1', userId, requestId]));
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new ServiceError('INTERNAL_ERROR');
  return `r_${digest}`;
}

export function requestIdFromEnvelope(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.getOwnPropertySymbols(raw).length ||
      Object.values(Object.getOwnPropertyDescriptors(raw)).some(d => !('value' in d) || !d.enumerable)) {
    throw new ServiceError('INVALID_INPUT');
  }
  const request = raw as Record<string, unknown>;
  const keys = ['requestId', 'input', 'versions', 'layoutDigest'];
  if (Object.keys(request).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(request, key))) throw new ServiceError('INVALID_INPUT');
  parseRequestId(request.requestId);
  return request.requestId as string;
}

/** Snapshot before the first await; do not invoke accessors or serialization hooks. */
export function snapshotGenerationRequest(raw: unknown): JsonObject {
  requestIdFromEnvelope(raw);
  try { return cloneDocument(raw as JsonObject); } catch { throw new ServiceError('INVALID_INPUT'); }
}

export function validateGenerationRequest(raw: unknown, config: GenerationConfig): ValidatedGenerationRequest {
  const requestId = requestIdFromEnvelope(raw);
  const request = raw as Record<string, unknown>;
  validateVersions(request.versions);
  let layoutDigest: string;
  try { layoutDigest = validateLayoutDigest(request.layoutDigest); } catch { throw new ServiceError('INVALID_INPUT'); }
  let input;
  try { input = validatePaperInput(request.input, { maxInputCodeUnits: config.maxInputCodeUnits, maxGraphemes: config.maxGraphemes, maxPages: config.maxPages }); }
  catch (error) { throw new ServiceError(error instanceof PaperError && error.code === 'INPUT_LIMIT_EXCEEDED' ? 'INPUT_LIMIT_EXCEEDED' : 'INVALID_INPUT'); }
  if (input.templateId !== request.versions.templateId) throw new ServiceError('INVALID_INPUT');
  return Object.freeze({ requestId, input, versions: Object.freeze({ ...request.versions }), layoutDigest });
}

export async function generationFingerprint(crypto: CryptoPort, userId: string, request: ValidatedGenerationRequest,
  keyId: string, version: string, defaultTitleAlign: string): Promise<string> {
  if (version !== 'learn-request-v1') throw new ServiceError('FINGERPRINT_UNSUPPORTED');
  const { input, versions } = request;
  const canonical = JSON.stringify([version, 'paper', 'pdf', userId, request.requestId,
    input.title, input.body, input.tracing, input.options.titleAlign ?? defaultTitleAlign, input.options.bodyIndent ?? 'default',
    versions.engineVersion, versions.templateId, versions.templateVersion, versions.fontBundleVersion, request.layoutDigest]);
  return hmac(crypto, keyId, canonical);
}

export async function assertSameRequest(crypto: CryptoPort, config: GenerationConfig, userId: string,
  request: ValidatedGenerationRequest, record: GenerationRequestRecord): Promise<void> {
  if (record.userId !== userId || record.requestId !== request.requestId) throw new ServiceError('IDEMPOTENCY_CONFLICT');
  if (!config.retainedFingerprintKeyIds.includes(record.fingerprintKeyId)) throw new ServiceError('KEY_UNAVAILABLE');
  const actual = await generationFingerprint(crypto, userId, request, record.fingerprintKeyId,
    record.fingerprintVersion, record.defaultTitleAlign);
  if (!equalHex(actual, record.fingerprint)) throw new ServiceError('IDEMPOTENCY_CONFLICT');
}
