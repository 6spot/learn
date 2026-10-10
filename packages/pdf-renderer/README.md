# Shared PDF renderer

`renderPdf(layout, provider, { maxBytes? }): Promise<Uint8Array>` renders the existing `PaperLayout` as A4 vector PDF. The same browser-resolved implementation runs in Node and the miniapp simulation. It performs no filesystem/network calls and receives no original title/body strings.

```ts
const bytes = await renderPdf(layout, fontProvider, { maxBytes: 32 * 1024 * 1024 });
// The authenticated service owns private upload, settlement and download access.
```

The provider only needs `fontBundleVersion`, `glyphOutline(fontId,glyphId)` and `originalFontBytes(fontId)`. Blank sheets can use `null`. The renderer checks the engine/resource tuple, snapshots validated layout data before asynchronous work, copies original-font bytes before verifying their length/SHA-256, checks real glyph ink, and rejects invalid glyph IDs or page overflow before output. Embedding uses the verified private copy even if a provider later mutates its buffer. It never calls shaping, chooses line breaks, alters grid geometry, substitutes fonts or rescales glyphs.

`pdf-lib@1.17.1` supplies low-level PDF objects, vector operators, pure JavaScript deflate and serialization. Each original glyph ID is drawn using an explicit absolute text matrix with the core's font size and baseline. The full unchanged TTF is embedded as a compressed `FontFile2` under CIDFontType2/Identity-H, with identity CID-to-glyph mapping. There is no font subsetting or outline-only PDF. Caps, joins, miter limit, dashes and gray come from the shared preset; no clipping is applied to grid centerline bounds.

PDF metadata identifies only Learn and the actually used fonts. Original MiSans license PDF and LXGW OFL text are attached when those fonts are used, preserving their original bytes without adding printed pages. The build verifies those license resources against [the shared manifest](../../assets/fonts/manifest.json); generated base64 license data is ignored by Git. Final license interpretation/distribution approval remains part of [final acceptance](../../docs/FINAL_ACCEPTANCE.md).

The layout contract cannot recover every original Unicode sequence from glyph IDs. This renderer does not invent `ToUnicode` mappings: visible/printed content is preserved, while PDF copy/text extraction is not guaranteed. This limitation is separate from rendering and is recorded in the task's acceptance evidence.

## Resource limits and failures

Default/hard output cap is 64 MiB. The caller may lower `maxBytes`, not raise it. Hard caps also bound one call to 50 pages and 100,000 glyphs. Font streams are bounded and the PDF writer checks its exact serialized size before allocating the final byte array. Rejection returns no partial bytes; the service must not upload a failed render.

`PdfRenderError` exposes only `PDF_INVALID_LAYOUT`, `PDF_RESOURCE_MISSING`, `PDF_RESOURCE_MISMATCH`, `PDF_RESOURCE_LIMIT` or `PDF_RENDER_FAILED`. Errors contain no source strings or raw provider errors. Rendered PDF bytes, glyph layouts and source ranges must not be written to application logs.

Full original fonts have a material file-size cost. Local two-page samples were approximately 5.53 MB for ordinary square text, 18.43 MB for MiSans plus LXGW tracing, and 165 KB for pinyin. A service limit below the mixed-font result will explicitly refuse that render; production configuration must account for supported templates. These are local sample sizes, not platform capacity or mobile-memory acceptance.

## Build and validation

Restore [original font resources](../../assets/fonts/README.md) and build the shared core/font packages first. Then:

```sh
npm --prefix packages/pdf-renderer install
npm --prefix packages/pdf-renderer test
npm --prefix packages/pdf-renderer run samples
```

The package build emits declarations, a self-contained ESM bundle and miniapp/cloud CommonJS bundles. Runtime code contains no Node imports or dynamic evaluation. Tests independently inflate `FontFile2` using Node zlib and compare every byte/SHA with the originals, inspect A4/page/glyph matrices and attached licenses, check boundary failures, and compare both bundles against Node in VMs without Buffer/TextEncoder/TextDecoder/Intl/crypto.

`samples` additionally requires Poppler `pdfinfo` and `pdffonts`. It creates twelve reproducible synthetic blank/filled/tracing PDFs under ignored `dist/pdf-evidence/t09`, validates page dimensions and full font embedding, and writes safe count/size/hash inspection reports. The earlier pinyin probe was also rasterized with `pdftoppm` and visually checked. More complete raster ink measurement and printable acceptance packs belong to T10; real devices, deployment limits and physical printing remain unverified here.
