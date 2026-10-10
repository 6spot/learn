# Learn cloud function composition

This directory is source. `npm run build:cloud` produces **`dist/cloudfunctions/learn-service`**, an independently deployable CommonJS function with the pinned `wx-server-sdk` manifest/lock. The function exports `main`, bundles the actual layout, font metrics, PDF, runtime and service code, and keeps only the SDK external. Use `npm run setup` for locked source dependencies. Node.js 20 is the build target; actual CloudBase runtime support, limits and permissions remain part of [final acceptance](../../docs/FINAL_ACCEPTANCE.md).

## Configuration

`config.example.json` is intentionally incomplete and cannot start a production service. Copy it outside version control, fill explicit values, then supply its JSON as `LEARN_DEPLOYMENT_CONFIG`. Supply a separate JSON key-ID-to-base64 map as **`LEARN_SECRET_KEYS`** through the deployment secret/environment facility. Every secret is 32 cryptographically random bytes, standard canonical base64. Generate independent identity, signed-window and fingerprint keys. Do not paste secret values into task notes, logs, source, CLI arguments or this repository.

The runtime environment IDs must differ; `appId` must match trusted WeChat context. `fileIdPrefix` must be verified against actual upload IDs, and `missingDocumentCodes` must contain only SDK codes verified to mean an absent document. Set `platformVerified: true` for production only after the runtime tests have passed. User event fields cannot choose environment or identity.

All credit, expiration and resource limits are required; there are no production quota/retention defaults. See [service configuration](../../packages/cloud-service/README.md). Retention must satisfy service validation; PDF bytes cannot exceed 64 MiB and pages cannot exceed 50. Choose smaller limits from measured CloudBase memory, duration, storage and client delivery budgets. Keep the identity key stable; retain request keys until all matching request protection periods have ended. Removing keys early breaks deduplication and is not a key rotation procedure.

Production composition also requires explicit `stats` and `lifecycle` sections. Set statistics coverage to the first completely covered Shanghai date, with measured scan budgets. Lifecycle values separately bound ledger/activity/audit/inactive-account retention and deletion/late-I/O protection. The historical signed-window upper bound must cover earlier deployments as well as the current window duration. Fill all example nulls and verify the privacy page reports these same values before release; missing sections do not silently disable required privacy behavior.

The binary implements only the current engine version. Declaring an unsupported old engine does not retain its algorithm. A future upgrade must retain required old implementations/resources or follow the compatibility policy before retiring them. Production preset publication additionally requires release acceptance; using this build does not turn candidate fonts into approved production fonts.

`fontUrls` must contain the three exact pinned resource IDs. Host the complete original TTF files at stable HTTPS locations after distribution licensing is accepted. Redirects, credentials in URLs, unexpected lengths and SHA-256 hashes are rejected. Fetches have a deployment-selected deadline of 1–120 seconds. Downloads and metrics are cached within a warm invocation process; failures can retry. No font bytes are bundled into the deployment artifact.

## RPC and execution

Requests are `{method,params}`; replies are `{ok:true,data}` or `{ok:false,error:{code}}`. `rpc.mjs` is the explicit method allowlist. Every business call retains service-side identity, ownership, admin and quota checks. An error response never includes the request or provider message. Maintenance functions are not public RPC methods.

`submitGeneration` awaits preparation, rendering, storage verification and terminal settlement inside the cloud invocation. The client can lose its response while the server still runs; querying the same request/job resolves that uncertainty. This does not claim verified execution after CloudBase terminates an invocation. Recovery uses metadata and existing PDFs and never saves or replays article text.

## Dependency evidence

The official `wx-server-sdk@4.0.2` pins CloudBase dependencies containing old Axios and lodash packages. The lock overrides Axios to the patched **0.34.0** legacy branch; a real local HTTP request verifies the interface used by the SDK. Do not run `npm audit fix --force`: its suggested SDK downgrade is not a validated compatibility fix.

The current SDK still carries `lodash.set@4.3.2` and `lodash.unset@4.5.2` advisories (audit: 4 high, 1 moderate including parent-package propagation). Source inspection places their calls in the SDK realtime watcher. Learn's adapter only uses direct reads, queries and transactions; it never calls `watch`, and stored/request objects reject prototype keys. These findings are recorded, not declared fixed. Re-evaluate the official SDK before production deployment, and do not introduce realtime watchers without resolving them.

## Local verification

`npm run test:composition` rebuilds the function and tests configuration, safe dispatch, immutable request snapshots, bounded/hash-pinned downloads, actual installed SDK surface/HTTP compatibility, standalone artifact imports and safe startup failure. The tests require restored original font resources. Real SDK network permissions, upload IDs, database transactions, disconnect behavior and scheduled execution need the user's final CloudBase configuration and evidence.
