# Generation execution and private artifacts

## Scope and APIs

Read before changing PDF execution, recovery or file delivery. [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md) owns state transitions; [service README](../../../packages/cloud-service/README.md) owns configuration and usage.

`createGenerationExecutor({store,clock,crypto,storage,bridge,renderer}, config)` returns the awaited executor. The trusted renderer receives `{jobId,batchId,userId,published,layout}` and `{maxOutputBytes}`; composition adapts that limit to PDF `renderPdf(...,{maxBytes})`. The renderer does not authorize accounts or write metadata.

## Transaction boundaries

Claim execution once, outside rendering but within a transaction that checks job/batch/deadline. A committed claim whose response is lost must not cause a second render. Repeated admission reuses the existing job. Uncertain outcomes remain pending for reconciliation.

Register a `pdf_candidates` record before uploading, including the recoverable path/reference and expected bytes/hash/page count. Read the private object back and verify it before atomically marking success, consuming the reservation and releasing the preset reference. The file and ledger must not claim success from upload acknowledgment alone.

Candidate states `pending`, `committed`, `deleting`, `deleted` fence success and cleanup through metadata transactions. A terminal failure cannot become success. Unknown storage reads or commit acknowledgments cannot justify refunds or destructive cleanup. Known renderer failure releases the reservation once. Cleanup retains deletion tombstones so recovery can remove files from late uploads.

## Privacy and runtime

Do not persist input, title, body, layout or font provider. The complete invocation is awaited through the runtime bridge; no fire-and-forget rendering or input queue. Job summaries expose safe metadata, not file references, fingerprints or article text. Only authenticated delivery can expose PDF bytes later.

## Verification

Run `npm run test:service` and `npm run test:service:pdf`. Cover duplicate execution, claimed-but-unacknowledged transactions, upload acknowledgment loss, candidate verification, success commit uncertainty, late uploads, file corruption, limits, and exactly-once reserve/consume/release. Real-font integration covers all four templates, multipage output, A4 structure, stored hashes and retry reuse. Local adapters do not prove CloudBase transaction isolation or execution after client disconnection.
