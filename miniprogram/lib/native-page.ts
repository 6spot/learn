import type { PaperCanvasHandle } from '../components/paper-canvas/index.js';
export interface NativePage {
  setData(data: Record<string, unknown>, complete?: () => void): void;
  selectComponent(selector: string): PaperCanvasHandle | null;
}
export interface PagePlatform {
  getWindowInfo(): { windowWidth: number; windowHeight: number; pixelRatio: number };
  navigateTo(options: { url: string; fail?(): void; complete?(): void }): void;
  switchTab(options: { url: string }): void;
  setNavigationBarTitle(options: { title: string }): void;
  showToast(options: { title: string; icon: 'none' }): void;
}
export type TextInputEvent = { detail: { value: string } };
export type TemplateTap = { currentTarget: { dataset: { template: string } } };
