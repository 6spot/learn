import { createNativeFontLoader, type FontPlatform } from './font-loader.js';
import { EditorSession } from './editor-session.js';
import { createCloudClient, type CloudPlatform, type CloudClientConfig } from './cloud-client.js';
import { SERVICE_CONFIG } from './service-config.js';
import { CompatibilityPresets } from './compatibility-presets.js';
import { CompatibilitySession, type UpdatePlatform } from './compatibility-session.js';

/** One application composition; source defaults keep deployment unavailable. */
export function createEditorEnvironment(platform: FontPlatform & CloudPlatform & UpdatePlatform,
  config: CloudClientConfig | null = SERVICE_CONFIG) {
  const client = createCloudClient(platform, config);
  const presets = new CompatibilityPresets(config === null);
  const fonts = createNativeFontLoader(platform, presets.fontUrls);
  const editor = new EditorSession({ presetFor: id => presets.presetFor(id), loadFonts: ids => fonts.load(ids) });
  const compatibility = new CompatibilitySession(client, editor, presets, platform, () => fonts.clear());
  // T20 will supply actual submission. Compatibility eligibility alone must not
  // enable the current placeholder generate handler.
  const generation = { available: false, message: compatibility.view.message };
  compatibility.subscribe(() => {
    generation.message = compatibility.view.message || '生成服务正在接入，可继续编辑和预览';
  });
  const cleanups = new Set<() => void>();
  return { client, editor, compatibility, generation,
    registerUserDataCleanup(callback: () => void): () => void {
      cleanups.add(callback); return () => { cleanups.delete(callback); };
    },
    clearUserData(): void {
      // Cancel callbacks first. Other sessions add synchronous invalidation here;
      // cloud tasks already accepted continue independently of local state.
      let failed = false;
      for (const cleanup of [() => compatibility.clearUserData(), () => editor.clear(), () => fonts.clear(), ...cleanups]) {
        try { cleanup(); } catch { failed = true; } // Every local owner must still get its cleanup attempt.
      }
      if (failed) throw new Error('LOCAL_DATA_CLEAR_FAILED');
    },
  };
}
