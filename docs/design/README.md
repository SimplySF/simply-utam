# SimplyUTAM Design Documents

This directory contains the architecture documents and topic design records for **SimplyUTAM** (`@simplysf/simply-utam` and `@simplysf/simply-utam-core`).

## Topic Index

| Document                                 | Title                          | Status   | Description                                                                                                                                             |
| ---------------------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [solution-design.md](solution-design.md) | Solution Design & Architecture | Accepted | Core system architecture, monorepo boundaries, transformation pipeline, offline step scaffolding engine, runtime test environment, and oclif CLI suite. |

## When a Design Document is Required

A design document is required **before** implementation when:

1. Introducing a new CLI command or subpackage.
2. Changing user-visible flags, outputs, error handling contracts, or JSON output structures.
3. Modifying core library architectural boundaries (e.g. `@simplysf/simply-utam-core` public subpaths).
4. Changing Salesforce authentication, session impersonation, or runtime navigation behavior.
5. Modifying AST parsing or code generation heuristics in rules, overrides, namespaces, or step generators.

## Document Lifecycle & Process

1. **Draft**: Author a markdown document in `docs/design/` outlining the problem, alternatives considered, technical design, and testing approach.
2. **Review & Agree**: Obtain team consensus before initiating large-scale code changes.
3. **Implement**: Execute implementation, keeping tests in sync.
4. **Update on Landing**: After implementation lands, update the document to reflect the shipped reality, update its status, and update this index. A design document that disagrees with shipped code creates technical debt.
