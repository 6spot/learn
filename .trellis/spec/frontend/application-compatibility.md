# Application compatibility and updates

## 1. Scope / Trigger

Read when editing App composition, version/resource refresh, native update UI or local privacy cleanup. T19 owns these contracts. [ARCHITECTURE](../../../docs/ARCHITECTURE.md) owns D-032/D-033; actual published-update and device acceptance remain pending.

## 2. Signatures

`createEditorEnvironment(wx, SERVICE_CONFIG)` creates the one App `client`, `editor`, `compatibility` and generation integration surface. `getLearnApp()` is the cross-entry-point accessor; do not introduce per-page/module client singletons. `CompatibilitySession.start/onShow/onHide`, `retry`, `refreshResources`, `requestUpdate` and `subscribe` own shared lifecycle/actions. `view` is a safe text/boolean projection, not a response or draft.

`App.clearUserData(): void` synchronously invalidates local owners. `registerUserDataCleanup(callback): () => void` attaches additional request/PDF/account owners and returns an unregister callback. Cleanup attempts all owners even if one fails, then throws only `LOCAL_DATA_CLEAR_FAILED` if any failed; the privacy UI must retain its retry affordance instead of claiming complete local removal.

## 3. Contracts

- Register UpdateManager once in App startup. Cold launch/foreground share the same in-flight compatibility Promise. A successful request caches for 60 seconds; failures throttle foreground attempts for 5 seconds. Explicit retry still joins an existing request. Pages and `application-status` only subscribe or trigger these shared actions.
- Send the compiled engine and selected locked tuple, never title/body/layout. Normalize cross-realm native JSON via bounded data-descriptor copying, rejecting accessors, executable serialization hooks and exotic instances; keep core plain-object checks unchanged. Arrays also require an ordinary Array/Object prototype chain from their realm; inspect inherited `toJSON` descriptors without reading or invoking them. Validate the complete response before installing any preset or resource URL. Core validates preset shape; descriptors must match the compiled font bundle, SHA-256, byte count, font version and required font IDs. Only pinned HTTPS font locations enter the loader. `local://` is accepted solely by the null-config development composition, for original-font diagnostic cache use.
- Current active presets and checked locked tuples are distinct. First trusted synchronization can replace an unverified development seed; an already verified ready editing combination stays locked even if active changes or uses a newer engine. An invalid/retired combination with a usable current replacement requires explicit refresh. Changing template during that refresh cancels its replacement. Preserve exact draft/settings/cleanup/undo, invalidate preview and digest, and recompute through EditorSession.
- Response installation rejects mutations of previously verified preset tuples. Network, service, account, resource and code errors have separate safe states. Layout compatibility never intercepts safe account/history/file RPCs; those still depend on cloud authorization. `compatibility.view.canGenerate` is only the layout-version gate; preview validity, account quota and actual submission integration add their own gates.
- `hasUpdate` only means download is available. `onUpdateReady` exposes an action without prompting or restarting. `requestUpdate` opens a real native confirmation; when input exists, warn it will not survive restart and must first be copied by the user. Apply only while still ready, foreground, same editor revision and same cleanup epoch. Cancel, background, clear or changed input cancels the confirmation. Apply at most once per session; no automatic restart, persisted draft, remote JS or page-specific update listener.
- Clear cancels queued/in-flight compatibility responses and pending confirmations, clears editor input/options/cleanup/undo/preview and releases font providers. Later T20/T21 owners must fence old submission, navigation, query and PDF callbacks through the same registration point. Local cancellation never reverses an already accepted cloud task.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Launch + foreground or duplicate refresh | One in-flight check/refresh; no duplicate update listeners |
| Network unavailable | Safe retry text, preserved input, no code-update claim |
| Old ready tuple + new active | Keep old preview/tuple until explicit invalidation |
| Retired tuple + current ready | Explain resource refresh; preserve draft and recompute |
| Unknown font pins / malformed response | No partial install; explicit resource-unavailable state |
| Code unsupported + no update / failed download | Block generation, preserve input, show recoverable update status |
| Ready + cancel, changed input, background or cleanup | Never call applyUpdate |
| Any local cleanup owner fails | Attempt remaining owners, report fixed failure, allow privacy retry |

## 5. Good / Base / Bad Cases

Good: native status instances share the App session and a history page directly calls `App.client`. Base: injected diagnostic transport and UpdateManager events are explicitly marked simulation. Bad: treating update availability as compatibility, replacing a supported old tuple silently, interpreting in-memory text as restart-safe, or enabling a placeholder generation handler.

## 6. Tests Required

Run `npm run typecheck`, `npm run build`, `node --test miniprogram/test/compatibility*.test.mjs miniprogram/test/editor*.test.mjs packages/runtime-smoke/test/runtime.test.mjs`, and `npm run test:canvas` when changing editor/font/preview integration. `node scripts/test-compatibility-devtools.mjs --diagnostics` uses the official simulator, actual local CloudService, native buttons and actual warning rendering. Its UpdateManager events/applyUpdate and confirmation callbacks are simulated because the SDK native modal actions do not deliver DevTools callbacks; actual confirmation interaction remains device acceptance. The harness restores native APIs and clears its modal/input before disconnecting. Serialize DevTools ownership with other workers. T19 task evidence records exact counts and remaining external gates.

## 7. Wrong vs Correct

Wrong: a page retries with a new CloudClient, clears content on update-ready, or claims a mocked applyUpdate proved formal release behavior. Correct: share App actions, keep raw user data out of diagnostics, and carry actual formal update/configuration/device checks to final Owner acceptance.
