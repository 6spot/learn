import { readFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutPaperDocument } from '../../paper-core/dist/index.js';
import { createFontMetricsProvider, FONT_BUNDLE_VERSION } from '../../font-metrics/dist/index.js';

export const repository = new URL('../../../', import.meta.url);
export const manifest = JSON.parse(readFileSync(new URL('assets/fonts/manifest.json', repository)));
export const originalFonts = Object.fromEntries(manifest.fonts.map(font => [font.id,
  new Uint8Array(readFileSync(new URL(`assets/fonts/${font.path}`, repository)))]));
export const provider = createFontMetricsProvider({ fontBundleVersion: FONT_BUNDLE_VERSION, fonts: originalFonts });
export const templateIds = ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'];
export function sampleInput(templateId, mode = 'filled') {
  if (mode === 'blank') return { templateId };
  return { templateId, tracing: mode === 'tracing',
    title: templateId === 'pinyin-lines' ? 'Pīn yīn' : '学习记录',
    body: templateId === 'pinyin-lines'
      ? "nǐ hǎo xi'an u\u0308\u0304\nĀ Á Ǎ À Ǖ Ǘ Ǚ Ǜ Ǹ Ê\u0301\nb p m f g j q y\n".repeat(5)
      : '春夏秋冬，学习记录。\n'.repeat(28) + '你好 AV 3.14 e\u0301cole nǚ\n',
  };
}
export const prepare = (templateId, input = {}) => createPaperDocument({ templateId, ...input }, getDevelopmentPreset(templateId));
export const layoutFor = (templateId, input = {}) => layoutPaperDocument(prepare(templateId, input), provider);
