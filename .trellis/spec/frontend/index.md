# Frontend Development Guidelines

## Project status

Learn uses a native WeChat mini-program. T01 provides a native diagnostics host and shared two-target builds; production pages remain separate work. D-039 confirms native base controls plus a small set of custom business components; [UI_DESIGN](../../../docs/UI_DESIGN.md) owns page/menu/layout/style definitions and their approval status. D-043 accepts the current mockup as the functional-development baseline; later visual refinements do not block implementation.

Read component and quality guidelines before frontend work. Unfilled entries below are bootstrap scaffolding, not evidence that React hooks or any UI framework have been selected.

| Guide | Description | Status |
|-------|-------------|--------|
| [Runtime Tooling](./runtime-tooling.md) | Source/output boundaries, shared builds and simulator checks | T01 implemented; actual-device acceptance pending |
| [Native Paper Preview](./canvas-preview.md) | Exact drawing, original-font caching and cancellable Canvas lifecycle | T08 independently checked in official simulator; devices/printing pending |
| [Directory Structure](./directory-structure.md) | Actual page/component file organization | To fill after UI skeleton |
| [Component Guidelines](./component-guidelines.md) | Confirmed native component policy, behavior and reuse boundaries | D-039 policy captured; real implementation examples pending |
| [Hook Guidelines](./hook-guidelines.md) | Platform lifecycle guidance when implemented | Generic scaffold; not a framework selection |
| [State Management](./state-management.md) | Local, app and cloud state organization | To fill from implementation |
| [Quality Guidelines](./quality-guidelines.md) | UI design gates, privacy and true-device acceptance | Project requirements captured; tool commands pending |
| [Type Safety](./type-safety.md) | Actual TypeScript conventions | To fill from implementation |

Use the authority documents instead of fabricating patterns for missing modules. Keep approved decisions, proposed design and implemented code distinct. English is used for these engineering guidelines; product design remains in the Chinese docs.
