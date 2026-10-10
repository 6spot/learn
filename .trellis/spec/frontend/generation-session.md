# Native generation submission

## Scope

Read when changing T20 submission, original-request recovery, editor/preview generation controls or result navigation. [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md) owns cloud idempotency/accounting and [UI_DESIGN](../../../docs/UI_DESIGN.md) owns the single P06 detail destination. T21 owns that page and cloud job display.

## App and page boundaries

`createEditorEnvironment` creates one `GenerationSession` with the App client/editor/compatibility result. `submit/retry/recover/startNew/clear/subscribe` are local submission operations; the view is not a second cloud job state machine. Both pages use `generationPageState` for safe text, booleans and status. Do not put request IDs, input, versions, digests or layouts in this projection, routes or persistent storage.

- Enable the primary action only after the current editor revision has successfully completed the visible Canvas display, with compatibility ready and `view.canStartNew`. Old render completion, hidden pages and failed renders cannot enable it.
- The primary action calls `startNew`: a known prior result requires an explicit new click before creating a new request. An unknown prior result blocks a new operation. Query calls `recover`; retry calls `retry`, preserving the original snapshot even after input edits. Explain the old-input semantics in the shared hint.
- Capture actual preview input/options/version/digest immutably. Use native secure random for the nonce, then retain the whole signed request ID. Query an unknown outcome first; only an explicit retry after a null result may resend that exact request. A lookup error never authorizes an automatic new request or replacement snapshot.
- Local wait timeout is not cloud failure or refund. Late verified submit/query responses may recover a known job. Validate request/template/job identity and submission/status agreement before accepting the result.

## Navigation lifecycle

`generationNavigation.onShow/onHide` follow App foreground/background. Each editor/preview `onShow` calls `showPage(route)` and stores its returned cleanup; `onHide/onUnload` release it. The cleanup is token-bound, so a late old page hide cannot clear a newer page's registration. App hide also clears the current registration.

Automatic `onJobKnown(jobId)` navigation requires the App to be foreground, a live generation page token, and the current top route matching that token. The stack alone does not prove visibility: WeChat retains its top route while backgrounded. Navigate only to `/pages/records/detail?jobId=...`, retaining native back navigation and sending no input or request ID. Hidden or failed navigation leaves the known result available from records; foreground does not replay navigation or submission.

## Clearing

The central App cleanup calls generation clear before other owners. Clear invalidates local waits, queued work and late response/navigation callbacks and releases its request snapshot. It cannot cancel a cloud task already accepted. Attempt all cleanup owners and report the shared fixed error if any fail, as specified in [application compatibility](application-compatibility.md).

## Verification

Run `node --test miniprogram/test/generation-native.test.mjs miniprogram/test/generation-session.test.mjs miniprogram/test/secure-random.test.mjs` and root TypeScript checking. The native generation harness builds current App/Page sources in memory; it does not depend on the shared DevTools output being current. It uses real client/service/layout/font code with simulated wx, Canvas completion, network faults and synthetic PDF output. Cover current/stale Canvas, double taps, explicit next generation, lost response, original snapshot after editing, page hide with retained route, App hide before Page hide, obsolete page tokens, clear and late results. Rebuild through the coordinated build owner before emitted native/editor/compatibility tests and official simulator checks. Device/CloudBase/configuration/printing acceptance remains separate.
