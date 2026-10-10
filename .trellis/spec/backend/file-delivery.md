# Records and private PDF delivery

## APIs

`CloudService.listJobs({cursor?,limit?})` returns `items,nextCursor,serverTime`; `getJob(jobId)` returns metadata plus `delivery`. `getPdfInfo(jobId)` returns size/hash/pages/expiry/chunk size; `readPdfChunk({jobId,offset})` returns an authenticated chunk. Read [service README](../../../packages/cloud-service/README.md) for complete signatures and required `fileAccess` configuration.

Chunks are fixed at 256 KiB except the last. Composition encodes bytes as canonical base64 for JSON, and native clients verify offsets, lengths, immutable metadata and the entire SHA256 before writing/opening. File IDs, paths and temporary URLs are never client access credentials or response fields.

## Authorization and caching

Each operation resolves trusted identity and verifies ownership, active account, visible/unexpired request/job and committed candidate. Recheck authorization and expiry transactionally after storage reads. Explicitly bind the candidate **primary key, jobId and batchId** to the requested target, as well as its canonical path/hash/size. A self-consistent candidate copied under another key is still invalid.

Only one verified full file is kept in the TTL cache, bounded by configured bytes and file expiry. Cache keys include user ID and immutable job/batch/file/hash/size. Concurrent reads for the same file share a promise in a per-key map only while it is in flight; `finally` deletes only its own promise. An A/B/A interleave must read two files rather than restarting A. Every cache hit retains authorization checks; logical deletion revokes access before physical cleanup. Platform concurrency must account for temporary memory used by simultaneous cold reads.

CloudBase's current adapter downloads a complete file on cold cache misses; do not pretend it supports ranged reads. The warm cache avoids repeating a full 18 MB read for each chunk. Revalidate real memory/cost/duration limits before deployment.

## History and activity

Admission writes the reverse-time `generation_history` index in the original transaction. The signed cursor is bound to the user and cannot become an arbitrary query. Filtering may yield an empty/short page with a non-null cursor; clients must continue it. Pre-index development data requires explicit idempotent backfill, not a false complete-history claim. Retention removes indexes with their authorized records.

Valid first-chunk delivery records the day's minimal idempotent activity fact; metadata queries, later chunks, retries and repeated downloads do not multiply unique activity or consume credits. Responses contain no article/title/layout or internal file reference.

## Checks

Run service and real-PDF integration checks. Cover >100 indexed jobs, malformed/cross-user cursors, hidden/expired records, wrong candidate key/association, post-read revocation, size/offset limits, single-file eviction/TTL, in-flight interleaving and defensive byte copies. Reassemble actual multipage and 18 MB PDFs from chunks and compare full hashes; validate repeated delivery does not render or debit again.
