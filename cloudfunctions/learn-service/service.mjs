import { CloudService, createGenerationExecutor, createPaperPreparer } from '../../packages/cloud-service/dist/index.js';
import { renderPdf } from '../../packages/pdf-renderer/dist/index.js';
import { createCloudRuntime } from '../runtime-example/index.mjs';
import { readDeployment } from './config.mjs';
import { createHostedFonts } from './resources.mjs';

export function createProductionService(sdk, environment, fetchBytes = globalThis.fetch) {
  const { config, crypto } = readDeployment(environment);
  const runtime = createCloudRuntime(sdk, config.runtime);
  const fonts = createHostedFonts(config.fontUrls, crypto, config.fontFetchTimeoutMs, fetchBytes);
  const renderer = {
    async render(execution, { maxOutputBytes }) {
      return await renderPdf(execution.layout, await fonts.loadMetrics(execution.published.preset), { maxBytes: maxOutputBytes });
    },
  };
  const executor = createGenerationExecutor({ ...runtime, crypto, bridge: runtime.execution, renderer }, config.service);
  const service = new CloudService({ ...runtime, crypto, resources: fonts.resources,
    preparer: createPaperPreparer(fonts.loadMetrics), executor }, config.service);
  return { service, runtime, crypto, config };
}
