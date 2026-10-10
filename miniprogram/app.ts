import { createEditorEnvironment } from './lib/editor-environment.js';
import type { FontPlatform } from './lib/font-loader.js';
import type { CloudPlatform } from './lib/cloud-client.js';
import type { UpdatePlatform } from './lib/compatibility-session.js';
import type { LearnApplication } from './lib/application.js';
declare const wx: FontPlatform & CloudPlatform & UpdatePlatform;
declare function App(options: { onLaunch(this: LearnApplication): void;
  onShow(this: LearnApplication): void; onHide(this: LearnApplication): void }): void;
App({
  onLaunch() { Object.assign(this, createEditorEnvironment(wx)); void this.compatibility.start(); },
  onShow() { void this.compatibility.onShow(); },
  onHide() { this.compatibility.onHide(); },
});
