# Recovery sweeps

## Scope and interfaces

`createRecoveryService({store,storage,clock,crypto}, config)` returns `recoverJob(jobId)` and `runSweep()`. Recovery accepts no renderer, preparer or saved article. Read [execution contracts](job-execution.md), [service README](../../../packages/cloud-service/README.md) and [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md) first.

## Invariants

A valid existing candidate can settle an active, unexpired execution after read/hash checks. The transaction rechecks current job/batch/deadline and candidate association. An expired execution fails and releases once; failure/success terminal states never reverse. Unknown reads before the deadline remain pending. A size budget rejection is not proof of failed storage.

The deterministic candidate path binds job and batch. Reject corrupt associations before reading/deleting; do not let damaged metadata redirect maintenance to another job's file. Public/diagnostic results project allowlisted status values and safe codes, even on catch paths: assigning raw metadata to a local variable does not make its status safe to return.

Scan RESERVED, GENERATING and candidate phases in ascending ID order. A persisted revision/phase/afterId checkpoint makes bounded runs resumable. Save the checkpoint with revision comparison; concurrent or lost acknowledgments can cause harmless rescans but cannot skip required work. Complete cycles restart so records inserted before a previous cursor are eventually visited. Revisit deleting/deleted candidates for late uploads until lifecycle cleanup proves their protection period has ended.

## Budgets and deployment

All page, record, time and read budgets are explicit. `maxRunMs` is a **soft record-boundary budget**: do not begin another record after the deadline; finish awaiting the current record, including settlement. It does not cancel I/O or promise a hard duration. Deployment execution limits require margin for a single record; abrupt termination remains recoverable through metadata and idempotent operations.

Maintenance is not a user RPC. A separate permission-bound function invokes fixed sweeps, with client invocation denied in actual CloudBase controls. Event `Type` or a claimed trigger name is never authentication. Production timers and permissions still require final external verification.

## Checks

Run service tests and real-PDF integration. Include >100 jobs across pages, concurrent checkpoint CAS, lost commit acknowledgments, read/time/record exhaustion, malformed safe projections, unexpired unknown files, terminal races, deleted candidate late uploads, cross-job candidate corruption, and recovery of a real multipage PDF without another prepare/render/upload.
