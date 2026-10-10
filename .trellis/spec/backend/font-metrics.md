# Shared original-font metrics

## 1. Scope / Trigger

Read when changing font loading, shaping, Canvas outlines or PDF embedding. Both targets consume `packages/font-metrics/dist/index.js`, built with the same browser-resolved dependencies. The [package README](../../../packages/font-metrics/README.md) owns integration details; [resource manifest](../../../assets/fonts/manifest.json) owns byte pins and provenance.

## 2. Signatures

```ts
createFontMetricsProvider({ fontBundleVersion, fonts }): OriginalFontMetricsProvider
provider.shape(fontId, text): ShapedText
provider.glyphOutline(fontId, glyphId): GlyphOutline
provider.originalFontBytes(fontId): Uint8Array
createMeasureTextMm(provider, canonicalFontId, fontSizeMm): (text: string) => number
```

`fonts` contains one or more known font IDs mapped to already loaded `Uint8Array` originals. Platform adapters own network/filesystem access. The provider has no host I/O and does not retain document strings.

## 3. Contracts

- Copy and validate exact length/SHA-256 before parsing. Pin metadata is generated from the resource manifest. Return frozen metrics/outlines and defensive original-byte copies.
- Shape one horizontal LTR run. Core owns paragraph boundaries, wrapping and physical placement. Font units use y-up; `positionShapedText` converts offsets and axes exactly once.
- Normalize internally per original grapheme using NFC; use canonical NFD only for missing composed cmap entries whose components exist. Glyph source ranges remain original UTF-16 intervals. Never normalize stored/editor input.
- Geometry caches may share glyph IDs. Source codepoints and mark/ligature flags must be invocation-local: Fontkit's cached first-call metadata is not reliable for cmap aliases or outline-before-shape access.
- Compute exact outline extrema with the package implementation, not Fontkit `path.bbox`. Verified LXGW glyphs expose upstream quadratic/cubic precision errors.
- Use package lexical codecs and one browser-resolved bundle. Do not select host codecs, native segmentation, system fonts or alternate shaping on one target.
- Canonical filled font determines logical widths in both modes. Tracing changes only permitted draw fonts. PDF receives unchanged original TTF bytes and explicit shaped glyph placement.

## 4. Validation & Error Matrix

| Condition | Stable result |
|---|---|
| Unsupported bundle / ID | `FONT_BUNDLE_UNSUPPORTED` / `FONT_ID_UNSUPPORTED` |
| Missing / altered font bytes | `FONT_RESOURCE_MISSING` / `FONT_RESOURCE_INVALID` |
| Absent glyph after canonical decomposition | `FONT_GLYPH_MISSING` |
| Joiner, selector, hidden control or lone surrogate | `FONT_TEXT_UNSUPPORTED` |
| Unreliable source mapping, reordering or vendor exception | `FONT_SHAPING_UNSUPPORTED` |
| Invalid bounds/metrics or millimetre overflow | `FONT_METRICS_INVALID` |
| Invalid outline glyph ID | `FONT_GLYPH_ID_INVALID` |

Errors expose codes and optional source positions only, never user text or vendor messages. Layout must map provider errors into its own safe boundary.

## 5. Good / Base / Bad Cases

Good: `ǖ` and `ǖ` shape identically while retaining distinct original ranges; `Ǹ` may produce two glyphs sharing one original grapheme. Base: load only the template's required verified font set. Bad: strip unsupported selectors, guess source length from glyph count, or accept a damaged font with system fallback.

## 6. Tests Required

`npm run test:fonts` builds and checks the package against independent FontTools BoundsPen/hmtx references, NFC/NFD clusters, alias call orders, exact source ranges, original bytes, missing/corrupt resources and nonfinite conversion. The restricted VM excludes host codecs and dynamic code generation. Resource/algorithm changes require deliberately versioned pins and regenerated independent evidence; passing Node/VM tests is not mobile performance, licensing or printing acceptance.

## 7. Wrong vs Correct

Wrong: reuse `font.getGlyph(id).codePoints` as the source of every later shaping call, or import a separate Node-resolved Fontkit implementation in the PDF service.

Correct: share the built provider; cache geometry independently of per-call provenance, then use its exact glyphs and original font bytes in both renderers.
