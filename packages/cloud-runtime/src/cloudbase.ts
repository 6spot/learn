import { RuntimeError, type JsonObject, type ListOptions, type MetadataStore, type MetadataTransaction,
  type PrivateStorage, type StoredDocument, type TrustedIdentity, type TrustedIdentityProvider } from "./contracts.js";
import { assertKey, assertStoragePath, cloneDocument, validateList } from "./validation.js";

/** Structural subset of wx-server-sdk. Real SDK behavior requires environment acceptance. */
export interface CloudDocumentReference {
  get(): Promise<{ data: unknown }>;
  set(input: { data: JsonObject }): Promise<unknown>;
  remove(): Promise<unknown>;
}

export interface CloudQuery {
  where(filter: Record<string, unknown>): CloudQuery;
  orderBy(field: string, direction: "asc"): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<{ data: unknown }>;
}

export interface CloudCollection extends CloudQuery {
  doc(id: string): CloudDocumentReference;
}

export interface CloudTransaction {
  collection(name: string): Pick<CloudCollection, "doc">;
}

export interface CloudDatabase {
  collection(name: string): CloudCollection;
  command: { gt(value: string): unknown };
  runTransaction<T>(work: (transaction: CloudTransaction) => Promise<T>): Promise<T>;
}

export interface CloudStorageSdk {
  uploadFile(input: { cloudPath: string; fileContent: Uint8Array }): Promise<{ fileID: string }>;
  downloadFile(input: { fileID: string }): Promise<{ fileContent: Uint8Array }>;
  deleteFile(input: { fileList: string[] }): Promise<{ fileList: Array<{ fileID: string; status: number }> }>;
}

export interface CloudIdentitySdk {
  getWXContext(): { OPENID?: string; APPID?: string };
}

export interface CloudEnvironmentConfig {
  stage: "development" | "production";
  developmentEnvironmentId: string;
  productionEnvironmentId: string;
  appId: string;
}

export function selectCloudEnvironment(config: CloudEnvironmentConfig): { env: string; appId: string } {
  if (!["development", "production"].includes(config.stage) ||
      !config.developmentEnvironmentId || !config.productionEnvironmentId || !config.appId ||
      config.developmentEnvironmentId === config.productionEnvironmentId) {
    throw new RuntimeError("INVALID_ARGUMENT");
  }
  return { env: config.stage === "development" ? config.developmentEnvironmentId : config.productionEnvironmentId,
    appId: config.appId };
}

export class CloudBaseIdentityProvider implements TrustedIdentityProvider {
  constructor(private readonly sdk: CloudIdentitySdk, private readonly expectedAppId: string) {
    if (!expectedAppId) throw new RuntimeError("INVALID_ARGUMENT");
  }

  current(): TrustedIdentity {
    try {
      const context = this.sdk.getWXContext();
      if (typeof context.OPENID !== "string" || !context.OPENID || context.APPID !== this.expectedAppId) {
        throw new RuntimeError("UNAUTHENTICATED");
      }
      return { subject: context.OPENID, appId: this.expectedAppId };
    } catch {
      throw new RuntimeError("UNAUTHENTICATED");
    }
  }
}

function decodeDocument(data: unknown): JsonObject | null {
  if (data === null || data === undefined) return null;
  // SDK _id is an envelope field, never an application-controlled metadata field.
  if (typeof data !== "object" || Array.isArray(data)) throw new RuntimeError("DATABASE_UNAVAILABLE");
  const { _id: ignored, ...value } = data as Record<string, unknown>;
  return cloneDocument(value as JsonObject);
}

export class CloudBaseMetadataStore implements MetadataStore {
  constructor(private readonly database: CloudDatabase,
    /** Match only the deployed SDK's verified missing-document code, never all errors. */
    private readonly isMissingDocument: (error: unknown) => boolean = () => false) {}

  private async read<T extends JsonObject>(source: CloudTransaction, collection: string, id: string): Promise<T | null> {
    assertKey(collection); assertKey(id);
    try {
      return decodeDocument((await source.collection(collection).doc(id).get()).data) as T | null;
    } catch (error) {
      if (this.isMissingDocument(error)) return null;
      throw new RuntimeError("DATABASE_UNAVAILABLE");
    }
  }

  get<T extends JsonObject>(collection: string, id: string): Promise<T | null> {
    return this.read(this.database, collection, id);
  }

