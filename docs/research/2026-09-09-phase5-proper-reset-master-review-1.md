# Phase 5 proper reset — Master review 1

**Date:** 2026-09-09  
**Decision:** Rejected as one implementation pass  
**Next action:** Re-run the bounded implementation from the production composition inward  
**Broad tests, live journeys, and packaging:** Not authorized by this review

## Outcome

The event-ledger direction remains appropriate, but this implementation does not satisfy the approved reset contract. The new core is internally coherent in several places, yet the production edge omits capabilities that a real Rove task needs and the claimed acceptance campaign does not exercise the required production composition or real interruption points.

This is not accepted as a nearly complete implementation with a list of small corrections. The pass is rejected as a whole. The next implementer may reuse sound code only after proving it through the replacement campaign below; it must not preserve a component merely to minimize the diff.

## Blocking findings

### 1. A launched Codex task is not bound to Rove MCP

`CodexExecutionCoreOptions` still requires `mcpLaunch`, but the production composition never passes it to the command adapter. `lookup_or_start_codex_thread` and `thread/resume` omit:

- the required Rove MCP server configuration;
- the task/session capability and verifier;
- task, Runtime session, mode, and browser-identity bindings;
- the required MCP catalog/provenance check;
- browser-route and attachment instructions;
- reasoning-effort configuration and the deny-by-default browser/tool settings previously enforced at launch.

Consequently, a task can appear to start and persist correctly while the Codex agent has no authenticated Rove connector.

Evidence:

- `apps/companion/src/main/codex/execution-core.ts:44-55,120-131`
- `apps/companion/src/main/codex/codex-runtime-task-adapter.ts:292-320,516-534`
- retained production behavior to preserve: `apps/companion/src/main/codex/task-coordinator.ts:1990-2048,5258-5307`

### 2. Pre-launch attachments are accepted by the UI but never made available to the task

The launch aggregate records attachment IDs, but `attachmentRuntime` is unused. The new launch path neither materializes the selected files nor persists attachment readiness, supplies task-scoped attachment instructions, or performs attachment cleanup as part of Finish.

This would make the Drive journey fail even if the lifecycle ledger itself converged.

Evidence:

- `apps/companion/src/main/codex/execution-core.ts:54-55,107-180`
- `apps/companion/src/main/codex/codex-runtime-task-adapter.ts:269-320`
- `apps/companion/src/main/codex/local-product-api.ts:1608-1644`

### 3. Live Runtime and Codex facts do not drive the engine to convergence

The production core subscribes only to App Server events. It does not ingest Runtime ownership or handoff facts. The App Server ingress commits a mapped event but does not wake the worker or notify the product surface after a successful commit. A completed `control.request_human` item is reduced to identifiers only; its trusted result is not converted into a durable continuation and control attention. Conversation item content is also discarded.

Consequences include an invisible or non-actionable handoff, no automatic continuation after Return Control, stale UI state, and an empty/incomplete conversation surface.

Evidence:

- `apps/companion/src/main/codex/execution-core.ts:133-179,183-287`
- `packages/protocol/src/task-engine.ts:618-655`
- `apps/companion/src/main/codex/product-task-port.ts:215-285`
- retained handoff semantics to preserve: `apps/companion/src/main/codex/task-coordinator.ts:4078-4240`

### 4. Producer identities are not safe across a Desktop restart

The product port uses source `local-product-api`, generation `1`, and an in-memory position counter. The command adapter similarly uses source `command-adapter`, generation `1`, and an in-memory counter. Both counters restart from zero while the aggregate and SQLite uniqueness constraints survive.

After restart, a new product intent or the first observed command fact can collide with an earlier source position or be treated as older. The fold also increments aggregate revision before returning an older-generation event as ignored, so an ignored event is not a byte-for-byte no-op.

Evidence:

- `apps/companion/src/main/codex/product-task-port.ts:86-113`
- `apps/companion/src/main/codex/codex-runtime-task-adapter.ts:51-73`
- `packages/protocol/src/task-engine.ts:571-592`
- `apps/companion/src/main/codex/sqlite-task-engine-store.ts:82-95`

### 5. Authoritative archive truth is misprojected

Open and archived thread lists are merged without retaining which list supplied each thread, and `codexTruth` reports every existing thread as `archived: false`. Archive reconciliation therefore cannot reconstruct the actual terminal state from App Server truth.

Evidence:

- `apps/companion/src/main/codex/codex-runtime-task-adapter.ts:90-138`

### 6. The acceptance campaign is not the approved campaign

The approved trace gate required the real production composition, an App Server host over a process-backed stand-in, a Runtime process-backed stand-in, ordered ingress, and assertions only through `LocalProductApi`. The delivered trace suite instead constructs the engine manually, uses in-memory fake RPC/Runtime objects, directly calls `engine.accept`, and bypasses `CodexExecutionCore` and ordered ingress.

The delivered 140-case interruption suite does not interrupt or restart a process. It computes an expected label from the command manifest and asserts that the label belongs to a fixed list. It cannot detect a repeated external action, lost event, stale lease, missing binding, or notification gap.

Evidence:

