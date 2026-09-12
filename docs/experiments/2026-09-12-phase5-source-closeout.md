# Phase 5 source closeout

Date: 2026-09-12

Status: accepted and closed for source-product scope

## Decision

Phase 5 is closed at the Rove source-product boundary. Packaging, installer
production, distribution signing, and release bundling are explicitly excluded
from this decision and remain future release work. No package or bundle was
created during this closeout.

The historical Phase 5 plans and experiment reports remain evidence of the
sequence of failures and corrections. This record supersedes their open P5.9
status statements; it does not rewrite their historical results.

## Final corrections

The final closeout corrected the customer-facing issues found during source
Desktop use:

- new-task and in-task messages use the same attachment-capable composer;
- all selected files are sent as ordered Codex inputs and remain visible on the
  corresponding user-message card;
- tasks remain conversational after a turn, including interrupted turns, rather
  than being constrained to one launch/one completion;
- finishing, retrying cleanup, archiving, unarchiving, and starting another task
  are available from durable task truth;
- browser profiles are only considered occupied while a task actually retains
  ownership; Rove does not silently switch a new task to Guest;
- the browser card opens or reveals the task browser and the browser companion
  remains recoverable when focus moves between Rove and the browser;
- welcome-only chrome no longer conflicts with macOS traffic controls while the
  normal task shell retains Rove identity;
- request-human results accept monotonic Runtime observation advancement and
  historical completed handoffs are idempotent by durable identity; and
- orphan Runtime reconciliation tolerates a verified child completing teardown
  without weakening the refusal to terminate an unproved or PID-reused process.

## Source acceptance evidence

The closeout gate intentionally used no build, package, or bundling command.
The accepted checks are:

- repository tests: 172 files and 1,276 tests;
- process-backed production lifecycle traces: 5/5;
- real stop/restart interruption matrix: 21/21;
- P5.0 deterministic contract fixtures: 75/75;
- P5.9 native lifecycle L0: 55 fixture cases, 10,080 exhaustive states,
  64 model sequences, 63,443 assertions;
- source campaign recovery tests: 7/7;
- workspace TypeScript check: passed;
- workspace ESLint check: passed;
- changed-file Prettier check and `git diff --check`: passed.

The source campaign and manual Desktop runs performed during Phase 5 remain the
live product evidence. This closeout did not repeat external-service mutations
or claim a packaged application result.

## Deferred release work

Packaging and bundling are not Phase 5 blockers under this decision. When a
release candidate is requested, treat the following as a separate release gate:

1. create the production renderer/application bundle;
2. assemble and sign the desktop package;
3. run packaged smoke and component-provenance checks; and
4. record distribution-specific results in a new release artifact.