  async list<T extends JsonObject>(collection: string, options?: ListOptions): Promise<StoredDocument<T>[]> {
    assertKey(collection);
    const { where, limit, afterId } = validateList(options);
    try {
      const filter: Record<string, unknown> = { ...where };
      if (afterId !== undefined) filter._id = this.database.command.gt(afterId);
      const response = await this.database.collection(collection).where(filter).orderBy("_id", "asc").limit(limit).get();
      if (!Array.isArray(response.data)) throw new RuntimeError("DATABASE_UNAVAILABLE");
      return response.data.map(item => {
        if (!item || typeof item._id !== "string") throw new RuntimeError("DATABASE_UNAVAILABLE");
        assertKey(item._id);
        const value = decodeDocument(item);
        if (value === null) throw new RuntimeError("DATABASE_UNAVAILABLE");
        return { id: item._id, value: value as T };
      });
    } catch {
      throw new RuntimeError("DATABASE_UNAVAILABLE");
    }
  }

  async transaction<T>(work: (transaction: MetadataTransaction) => Promise<T>): Promise<T> {
    let callbackFailed = false;
    let callbackError: unknown;
    try {
      return await this.database.runTransaction(async source => {
        callbackFailed = false;
        let open = true;
        const assertOpen = () => { if (!open) throw new RuntimeError("TRANSACTION_CLOSED"); };
        const set = async (collection: string, id: string, value: JsonObject) => {
          assertOpen(); assertKey(collection); assertKey(id);
          const data = cloneDocument(value);
          try { await source.collection(collection).doc(id).set({ data }); }
          catch { throw new RuntimeError("DATABASE_UNAVAILABLE"); }
        };
        try {
          return await work({
            get: <D extends JsonObject>(collection: string, id: string) => {
              assertOpen(); return this.read<D>(source, collection, id);
            },
            set,
            create: async (collection, id, value) => {
              assertOpen();
              if (await this.read(source, collection, id) !== null) throw new RuntimeError("ALREADY_EXISTS");
              await set(collection, id, value);
            },
            delete: async (collection, id) => {
              assertOpen(); assertKey(collection); assertKey(id);
              try { await source.collection(collection).doc(id).remove(); }
              catch { throw new RuntimeError("DATABASE_UNAVAILABLE"); }
            },
          });
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
          throw error;
        } finally { open = false; }
      });
    } catch (error) {
      if (callbackFailed) throw callbackError;
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("DATABASE_UNAVAILABLE");
    }
  }
}

/** Capability belongs only to trusted backend composition; there is no public URL API. */
export class CloudBasePrivateStorage implements PrivateStorage {
  constructor(private readonly sdk: CloudStorageSdk,
    /** Must be verified against the actual environment's uploaded file IDs before deployment. */
    private readonly fileIdForPath: (path: string) => string) {
    if (typeof fileIdForPath !== "function") throw new RuntimeError("INVALID_ARGUMENT");
  }

  resolve(path: string): string {
    assertStoragePath(path);
    try {
      const fileId = this.fileIdForPath(path);
      if (typeof fileId !== "string" || !fileId) throw new RuntimeError("STORAGE_UNAVAILABLE");
      return fileId;
    } catch { throw new RuntimeError("STORAGE_UNAVAILABLE"); }
  }

  async put(path: string, bytes: Uint8Array): Promise<string> {
    assertStoragePath(path);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new RuntimeError("INVALID_ARGUMENT");
    const expectedFileId = this.resolve(path);
    try {
      const result = await this.sdk.uploadFile({ cloudPath: path, fileContent: bytes });
      if (typeof result.fileID !== "string" || !result.fileID) throw new RuntimeError("STORAGE_UNAVAILABLE");
      if (result.fileID !== expectedFileId) {
        // A bad resolver is a deployment error. Remove this known uploaded artifact;
        // never claim recoverability for an ID that metadata cannot reconstruct.
        await this.remove(result.fileID);
        throw new RuntimeError("STORAGE_UNAVAILABLE");
      }
      return result.fileID;
    } catch { throw new RuntimeError("STORAGE_UNAVAILABLE"); }
  }

  async read(fileId: string): Promise<Uint8Array> {
    if (typeof fileId !== "string" || !fileId) throw new RuntimeError("INVALID_ARGUMENT");
    try {
      const result = await this.sdk.downloadFile({ fileID: fileId });
      if (!(result.fileContent instanceof Uint8Array) || result.fileContent.length === 0) {
        throw new RuntimeError("STORAGE_UNAVAILABLE");
      }
      return Uint8Array.from(result.fileContent);
    } catch { throw new RuntimeError("STORAGE_UNAVAILABLE"); }
  }

  async remove(fileId: string): Promise<void> {
    if (typeof fileId !== "string" || !fileId) throw new RuntimeError("INVALID_ARGUMENT");
    try {
      const result = await this.sdk.deleteFile({ fileList: [fileId] });
      const entry = result.fileList.find(file => file.fileID === fileId);
      if (!entry || entry.status !== 0) throw new RuntimeError("STORAGE_UNAVAILABLE");
    } catch { throw new RuntimeError("STORAGE_UNAVAILABLE"); }
  }
}
