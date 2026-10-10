# Component Guidelines

## Status and authority

D-039 in [DECISIONS](../../../docs/DECISIONS.md) is confirmed. [UI_DESIGN](../../../docs/UI_DESIGN.md) owns the UI component policy and page design; D-043 accepts the current navigation, page layout and visual tokens as the development baseline, subject to later refinement. No production mini-program pages exist yet. Examples below prescribe behavior; they are not existing implementations.

## Component selection

- Build with native WXML, WXSS and TypeScript. Use native button, input/textarea, switch, scroll and Canvas capabilities for their actual interaction semantics.
- Do not install an entire WeUI, Vant or TDesign library by default. WeUI is not the same thing as built-in platform components.
- Reuse project components for recurring business UI such as template entries, previews and job status. Do not build a generic component framework or replace native text entry.
- Before introducing a complex third-party control, record the actual unmet need, native alternatives, dependency footprint, compatibility, maintenance and selective import plan in the owning task. Route product changes through DECISIONS; do not reopen already approved routine choices.

## Concrete interaction contract

Primary actions use real button semantics. A pending submission has a visible loading state and suppresses duplicate activation; the service still enforces request idempotency. Inputs preserve user text; do not allow default platform length limits to truncate content silently.

D-040 confirms collapsed title alignment and first-line indentation controls. Keep their summary accurate and reset only those settings. Put newline cleanup beside body input; require a before/after preview and explicit apply, and provide undo. Current control values follow the D-043 baseline; D-046 now defines conservative transformation, stale-preview rejection and one-level undo invalidated only by subsequent body editing. Use shared layout inputs and cloud allowlists; never expose trusted font or geometry settings through this panel.

D-042 confirms one editor page instead of text/settings tabs. Render body input as the primary section, followed by a visible tracing row and a collapsed advanced-settings summary. Show the two option groups and reset action only while expanded. Expansion and tracing changes must preserve the input element, its value and focus; returning from preview preserves available editing state. Use section spacing and dividers to retain hierarchy without per-field cards. Exact visual values remain in UI_DESIGN under the D-043 baseline.

Illustrative WXML, not an existing component:

```xml
<button loading="{{submitting}}" disabled="{{submitting || !canGenerate}}"
  bindtap="onGenerate">生成 PDF</button>
```

Good: native controls plus approved shared visual tokens. Bad: a tappable view that only looks disabled, per-page UI libraries, handwritten text-entry behavior, or client-only duplicate protection.

## Styling and page boundaries

- Read the approved page entry in UI_DESIGN before implementation. Proposed paths and values are not approved merely because the mockup renders them.
- Owner rejected both nested large cards and a hierarchy-free list redesign. Follow the latest UI_DESIGN: four home quadrants, clearly grouped paper preview/text/settings sections, and distinct result/info/action hierarchy. Backgrounds and section spacing are valid grouping tools; avoid redundant inner wrappers rather than removing all visual structure.
- Keep shared colors, spacing, typography and button variants in one implementation location once the UI skeleton exists. Do not copy independently adjustable values into every page.
- Screen UI typography and spacing never alter millimetre-based paper geometry or paper font presets.
- Preserve safe areas, keyboard focus and readable labels. State, errors and selection require text/semantics as well as color.
- Page components do not own font line breaking, billing or trusted authorization. Application compatibility checks are shared at the app entry, not registered per page.

## Validation cases

| Case | Expected behavior |
|---|---|
| Rapid repeated generation taps | One in-flight request snapshot; visible pending state; cloud idempotency remains required |
| Empty input | Blank paper is valid; do not force text or mode selection |
| Keyboard / large text / small screen | Input and actions remain reachable and readable |
| Font resource failure | Retry/error state; no silent system-font export fallback |
| Back from preview | Preserve available in-memory editing state; no promise of persistence across restart |
| Tap paper inside preview | Zoom/reset in the existing reading area with explicit controls; do not open a second same-title preview dialog |
| Editor initial state | Body and tracing are available on one page; advanced options and reset are hidden until expanded |
| Toggle tracing / expand settings | Keep current title/body and focus; update preview and summary without recreating text controls |
| Reset advanced settings | Reset alignment/indentation only; retain body, title and tracing |
| Ordinary user reaches admin route | Cloud denies access regardless of hidden menu |

Check design consistency, native control behavior and relevant true-device flows under [TESTING](../../../docs/TESTING.md). Do not count an HTML preview as mini-program or printing acceptance.
