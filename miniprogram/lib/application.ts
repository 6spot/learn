import type { EditorSession } from './editor-session.js';
export interface LearnApplication {
  editor: EditorSession;
  generation: { available: boolean; message: string };
}
declare function getApp<T>(): T;
/** App owns the instance across separately bundled native page entry points. */
export function getLearnApp(): LearnApplication { return getApp<LearnApplication>(); }
