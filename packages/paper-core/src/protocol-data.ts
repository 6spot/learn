import { PaperError, type PaperErrorCode, type PaperErrorDetails } from './errors.js';

export type Schema = 'id' | 'boolean' | 'finite' | 'nonnegative' | 'positive' | 'integer' | 'positive-integer'
  | Readonly<{ enum: readonly string[] }> | Readonly<{ array: Schema }>
  | Readonly<{ nullable: Schema }> | Readonly<{ record: Readonly<Record<string, Schema>> }>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Explicit schemas prevent silent omissions, serialization hooks and runtime-dependent strings. */
export function decodeProtocolData(value: unknown, schema: Schema, code: PaperErrorCode, field: PaperErrorDetails['field']): Json {
  const invalid = (): never => { throw new PaperError(code, field ? { field } : {}); };
  if (typeof schema === 'string') {
    if (schema === 'id') return typeof value === 'string' && ID.exec(value)?.[0] === value ? value : invalid();
    if (schema === 'boolean') return typeof value === 'boolean' ? value : invalid();
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return invalid();
    if (schema === 'positive' && value <= 0 || schema === 'nonnegative' && value < 0 ||
      schema === 'integer' && (!Number.isSafeInteger(value) || value < 0) ||
      schema === 'positive-integer' && (!Number.isSafeInteger(value) || value <= 0)) return invalid();
    return Object.is(value, -0) ? 0 : value;
  }
  if ('enum' in schema) return typeof value === 'string' && schema.enum.includes(value) ? value : invalid();
  if ('nullable' in schema) return value === null ? null : decodeProtocolData(value, schema.nullable, code, field);
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length > 0) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if ('array' in schema) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(descriptors).length !== value.length + 1) return invalid();
    const output: Json[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
      output.push(decodeProtocolData(descriptor.value, schema.array, code, field));
    }
    return output;
  }
  if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Object.keys(schema.record).sort();
  if (Object.keys(descriptors).length !== keys.length) return invalid();
  const output: { [key: string]: Json } = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    output[key] = decodeProtocolData(descriptor.value, schema.record[key]!, code, field);
  }
  return output;
}

export const VERSION_SCHEMA: Schema = { record: {
  engineVersion: 'id', templateId: { enum: ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'] },
  templateVersion: 'id', fontBundleVersion: 'id',
} };
