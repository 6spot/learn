import { getDevelopmentPreset } from '../../packages/paper-core/src/index.js';
import { createNativeFontLoader, type FontPlatform } from './font-loader.js';
import { EditorSession } from './editor-session.js';

/** Local development composition. Production preset/service injection is owned
 * by deployment composition; candidates never authorize a cloud submission. */
export function createEditorEnvironment(platform: FontPlatform) {
  const fonts = createNativeFontLoader(platform);
  return {
    editor: new EditorSession({ presetFor: getDevelopmentPreset, loadFonts: ids => fonts.load(ids) }),
    generation: { available: false, message: '生成服务暂不可用，可继续编辑和预览' },
  };
}
