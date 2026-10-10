import { PaperError } from './errors.js';

/** Version of the algorithm actually compiled into this package, independent of registry labels. */
export const PAPER_ENGINE_VERSION = 'learn-engine-dev.4';
export function assertExecutableEngine(version: string): void {
  if (version !== PAPER_ENGINE_VERSION) throw new PaperError('UNSUPPORTED_VERSION', { field: 'versions' });
}
