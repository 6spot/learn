# Administrator statistics

Read for `getAdminStats`, activity events or retention/deletion affecting its sources. D-049 and [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md#6-统计口径) own the metric meanings. `packages/cloud-service/src/stats.ts` aggregates safe source records; `stats-date.ts` defines Shanghai dates; `stats-coverage.ts` owns internal transaction helpers.

## API and facts

`getAdminStats({date?})` defaults to the server's current Shanghai date. Explicit dates must be real `YYYY-MM-DD` dates and not in the future. Configuration explicitly supplies `coverageStartDate`, `pageSize`, `maxScanRecords` and `maxRunMs`. A missing stats configuration is unavailable, never an implicit production policy.

Count first account creation from users, distinct user/day facts from daily_activity, task terminal outcomes from generation_jobs, and consumed credits from CONSUME ledger records. New-job admission writes activity in the same transaction at admission time; preparation outcome, midnight crossings, retries and polling do not move or multiply it. Valid PDF delivery writes activity only for offset zero after authorization. An additional first-chunk download on another day can count that day's user; subsequent chunks alone cannot.

Authenticate the trusted active administrator before scanning and again in the final audit transaction. Never accept client roles or expose user IDs, title/body, layout, fingerprints or file capabilities in the response. `STATS_READ` audit contains safe operation facts.

## Complete scanning and coverage

Scan every page with stable ID cursors and validate source IDs/fields. Global record/time budgets fail with `STATS_LIMIT_EXCEEDED`; truncated totals are not successful results. `generatedAt` is an observation cutoff, not a cross-query database snapshot. Concurrent additions may appear on the next refresh. No terminal denominator means a null failure rate.

Coverage reports per-source starts and date/source gaps; missing metrics (including template totals) are null, never fabricated zeros. Delete source records in the same transaction as `markStatsCoverageGapInTransaction`, which stores no user identifier. Natural retention can advance the source floor monotonically before deleting older facts. Coverage state revisions are checked before and after aggregation; a concurrent change returns `STATS_CHANGED`. Gap records below their source floor may be cleaned, but deleting personal records must never restore a false claim of complete statistics.

## Verification

Run `npm run test:service` and the actual PDF integration when changing activity placement. Cover Shanghai midnight, preparation failure/rollback, retry and non-first PDF chunks, more than one scan page, budgets, missing coverage, concurrent coverage mutation and disabled/non-admin users. Root composition tests cover RPC identity rejection and actual PDF/credit/DAU totals. Production scan cost, permissions, retention values and scheduled cleanup remain explicit configuration acceptance.
