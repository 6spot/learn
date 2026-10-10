import { createNativeFontLoader, type FontPlatform } from './font-loader.js';
import { EditorSession } from './editor-session.js';
import { createCloudClient, type CloudPlatform, type CloudClientConfig } from './cloud-client.js';
import { SERVICE_CONFIG } from './service-config.js';
import { CompatibilityPresets } from './compatibility-presets.js';
import { CompatibilitySession, type UpdatePlatform } from './compatibility-session.js';
import { GenerationSession, type GenerationPlatform } from './generation-session.js';
import { secureUuidV4 } from './secure-random.js';
declare function getCurrentPages(): { route: string }[];
type GenerationRoute = 'pages/editor/index' | 'pages/preview/index';
export interface GenerationNavigation {
  onShow(): void;
  onHide(): void;
  showPage(route: GenerationRoute): () => void;
}

/** One application composition; source defaults keep deployment unavailable. */
export function createEditorEnvironment(platform: FontPlatform & CloudPlatform & UpdatePlatform & GenerationPlatform,
  config: CloudClientConfig | null = SERVICE_CONFIG) {
  const client = createCloudClient(platform, config);
  const presets = new CompatibilityPresets(config === null);
  const fonts = createNativeFontLoader(platform, presets.fontUrls);
  const editor = new EditorSession({ presetFor: id => presets.presetFor(id), loadFonts: ids => fonts.load(ids) });
  const compatibility = new CompatibilitySession(client, editor, presets, platform, () => fonts.clear());
  let foreground = false, visiblePage: { route: GenerationRoute } | null = null;
  const generationNavigation: GenerationNavigation = {
    onShow() { foreground = true; },
    onHide() { foreground = false; visiblePage = null; },
    showPage(route) {
      const token = { route }; visiblePage = token;
      return () => { if (visiblePage === token) visiblePage = null; };
    },
  };
  const generation = new GenerationSession({ client, editor, canGenerate: () => compatibility.view.canGenerate,
    secureUuid: () => secureUuidV4(platform), waitTimeoutMs: 15000,
    onJobKnown(jobId) {
      const pages = getCurrentPages(), route = pages[pages.length - 1]?.route;
      if (!foreground || !visiblePage || route !== visiblePage.route) throw new Error('GENERATION_PAGE_HIDDEN');
      return new Promise<void>((resolve, reject) => {
        platform.navigateTo({ url: `/pages/records/detail?jobId=${encodeURIComponent(jobId)}`,
          success: resolve, fail: () => reject(new Error('GENERATION_NAVIGATION_FAILED')) });
      });
    },
  });
  const cleanups = new Set<() => void>();
  return { client, editor, compatibility, generation, generationNavigation,
    registerUserDataCleanup(callback: () => void): () => void {
      cleanups.add(callback); return () => { cleanups.delete(callback); };
    },
    clearUserData(): void {
      // Cancel callbacks first. Other sessions add synchronous invalidation here;
      // cloud tasks already accepted continue independently of local state.
      let failed = false;
      for (const cleanup of [() => generation.clear(), () => compatibility.clearUserData(), () => editor.clear(), () => fonts.clear(), ...cleanups]) {
        try { cleanup(); } catch { failed = true; } // Every local owner must still get its cleanup attempt.
      }
      if (failed) throw new Error('LOCAL_DATA_CLEAR_FAILED');
    },
  };
}
