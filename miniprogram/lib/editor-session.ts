import { createLayoutDigest, createPaperDocument, getDefaultTextOptions, layoutPaperDocument } from '../../packages/paper-core/src/index.js';
import type { PaperInput, PaperLayout, PaperUserOptions, TrustedPaperPreset } from '../../packages/paper-core/src/contracts.js';
import type { TemplateId } from '../../packages/paper-core/src/types.js';
import type { FontMetricsProvider } from '../../packages/paper-core/src/font-metrics.js';
import type { FontId, OriginalFontMetricsProvider } from '../../packages/font-metrics/dist/index.js';
import { cleanBodyNewlines } from './text-cleanup.js';

export type EditorDraft = Readonly<{ templateId: TemplateId; title: string; body: string; tracing: boolean; options: PaperUserOptions }>;
export type CleanupPreview = Readonly<{ bodyRevision: number; before: string; after: string; changed: boolean }>;
export type EditorPreview = Readonly<{ revision: number; input: PaperInput; layout: PaperLayout;
  fonts: OriginalFontMetricsProvider | null; digest: string }>;
export interface EditorDependencies {
  presetFor(templateId: TemplateId): TrustedPaperPreset;
  loadFonts(ids: readonly FontId[]): Promise<OriginalFontMetricsProvider>;
}
export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
export function previewErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (typeof code === 'string' && /FONT|PREVIEW_FONT/.test(code)) return '预览字体加载失败，请重试';
  if (code === 'INPUT_LIMIT_EXCEEDED' || code === 'PAGE_LIMIT_EXCEEDED') return '文字过长，请减少内容后重试';
  if (code === 'UNSUPPORTED_TEXT' || code === 'MISSING_GLYPH') return '部分文字暂不支持，请调整内容后重试';
  if (code === 'GLYPH_OUT_OF_BOUNDS') return '部分文字超出纸张可用范围，请调整内容后重试';
  return '预览暂不可用，请重试';
}
function blankMetrics(preset: TrustedPaperPreset): FontMetricsProvider {
  return { fontBundleVersion: preset.versions.fontBundleVersion, shape() { throw new Error('Blank layout must not shape text'); } };
}
export function createBlankLayout(preset: TrustedPaperPreset): PaperLayout {
  return layoutPaperDocument(createPaperDocument({ templateId: preset.versions.templateId }, preset), blankMetrics(preset));
}

