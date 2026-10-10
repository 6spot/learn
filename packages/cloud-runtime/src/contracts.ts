export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface StoredDocument<T extends JsonObject = JsonObject> {
  id: string;
  value: T;
}

export interface ListOptions {
  /** Equality predicates on top-level fields only. */
  where?: Record<string, string | number | boolean | null>;
  afterId?: string;
  limit?: number;
}

export interface MetadataReader {
  get<T extends JsonObject = JsonObject>(collection: string, id: string): Promise<T | null>;
  /** Stable ascending document ID order; default 50, at most 100. */
  list<T extends JsonObject = JsonObject>(collection: string, options?: ListOptions): Promise<StoredDocument<T>[]>;
}

export interface MetadataTransaction {
  get<T extends JsonObject = JsonObject>(collection: string, id: string): Promise<T | null>;
  set(collection: string, id: string, value: JsonObject): Promise<void>;
  create(collection: string, id: string, value: JsonObject): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
}

export interface MetadataStore extends MetadataReader {
  /** The SDK may retry this callback. Keep all external effects outside it. */
  transaction<T>(work: (transaction: MetadataTransaction) => Promise<T>): Promise<T>;
}

export interface PrivateStorage {
  /** Deterministic provider reference for a pre-registered server-selected path. */
  resolve(path: string): string;
  /** Backend capability only; caller supplies a server-generated candidate path. */
  put(path: string, bytes: Uint8Array): Promise<string>;
  /** Never expose this method directly to clients; authorize task ownership first. */
  read(fileId: string): Promise<Uint8Array>;
  remove(fileId: string): Promise<void>;
}

export interface TrustedIdentity {
  /** Provider subject; map to an internal user ID in the identity service. */
  subject: string;
  appId: string;
}

export interface TrustedIdentityProvider {
  current(): TrustedIdentity;
}

export interface Clock {
  now(): number;
}

export interface ExecutionBridge {
  /** Holds payload only for the duration of this awaited invocation, never queues it. */
  invoke<Input, Output>(input: Input, work: (input: Input) => Promise<Output>): Promise<Output>;
}

export type RuntimeErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "ALREADY_EXISTS"
  | "NOT_FOUND"
  | "STORAGE_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "EXECUTION_OUTCOME_UNKNOWN"
  | "EXECUTION_NOT_STARTED"
  | "TRANSACTION_CLOSED";

/** Safe machine code only. Provider messages can contain user input or credentials. */
export class RuntimeError extends Error {
  constructor(readonly code: RuntimeErrorCode) {
    super(code);
    this.name = "RuntimeError";
  }
}
