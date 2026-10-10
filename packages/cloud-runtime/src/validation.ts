import { RuntimeError, type JsonObject, type JsonValue, type ListOptions } from "./contracts.js";

export function assertKey(value: string): void {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
}

function validateJson(value: unknown, ancestors: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new RuntimeError("INVALID_ARGUMENT");
  // Inspect data descriptors before reading values. Accessors/toJSON hooks must
  // never execute between validation and persistence or silently change data.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(descriptors).length !== value.length + 1) {
      throw new RuntimeError("INVALID_ARGUMENT");
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new RuntimeError("INVALID_ARGUMENT");
      validateJson(descriptor.value, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (["__proto__", "constructor", "prototype", "_id"].includes(key) ||
        !("value" in descriptor) || !descriptor.enumerable) {
      throw new RuntimeError("INVALID_ARGUMENT");
    }
    validateJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

/** This validates serialization, not privacy. Services must project allowed fields. */
export function cloneDocument(value: JsonObject): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
  validateJson(value, new Set());
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function validateList(options: ListOptions = {}): Required<Pick<ListOptions, "limit" | "where">> & Pick<ListOptions, "afterId"> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RuntimeError("INVALID_ARGUMENT");
  if (options.afterId !== undefined) assertKey(options.afterId);
  const where = options.where ?? {};
  for (const [key, value] of Object.entries(where)) {
    assertKey(key);
    if (["_id", "__proto__", "constructor", "prototype"].includes(key) ||
        !(value === null || typeof value === "string" || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)))) {
      throw new RuntimeError("INVALID_ARGUMENT");
    }
  }
  return { ...options, limit, where };
}

export function assertStoragePath(path: string): void {
  if (typeof path !== "string" || path.length > 512 ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.pdf$/.test(path) ||
      path.split("/").some(part => part === "." || part === "..")) {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
}
