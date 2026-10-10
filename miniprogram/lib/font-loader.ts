import { createFontMetricsProvider, FONT_BUNDLE_VERSION, FONT_RESOURCES,
  type FontId, type OriginalFontMetricsProvider } from '../../packages/font-metrics/dist/index.js';
import { PREVIEW_FONT_URLS } from './font-sources.js';

export interface FontFileSystem {
  readFile(options: { filePath: string; success(result: { data: ArrayBuffer | string }): void; fail(): void }): void;
  writeFile(options: { filePath: string; data: ArrayBuffer; success(): void; fail(): void }): void;
  mkdirSync(path: string, recursive: boolean): void;
  unlinkSync(path: string): void;
}
export interface FontPlatform {
  env: { USER_DATA_PATH: string };
  getFileSystemManager(): FontFileSystem;
  downloadFile(options: { url: string; timeout: number;
    success(result: { statusCode: number; tempFilePath: string }): void; fail(): void }): void;
}
declare const wx: FontPlatform;

export class PreviewFontError extends Error {
  constructor(readonly code: 'PREVIEW_FONT_UNAVAILABLE' | 'PREVIEW_FONT_INVALID' | 'PREVIEW_FONT_CONFIGURATION') {
    super(code); this.name = 'PreviewFontError';
  }
}

/** One most-recent provider and one promise per requested font set. No text,
 * outlines or layout snapshots are persisted. File identities are trusted SHA256s. */
export function createNativeFontLoader(platform: FontPlatform,
  urls: Readonly<Partial<Record<FontId, string>>> = PREVIEW_FONT_URLS) {
  let current: OriginalFontMetricsProvider | null = null;
  let revision = 0;
  const inflight = new Map<string, Promise<OriginalFontMetricsProvider>>();
  const fs = platform.getFileSystemManager();
  const directory = `${platform.env.USER_DATA_PATH}/learn-fonts`;
  const read = (filePath: string): Promise<Uint8Array> => new Promise((resolve, reject) => {
    fs.readFile({ filePath, success: result => {
      if (Object.prototype.toString.call(result.data) !== '[object ArrayBuffer]') reject(new PreviewFontError('PREVIEW_FONT_INVALID'));
      else resolve(new Uint8Array(result.data as ArrayBuffer));
    }, fail: () => reject(new PreviewFontError('PREVIEW_FONT_UNAVAILABLE')) });
  });
  const remove = (path: string) => { try { fs.unlinkSync(path); } catch { /* absent or unavailable cache */ } };

  return {
    load(fontIds: readonly FontId[]): Promise<OriginalFontMetricsProvider> {
      const ids = [...new Set(fontIds)].sort();
      if (!ids.length || ids.some(id => !FONT_RESOURCES.some(resource => resource.id === id))) {
        return Promise.reject(new PreviewFontError('PREVIEW_FONT_CONFIGURATION'));
      }
      if (current && ids.every(id => current!.hasFont(id))) return Promise.resolve(current);
      const key = ids.join(',');
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = ++revision;
      // Drop our old provider reference before parsing another large font set.
      // A displayed component keeps only the provider it is actively using.
      current = null;
      const work = (async () => {
        const entries = await Promise.all(ids.map(async id => {
          const resource = FONT_RESOURCES.find(item => item.id === id)!;
          const path = `${directory}/${resource.sha256}.ttf`;
          try { return { id, path, bytes: await read(path), downloaded: false }; }
          catch { /* A missing cache may be resolved by trusted deployment URLs. */ }
          const url = urls[id];
          if (!url) throw new PreviewFontError('PREVIEW_FONT_UNAVAILABLE');
          if (!/^https:\/\/[^/?#\s]+(?:\/[^\s]*)?$/.test(url)) throw new PreviewFontError('PREVIEW_FONT_CONFIGURATION');
          const temporary = await new Promise<string>((resolve, reject) => {
            platform.downloadFile({ url, timeout: 30000,
              success: result => result.statusCode === 200 && result.tempFilePath
                ? resolve(result.tempFilePath) : reject(new PreviewFontError('PREVIEW_FONT_UNAVAILABLE')),
              fail: () => reject(new PreviewFontError('PREVIEW_FONT_UNAVAILABLE')) });
          });
          try { return { id, path, bytes: await read(temporary), downloaded: true }; }
          finally { remove(temporary); }
        }));
        let provider: OriginalFontMetricsProvider;
        try {
          provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION,
            fonts: Object.fromEntries(entries.map(item => [item.id, item.bytes])) });
        } catch {
          // Corrupt cached files must not poison every subsequent retry.
          for (const item of entries) remove(item.path);
          throw new PreviewFontError('PREVIEW_FONT_INVALID');
        }
        try { fs.mkdirSync(directory, true); } catch { /* existing directory; cache is optional */ }
        for (const item of entries.filter(entry => entry.downloaded)) {
          await new Promise<void>(resolve => {
            try { fs.writeFile({ filePath: item.path,
              data: item.bytes.buffer as ArrayBuffer, success: resolve, fail: resolve }); }
            catch { resolve(); } // Optional persistence must not discard verified in-memory fonts.
          });
        }
        if (request === revision) current = provider;
        return provider;
      })();
      inflight.set(key, work);
      void work.then(() => inflight.delete(key), () => inflight.delete(key));
      return work;
    },
    clear(): void { current = null; revision++; },
  };
}
let loader: ReturnType<typeof createNativeFontLoader> | undefined;
export function loadPreviewFonts(fontIds: readonly FontId[]): Promise<OriginalFontMetricsProvider> {
  loader ??= createNativeFontLoader(wx);
  return loader.load(fontIds);
}
export function releasePreviewFonts(): void { loader?.clear(); }