/** Owned once by App. No storage/logging/native APIs and no module singleton. */
export class EditorSession {
  private draftValue: EditorDraft;
  private presetValue: TrustedPaperPreset;
  private revisionValue = 0;
  private bodyRevision = 0;
  private listeners = new Set<() => void>();
  private pending: { revision: number; promise: Promise<EditorPreview | null> } | null = null;
  private previewValue: EditorPreview | null = null;
  private statusValue: PreviewStatus = 'idle';
  private messageValue = '';
  private cleanupValue: CleanupPreview | null = null;
  private undoValue: { before: string; after: string; bodyRevision: number } | null = null;
  constructor(private readonly dependencies: EditorDependencies, templateId: TemplateId = 'essay-grid') {
    this.presetValue = this.lockPreset(templateId);
    this.draftValue = Object.freeze({ templateId, title: '', body: '', tracing: false,
      options: getDefaultTextOptions(this.presetValue) });
  }
  private lockPreset(id: TemplateId): TrustedPaperPreset {
    return createPaperDocument({ templateId: id }, this.dependencies.presetFor(id)).preset;
  }
  get draft(): EditorDraft { return this.draftValue; }
  get preset(): TrustedPaperPreset { return this.presetValue; }
  get revision(): number { return this.revisionValue; }
  get preview(): EditorPreview | null { return this.previewValue; }
  get status(): PreviewStatus { return this.statusValue; }
  get message(): string { return this.messageValue; }
  get cleanup(): CleanupPreview | null { return this.cleanupValue; }
  get canUndo(): boolean { return this.undoValue !== null; }
  get hasInput(): boolean { return this.draftValue.title.length > 0 || this.draftValue.body.length > 0; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private changed(): void {
    this.revisionValue++; this.previewValue = null; this.statusValue = 'idle'; this.messageValue = ''; this.emit();
  }
  selectTemplate(templateId: TemplateId): void {
    if (templateId === this.draftValue.templateId) return; // Keep the version locked while editing.
    const preset = this.lockPreset(templateId);
    this.presetValue = preset;
    this.draftValue = Object.freeze({ ...this.draftValue, templateId }); this.changed();
  }
  reloadPreset(): void {
    this.presetValue = this.lockPreset(this.draftValue.templateId); this.changed();
  }
  blankLayout(templateId: TemplateId): PaperLayout { return createBlankLayout(this.dependencies.presetFor(templateId)); }
  setTitle(title: string): void {
    if (title === this.draftValue.title) return;
    this.draftValue = Object.freeze({ ...this.draftValue, title }); this.changed();
  }
  setBody(body: string): void {
    if (body === this.draftValue.body) return;
    this.bodyRevision++; this.undoValue = null;
    this.draftValue = Object.freeze({ ...this.draftValue, body }); this.changed();
  }
  setTracing(tracing: boolean): void {
    if (tracing === this.draftValue.tracing) return;
    this.draftValue = Object.freeze({ ...this.draftValue, tracing }); this.changed();
  }
  setOptions(options: PaperUserOptions): void {
    this.draftValue = Object.freeze({ ...this.draftValue, options: Object.freeze({ ...this.draftValue.options, ...options }) }); this.changed();
  }
  resetOptions(): void {
    this.draftValue = Object.freeze({ ...this.draftValue, options: getDefaultTextOptions(this.presetValue) }); this.changed();
  }
  prepareCleanup(): CleanupPreview {
    const before = this.draftValue.body, after = cleanBodyNewlines(before);
    this.cleanupValue = Object.freeze({ bodyRevision: this.bodyRevision, before, after, changed: before !== after });
    this.emit(); return this.cleanupValue;
  }
  cancelCleanup(): void { this.cleanupValue = null; this.emit(); }
  applyCleanup(): 'applied' | 'unchanged' | 'stale' {
    const preview = this.cleanupValue;
    if (!preview) return 'unchanged';
    if (preview.bodyRevision !== this.bodyRevision || preview.before !== this.draftValue.body) {
      this.cleanupValue = null; this.emit(); return 'stale';
    }
    if (!preview.changed) return 'unchanged';
    this.bodyRevision++;
    this.undoValue = { before: preview.before, after: preview.after, bodyRevision: this.bodyRevision };
    this.draftValue = Object.freeze({ ...this.draftValue, body: preview.after });
    this.cleanupValue = null; this.changed(); return 'applied';
  }
  undoCleanup(): boolean {
    const undo = this.undoValue;
    if (!undo || undo.bodyRevision !== this.bodyRevision || undo.after !== this.draftValue.body) return false;
    this.bodyRevision++; this.draftValue = Object.freeze({ ...this.draftValue, body: undo.before });
    this.undoValue = null; this.cleanupValue = null; this.changed(); return true;
  }
  preparePreview(): Promise<EditorPreview | null> {
    if (this.previewValue?.revision === this.revisionValue) return Promise.resolve(this.previewValue);
    if (this.pending?.revision === this.revisionValue) return this.pending.promise;
    const revision = this.revisionValue, input = this.draftValue, preset = this.presetValue;
    this.statusValue = 'loading'; this.messageValue = ''; this.emit();
    const promise = (async () => {
      try {
        const document = createPaperDocument(input, preset);
        let fonts: OriginalFontMetricsProvider | null = null;
        if (document.mode !== 'blank') {
          const ids = new Set<FontId>([preset.textStyles.title.canonicalFontId as FontId, preset.textStyles.body.canonicalFontId as FontId]);
          if (document.mode === 'tracing') {
            ids.add(preset.textStyles.title.tracingHanFontId as FontId); ids.add(preset.textStyles.body.tracingHanFontId as FontId);
          }
          fonts = await this.dependencies.loadFonts([...ids]);
        }
        if (revision !== this.revisionValue) return null;
        const layout = layoutPaperDocument(document, fonts ?? blankMetrics(preset));
        const preview = Object.freeze({ revision, input, layout, fonts, digest: createLayoutDigest(layout) });
        this.previewValue = preview; this.statusValue = 'ready'; this.messageValue = ''; this.emit();
        return preview;
      } catch (error) {
        if (revision !== this.revisionValue) return null;
        this.previewValue = null; this.statusValue = 'error'; this.messageValue = previewErrorMessage(error); this.emit();
        return null;
      }
    })();
    this.pending = { revision, promise };
    void promise.then(() => { if (this.pending?.promise === promise) this.pending = null; });
    return promise;
  }
}
