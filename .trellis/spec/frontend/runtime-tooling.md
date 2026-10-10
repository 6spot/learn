# Native runtime and build tooling

## 1. Scope / Trigger

Read when changing build scripts, native page registration or shared-code dependencies. Source is under `miniprogram/`; generated runtime is `dist/miniprogram/`. Import the repository root in WeChat DevTools because `project.config.json` selects that generated directory.

## 2. Signatures

Root commands: `npm run setup`, `npm test`, `npm run build`, `npm run smoke`. Setup uses each package's lockfile with `npm ci`; root-only `npm install` does not install nested dependencies. `node scripts/setup.mjs --list` inspects its scope without mutation. `packages/paper-core` retains its independent `npm test` compilation and regression gate. The diagnostics page is `pages/runtime/index`; it is a development host, not an approved product page.

## 3. Contracts

`scripts/build.mjs` bundles the same paper source for ES2017 CommonJS miniapp and Node20 CommonJS cloud diagnostics. Native WXML/WXSS/JSON is copied, not transformed into a web app. Generate font-provider and renderer declarations before native type checking; never rely on a previous developer's ignored `dist` output. Generated output and private DevTools configuration stay ignored. SDK declarations only model used APIs; they do not establish target compatibility.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing compiler/dependency | Install pinned dependencies, then rerun checks |
| Invalid emitted import / Node builtin in miniapp | Build or VM test fails |
| Unsupported text runtime | Explicit error/capability result, no alternative segmentation |
| Missing DevTools login/port | Record failed automation attempt; continue independent Node tests |

## 5. Good / Base / Bad Cases

Good: source-only import reused by both targets, native `App`/`Page` registration verified. Base: synthetic measurements used only by named diagnostics. Bad: ship diagnostics as product preview, log actual entered text, use Node filesystem from paper core, or call VM success real-device evidence.

## 6. Tests Required

Run root `npm test`; runtime tests load emitted bundles and compare complete synthetic results. Core edits also require `npm --prefix packages/paper-core test`. Official `miniprogram-automator` automation checks actual page data/interaction and disconnects without closing the user's IDE. Include version, base library and simulated-vs-device provenance in evidence.

The official SDK stays at 0.12.1; its legacy image dependency is overridden to Jimp 0.22.12. A synthetic PNG QR-code regression exercises the SDK's actual decode API. The isolated install audit on 2026-10-11 removed high/critical legacy image/minimist findings; five moderate transitive findings remain for the development-only file-type ASF parser. This tool path reads DevTools PNG QR images, not user uploads, and is excluded from production bundles. Keep that scope explicit instead of claiming a clean full dependency audit or blindly forcing incompatible SDK downgrades. Recheck dependencies at release.

## 7. Wrong vs Correct

Wrong: edit `dist/miniprogram/pages/...js` or import a renderer to choose line breaks.

Correct: edit TypeScript/WXML/WXSS source, rebuild, feed both renderers the versioned core layout, test the generated native page.
