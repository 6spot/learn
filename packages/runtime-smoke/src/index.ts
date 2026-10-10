import { buildPageGeometry, getDefaultPreset } from '../../paper-core/src/index.js';
import { probeRuntimeCapabilities } from './capabilities.js';
import type { RuntimeCapabilities } from './capabilities.js';
import { runTextFixture, TEMPLATE_IDS, TEXT_FIXTURES } from './fixtures.js';

export { probeRuntimeCapabilities, runTextFixture, TEMPLATE_IDS, TEXT_FIXTURES };
export type { RuntimeCapabilities };
export type SmokeCheck = Readonly<{
  id: string;
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
}>;
export type RuntimeSmokeReport = Readonly<{
  kind: 'synthetic-development-smoke';
  capabilities: RuntimeCapabilities;
  checks: readonly SmokeCheck[];
  resources: 'formal-font-metrics-and-renderers-not-connected';
  targetRuntimeVerified: false;
}>;

/** Summary contains counts and fixed failure codes only, never text/layout/error payloads. */
export function runRuntimeSmoke(): RuntimeSmokeReport {
  const capabilities = probeRuntimeCapabilities();
  const checks: SmokeCheck[] = [];
  for (const id of TEMPLATE_IDS) {
    try {
      const geometry = buildPageGeometry(getDefaultPreset(id));
      checks.push({ id: `geometry-${id}`, status: 'passed', detail: `${geometry.segments.length} segments` });
    } catch {
      checks.push({ id: `geometry-${id}`, status: 'failed', detail: 'GEOMETRY_FAILED' });
    }
  }
  for (const fixture of TEXT_FIXTURES) {
    if (!capabilities.textLayoutSupported && fixture.id !== 'essay-whitespace') {
      checks.push({ id: fixture.id, status: 'skipped', detail: 'TEXT_RUNTIME_UNSUPPORTED' });
      continue;
    }
    try {
      const layout = runTextFixture(fixture.id);
      checks.push({ id: fixture.id, status: 'passed', detail: `${layout.pages.length} pages; ${layout.mode}` });
    } catch {
      checks.push({ id: fixture.id, status: 'failed', detail: 'LAYOUT_FAILED' });
    }
  }
  return { kind: 'synthetic-development-smoke', capabilities, checks,
    resources: 'formal-font-metrics-and-renderers-not-connected', targetRuntimeVerified: false };
}
