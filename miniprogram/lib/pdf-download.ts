import { sha256 } from '@noble/hashes/sha256';
import type { PdfInfo, PdfChunk } from '../../packages/cloud-service/dist/index.js';
import { CloudClientError } from './cloud-client.js';
export interface PdfDownloadClient {
  getPdfInfo(jobId: string): Promise<PdfInfo>;
  readPdfChunk(params: { jobId: string; offset: number }): Promise<PdfChunk>;
}
export interface PdfFileSystem {
  mkdirSync(path: string, recursive: boolean): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
  writeFile(options: { filePath: string; data: ArrayBuffer; success(): void; fail(): void }): void;
}
export interface PdfPlatform {
  env: { USER_DATA_PATH: string };
  getFileSystemManager(): PdfFileSystem;
  openDocument(options: { filePath: string; fileType: 'pdf'; showMenu: true; success(): void; fail(): void }): void;
}
const MAX_BYTES = 64 * 1024 * 1024;
const fail = (code = 'INVALID_RESPONSE'): never => { throw new CloudClientError(code); };

/** App-owned downloader. Only a complete hash-verified PDF reaches the viewer.
 * The user may explicitly save/share from the native viewer. App cache is bounded. */
export function createPdfDownloader(client: PdfDownloadClient, platform: PdfPlatform) {
  const directory = `${platform.env.USER_DATA_PATH}/learn-pdf`;
  const fs = platform.getFileSystemManager();
  let pending: { jobId: string; promise: Promise<void> } | null = null;
  let revision = 0;
  const remove = (path: string) => { try { fs.unlinkSync(path); } catch { /* missing or platform-busy temporary file */ } };
  const ownedFiles = (strict: boolean): string[] => {
    try { return fs.readdirSync(directory).filter(file => /^learn-[A-Za-z0-9_-]{1,128}\.pdf$/.test(file)); }
    catch {
      if (!strict) return [];
      // Confirm an absent directory through its parent instead of treating every
      // platform read failure as absence or matching provider error messages.
      try { if (!fs.readdirSync(platform.env.USER_DATA_PATH).includes('learn-pdf')) return []; } catch { /* unverified */ }
      return fail('LOCAL_CLEAR_FAILED');
    }
  };
  const purgeFiles = (strict = false) => {
    for (const file of ownedFiles(strict)) remove(`${directory}/${file}`);
    if (strict && ownedFiles(true).length) fail('LOCAL_CLEAR_FAILED');
  };
  const clearLocalFiles = () => {
    revision++; purgeFiles(true);
    // A platform write already in progress may finish later. Its cancelled
    // callback cleans up, but privacy must require a retry before claiming done.
    if (pending) fail('LOCAL_CLEAR_PENDING');
  };
  purgeFiles();
  return {
    clearLocalFiles,
    open(jobId: string, progress?: (received: number, total: number) => void): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return Promise.reject(new CloudClientError('INVALID_ARGUMENT'));
      if (pending) return pending.jobId === jobId ? pending.promise : Promise.reject(new CloudClientError('DOWNLOAD_IN_PROGRESS'));
      const currentRevision = revision;
      const active = () => { if (revision !== currentRevision) fail('DOWNLOAD_CANCELLED'); };
      const promise = (async () => {
        const info = await client.getPdfInfo(jobId);
        active();
        if (!info || info.jobId !== jobId || !Number.isSafeInteger(info.bytes) || info.bytes < 1 || info.bytes > MAX_BYTES ||
            !Number.isSafeInteger(info.chunkBytes) || info.chunkBytes < 1 || info.chunkBytes > 262144 ||
            !Number.isSafeInteger(info.pageCount) || info.pageCount < 1 || !Number.isSafeInteger(info.expiresAt) ||
            typeof info.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(info.sha256)) fail();
        const bytes = new Uint8Array(info.bytes);
        let offset = 0;
        progress?.(0, info.bytes);
        while (offset < bytes.length) {
          const chunk = await client.readPdfChunk({ jobId, offset });
          active();
          const expectedLength = Math.min(info.chunkBytes, info.bytes - offset), next = offset + expectedLength;
          if (!chunk || chunk.jobId !== jobId || chunk.offset !== offset || chunk.totalBytes !== info.bytes ||
              chunk.sha256 !== info.sha256 || chunk.expiresAt !== info.expiresAt || !(chunk.bytes instanceof Uint8Array) ||
              chunk.bytes.length !== expectedLength || chunk.nextOffset !== (next === info.bytes ? null : next)) fail();
          bytes.set(chunk.bytes, offset); offset = next; progress?.(offset, info.bytes);
        }
        const actual = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== info.sha256) fail('FILE_INVALID');
        const path = `${directory}/learn-${jobId}.pdf`;
        purgeFiles();
        try { fs.mkdirSync(directory, true); } catch { /* existing directory; write reports unavailable storage */ }
        try {
          await new Promise<void>((resolve, reject) => {
            try { fs.writeFile({ filePath: path, data: bytes.buffer, success: resolve, fail: () => reject(new CloudClientError('FILE_WRITE_FAILED')) }); }
            catch { reject(new CloudClientError('FILE_WRITE_FAILED')); }
          });
          active();
          await new Promise<void>((resolve, reject) => {
            try { platform.openDocument({ filePath: path, fileType: 'pdf', showMenu: true,
              success: resolve, fail: () => reject(new CloudClientError('FILE_OPEN_FAILED')) }); }
            catch { reject(new CloudClientError('FILE_OPEN_FAILED')); }
          });
        } catch (error) { remove(path); throw error; }
      })();
      pending = { jobId, promise };
      void promise.then(() => { pending = null; }, () => { pending = null; });
      return promise;
    },
  };
}
