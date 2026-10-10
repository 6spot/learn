# Idempotent generation admission

## 1. Scope / Trigger

Read before changing generation RPCs, client submission snapshots, execution handoff or retention. [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md) owns D-034/D-037/D-050; [service README](../../../packages/cloud-service/README.md) owns API/configuration usage.

## 2. Signatures

- `getSubmissionWindow(): Promise<{windowId,expiresAt}>`
- `createRequestId(windowId, secureUuidV4): string`
- `submitGeneration({requestId,input,versions,layoutDigest}): Promise<{job,submission:'pending'|'settled'}>`
- `findJobByRequest(requestId): Promise<JobSummary|null>`
- `createPaperPreparer(loadMetrics)` returns `prepare(input,trustedPreset) -> {layout,digest}` using actual shared core.
- Injected `GenerationExecutor.execute({jobId,batchId,userId,published,layout}): Promise<void>` must await execution and terminal commit; it is not a client-supplied capability.

## 3. Contracts

The complete request ID contains the user-bound server-signed window and client's secure UUID. Freeze it with the submitted parameters for retries; never renew a separate window for the same old ID. Existing records use their saved fingerprint key/canonical version/defaults and return the same task despite window expiry or changed active presets. Unknown expired IDs fail after cleanup too.

Snapshot the input before the first await through runtime `cloneDocument`. Reject accessors, hidden fields, serialization hooks and nonstandard object/array prototypes without executing them. Preserve original text/whitespace. Identity comes from the trusted provider; input identity, role, balance and digest cannot authorize execution.

Atomically create request binding, job, credit reservation/ledger and preset reference. Only the creating request prepares once, checks the shared layout digest/page limit and invokes the awaited executor. Known preparation failure atomically fails/releases; unknown executor outcome remains queryable pending until trusted reconciliation. A RESERVED record alone is not a reliable accepted-execution acknowledgment.

D-049 activity belongs to that new-job transaction, using its admission timestamp. Preparation may fail or finish after Shanghai midnight; neither moves the unique activity to a different day. Existing-request retries do not create activity, and a rolled-back admission leaves none. This statistical fact does not change the execution acknowledgment contract above.

`JobSummary` exposes IDs/template/state/timestamps/page count/safe failure/file expiry, not file IDs, HMACs, title/body or layout. Metadata stores fingerprint algorithm/key ID and safe task/version facts, never replayable content. Generation configuration is explicit: retained keys, window/record/PDF/request periods, job deadline, input/page/byte/concurrency/rate limits. Retention validates D-050 ordering.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Tampered/cross-user window or malformed random ID | `REQUEST_INVALID` |
| Unknown expired full request ID | `REQUEST_EXPIRED`; no new reservation |
| Existing ID with changed effective parameters | `IDEMPOTENCY_CONFLICT`; no old-file delivery |
| Retained key/canonical implementation unavailable | Explicit safe key/protocol failure; no duplicate |
| Rate/concurrency/quota/input/version rejection | Stable safe error, no partial admission |
| Preparation/digest/page failure | FAILED and release in one transaction |
| Runner returns without terminal commit / uncertain failure | Pending/unknown outcome, no client-invented failure |

## 5. Good / Base / Bad Cases

Good: response is lost, retry reuses the full original ID and finds the same job without another prepare/reservation. Base: a new valid request uses its own immutable snapshot. Bad: renew a window on network retry, persist layout for replay, fire an unawaited executor after returning, or interpret client timeout as a refund instruction.

## 6. Tests Required

`npm run test:service` covers concurrent deduplication, fingerprint preservation/rotation, expired cleanup replay, resource limits, atomic rollback, immutable snapshots, trusted query ownership, creator-only preparation and uncertain execution outcomes. `npm run test:cloud` covers metadata cloning and transactional ports. Keep real PDF, reconciliation, private delivery and actual CloudBase disconnect behavior in their integration gates.

## 7. Wrong vs Correct

Wrong: `return {accepted:true}` after writing RESERVED, or invoke inherited `toJSON` while cloning an input array.

Correct: validate/snapshot first, atomically bind the request and credit, await the trusted execution path, and report only the state actually known by the server.
