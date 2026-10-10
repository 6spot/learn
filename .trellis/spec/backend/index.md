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
| [Shared Paper Contracts](./paper-contracts.md) | User/preset boundary, source spans, font units and renderer contract | T03 implemented; complete layout/rendering tracked separately |
| [Shared Font Metrics](./font-metrics.md) | Verified original bytes, deterministic shaping, source provenance and exact outlines | T04 locally verified; production fonts/devices/printing pending |
| [Accounts and Presets](./account-presets.md) | Trusted identity, monthly credit ledger and immutable registry | T12/T13 locally verified; production integration pending |
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
