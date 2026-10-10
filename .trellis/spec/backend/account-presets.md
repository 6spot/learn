# Trusted accounts and immutable presets

## 1. Scope / Trigger

Read before modifying `packages/cloud-service`, composing generation transactions or exposing cloud APIs. The [service README](../../../packages/cloud-service/README.md) owns concrete configuration and API usage. Runtime adapters follow [runtime-contracts](runtime-contracts.md).

## 2. Signatures

- `CloudService.getAccount(): Promise<AccountResponse>`
- `publishPreset(preset, acceptance?)`, `activatePreset(versions)`
- `getCompatibility({engineVersion, lockedVersions?})`
- `retirePreset(versions)`, `removePreset(versions)`
- Internal transaction helpers in `credits.ts` and `presets.ts` compose with jobs; do not expose them as client commands.

## 3. Contracts

Every call resolves trusted identity. HMAC(subject + appId) with a stable identity key yields internal user ID; raw OpenID is not stored or logged. Only server `adminUserIds` grants administrator access. Configuration is copied/frozen and production has no implicit quota or key defaults.

Monthly free buckets use `Asia/Shanghai`; first access grants the current month once, skipped months do not accumulate. `available` belongs to the current bucket; returned `reserved` includes outstanding older buckets. A late release goes to its original bucket and expires there after rollover. All grants, expirations, reservations and settlements have deterministic immutable ledger entries in the same transaction.

`AccountResponse` contains `userId,isAdmin,period,available,reserved,monthlyGrant,periodEndsAt`. It contains no raw platform identity. Registry compatibility returns `engineSupported,current,locked,serverTime`; each preset availability is `ready`, `update-required`, `retired`, `resource-unavailable` or `not-found`.

Publishing validates core geometry and actual trusted resource bytes against length/SHA-256 descriptors. One immutable version tuple is published once; a separate pointer selects the template's sole active version. A supported old locked session remains usable when a newer active engine requires update. Production publication requires validated-release stage and authenticated license/print/resource acceptance with evidence; development fixtures are not production acceptance.

Retirement prohibits new admissions. Existing job references remain loadable; removal requires retired state and zero references in a transaction, and preserves tombstone/audit. Registry removal does not delete shared font binaries.

## 4. Validation & Error Matrix

| Situation | Behavior |
|---|---|
| Client supplies identity/admin/balance | Never used as authority |
| Missing identity, disabled/deleted user | Reject safely |
| Concurrent account creation or month access | One grant, no negative balance |
| Invalid reserve/settle amount or outcome | Reject before any write |
| Duplicate settlement | Existing result; no second consume/release |
| Unknown or unsupported version/resource | Explicit unavailable/reject; no fallback |
| Non-admin, existing tuple overwrite or active/referenced removal | Reject, preserve data |
| Unknown adapter/crypto error | Fixed safe error, no vendor payload |

## 5. Good / Base / Bad Cases

Good: settle a September reservation in October against September, leaving October's quota unchanged. Base: concurrent first account calls all observe one monthly grant. Bad: decrement reserved for an unvalidated settlement outcome, or trust client `stage`/`acceptance` without authenticated administration.

## 6. Tests Required

`npm run test:service` compiles dependencies and service, then covers concurrent grants, timezone boundaries, old reservations, ledger conservation, runtime invalid inputs, permissions, registry immutability, byte hashes, old locked compatibility, production gates and reference/removal races. Generation must add task-state/batch/deadline checks around these primitives; primitive tests alone do not prove an accepted job is reliably executed.

## 7. Wrong vs Correct

Wrong: reserve in one transaction, then create the job later; return stored available as a current-month balance without rollover; remove font files when retiring a preset.

Correct: combine job/idempotency/reservation/ledger/reference writes atomically, validate settlement against the current task inside its transaction, and retire versions without invalidating in-flight resources.
