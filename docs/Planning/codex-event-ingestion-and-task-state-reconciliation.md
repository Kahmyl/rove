# Codex Event Ingestion and Task-State Reconciliation

**Status:** Complete for the qualified reconstructible fact families; bounded live-only gaps remain explicit.

## Problem and live evidence

Rove previously treated a successfully delivered App Server notification as the only production path from Codex truth into the durable Task ledger. The reproduced failure reached Runtime `awaiting_human`; the completed `control.request_human` item existed in exact App Server thread history, but the Task ledger retained only the started item. The ledger source positions skipped one connection-level position and later continued. No persisted diagnostic identified the exact exception, so the evidence proves a durable convergence gap but not a particular lost transport message or exception.

The architectural defect was broader than handoff presentation: a reconstructible Codex terminal fact could remain permanently absent after listener, mapping, validation, or ingress failure. Runtime polling could restore Runtime ownership truth but could not reconstruct Codex-owned continuation instruction or policy.

## Authority boundaries

- The SQLite Task ledger and `TaskEngine` remain Rove's only durable product lifecycle authority and reducer.
- Exact bound App Server `thread/read` history is authoritative external reconstruction evidence for supported Codex facts.
- Live notifications are ordered low-latency observations and invalidation signals, not the sole durable truth channel.
- Runtime remains authoritative for session, ownership, and handoff identity. A completed request-human history item composes continuation only when exact Runtime truth corroborates it.
- History reconciliation is read-side evidence. It cannot submit a turn, steer a turn, repeat a tool, approve a request, or dispatch a browser/external action.

## Non-goals

This correction does not replace SQLite, `TaskEngine`, ordered ingress, Runtime polling, Task command/outbox recovery, the continuation or attention models, or the browser safety kernel. It does not add a broker, cloud service, second lifecycle writer, per-Task sequence-gap authority, general attention-system rewrite, or history-driven work dispatcher. Provider archive membership and live-only requests stay with their existing authorities.

## Fact inventory

