# Native paper preview

## 1. Scope / Trigger

Read when changing preview rendering, original-font loading or native Canvas lifecycle. The [renderer README](../../../packages/canvas-renderer/README.md) owns usage and limits. Paper core owns layout; [shared font metrics](../backend/font-metrics.md) owns shaping and outlines.

## 2. Signatures

`renderPaperPage(canvas, layout, pageIndex, fonts, {widthPx,pixelRatio,zoom})` draws one existing page and returns safe counts and ink bounds. Native `PaperCanvasHandle.display(request)` resolves to the report or `null` on cancellation/error; `clear()` releases its backing bitmap and image. Optional `viewport: {topMm,heightMm}` allocates only the screen slice; `snapshot: true` displays an in-memory PNG for native scroll/overlay composition. `createNativeFontLoader(platform, trustedUrls)` loads selected original-font IDs.

## 3. Contracts

- CSS width/zoom affect the view; DPR affects backing pixels. Neither changes page millimetres, glyph origins, physical font size or pagination.
- Editor slices use the renderer viewport, not ancestor CSS clipping of a full native Canvas. Preflight still checks the entire page, including offscreen glyphs; cropping changes only the bitmap height and display transform.
- T18 editor/preview use `snapshot: true`: render a hidden Canvas with the same layout, encode `toDataURL('image/png')`, reject data URLs over 900,000 characters before `setData`, then release the bitmap to 1×1. Wait for the matching native image load before reporting ready; error/clear/new revision/detach cancels pending decoding and stale callbacks. Images remain in memory; do not use temporary-file exports or write input-bearing snapshots to disk.
- Draw core glyph IDs through exact T04 outlines. Convert the font y-up axis once; glyph origins already include offsets. Never call Canvas text measurement/shaping to choose positions.
- Validate all required Canvas APIs, page/resource/style data, line caps, complete ink bounds and bitmap limits before resizing or drawing. Failure must not leave a partially painted page presented as valid.
- Layout/provider objects stay in JS memory, outside `setData`. The bridge carries dimensions, status and safe counts only. Editor text needed by native inputs is distinct from a text-bearing layout snapshot.
- Each display increments a revision and cancels pending callbacks. Detached components resolve pending waits even when a native callback never arrives, then release the bitmap. Stale callbacks cannot overwrite the latest page.
- Load only required fonts from SHA-addressed private files or trusted configured HTTPS URLs. Verify original bytes before use; deduplicate in-flight loading, remove corrupt cache entries, and do not let optional cache-write failure reject a valid in-memory provider. No user-selected URLs, system fallback or font binaries in the code package.
- App-wide editor/providers live on the App instance. The build bundles page entries separately, so an imported module singleton alone is not a cross-page store.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Missing drawing method | `CANVAS_UNSUPPORTED_API` before any paint |
| Missing page, font, wrong resource version or invalid ink | Safe renderer failure, hide stale output |
| Excessive backing allocation | Explicit limit failure; no partial resizing |
| Cache corrupt / unavailable source | Remove bad cache; expose retryable safe failure |
| Cache write callback or synchronous failure after verification | Continue with the valid provider |
| New render / detached component | Resolve cancelled work as null; no stale UI mutation |

## 5. Good / Base / Bad Cases

Good: zoom page two of a three-page document and assert unchanged glyph count/mm bounds. Base: blank paper renders without loading a text font. Bad: replace missing fonts with system text, put the full layout into page data, or declare partial output successful after a Canvas method throws.

## 6. Tests Required

`npm run test:canvas` covers exact transforms, caps, bounds, limits, real font outlines, viewport preflight, snapshot API/size/decoding failures and native lifetime/cache races. T18 uses `npm run test:editor:devtools` for actual input, cleanup overlays, PNG decoding, paging/zoom/scroll edges and safe sharing. After native behavior changes, `npm run test:canvas:devtools` exercises actual DevTools and writes reproducible evidence under ignored `dist/canvas-evidence`. Coordinate tool ownership before rebuilding or re-launching the shared project. These results do not replace real devices or printing.

## 7. Wrong vs Correct

Wrong: call `fillText`, add shaping offsets twice, or treat `setData` completion as guaranteed after detach.

Correct: validate a complete draw plan, apply exact glyph-outline transforms, use revision cancellation, and clear or hide invalid/stale output.
