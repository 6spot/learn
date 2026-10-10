# Privacy, deletion and finite retention

Read before changing account deletion, request cleanup, private file expiry, inactivity cleanup or maintenance composition. D-045/D-050/D-051 in [DECISIONS](../../../docs/DECISIONS.md) and [DATA_AND_CREDITS §7](../../../docs/DATA_AND_CREDITS.md#7-隐私与清理) own the policy. Implementation is in `packages/cloud-service/src/privacy.ts`, `lifecycle.ts`, `lifecycle-records.ts` and `lifecycle-files.ts`.

## Public boundary

`getPrivacyInfo()` reports actual configured retention and the trusted user's current deletion status. `getDeletionStatus()` and `deleteMyData({confirm:true})` do not create an account. A `none` status means no current account record, not a permanent stored deletion receipt. Confirmations must be exact safe snapshots; client user IDs never select the target.

Starting deletion atomically marks the user deleted and creates finite `account_deletions` protection. New admission, grants and history/file access reject this state. Already accepted jobs settle under the original terminal/credit invariants. Read paths and delayed signed-window/admin writes recheck active state before returning data or writing personal facts. Missing old request lookup does not bypass the final account check.

`earliestReuseAt` is a lower bound, extended by necessary unsettled jobs, request/ledger protection and late-I/O deadlines. It covers the deletion month's quota boundary and every still-valid signed window. It is not a guaranteed completion time. No early reopen endpoint exists. Only after all required cleanup completes are user, credit-account and deletion protection records removed; a later normal visit may create a new account. Keep identity keys stable across this lifecycle.

## Maintenance and storage

`createLifecycleService(deps, serviceConfig).runSweep()` has no renderer or replayable input. It scans fixed collections with persisted phase/ID checkpoints, bounded pages/records and a soft record-boundary time budget. Concurrent workers use revision-checked checkpoint writes. Record errors/retries remain observable and revisitable. The final dependency check uses bounded existence queries, not unbounded in-memory user scans.

Revoke a successful file's database reference before deleting its storage object; do not reverse the task terminal state or consumption. Keep a candidate tombstone through its explicit late-I/O protection window and re-delete possible late writes. Unknown storage results retry. First logical deletion counts must not multiply during tombstone revisits; such telemetry is not exact provider billing or proof of physical deletion at one instant.

Clear no-longer-needed fingerprints into minimal finite request tombstones. Do not remove request protection before the signed window and required terminal/protection boundaries. Job/history/preset-use cleanup must preserve dependency integrity. Old expired request IDs remain rejected after both record and account cleanup, including after recreation.

Delete user-scoped statistics facts in the same transaction that marks their date/source coverage gap. Natural retention advances conservative source floors; gap records below a floor can be removed. Published preset provenance may be scrubbed without changing its immutable layout specification. No permanent personal hash is retained for analytics.

## Configuration and checks

`service.lifecycle` explicitly supplies page/record/time budgets; maximum historical window TTL; late-I/O and deletion protection; ledger, activity, audit and inactive-user retention. It requires generation configuration and a historical window bound at least as large as the current window TTL. Production deployment requires lifecycle and stats sections. Actual maximum platform execution/storage-request duration and all production retention numbers remain final configuration evidence.

Run service and real-PDF suites for lifecycle changes. Cover deletion during generation/signing/file reads/admin changes, unknown storage results, concurrent/budgeted sweeps, short/empty cursor pages, non-first tombstone sweeps, finite cleanup/recreation, stale expired request rejection and honest coverage. Root composition tests exercise the deployed maintenance entry through SDK-shaped metadata adapters and the actual PDF/native-client/delete path. Never equate those simulations with verified CloudBase permissions, scheduling or physical-device cache cleanup.
