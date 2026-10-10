export type PaperErrorCode =
  | 'INVALID_INPUT' | 'UNKNOWN_FIELD' | 'INPUT_LIMIT_EXCEEDED' | 'INVALID_UNICODE'
  | 'UNSUPPORTED_CONTROL' | 'INVALID_PRESET' | 'VERSION_MISMATCH' | 'FONT_RESOURCE_MISSING'
  | 'FONT_INTEGRITY_FAILED' | 'MISSING_GLYPH' | 'INVALID_FONT_METRICS'
  | 'INVALID_LAYOUT' | 'UNSUPPORTED_VERSION' | 'LAYOUT_DIGEST_INVALID' | 'LAYOUT_DIGEST_MISMATCH'
  | 'GLYPH_OUT_OF_BOUNDS' | 'PAGE_LIMIT_EXCEEDED' | 'UNSUPPORTED_TEXT' | 'INTERNAL_LAYOUT_ERROR';
export type PaperErrorDetails = Readonly<{
  field?: 'input' | 'templateId' | 'title' | 'body' | 'tracing' | 'options' | 'titleAlign' | 'bodyIndent' | 'preset' | 'versions' | 'font' | 'layout';
  block?: 'title' | 'body';
  offset?: number;
  limit?: number;
}>;

/** Fixed messages and scalar locations only: never attach text, layout or raw provider errors. */
export class PaperError extends Error {
  readonly code: PaperErrorCode;
  readonly details: PaperErrorDetails;
  constructor(code: PaperErrorCode, details: PaperErrorDetails = {}) {
    super(code);
    this.name = 'PaperError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
  toJSON(): Readonly<{ code: PaperErrorCode; details: PaperErrorDetails }> {
    return { code: this.code, details: this.details };
  }
}

export function safePaperFailure(error: unknown): ReturnType<PaperError['toJSON']> {
  return error instanceof PaperError ? error.toJSON() : new PaperError('INTERNAL_LAYOUT_ERROR').toJSON();
}
