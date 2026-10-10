import { createFontMetricsProvider, FONT_BUNDLE_VERSION, FONT_RESOURCES } from '../../packages/font-metrics/dist/index.js';
import { ServiceError } from '../../packages/cloud-service/dist/index.js';

/** Trusted deployment URLs only. Downloaded bytes are bounded and hash-pinned. */
export function createHostedFonts(urls, crypto, timeoutMs, fetchBytes = globalThis.fetch) {
  const locations = Object.freeze({ ...urls });
  const cache = new Map();
  let provider;
  const resources = Object.freeze({
    async describeBundle(version) {
      if (version !== FONT_BUNDLE_VERSION) return null;
      return { fontBundleVersion: version, fonts: FONT_RESOURCES.map(font => ({ ...font, location: locations[font.id] })) };
    },
    async readFontBytes(id, version) {
      const font = FONT_RESOURCES.find(item => item.id === id);
      if (version !== FONT_BUNDLE_VERSION || !font || !locations[id]) throw new ServiceError('RESOURCE_UNAVAILABLE');
      if (!cache.has(id)) {
        const loading = (async () => {
          const controller = new AbortController();
          let reader;
          let timer;
          const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new ServiceError('RESOURCE_UNAVAILABLE')); }, timeoutMs);
          });
          const download = async () => {
            const response = await fetchBytes(locations[id], { redirect: 'error', signal: controller.signal });
            if (controller.signal.aborted) throw new ServiceError('RESOURCE_UNAVAILABLE');
            if (!response.ok || !response.body) throw new ServiceError('RESOURCE_UNAVAILABLE');
            reader = response.body.getReader();
            const bytes = new Uint8Array(font.bytes);
            let offset = 0;
            for (;;) {
              const part = await reader.read();
              if (controller.signal.aborted) throw new ServiceError('RESOURCE_UNAVAILABLE');
              if (part.done) break;
              if (!(part.value instanceof Uint8Array) || part.value.length > bytes.length - offset) throw new ServiceError('RESOURCE_UNAVAILABLE');
              bytes.set(part.value, offset); offset += part.value.length;
            }
            if (offset !== font.bytes || await crypto.sha256(bytes) !== font.sha256) throw new ServiceError('RESOURCE_UNAVAILABLE');
            return bytes;
          };
          try {
            return await Promise.race([download(), deadline]);
          } catch { throw new ServiceError('RESOURCE_UNAVAILABLE'); }
          finally {
            clearTimeout(timer);
            controller.abort();
            // Cancellation is best effort; a broken provider must not extend the deadline.
            if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
          }
        })();
        cache.set(id, loading);
        loading.catch(() => { if (cache.get(id) === loading) cache.delete(id); });
      }
      return new Uint8Array(await cache.get(id));
    },
  });
  return {
    resources,
    async loadMetrics(preset) {
      if (preset.versions.fontBundleVersion !== FONT_BUNDLE_VERSION) throw new ServiceError('RESOURCE_UNAVAILABLE');
      if (!provider) {
        provider = Promise.all(FONT_RESOURCES.map(async font =>
          [font.id, await resources.readFontBytes(font.id, FONT_BUNDLE_VERSION)]))
          .then(entries => createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: Object.fromEntries(entries) }))
          .catch(() => { provider = undefined; throw new ServiceError('RESOURCE_UNAVAILABLE'); });
      }
      return await provider;
    },
  };
}
