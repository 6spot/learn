# Cloud runtime contracts

## 1. Scope / Trigger

Read before implementing cloud business services or changing infrastructure adapters. `packages/cloud-runtime` owns provider-neutral ports and deterministic memory adapters. CloudBase configuration is composed at `cloudfunctions/`; paper layout never imports this package. See [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md) for business rules and [FINAL_ACCEPTANCE](../../../docs/FINAL_ACCEPTANCE.md) for pending production evidence.

## 2. Signatures

`MetadataStore.get/list/transaction` reads JSON metadata and opens a callback transaction. `MetadataTransaction.get/create/set/delete` operates on single records; no transaction query support is assumed. `PrivateStorage.resolve(path)` computes a provider reference; `put(path, Uint8Array)`, `read(fileId)`, `remove(fileId)` are backend-only capabilities. `TrustedIdentityProvider.current()` returns `{subject, appId}` from trusted context. `ExecutionBridge.invoke(input, work)` awaits work inside the invocation.

`cloneDocument(value: JsonObject): JsonObject` supplies synchronous safe JSON snapshots for metadata and RPC boundaries before asynchronous work begins.

## 3. Contracts

- List uses equality filters, ascending ID cursor, default 50 and maximum 100 records. Consumers must paginate.
- Transaction callbacks may retry. Generate stable operation IDs before the callback; perform rendering, uploading and notifications outside it.
- Persist candidate job/batch/path metadata **before** upload. Production must inject a verified path-to-fileID resolver; an opaque upload response alone cannot recover a process crash immediately after storage success.
- Project persisted records through explicit field allowlists. JSON-serializability does not enforce article privacy. No raw input, title, body, layout, secret or parameter fingerprint in logs.
- Snapshot validation uses property descriptors, rejects own hooks/accessors/hidden fields, and checks both object and array prototypes. `Array.isArray` alone is insufficient: a custom array prototype can inherit `toJSON` and rewrite a request during serialization. Do not execute it to discover whether the result looks valid.
- `StaticIdentityProvider` and `MemoryMetadataStore` are local test adapters. Never construct trusted identity from client event fields.
- CloudBase missing-document exception classification is injected after verifying SDK error codes; unknown errors fail closed.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Missing identity / wrong app | `UNAUTHENTICATED` |
| Invalid path, JSON or pagination | `INVALID_ARGUMENT` |
| Duplicate create | `ALREADY_EXISTS` |
| Unknown database/provider error | Safe runtime code, never raw provider message |
| Upload ID differs from resolver | Reject; clean up the known mismatched upload |
| Response lost after execution | Unknown outcome; query metadata, never infer failure/refund |

## 5. Good / Base / Bad Cases

Good: pre-register a candidate path, upload, validate existing bytes, then settle a still-valid batch atomically. Base: await one invocation throughout; clients can query persisted progress from another page. Bad: queue an article for automatic retry, retain input in a job record, return accepted before verified execution, or refund because the client disconnected.

## 6. Tests Required

Run `npm --prefix packages/cloud-runtime test` (includes strict TypeScript). Cover rollback, concurrent create/reservation, commit failure, trusted-context rejection, path resolution mismatch, response loss, upload-success/process-crash recovery without returned fileID, duplicate settlement and terminal races. Memory serialization proves business invariants; it does not prove CloudBase isolation or post-disconnect execution.

## 7. Wrong vs Correct

Wrong: `void render(event); return { accepted: true }` or `store.set('jobs', id, event)`.

Correct: persist allowlisted metadata and a reservation atomically; `await bridge.invoke(transientInput, execute)`; expose metadata queries independently; reconcile only existing artifacts/state. A scheduled recovery handler must never call the renderer.
