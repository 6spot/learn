import type { FontId } from '../../packages/font-metrics/dist/index.js';

/** Trusted deployment configuration. Configure authorized HTTPS origins at final
 * integration; never take a font URL or hash from page/user input. */
export const PREVIEW_FONT_URLS: Readonly<Partial<Record<FontId, string>>> = Object.freeze({});
