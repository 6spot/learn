export type PdfRenderErrorCode = 'PDF_INVALID_LAYOUT' | 'PDF_RESOURCE_MISSING' | 'PDF_RESOURCE_MISMATCH'
  | 'PDF_RESOURCE_LIMIT' | 'PDF_RENDER_FAILED';
export class PdfRenderError extends Error {
  constructor(readonly code: PdfRenderErrorCode) { super(code); this.name = 'PdfRenderError'; }
  toJSON() { return { code: this.code }; }
}
export const invalid = (): never => { throw new PdfRenderError('PDF_INVALID_LAYOUT'); };
