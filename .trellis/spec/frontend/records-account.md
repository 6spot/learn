# Account and generation records

## Scope and owners

Read before changing P04 My, P05 records, P06 detail or their App lifecycle. `record-data.ts` projects safe account/task fields, `record-sessions.ts` owns reads and visibility, and `record-environment.ts` owns the single App PDF downloader. T20 only navigates a known job ID to `/pages/records/detail?jobId=...`; it does not implement another result page. PRODUCT/D-035, DATA_AND_CREDITS/D-034/D-051 and UI_DESIGN own product behavior.

## Data and display

Project an explicit field allowlist before native setData. Never include user identity, request ID, input title/body, layout, file capability or raw provider error. Show Shanghai timestamps, actual terminal state, safe failure descriptions and file availability separately. A failed query can retain last-known state with a visible warning, but cannot turn a task FAILED or keep an enabled file action. Admin navigation requires the current successful account response; old page data cannot authorize it.

## Reads and polling

Page visibility and App foreground jointly control polling. Hide/background invalidates queued and in-flight responses and cancels timers; returning queries again. Concurrent reads share one Promise. Poll only known nonterminal jobs: 5-second normal interval and 15-second error backoff. List polling rotates through at most five pending jobs per round while preserving other loaded rows and the continuation cursor.

List reads consume at most three server responses per action. Empty or short pages with a cursor are not the end: continue within that budget, then expose Continue loading. Validate cursors, projected rows, ordering and duplicates before replacing the visible list. Failed pagination preserves existing valid rows and its continuation. Explicit refresh starts from the latest page.

## Files and cleanup

The one App-owned downloader performs startup housekeeping and verifies complete bytes/hash before writing/opening a PDF. Both Open and Save/share go through it; native reader menu actions are explicit user choices. Received bytes may show download progress, never simulated generation progress. Duplicate taps share one download, and a returning page releases a prior download's busy state without replaying stale messages.

If retrieval reports NOT_FOUND or RECORD_EXPIRED, remove that record's stale delivery action and show a query error. Account deletion/disable/auth revocation invokes central App cleanup and leaves an explicit error instead of an idle loading title. These outcomes do not rewrite the cloud task's terminal state or consume credits.

Central cleanup invalidates every record/account session before clearing owned PDFs. Attempt all owners and propagate LOCAL_DATA_CLEAR_FAILED if any cannot complete. A pending native write requires a retry; its late callback must remove the file and must not open the reader or restore stale metadata. The privacy page owns that retry affordance. Already accepted cloud jobs remain independent of local cleanup.

## Verification

Run `node --test miniprogram/test/records.test.mjs miniprogram/test/privacy.test.mjs miniprogram/test/admin.test.mjs` and the full root TypeScript check. Cover empty/short cursor pages, polling bounds/rotation, hide and background, errors after prior success, retrieval revocation, central cleanup with late metadata/write callbacks, and actual App/P04 routing. Native simulations do not verify real CloudBase permissions, phone filesystem/reader behavior, feedback submission or printing; those remain final acceptance.