| Fact family                             | Live observation                                        | Durable destination                                               | Reconstruction class                                             | Recovery behavior                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn started and terminal               | `turn/started`, `turn/completed`                        | Task aggregate Codex turn truth                                   | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY`                            | Exact turn history emits monotonic observations; terminal cannot regress to active for the same turn.                                                       |
| User message materialization            | `item/completed` with `clientId`                        | Conversation item and message-delivery correlation                | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY` when `clientId` is present | Materializes once and never resubmits the message. Missing `clientId` cannot be fabricated.                                                                 |
| Assistant, plan, reasoning-safe summary | item notifications                                      | Bounded conversation projection                                   | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY`                            | Final item is restored exactly once through shared projection. Hidden reasoning content remains excluded.                                                   |
| Ordinary command/tool completion        | item notifications                                      | Bounded conversation projection                                   | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY`                            | Completion/status/output projection is restored without rerunning the tool.                                                                                 |
| File-change item                        | item notifications                                      | Bounded conversation projection                                   | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY`                            | Item completion is restored; history does not authorize applying a change again.                                                                            |
| Completed `control.request_human`       | `item/completed`                                        | Conversation item, continuation, Rove-control attention           | `RECONSTRUCTIBLE_FROM_THREAD_HISTORY` plus Runtime corroboration | The shared normalizer and exact session/handoff/generation checks compose one continuation and attention.                                                   |
| Provider thread archive state           | thread archive notifications and bounded thread listing | Codex provider truth, distinct from local Task archive preference | `REQUIRES_OTHER_AUTHORITY`                                       | Existing exact command/list reconciliation remains responsible; `thread/read` alone does not assert archive membership.                                     |
| App Server server-request attention     | server requests and `serverRequest/resolved`            | Exact generation-fenced attention                                 | `LIVE_ONLY / REQUIRES_OTHER_AUTHORITY`                           | Normal thread history does not expose outstanding wire requests. Loss records recovery-required state; Rove does not manufacture or auto-approve a request. |
| Delta/progress-only presentation        | delta/progress notifications                            | Expendable bounded presentation                                   | `LIVE_ONLY`                                                      | Final reconstructible item wins; lost intermediate progress is not fabricated.                                                                              |

## Previous and missing recovery

Before this correction, ordered ingress provided generation fencing, serialized reduction, commit-before-publication, and duplicate event protection after mapping. Runtime polling restored Runtime state. Command/outbox recovery correlated uncertain Rove-initiated writes. Some legacy/coordinator paths read exact thread history for individual command recovery. None formed a general production convergence boundary for durable Codex observations, and App Server event-delivery failures remained primarily in memory.

The implemented boundary adds a task-bound thread-truth reconciler, shared item/handoff normalization, bounded durable reconciliation diagnostics, and triggers for delivery failure, reconnect, startup, and exact Runtime/continuation contradiction. Acceptance failures now reject the ingress caller after recording recovery state, allowing the owning layer to schedule reconstruction.

Task-ingestion recovery is owned by the ExecutionCore listener that maps and commits the event. A generic host listener failure remains visible in host health but cannot create a Task blocker after the Task listener already committed. Failed events cross one semantic classification boundary: `THREAD_HISTORY_RECONSTRUCTIBLE`, `LIVE_ATTENTION`, `PROVIDER_OTHER_AUTHORITY`, or `EXPENDABLE_PRESENTATION`.

Unresolved durable blockers are keyed by recovery class and exact semantic correlation. Thread history has one exact thread-bound blocker; live attention uses connection generation plus typed wire request identity; provider archive membership uses the exact bound thread membership identity. Success deletes only its matching blocker. Per-class bounds collapse excess uncertainty into a class-specific overflow blocker that stays fail-closed.

## Implementation slices and dependencies

The reconciler depends on the existing qualified history reader, exact persisted Task bindings, shared Codex item normalization, Runtime corroboration for handoffs, and ordered `TaskEngine` acceptance. Each later slice relies on those authority checks; none introduces an alternate write path.

1. Shared Codex item and completed-handoff normalization.
2. Monotonic Task reduction for completed items, terminal turns, and terminal continuation generations.
3. Exact Task/thread/session/source validation around full `thread/read` history.
4. Re-entry through `OrderedTaskIngress` and `TaskEngine`; no direct projection mutation.
5. Bounded triggers and three-attempt reconciliation with no permanent polling loop.
6. Durable bounded metadata: trigger, outcome, thread identity, attempt, event family, and error category; no raw App Server payload.
7. Runtime durable-handoff acknowledgement after Companion ledger commit; `control.wait` returns a bounded retry error until the exact acknowledgement exists.
8. Deterministic multi-family, duplicate, late, isolation, live-only attention, Runtime acknowledgement, and startup tests.

## Compatibility and migration

No SQL migration or destructive data rewrite is required. Existing aggregate JSON is normalized with empty terminal-turn and reconciliation-diagnostic collections. Existing Tasks whose exact App Server history is still available can converge on startup or another trigger. Existing local archive preferences remain separate from provider archive truth. Older Runtime sessions without durable acknowledgement remain readable; a new exact request/repair establishes the acknowledgement before `control.wait` may block.

## Fault-injection matrix

| Injection                                              | Expected result                                                                                                               | Evidence                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Lost request-human terminal                            | History + Runtime reconstruct continuation and pending Rove-control attention; Runtime receives exact durable acknowledgement | Production reconciler SQLite test                 |
| Lost ordinary tool terminal                            | Completed item restored; no tool dispatch                                                                                     | Production reconciler SQLite test                 |
| Lost turn terminal                                     | Terminal turn restored; no turn submission                                                                                    | Production reconciler SQLite test                 |
| Lost assistant terminal                                | Final item restored once                                                                                                      | Production reconciler SQLite test                 |
| Lost user-message materialization with client identity | Item and delivery correlation restored; no message submission                                                                 | Production reconciler SQLite test                 |
| Duplicate history/live fact                            | Same history is idempotent                                                                                                    | Production reconciler SQLite test                 |
| Late started item/turn                                 | Completed item and terminal turn do not regress                                                                               | Production reconciler SQLite test                 |
| Reconnect                                              | Open bound Tasks are scheduled after connection replacement                                                                   | Execution-core trigger and generation-fence tests |
| Restart                                                | Open bound Tasks reconcile before normal recovery publication                                                                 | Execution-core startup recovery test              |
| Multi-Task shared connection                           | Repairing Task A leaves Task B unchanged                                                                                      | Production reconciler SQLite test                 |
| Lost live-only attention                               | No approval is fabricated; history success cannot clear its exact blocker; matching live authority can                        | ExecutionCore recovery ownership test             |
| Lost `serverRequest/resolved`                          | Exact live-attention blocker persists across history reconciliation and clears only on matching resolution                    | ExecutionCore recovery ownership test             |
| Lost provider archive notification                     | Conversation history does not claim membership repair; a later exact provider notification clears its blocker                 | ExecutionCore recovery ownership test             |
| Failed progress/delta                                  | No durable recovery blocker; terminal history remains authoritative                                                           | ExecutionCore recovery ownership test             |
| Unrelated listener failure                             | Task commit remains accepted and no false Task blocker is created                                                             | RPC and ExecutionCore listener-isolation tests    |
| Multiple blocker classes                               | Resolving one authority leaves every unrelated blocker intact                                                                 | Task aggregate recovery-class test                |

## Acceptance conditions

- Exact history repairs supported durable facts through `TaskEngine` only.
- No reconciliation path dispatches external work or user commands.
- Duplicate and delayed observations are idempotent and monotonic.
- The reproduced Runtime/continuation contradiction schedules repair without restart or Task reopening.
- Startup and reconnect schedule bounded recovery for open bound Tasks.
- `control.wait` depends on exact Companion durable acknowledgement, not MCP-process memory alone.
- Diagnostics are bounded and contain identities/categories rather than raw payloads.

## Remaining bounded gaps

Normal `thread/read` cannot reconstruct outstanding server-request wire attention or provider archive-list membership. Those families remain fail-closed or use their existing exact authority. Paginated history is preserved as a compatibility classification but the selected production component remains on its qualified legacy full-history mode. Packaged and live external-account acceptance are outside this task and are not claimed.
