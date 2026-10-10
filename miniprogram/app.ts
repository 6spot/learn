import { createEditorEnvironment } from './lib/editor-environment.js';
import type { FontPlatform } from './lib/font-loader.js';
import type { LearnApplication } from './lib/application.js';
declare const wx: FontPlatform;
declare function App(options: { onLaunch(this: LearnApplication): void }): void;
// A single owner is essential: native TS entry points are bundled separately.
// T19 adds shared compatibility/update state here; T20 supplies real submission.
App({ onLaunch() { Object.assign(this, createEditorEnvironment(wx)); } });
