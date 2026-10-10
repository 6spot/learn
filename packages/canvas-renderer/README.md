# Canvas preview renderer

`renderPaperPage(canvas, layout, pageIndex, fonts, view)` draws one existing `PaperLayout` page. It never measures text, shapes glyphs, wraps, paginates or adjusts paper geometry. The optional font provider exposes T04 original-font outlines; the page's baseline origins already include shaping offsets.

```ts
const result = renderPaperPage(canvas, layout, 0, provider, {
  widthPx: 358,
  pixelRatio: 3,
  zoom: 1,
});
```

`widthPx` and `zoom` determine CSS dimensions; `pixelRatio` determines backing allocation. Millimetre coordinates and page count stay unchanged. A page exceeding 16,777,216 backing pixels or an 8192-pixel side fails explicitly. Bounds include line width/caps and actual glyph ink; dashed-line bounds are conservative. Resource/version/ink and required Canvas method validation happen before resizing or drawing, and native component failures hide and clear the previous canvas.

The original-font provider draws outlines for Canvas only. PDF font embedding is a separate renderer requirement; this package does not define PDF behavior.

## Native integration

- [`paper-canvas`](../../miniprogram/components/paper-canvas/index.ts) is the reusable native `type="2d"` component. Call `display({layout, fonts, pageIndex, widthPx, zoom})`; it resolves to a render report or `null` on cancellation/error. `clear()` releases the backing bitmap. Detach cancels pending callbacks and releases resources. `rendered` and `rendererror` events contain counts/bounds or a safe code, never source text.
- Layout and provider objects stay in JS memory; they never enter `setData`. Only dimensions, status and safe counts cross the native bridge.
- [`font-loader`](../../miniprogram/lib/font-loader.ts) loads only selected fonts from a SHA-addressed private cache or trusted HTTPS configuration. T04 verifies original bytes. In-flight requests deduplicate, the latest provider can be released, invalid cache files are removed for retry, and cache write failures (callbacks or synchronous exceptions) do not discard an already verified in-memory provider.
- [`font-sources`](../../miniprogram/lib/font-sources.ts) intentionally has no deployment URLs. Authorized font hosting and domain configuration belong to final integration. Do not feed URLs or resource identities from user input.
- `pages/canvas-diagnostics/index` contains fixed development samples, independent of the future production editor/preview navigation.

## Build and checks

Install root, font-metrics and canvas-renderer dependencies and restore the [local original fonts](../../assets/fonts/README.md) first. Font binaries stay ignored.

```sh
npm run build
npm run typecheck
npm --prefix packages/canvas-renderer test
node scripts/test-canvas-devtools.mjs --diagnostics
```

Root build generates the T04 provider and renderer from source, copies one verified ES2017 CommonJS provider to `dist/miniprogram/vendor/font-metrics.js`, and computes the relative require separately for each native entry. It preserves both original runtime-smoke targets. Run root `npm test` for shared-host regression.

The official automator script transmits the complete original font bytes in chunks, writes each font once through the native private filesystem, verifies them through T04 at use, and exercises four blank templates, filled/tracing square and pinyin samples, paging, zoom and missing-resource recovery. Reports/screenshots go to ignored `dist/canvas-evidence/`. It disconnects without closing the user's IDE.

This is simulated validation. Actual iOS/Android font loading, memory/latency, trusted hosting/domain setup, PDF comparison and physical printing remain final acceptance work.
