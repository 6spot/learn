import { createLayoutDigest, createPaperDocument, layoutPaperDocument,
  type FontMetricsProvider, type TrustedPaperPreset } from '@learn/paper-core';
import type { GenerationPreparer } from './contracts.js';

/** The deployment loads verified font bytes; all actual layout/digest logic is shared core. */
export function createPaperPreparer(loadMetrics: (preset: TrustedPaperPreset) => Promise<FontMetricsProvider>): GenerationPreparer {
  return {
    async prepare(input, preset) {
      const document = createPaperDocument(input, preset);
      const metrics = await loadMetrics(document.preset);
      const layout = layoutPaperDocument(document, metrics);
      return { layout, digest: createLayoutDigest(layout) };
    },
  };
}
