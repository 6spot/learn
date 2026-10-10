import { createEditorEnvironment } from './lib/editor-environment.js';
import { createRecordEnvironment } from './lib/record-environment.js';
import type { PdfPlatform } from './lib/pdf-download.js';
import type { GenerationPlatform } from './lib/generation-session.js';
import type { FontPlatform } from './lib/font-loader.js';
import type { CloudPlatform } from './lib/cloud-client.js';
import type { UpdatePlatform } from './lib/compatibility-session.js';
import type { LearnApplication } from './lib/application.js';
declare const wx: FontPlatform & CloudPlatform & UpdatePlatform & PdfPlatform & GenerationPlatform;
declare function setTimeout(callback: () => void, milliseconds: number): number;
declare function clearTimeout(id: number): void;
declare function App(options: { onLaunch(this: LearnApplication): void;
  onShow(this: LearnApplication): void; onHide(this: LearnApplication): void }): void;
App({
  onLaunch() {
    Object.assign(this, createEditorEnvironment(wx));
    this.records = createRecordEnvironment(this.client, wx, { setTimeout, clearTimeout }, () => this.clearUserData());
    this.registerUserDataCleanup(() => this.records.clearUserData());
    void this.compatibility.start();
  },
  onShow() { this.generationNavigation.onShow(); this.records.onShow(); void this.compatibility.onShow(); },
  onHide() { this.generationNavigation.onHide(); this.records.onHide(); this.compatibility.onHide(); },
});
