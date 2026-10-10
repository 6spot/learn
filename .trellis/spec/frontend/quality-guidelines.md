# Frontend Quality Guidelines

## Status

UI policy is confirmed by D-039; D-043 accepts current navigation and styling in [UI_DESIGN](../../../docs/UI_DESIGN.md). The repository has no implemented mini-program UI or UI test command yet. Do not invent passing checks or framework conventions.

## Review gates

- Read the owning page/layout spec and verify its approval status before writing the page.
- Match approved menus, entry points, primary actions and shared visual values. New UI scope or library choices require the documented design process.
- Verify both hierarchy and nesting: the home uses four quadrants; editor preview/text/settings and result state/info/actions are distinguishable through headings, background and spacing. No redundant inner paper backdrop or per-field cards. A flat list redesign does not satisfy the Owner’s latest feedback.
- Use native input/button/switch semantics; pending and disabled behavior must be functional, not merely visual.
- Cover loading, empty, success and error/retry states relevant to each page. Network timeout is not a cloud task failure.
- Keep input out of logs, analytics, route query strings and default persistent storage. History must not become a draft archive.
- Verify D-040 collapsed settings, summary/reset, and cleanup preview/apply/undo. Cancel leaves input intact; mock sample transformations do not define the production O-014 algorithm.
- Verify D-042 same-page editing: body remains the main editing area, tracing has a visible separate row, and advanced options/reset are hidden by default. Check section hierarchy as well as reachability at narrow and short viewport sizes; do not shrink body input to force every option above the fold. Expansion must not recreate the focused text controls.
- Check screen-only grid contrast independently from paper geometry. In successful valid-file detail, put Open PDF before metadata; query-error and expired states must not inherit the success action.
- Trace preview navigation through both crop and full-preview entry points: one preview page owns zoom/reset and paging. Verify all enlarged paper edges remain reachable inside its scrolling reader; a single back returns to the editor without an extra preview dialog.
- Share application compatibility state and update listeners; protect current input from forced restart.
- Treat hidden admin menus and known task/file IDs as UI only; cloud authorization remains mandatory.

## Verification

Use [TESTING](../../../docs/TESTING.md) for the authority on acceptance. Verify small screens, large type, keyboard visibility, bottom safe area, repeat taps, back navigation, foreground/background refresh and file handling in actual WeChat environments where applicable.

A design HTML preview may be inspected for navigation, overflow, contrast and sample states. This does not prove native component/API support, account security, font metrics, PDF correctness or printing. Add actual UI lint/build/test commands when T18 creates the implementation; do not invent them now.

Core changes must also run `npm test` in `packages/paper-core`. Documentation-only work checks diffs, links and rule consistency. Record what was actually run and what remains unverified.