- approved contract: `docs/research/2026-09-09-phase5-proper-reset.md:326-407`
- delivered trace: `apps/companion/src/main/codex/task-engine-production-traces.test.ts:1-190,220-516`
- delivered interruption matrix: `apps/companion/src/main/codex/task-engine-cut-points.test.ts:1-58`

## What remains valid

The following ideas can remain, subject to the new campaign:

- one SQLite lifecycle ledger;
- closed typed task events and aggregate projection;
- one exhaustive command manifest and adapter table;
- transactional event, aggregate, projection, and outbox commit;
- one-command-at-a-time worker behavior;
- `ProductTaskPort` as the sole lifecycle boundary for `LocalProductApi`;
- removal of the old coordinator from production construction.

## Bounded replacement pass

The second pass must begin by making `CodexExecutionCore` and its process-backed test composition work end to end. It must treat the current Task Engine files as unaccepted scaffolding and may rewrite them.

### Required production behavior

1. **Stable ingress identities**
   - Use identities that survive restart without an in-memory global position: operation-bound product events, command/attempt-bound worker facts, connection-bound App Server sequences, and Runtime generation/observation identities.
   - An ignored older event must leave aggregate and projection bytes unchanged and must not enqueue a command.

2. **Complete launch boundary**
   - Restore persisted task capability issuance and verification.
   - Start and resume Codex with required Rove MCP configuration, task/session/mode/browser bindings, catalog verification, browser-route instructions, attachment instructions, selected model/effort, and deny-by-default non-Rove browser paths.
   - Fail before the first turn if the real thread is not bound to the expected Rove MCP catalog.

3. **Complete attachment boundary**
   - Materialize selected drafts after Runtime binding and before the first Codex turn.
   - Persist readiness/failure as task facts.
   - Clean up through the same Finish state machine.

4. **Complete live ingress**
   - Map all required App Server notifications, including completed conversation items and `control.request_human` results.
   - Corroborate handoff results with Runtime truth before exposing Return Control.
   - Feed Runtime control/inventory changes through one ordered boundary.
   - After every committed fact, run the worker to idle and publish the resulting snapshot through one awaited path.

5. **Complete projection**
   - Preserve bounded conversation content, progress, attention, control-handoff state, and archive state in the task aggregate/projection.
   - Rebuild the same product snapshot after Desktop, Runtime, or App Server restart.

6. **Truth-based restart**
   - On startup and component generation change, enqueue explicit reconcile facts/commands for every non-closed task.
   - Do not replay a possibly accepted external action; read or correlate authoritative truth.

### Required finite evidence

1. Static gates must additionally prove that `mcpLaunch`, capability issuance, attachment Runtime, Runtime observations, event-to-worker wake-up, and product publication are all reachable from `CodexExecutionCore`.
2. The 12 lifecycle traces must construct the real `CodexExecutionCore` and interact only through its `LocalProductApi` and process-backed stand-in protocols.
3. The interruption matrix must actually stop and restart the worker/host process at every cut for every externally consequential command, then assert durable external action counts and final projections.
4. Add explicit Desktop-restart cases for a second product intent and for command facts, proving no source-position collision or silent ignore.
5. Add a launch assertion over actual `thread/start` and `thread/resume` parameters, plus a failing MCP catalog/provenance case.
6. Add attachment materialization/cleanup and completed-handoff-item cases through the production event transport.

Only the focused reset campaign, companion typecheck, changed-file formatting, and `git diff --check` run inside this pass. The repository-wide suite, live service journeys, and packaging remain reserved for the next Master acceptance.

## Master decision rule for pass 2

Pass 2 is accepted only if source inspection and the executable campaign agree that the production composition is the tested composition. Any direct engine mutation, in-process fake substituted for the required process protocol, computed interruption result without an actual restart, omitted production launch binding, or unconsumed live event rejects the pass as a whole.

## Time-bounded amendment after checkpoint

The original cross-product was too large for the intended reset gate. It is replaced by the following smaller proof obligation. This does not weaken compile-time command coverage or the customer lifecycle boundary.

### Static and unit coverage

- Keep static production-reachability gates.
- Keep aggregate invariants.
- Keep exhaustive manifest/adapter coverage for every native command.
- Add explicit restart-safe producer identity and ignored-event no-op cases.

### Five production-composition traces

Each trace constructs the real `CodexExecutionCore`, uses the process-backed App Server and Runtime protocols, and drives the product only through `LocalProductApi`:

1. launch with required Rove MCP, model/effort, temporary or named browser identity, and optional pre-launch attachment → one initial turn;
2. conversation/progress plus Codex attention → durable UI projection → response/resolution;
3. completed `control.request_human` → Runtime corroboration → human control → Return Control → one continuation;
4. Finish from active or handoff state → interruption/settlement → attachment cleanup → Runtime close → archive → closed;
5. Desktop, App Server, and Runtime restart → exact task restoration → second product intent succeeds without identity collision or duplicate external action.

### Twenty-one real interruption cases

Test the seven cut points against one representative command from each external-behavior class:

- repeatable read;
- correlated write;
- uncertain write.

