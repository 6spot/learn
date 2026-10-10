import { canvasDimensions, CanvasRenderError, renderPaperPage,
  type CanvasRenderResult, type CanvasSurface, type OutlineProvider } from '../../../packages/canvas-renderer/dist/index.js';
import type { PaperLayout } from '../../../packages/paper-core/dist/contracts.js';

export interface PaperCanvasRequest {
  layout: PaperLayout; fonts: OutlineProvider | null; pageIndex: number; widthPx: number; zoom?: number;
}
export interface PaperCanvasHandle {
  display(request: PaperCanvasRequest): Promise<CanvasRenderResult | null>;
  clear(): void;
}
interface Instance {
  setData(data: Record<string, unknown>, done?: () => void): void;
  triggerEvent(name: string, data: unknown): void;
  createSelectorQuery(): { select(selector: string): {
    fields(options: { node: true; size: true }, callback: (value: { node?: CanvasSurface } | null) => void): { exec(): void };
  } };
}
declare const wx: { getWindowInfo(): { pixelRatio: number } };
declare function Component(options: {
  data: Record<string, unknown>;
  lifetimes: { attached(this: Instance): void; detached(this: Instance): void };
  methods: { display(this: Instance, request: PaperCanvasRequest): Promise<CanvasRenderResult | null>; clear(this: Instance): void };
}): void;
type State = { revision: number; active: boolean; canvas: CanvasSurface | null; cancelPending: (() => void) | null };
const states = new WeakMap<Instance, State>();

Component({
  data: { cssWidth: 1, cssHeight: 1, status: 'empty', message: '' },
  lifetimes: {
    attached() { states.set(this, { revision: 0, active: true, canvas: null, cancelPending: null }); },
    detached() {
      const state = states.get(this);
      if (state) { state.active = false; state.revision++; state.cancelPending?.(); if (state.canvas) { state.canvas.width = 1; state.canvas.height = 1; } state.canvas = null; }
      states.delete(this);
    },
  },
  methods: {
    async display(request) {
      const state = states.get(this);
      if (!state?.active) return null;
      const revision = ++state.revision;
      state.cancelPending?.();
      this.setData({ status: 'loading', message: '正在绘制预览' });
      try {
        const page = request.layout.pages[request.pageIndex];
        if (!page) throw new CanvasRenderError('CANVAS_PAGE_OUT_OF_RANGE');
        const view = { widthPx: request.widthPx, pixelRatio: wx.getWindowInfo().pixelRatio, zoom: request.zoom ?? 1 };
        const size = canvasDimensions(page.geometry.page.width, page.geometry.page.height, view);
        const canvas = await new Promise<CanvasSurface | null>(resolve => {
          let settled = false;
          const finish = (value: CanvasSurface | null) => {
            if (settled) return;
            settled = true;
            if (state.cancelPending === cancel) state.cancelPending = null;
            resolve(value);
          };
          const cancel = () => finish(null);
          state.cancelPending = cancel;
          this.setData({ cssWidth: size.cssWidth, cssHeight: size.cssHeight }, () => {
            if (!state.active || revision !== state.revision) { finish(null); return; }
            try {
              this.createSelectorQuery().select('#paper').fields({ node: true, size: true }, value => finish(value?.node ?? null)).exec();
            } catch { finish(null); }
          });
        });
        if (!state.active || revision !== state.revision) return null;
        if (!canvas) throw new CanvasRenderError('CANVAS_UNSUPPORTED_API');
        state.canvas = canvas;
        const result = renderPaperPage(canvas, request.layout, request.pageIndex, request.fonts, view);
        this.setData({ status: 'ready', message: '' });
        this.triggerEvent('rendered', result);
        return result;
      } catch (error) {
        if (!state.active || revision !== state.revision) return null;
        state.cancelPending?.();
        if (state.canvas) { state.canvas.width = 1; state.canvas.height = 1; }
        const code = error instanceof CanvasRenderError ? error.code : 'CANVAS_RESOURCE_MISSING';
        this.setData({ status: 'error', message: '预览未能完成，请重试' });
        this.triggerEvent('rendererror', { code });
        return null;
      }
    },
    clear() {
      const state = states.get(this);
      if (!state) return;
      state.revision++;
      state.cancelPending?.();
      if (state.canvas) { state.canvas.width = 1; state.canvas.height = 1; }
      state.canvas = null;
      this.setData({ status: 'empty', message: '', cssWidth: 1, cssHeight: 1 });
    },
  },
});
