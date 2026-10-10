# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

Learn uses provider-neutral TypeScript business services and CloudBase adapters. Read the runtime contract and authority documents before cloud work. Existing scaffold entries below are not implemented conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Runtime Contracts](./runtime-contracts.md) | Metadata transactions, private storage, trusted identity and awaited execution | Implemented T11 ports; real CloudBase verification pending |
| [Shared Paper Contracts](./paper-contracts.md) | User/preset boundary, source spans, font units and renderer contract | T03/T05/T06/T07 implemented and locally verified |
| [PDF Rendering](./pdf-rendering.md) | Exact glyph operators, full original-font embedding and immutable byte snapshots | T09 locally verified; physical printing pending |
| [Shared Font Metrics](./font-metrics.md) | Verified original bytes, deterministic shaping, source provenance and exact outlines | T04 locally verified; production fonts/devices/printing pending |
| [Accounts and Presets](./account-presets.md) | Trusted identity, monthly credit ledger and immutable registry | T12/T13 locally verified; production integration pending |
| [Administrator Statistics](./admin-statistics.md) | Shanghai daily facts, bounded complete scans and honest deletion coverage | T22 backend; native UI and platform acceptance tracked separately |
| [Privacy and Lifecycle](./privacy-lifecycle.md) | Revocation, finite protection, resumable cleanup and honest coverage | T23 backend; native UI and platform acceptance tracked separately |
| [Private File Delivery](./file-delivery.md) | Authorized reverse-time history, bounded chunks and verified cache | T17 locally verified; actual storage/phone delivery pending |
| [Job Recovery](./job-recovery.md) | Resumable maintenance scans, bounded work and safe existing-file recovery | T16 locally verified; platform scheduling pending |
| [Job Execution](./job-execution.md) | Awaited PDF rendering, candidate verification, atomic settlement and cleanup fencing | T15 locally verified; T16 recovery and T17 private access verified |
| [Job Admission](./job-admission.md) | Signed request windows, atomic dedup/reservation and awaited execution contract | T14 locally verified; T15 actual PDF integration verified |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