The command manifest statically requires every external command to belong to exactly one of these classes. Each representative case must actually stop/restart the relevant process and verify persisted intent identity, external action count, retained attention/handoff, convergence or explicit recovery, and no work after closure.

This 3 × 7 matrix replaces the 20 × 7 matrix. Adding more cases requires a new Master decision and is forbidden inside the implementation turn.

### Fixed execution limit

The implementation turn may only:

- complete the already-started process driver and replace the invalid trace/interruption tests;
- correct a failure that prevents one of the fixed five traces or 21 interruption cases from exercising the intended production behavior;
- run the focused reset campaign, companion typecheck, changed-file formatting/lint, and `git diff --check` once after the campaign is green.

It may not add new lifecycle features, new trace categories, repository-wide checks, live journeys, build/package/staging, or another follow-up round. If the fixed campaign does not pass, it returns the single blocking invariant to the Master.

## Amended campaign result

**Master decision:** Rejected. No further correction round was started.

The implementation task initially stopped on an invalid aggregate fixture: it represented a paused Runtime session with a non-null controller. The Master normalized the two fixture values to `controller: null`; no production code was changed by that normalization.

The Master then ran the fixed focused campaign once. Results before the stop:

- static production gates: 7/7 passed;
- command completeness: 1/1 passed;
- aggregate contracts: 6/6 passed;
- ledger contracts: 4/4 passed;
- ordered ingress: 2/2 passed;
- process-backed production traces: 1/5 passed;
- process-backed interruption matrix: stopped and not accepted after the production-trace failure.

The passing real trace was Desktop, App Server, and Runtime restart plus a second product intent. The four failing real traces were:

1. attachment/MCP launch and failing-catalog boundary — timed out waiting for the expected product state;
2. conversation/progress and Codex attention — the process driver timed out;
3. completed handoff and Return Control — the process driver timed out;
4. Finish from handoff with attachment cleanup and archive — the process driver timed out.

These failures occur through the real `CodexExecutionCore` process composition. They are not overridden by the green static/unit results. The evidence harness currently suppresses child stderr and reports only polling timeouts, so it does not establish one safe, shared correction. Treating each timeout as a separate edit would recreate the prohibited repair loop.

The Vitest process was interrupted after the fixed production-trace result, and a host-level process check confirmed that no process-backed Rove test Runtime, MCP, App Server, or Desktop driver remained running. Per the amended gate, companion typecheck, formatting/lint, broad tests, live journeys, build, and packaging were not run.

## Subsequent reset acceptance and compatibility closeout

Later bounded corrections completed the amended reset proof. Independent Master review accepted the architecture gate after the focused contracts passed 36/36, the five process-backed production traces passed 5/5, and the real interruption campaign passed 21/21. That decision authorized post-acceptance repository verification; it did not by itself complete Phase 5.

The first repository-wide test run after that acceptance passed 1,125 of 1,149 tests and exposed 24 failures in eight files. The failures were closed as grouped integration causes rather than independent patches:

- reconnect the renderer-facing API fixtures to the ledger task port;
- restore the production unavailable-attachment reselection path through the attachment authority and Runtime materializer;
- route explicit human-return responses through the durable continuation intent;
- reject task-engine decisions at the product seam instead of silently reporting success;
- verify committed semantic transfers against their final required state rather than comparing one observation to itself as a transition;
- align legacy-store compatibility tests with the reset rule that active legacy work is quarantined instead of replayed;
- align durable close/bootstrap assertions with the accepted staged command sequence.

The 30-minute closeout stopped before another repository-wide campaign. Evidence completed inside the window:

- all eight previously failing files covered by focused verification;
- focused product/recovery/persistence tests: 132/132 passed;
- focused semantic-transfer HTTP and Runtime tests: 3/3 passed;
- supporting action-verification, aggregate, ledger, and adapter recovery tests: 33/33 passed;
- workspace typecheck: passed;
- workspace lint: passed;
- changed-file formatting and `git diff --check`: passed.

The remaining acceptance sequence is one repository-wide test run, build and fixed Phase 5 fixtures, source-local external-service journeys, then one package/smoke run only after the live journeys pass.

## Post-closeout repository verification

The single repository-wide campaign completed after the compatibility closeout:

- test files: 163/163 passed;
- tests: 1,149/1,149 passed;
- process-backed production traces: 5/5 passed inside the campaign;
- real process interruption cases: 21/21 passed inside the campaign;
- MCP process E2E: 2/2 passed inside the campaign;
- no unhandled test error was reported.

No correction or repository-wide rerun was required. Build, source-local external-service journeys, and packaging remain separate subsequent gates.

## Build and frozen Phase 5 campaigns

The post-verification build and deterministic fixture gate completed without changing product behavior:

- all eight buildable workspace projects compiled successfully;
- Companion renderer production bundle completed successfully;
- P5.0 contract campaign: 75/75 passed;
- P5.9 native lifecycle campaign: passed;
- P5.9 coverage: 55 fixture cases, 8,640 exhaustive states, 2,880 rejected-state checks, 64 model sequences, 21 semantic cases, 26 transition sequences, 34 rejection cases, and 56,243 assertions.

No package was produced. The next gate is source-local live acceptance; packaging remains last.
