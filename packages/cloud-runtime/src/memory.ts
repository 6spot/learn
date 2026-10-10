import { RuntimeError, type Clock, type ExecutionBridge, type JsonObject, type ListOptions,
  type MetadataReader, type MetadataStore, type MetadataTransaction, type PrivateStorage,
  type StoredDocument, type TrustedIdentity, type TrustedIdentityProvider } from "./contracts.js";
import { assertKey, assertStoragePath, cloneDocument, validateList } from "./validation.js";

type Tables = Map<string, Map<string, JsonObject>>;

function copyTables(tables: Tables): Tables {
  return new Map([...tables].map(([collection, documents]) => [collection,
    new Map([...documents].map(([id, value]) => [id, cloneDocument(value)]))]));
}

class Reader implements MetadataReader {
  constructor(protected readonly tables: () => Tables, protected readonly assertOpen = () => {}) {}

  async get<T extends JsonObject>(collection: string, id: string): Promise<T | null> {
    this.assertOpen();
    assertKey(collection);
    assertKey(id);
    const value = this.tables().get(collection)?.get(id);
    return value === undefined ? null : cloneDocument(value) as T;
  }

  async list<T extends JsonObject>(collection: string, options?: ListOptions): Promise<StoredDocument<T>[]> {
    this.assertOpen();
    assertKey(collection);
    const { limit, where, afterId } = validateList(options);
    return [...(this.tables().get(collection) ?? [])]
      .filter(([id, value]) => (afterId === undefined || id > afterId) &&
        Object.entries(where).every(([key, expected]) => value[key] === expected))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .slice(0, limit)
      .map(([id, value]) => ({ id, value: cloneDocument(value) as T }));
  }
}

/** Deterministic serial transactions, not an emulation of CloudBase isolation internals. */
export class MemoryMetadataStore extends Reader implements MetadataStore {
  private committed: Tables = new Map();
  private tail: Promise<void> = Promise.resolve();
  private failCommit = false;

  constructor() {
    // No callback invokes this getter until construction has finished.
    super(() => this.committed);
  }

  /** Inject one failure after a callback succeeds but before its writes are committed. */
  failNextCommit(): void { this.failCommit = true; }

  async transaction<T>(work: (transaction: MetadataTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    let open = true;
    const ensureOpen = () => { if (!open) throw new RuntimeError("TRANSACTION_CLOSED"); };
    try {
      const draft = copyTables(this.committed);
      const reader = new Reader(() => draft, ensureOpen);
      const write = async (collection: string, id: string, value: JsonObject, create: boolean) => {
        ensureOpen();
        assertKey(collection);
        assertKey(id);
        const documents = draft.get(collection) ?? new Map<string, JsonObject>();
        if (create && documents.has(id)) throw new RuntimeError("ALREADY_EXISTS");
        documents.set(id, cloneDocument(value));
        draft.set(collection, documents);
      };
      const transaction: MetadataTransaction = {
        get: reader.get.bind(reader),
        set: (collection, id, value) => write(collection, id, value, false),
        create: (collection, id, value) => write(collection, id, value, true),
        delete: async (collection, id) => {
          ensureOpen(); assertKey(collection); assertKey(id);
          draft.get(collection)?.delete(id);
        },
      };
      const result = await work(transaction);
      if (this.failCommit) {
        this.failCommit = false;
        throw new RuntimeError("DATABASE_UNAVAILABLE");
      }
      this.committed = draft;
      return result;
    } finally {
      open = false;
      unlock();
    }
  }

  /** Test-only inspection of the durable representation. */
  snapshot(): Record<string, Record<string, JsonObject>> {
    return Object.fromEntries([...copyTables(this.committed)].map(([name, documents]) => [name, Object.fromEntries(documents)]));
  }
}

export class MemoryPrivateStorage implements PrivateStorage {
  private readonly files = new Map<string, Uint8Array>();

  resolve(path: string): string {
    assertStoragePath(path);
    return `private:${path}`;
  }

  async put(path: string, bytes: Uint8Array): Promise<string> {
    assertStoragePath(path);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new RuntimeError("INVALID_ARGUMENT");
    const fileId = this.resolve(path);
    this.files.set(fileId, Uint8Array.from(bytes));
    return fileId;
  }

  async read(fileId: string): Promise<Uint8Array> {
    const bytes = this.files.get(fileId);
    if (bytes === undefined) throw new RuntimeError("NOT_FOUND");
    return Uint8Array.from(bytes);
  }

  async remove(fileId: string): Promise<void> { this.files.delete(fileId); }

  /** Test-only backend inventory; clients never receive file paths through this. */
  fileIds(): string[] { return [...this.files.keys()].sort(); }
}

export class SystemClock implements Clock {
  now(): number { return Date.now(); }
}

export class ManualClock implements Clock {
  constructor(private value = 0) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RuntimeError("INVALID_ARGUMENT");
  }
  now(): number { return this.value; }
  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || !Number.isSafeInteger(this.value + milliseconds)) {
      throw new RuntimeError("INVALID_ARGUMENT");
    }
    this.value += milliseconds;
  }
}

/** Server-side direct execution: no early accepted response or retained input. */
export class AwaitedExecutionBridge implements ExecutionBridge {
  async invoke<Input, Output>(input: Input, work: (input: Input) => Promise<Output>): Promise<Output> {
    return await work(input);
  }
}

export class SimulatedExecutionBridge implements ExecutionBridge {
  constructor(private readonly fault: "none" | "before-start" | "response-lost" = "none") {}
  async invoke<Input, Output>(input: Input, work: (input: Input) => Promise<Output>): Promise<Output> {
    if (this.fault === "before-start") throw new RuntimeError("EXECUTION_NOT_STARTED");
    const result = await work(input);
    if (this.fault === "response-lost") throw new RuntimeError("EXECUTION_OUTCOME_UNKNOWN");
    return result;
  }
}

/** Test-only trusted-context fixture. Never construct it from a request event. */
export class StaticIdentityProvider implements TrustedIdentityProvider {
  constructor(private readonly identity: TrustedIdentity | null) {}
  current(): TrustedIdentity {
    if (!this.identity?.subject || !this.identity.appId) throw new RuntimeError("UNAUTHENTICATED");
    return { subject: this.identity.subject, appId: this.identity.appId };
  }
}
