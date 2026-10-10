# Shared original-font metrics

This package implements paper-core's `FontMetricsProvider` with the three pinned T02 original TTF candidates. Preview and cloud consume the **same browser-resolved implementation**, including kerning, pinyin normalization, grapheme source ranges, advances, offsets and exact ink bounds. Font bytes are supplied by platform adapters; the package performs no file, network, Canvas or WeChat calls.

```sh
npm --prefix packages/font-metrics install
npm --prefix packages/font-metrics test
# From the repository root: npm run test:fonts
```

Tests require the original local fonts. Restore instructions and license review are in [assets/fonts](../../assets/fonts/README.md). Build reads its manifest to generate [resource metadata](src/resources.generated.ts); never edit those SHA-256 pins by hand. `dist/` and `node_modules/` are ignored, and no font binary or subset belongs in this package.

## Integration

```ts
import {
  createFontMetricsProvider, createMeasureTextMm, FONT_BUNDLE_VERSION,
} from './packages/font-metrics/dist/index.js';

const metrics = createFontMetricsProvider({
  fontBundleVersion: FONT_BUNDLE_VERSION,
  fonts: { 'misans-latin-regular': previouslyLoadedBytes }, // Uint8Array
});
const run = metrics.shape('misans-latin-regular', 'nǐ hǎo Ǹ');
const measureTextMm = createMeasureTextMm(metrics, 'misans-latin-regular', 6);
```

The size in this example only demonstrates the API; final typography comes from the trusted preset. Load only the fonts required by the current template. Construction copies bytes and verifies exact size and SHA-256 before parsing. Empty resources, unknown IDs/versions, modified bytes and missing glyphs fail with `FontMetricsError` containing a stable code and optional source positions; no error includes text. Returned results and public pin metadata are frozen. The provider does not cache document strings.

`shape(fontId, text)` accepts one horizontal LTR run; layout owns newlines, pagination and all physical placement. Values are font units with positive y upwards; `ascender`/`descender` follow `hhea`. Each glyph has an original UTF-16 grapheme interval. Run ink bounds include cumulative advances and offsets. Pass results to paper-core `positionShapedText` exactly once; its output origins already include offsets and reverse the y axis into millimetres.

`glyphOutline(fontId, glyphId)` returns original vector commands (`moveTo`, `lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `closePath`) and the same exact unoffset ink bounds. It supports Canvas rendering without native font shaping. `originalFontBytes(fontId)` returns a defensive copy of the unchanged TTF for the PDF adapter. PDF must embed the correct original font and place shaped glyph IDs; outline-only PDF is not the chosen delivery strategy. Never ask either renderer to independently wrap or measure text.

D-031's canonical font controls logical widths and wrapping. A tracing font may draw the Chinese glyph inside the assigned slot, but cannot be supplied to `createMeasureTextMm` as an alternative layout policy. The provider exposes font capabilities; the core chooses canonical/tracing IDs from the trusted preset.

## Unicode and exact geometry

- Internal normalization uses NFC per original grapheme. Missing composed codepoints may use canonical NFD only when all components exist; no compatibility normalization or source rewriting occurs. This supports `Ǹ` in both MiSans candidates and maps `ǖ` to the same designed glyph as `ǖ`.
- Source provenance is checked against the complete normalized codepoint stream. A ligature can span multiple original graphemes; unsupported reordering/one-to-many mappings fail rather than guess source offsets.
- Glyph geometry may be cached by ID, but source metadata is per invocation. A provider-local Fontkit adapter keeps cmap aliases and outline-before-shape calls independent; it does not modify global state, the vendor cache or font bytes.
- Variation selectors, joiners, hidden format controls, line separators and lone surrogates are explicitly rejected in this version. Emoji or other absent glyphs fail. No system-font fallback, stripping or replacement glyph is allowed.
- Exact outline bounds come from direct quadratic extrema and stable cubic roots. Fontkit's own `path.bbox` produced wrong extrema for 25 LXGW GB characters; it is intentionally not used. For example, `蔹` has xMin **63.6** font units, not 65.0625.

## Evidence and runtime limits

The suite compares 14,019 real glyph records (all GB2312 Han plus ASCII/pinyin probes) with independently generated fontTools `BoundsPen`/`hmtx` digests. It also checks all 90 synthetic pinyin clusters in each font, all 37 pinned cmap-alias groups in opposite call orders, canonical source mapping, core placement integration, actual kerning and line-boundary behavior, failed resource checks, unchanged PDF bytes, and matching cloud/browser results. Millimetre adapters reject nonfinite metrics and arithmetic overflow.

To regenerate the independent baseline after a deliberate resource change:

```sh
assets/fonts/.venv/bin/python packages/font-metrics/tools/generate-reference.py
```

The test reference contains synthetic public codepoint IDs and aggregate hashes, not outlines or user text. Changing a pin/algorithm still requires a new supported font/metrics bundle and review; regeneration is not permission to accept a changed upstream font.

The build uses fontkit 2.0.4, noble-hashes 1.8.0, unicode-segmenter 0.17.3 and unicode-properties 1.4.1 (also used by Fontkit, explicitly pinned for glyph mark flags). Its ES2017 bundle is about **385 KB** minified, has no external imports and no `eval`/`Function` call sites. Package-local UTF codecs are injected lexically, so neither `TextDecoder`, `TextEncoder`, `Buffer`, DOM nor `Intl.Segmenter` is required from the host. Other unsupported legacy font metadata encodings are not silently delegated to host-specific codecs.

Fontkit contains a duplicate `axisIndex` property in its unused variable-font STAT format-1 definition, so esbuild reports that upstream warning while rebundling. All accepted resources are hash-pinned static TTFs; no variable-font input is accepted. This is recorded rather than broadly suppressing build warnings.

Node VM comparison disables dynamic code generation and host codecs; it is a simulator check, **not WeChat real-device acceptance**. Creating providers for all three original fonts (34 MB) took roughly 28 seconds in this restricted VM; normal Node was much faster. This is not a mobile benchmark. Final adapters should load only needed resources and separately validate loading latency, memory, UI responsiveness and platform limits.

Actual MiSans font distribution/subsetting permission, product attribution, PDF integration, full device coverage, teaching glyph forms and printed typography remain separate release checks. This package and the candidate bundle are local development results, not production font approval.
