# Task process manager — Master review 2

**Date:** 2026-09-09  
**Result:** Not accepted at the 30-minute cutoff  
**Scope:** Independent review of the bounded production-worker correction

## What passed

- Production now composes a `TaskProcessWorker` over the SQLite outbox.
- Worker outcomes re-enter `TaskProcessManager` as facts.
- SQLite command claims are atomic and command transitions are guarded.
- Frozen launch state plus the lifecycle record can rebuild a missing or stale task-context compatibility snapshot.
- Startup restores compatibility context before outbox recovery.
- Recovery origin now survives a process cut after a reconciliation claim is accepted; a second child-process cut proves the next start reconciles again rather than dispatching fresh work.
- Focused Master verification passed: 105/105 lifecycle tests, then 9/9 final worker/store/recovery tests; companion typecheck and `git diff --check` passed.

## Remaining acceptance blocker

The ledger is not yet the sole lifecycle authority for handoff, continuation, and attention state.

- Production still restores `codex-continuations.v2.json` and `codex-attention.v1.json` before running the outbox.
- `returnControlForTask` requires the JSON-backed continuation store before it appends the lifecycle intent.
- SQLite writes copies to `task_handoff` and `task_attention`, but `TaskStore` exposes no corresponding read/rebuild operations. Those rows therefore cannot restore the product when the JSON compatibility files are missing or stale.
- The worker still updates the JSON-backed task context while executing internal lifecycle commands. This is acceptable only as a disposable projection after the ledger transaction; it cannot remain required to decide or resume work.

This is the same boundary identified in Master review 1, blocker 2. The worker/outbox correction is materially stronger, but full or live acceptance would give a misleading result while restart recovery still depends on the old stores.

## Decision

Stop at the clock. Do not run the repository-wide suite, external live journeys, or packaging.

The next bounded pass must add typed ledger reads for bindings, handoffs/continuations, and attention; rebuild those projections from ledger plus fresh Codex/Runtime truth at startup; remove JSON-backed state from lifecycle decisions; and prove recovery with the compatibility files missing. No new architecture research or workflow platform is required.
