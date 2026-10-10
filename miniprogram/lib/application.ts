import type { EditorSession } from './editor-session.js';
import type { CloudClient } from './cloud-client.js';
import type { CompatibilitySession } from './compatibility-session.js';
import type { GenerationSession } from './generation-session.js';
import type { RecordEnvironment } from './record-environment.js';
import type { GenerationNavigation } from './editor-environment.js';
export interface LearnApplication {
  client: CloudClient;
  editor: EditorSession;
  compatibility: CompatibilitySession;
  records: RecordEnvironment;
  generation: GenerationSession;
  generationNavigation: GenerationNavigation;
  clearUserData(): void;
  /** Register synchronous cancellation/clearing for T20 request and T21 file owners. */
  registerUserDataCleanup(callback: () => void): () => void;
}
declare function getApp<T>(): T;
/** App owns the instance across separately bundled native page entry points. */
export function getLearnApp(): LearnApplication { return getApp<LearnApplication>(); }
