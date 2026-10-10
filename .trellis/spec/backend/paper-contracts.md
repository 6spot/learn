# Shared paper contracts

## 1. Scope / Trigger

Read before changing `packages/paper-core`, font integration or a renderer. This is shared, platform-neutral code despite the backend spec location. The [core README](../../../packages/paper-core/README.md) owns concrete API usage; [PAPER_PRESETS](../../../docs/PAPER_PRESETS.md) owns physical dimensions.

## 2. Signatures

`createPaperDocument(input, trustedPreset)` returns a frozen `PaperDocument`. `validatePaperInput`, `validateTrustedPreset`, `parseTextBlock` and `getDefaultTextOptions` are public boundary helpers. `FontMetricsProvider.shape(fontId,text): ShapedText` feeds `positionShapedText`, which produces exact millimetre glyph placements. `safePaperFailure` projects errors to safe machine-readable fields.

Use `layoutPaperDocument(document, metrics)` as the unified four-template entry. `validateLayoutVersions`, `assertLayoutVersionsMatch` and `assertLayoutVersionsSupported` validate explicit supported combinations. `serializePaperLayout`, `createLayoutDigest`, `validateLayoutDigest` and `assertLayoutDigestMatches` implement the shared `learn-layout-v1:sha256:<64 lowercase hex>` protocol.

## 3. Contracts

- User options: `titleAlign: left|center|right`, `bodyIndent: default|none`; no dimensions, fonts, gray values, internal mode or trusted versions in `PaperInput`.
- `LayoutVersionTuple` binds engine, template ID, template version and font/metrics bundle version. Structural validation does not authenticate a preset; the cloud registry owns that trust boundary.
- Preserve original title/body bytes represented as JS strings: no trim, normalization or line-ending rewrite. Source ranges are original UTF-16 half-open offsets; separators preserve CR/LF/CRLF, and a final separator creates a final empty paragraph.
- `unicode-segmenter` is pinned for both targets; do not choose native-vs-fallback segmentation at runtime.
- Geometry is fixed. Coordinates use 1e-6 mm precision, y-down on page and y-up in font units. Output glyph origins already include shaping offsets. Renderers may not apply them again or determine line breaks.
- Filled metrics determine slots for both filled and tracing. Draw fonts must fit those slots; no renderer-driven resizing, fallback font or alternate pagination.
- The current binary executes only its actual compiled engine version, including direct square/pinyin entries. A list claiming an old version is supported does not authorize current code to impersonate that algorithm. Old engines require their retained actual implementation in trusted composition.
- Square punctuation follows D-025/D-047. Only the specified final Han/stop combination shares the last cell; unsupported further punctuation fails with a source position. Words/numbers prefer whole runs, overlong runs split only at graphemes, explicit blank lines remain meaningful.
- Pinyin uses its own line bands, fixed third-line baseline and validated Latin/pinyin clusters (D-048). Unsupported scripts and repeated/invalid combining marks fail; no automatic conversion or spelling correction. Candidate typography is versioned, never a user setting.
- Title/body style IDs must be unique. Each glyph references the actual style for its `source.block`; a syntactically valid unknown ID is not a valid layout.
- Layout serialization validates the complete schema, including page geometry, lines, slots, glyphs, source ranges, versions and all styles. Sort object keys, preserve array order/nulls, normalize negative zero, retain finite precision. Reject unknown/missing/accessor/hidden/symbol fields, exotic prototypes, sparse arrays and nonfinite numbers before hashing. Hash the explicit protocol domain plus canonical UTF-8 bytes with the pinned shared implementation.
- Layout digests check preview/server agreement; T14 HMAC fingerprints detect changed request parameters. Identical blank layouts can have the same layout digest despite different whitespace input. Do not normalize input to force fingerprint equality, log canonical layout or persist text-bearing snapshots.

## 4. Validation & Error Matrix

| Input | Required result |
|---|---|
| Unknown fields, malformed options, unsupported controls or lone surrogate | Explicit safe input error |
| Noncanonical fixed geometry / invalid limits / malformed style | Reject preset |
| Mutable caller changes after creation | Do not alter frozen document |
| Missing glyph, invalid cluster range or inconsistent ink union | Reject shaping result |
| NaN, Infinity, overflow or ink outside slot | Reject, no clipped partial output |
| Unexpected exception containing source text | Convert to safe fixed error, never echo text |
| Wrong engine/tuple, resource bundle or malformed digest | Explicit version/resource/protocol error; no silent upgrade |
| Duplicate style IDs, unknown or wrong-block glyph style | Reject preset/layout before digest or draw |

## 5. Good / Base / Bad Cases

Good: canonical decomposition inside a font provider maps every output glyph back to the original grapheme. Base: no drawable text yields blank mode while preserving the editor input. Bad: normalize user text for hashing, use `.length` as a grapheme count, move a grid to fit text, or accept a client's `stage: validated-release` as proof of authorization.

## 6. Tests Required

`npm --prefix packages/paper-core test` includes compilation. Add behavior regressions for exact sources, boundary rejection, unchanged physical presets, font-unit conversion, ink containment and complete protocol validation. `npm run test:layout` covers real font metrics; `npm run test:runtime` compares complete four-template/multipage layouts and canonical digests across isolated targets, with host codecs/Intl/Node crypto absent. Golden regeneration must be deliberate and reviewed; an unchanged hash demonstrates no layout drift. Physical printing remains separate acceptance.

## 7. Wrong vs Correct

Wrong: `createPaperDocument(event, event.preset)` or `canvas.measureText` to decide a wrap.

Correct: fetch an immutable supported preset from the trusted registry, validate the user's allowed fields, layout with the pinned shared provider, and draw its exact output.
