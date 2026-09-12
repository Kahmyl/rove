# Task process manager — Master review 1

**Date:** 2026-09-09  
**Result:** Not accepted  
**Review scope:** The one-hour bounded implementation pass following `2026-09-09-durable-task-process-manager.md`

## What passed

- The platform-neutral `TaskProcessManager`/`TaskStore` types were added to `@rove/protocol`.
- Exact versions of Kysely and `better-sqlite3` were pinned.
- The SQLite adapter enables WAL, `synchronous = FULL`, foreign keys, and a busy timeout.
- The Electron 37.10.3 focused probe loaded `better-sqlite3` successfully with module ABI 136.
- The importer creates read-only backups and records an idempotent source digest.
- Focused tests passed: 99/99 across the Gate 0, SQLite store, importer, and Phase 5 execution files.
- Companion typecheck passed.
- `git diff --check` passed.

## Acceptance blockers

### 1. The durable outbox is not used by production

`SqliteTaskStore.claimDueCommands` exists, but the only non-test implementation reference is its own declaration. Production receives a command ID from the process manager and the coordinator dispatches the external operation directly, then calls `markCommand`.

This bypasses durable claiming, worker generation, lease recovery, and restart-driven dispatch. A command committed before process exit will remain pending indefinitely because there is no production worker to consume it. A command marked `possibly_started` is changed to `reconcile_required` on database open, but there is no reconciler that consumes that state.

**Required correction:** A production `TaskProcessWorker` must be the only component that claims and dispatches lifecycle commands. Coordinator methods append intents/facts and await projections; they must not dispatch from the immediate reducer return value.

### 2. Lifecycle state still advances through independent JSON stores

The production composition still creates `codex-continuations.v2.json`, `codex-task-contexts.v2.json`, and `codex-attention.v1.json`. Bootstrap, handoff/return, and close dispatch paths still call `updateContext`, continuation-store methods, and attention queue persistence separately from SQLite command status.

This retains the original crash window: the external effect or JSON transition may happen while the ledger update does not, or vice versa. The new database is therefore a parallel journal, not the single lifecycle authority.

**Required correction:** For the bounded lifecycle slice, the ledger transaction must own the task record, binding, handoff, attention, continuation, projection, and next command. Legacy JSON may remain as a read-only compatibility projection during migration, but it cannot select or advance work.

### 3. External results are not reducer inputs

`markCommand` stores an optional result object in `reconciliation_json`, but it does not append a validated fact, run the reducer, or atomically commit the resulting task state and next command. The coordinator instead reads external truth and independently re-enters its handwritten loop.

**Required correction:** Accepted, terminal, failed, and unresolved command outcomes must be typed facts processed by `TaskProcessManager.accept`. Recording a fact, updating task state/projection, and planning the next command must be one transaction.

### 4. The manual executor remains a production authority

Launch, Runtime and Codex binding, return control, and close still contain direct handwritten dispatch and stage advancement. The old close implementation also remains selectable whenever optional callbacks are absent. The reducer authorizes some branches, but the coordinator continues to decide execution order and performs the work itself.

**Required correction:** Replace optional callbacks with one required process port in production. Remove the production fallback and make unsupported command types stop at the worker adapter boundary.

### 5. Persisted-state consistency is incomplete

`task_instance.desired_state` is written from the pre-transition input record while `reducer_state_json` is written from the derived record. A `persist_close_intent` decision can therefore store contradictory values in the same row. Command status updates permit unrestricted transitions, and `claimDueCommands` returns the rows selected before checking which rows its guarded update actually claimed.

**Required correction:** Derive indexed columns from the committed record, enforce a command transition table, and return only commands whose claim update succeeded. Add a two-connection claim test.

### 6. Gate 0 does not yet prove real process-cut recovery

The focused transaction test throws before commit, and the lease test closes the store cleanly. They are useful unit checks but do not terminate a child process at the required pre/post-dispatch points. The Electron probe proves source-time native loading, not a packaged application.

**Required correction:** After blockers 1–5 are fixed, add one small child-process interruption harness around the real worker. Package only after source-built lifecycle and live acceptance pass, per the user's verification instruction.

## Verification decision

The focused checks were sufficient to expose the boundary. The repository-wide suite and external live journeys were intentionally not run because the production architecture cannot yet recover or dispatch from its durable outbox. Running them would consume time without satisfying the acceptance invariant.

## Next bounded implementation

Keep the same architecture and tool choices. Do not restart broad research and do not add a workflow platform. The next correction is one cohesive vertical slice:

1. Implement a required `TaskProcessWorker` that claims SQLite commands.
2. Move launch, handoff/return, and finish command execution behind its Codex/Runtime adapters.
3. Convert adapter outcomes into validated reducer facts.
4. Make the ledger authoritative for lifecycle-critical state and make legacy JSON non-authoritative.
5. Add a two-connection claim test and one real process-interruption test.
6. Run the focused lifecycle suite once, then return for Master review before any full or live campaign.

This is a correction to the implementation boundary, not a change to the approved architecture.
