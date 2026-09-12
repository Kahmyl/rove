# Phase 5 proper reset: finite task-engine replacement

**Date:** 2026-09-09  
**Status:** Approved architecture for one replacement implementation; production acceptance remains open  
**Decision owner:** Master Engineering Agent  
**Scope:** Task launch, message/turn control, App Server attention, browser handoff and return, finish, archive, restart recovery, projection, and the transition into the external live-journey campaign

## Executive decision

The present Phase 5 integration shell is rejected. It must not receive another incremental correction.

Rove will retain the parts that already express stable product responsibilities:

- the generated native lifecycle reducer and validators;
- SQLite, Kysely, and `better-sqlite3` as the local transactional adapter;
- the Codex App Server schema validators and account/catalog service;
- the Runtime browser/session implementation;
- the versioned product API contract and unified renderer;
- attachment, browser-workspace, and browser-interaction subsystems that are outside task-lifecycle authority.

Rove will replace the production integration shell that currently joins those parts:

- `TaskProcessInput` as a caller-supplied full lifecycle snapshot;
- the fallback merge in `TaskProcessManager` where an empty continuation, attention list, or inspection can mean “retain the prior value”;
- `compareLifecycleDecision` in `CodexExecutionCore`;
- `RoveTaskCoordinator` as a combined decision-maker, external adapter, projection builder, compatibility store, and recovery loop;
- direct lifecycle-related attention and continuation updates in `LocalProductApi`;
- optional `taskProcessDriver` branches and the parallel manual lifecycle path;
- fire-and-forget delivery for events that must become durable before the UI can act on them.

The replacement is a small **Task Engine**. It accepts typed intents and facts, folds each one into a durable aggregate, derives the exact native lifecycle input, asks the existing reducer for the next command, and atomically records the aggregate, projection, accepted input, and outbox command. A thin command adapter performs only the selected command. Its result re-enters the engine as a typed fact.

This is a replacement of one production boundary, not a rewrite of Rove and not a new workflow platform.

## Frozen baseline

No production implementation is accepted at this baseline. No full-suite, live-journey, or package result may be used as acceptance evidence for it.

- Git base: `a108622a4dd42acf883dcce6a41a033dcfed3dbe`
- The worktree contains 118 tracked modified files plus new files from Phases 1–5.
- The central Phase 5 lifecycle surface is 13,881 lines across the reducer/process, coordinator, execution core, worker/store, product API, transport, attention, continuation, conversation, and importer files.
- `RoveTaskCoordinator` is 5,301 lines.
- `LocalProductApi` is 1,871 lines.
- Seventeen production branches still select between `taskProcessDriver` and the earlier path.
- The stopped transport correction changed the baseline but was not reviewed or accepted. It may be reused only if it satisfies this document’s ingress contract and tests.

Key baseline fingerprints:

| File | SHA-256 |
|---|---|
| `packages/protocol/src/native-lifecycle-contract.ts` | `aa28b13037346405b99431b54b7da23bb63a4d23612a053f12a9d4c4084038b8` |
| `packages/protocol/src/task-process.ts` | `83376fc9b794a2cf4b73a51337713f8033f3b4481107c6d4bda6c46564cea77c` |
| `apps/companion/src/main/codex/execution-core.ts` | `5a3f2b5d25dcb6bc91dfd5bf9bf2e899ef665d7367dba8a0fbcfa4bbc1ac4859` |
| `apps/companion/src/main/codex/task-coordinator.ts` | `cad9bfe2dd893ecabef49bcf9a29222e6f36ec4a70f4888ec17b7b97c6439b4f` |
| `apps/companion/src/main/codex/task-process-worker.ts` | `d56556133315bdacde79bc7490d2307b20d4c3e762eef36aedddac54e5448fdd` |
| `apps/companion/src/main/codex/sqlite-task-store.ts` | `b002fe235799bff4c8de27e706889a6131e8fd39df653c532ffd0837a1b8581f` |
| `apps/companion/src/main/codex/local-product-api.ts` | `ee61ac8a0368c9aae1fd50ffbe5614cb459432a8f99815d4f9e2bbb43226c9ae` |
| `apps/companion/src/main/codex/rpc-connection.ts` | `3475a0b4924fdbb890ad3eb1ff4da1b502880d3b41fa9b3307bfa6404bf73f12` |
| `apps/companion/src/main/codex/app-server-host.ts` | `30356cd6d2b1c9a1000290d1e9703957e611500151cc426cf5e0f5cc233729aa` |

## Why the prior implementation could not converge

### 1. A snapshot is being used as both state and event

`TaskProcessInput` carries a complete `NativeLifecycleInput`. `TaskProcessManager.accept` merges that caller snapshot with its stored snapshot. Empty values are treated as “no change” for continuation, attention, and fresh inspection.

That is not a deterministic event fold. It makes these two different facts indistinguishable:

- “there are now zero pending attention requests”; and
- “the caller did not provide attention information.”

Consequently the aggregate cannot reliably clear prior state. More local conditions cannot solve that ambiguity.

### 2. The ledger is consulted after a second component has already assembled truth

`CodexExecutionCore.compareLifecycleDecision` asks the ledger for prior state and performs another selective merge before calling `TaskProcessManager`. `RoveTaskCoordinator.lifecycleDecisionForTask` has already read Runtime, Codex, continuation, attention, and context state to construct the input.

The real flow is therefore:

```text
several mutable stores and live reads
          │
          ▼
handwritten coordinator assembles a snapshot
          │
          ▼
execution core merges it with ledger state
          │
          ▼
task manager merges it again
          │
          ▼
native reducer
```

The reducer is the last decision function, but it is not the owner of how facts become state.

### 3. The old and new execution paths coexist

Production supplies `taskProcessDriver`, but the same coordinator retains full direct launch, return, close, resume, archive, continuation, and recovery flows when the optional driver is absent. This makes source review, test composition, and future maintenance unable to prove that every production entry point crosses one boundary.

### 4. Product commands still complete lifecycle transitions outside the ledger

After lifecycle calls, `LocalProductApi` directly cancels, resolves, or flushes attention records. Handoff and continuation projection is also maintained through in-memory compatibility services. Those writes may be reasonable projections, but their placement makes them part of task completion behavior.

### 5. Unit composition differs from production composition

Several focused tests directly await fake event listeners. The production transport historically accepted synchronous listeners and did not await asynchronous durable observers. This allowed a passing test to prove behavior that the actual host did not provide.

### 6. The review method had no finite proof obligation

Review inspected one seam after another. Each correction exposed the next seam. The correct unit of review is the complete lifecycle boundary plus a generated cut-point campaign, not the most recently changed method.

## Official App Server boundary

The official Codex App Server documentation defines the external truth Rove must consume:

- notifications are the stream for thread, turn, item, and request-resolution lifecycle;
- `turn/completed` supplies terminal turn status, including interruption and failure;
- `serverRequest/resolved` confirms that a pending request has been answered or cleared;
- `item/completed` is authoritative for the final item;
- `thread/read` reads stored truth without resuming or subscribing;
- `thread/resume` reopens a stored thread so later turns can append.

Rove must treat response acceptance and later terminal notifications as different facts. It must also be able to reconstruct from `thread/read` when a notification was not durably accepted before a process stop. See the [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Authority map

| State | Sole authority | Rove representation | Recovery rule |
|---|---|---|---|
| Task identity, frozen launch configuration, desired state | Task Engine ledger | Durable aggregate | Read ledger |
| Accepted user intent | Task Engine ledger | Typed event with stable operation ID | Deduplicate by task + operation ID |
| Planned lifecycle command | Native reducer + Task Engine ledger | Transactional outbox row | Claim or reconcile |
| Codex thread, turn, item, archive, and pending-request truth | Codex App Server | Validated fact plus disposable projection | `thread/read`, list, resume, or later notification |
| Runtime session, ownership generation, handoff, observation, workspace attachment | Rove Runtime | Validated fact plus durable binding | Runtime inventory/control inspection |
| Human handoff correlation and continuation intent | Task Engine ledger | Aggregate handoff record | Join exact task/session/thread/handoff/generation |
| Attention status | Task Engine ledger, confirmed by App Server or Runtime | Aggregate attention record | Resolution notification, turn truth, or Runtime truth |
| Conversation display | Codex App Server | Disposable bounded projection | Rebuild from stored thread and events |
| Renderer state | Task Engine projection | Versioned snapshot/subscription cursor | Re-read projection |
| Account/login/model/usage | Codex App Server | Account/catalog projection | Refresh App Server |
| Browser actions, downloads, uploads, and page state | Rove Runtime | Runtime evidence and receipts | Runtime inspection/evidence |
| Attachment draft selection | Attachment subsystem | Draft manifest before launch | User reselects if unavailable |

The renderer, `LocalProductApi`, event listeners, and command adapters never advance lifecycle state directly.

## Replacement topology

```text
Renderer
  │ versioned intent
  ▼
ProductApi adapter
  │ typed TaskIntent
  ▼
TaskEngine ───────────────► SQLite TaskStore
  │                           ├─ accepted event
  │ exact aggregate fold      ├─ aggregate revision
  │ native reducer            ├─ product projection
  │                           └─ outbox command
  ▼
TaskWorker
  │ one exact command
  ▼
Codex/Runtime adapter
  │ typed outcome or observed fact
  └────────────────────────► TaskEngine

Codex ordered event ingress ─► typed Codex facts ─► TaskEngine
Runtime observation ingress ─► typed Runtime facts ─► TaskEngine
```

### Required new boundaries

#### `TaskEvent`

Use a closed, versioned discriminated union. It contains no caller-computed lifecycle snapshot.

Minimum intent variants:

- `task_launch_requested`
- `task_message_requested`
- `task_return_requested`
- `task_finish_requested`
- `task_cleanup_retry_requested`
- `task_archive_requested`
- `task_unarchive_requested`
- `attention_response_requested`
- `explicit_continuation_response_requested`

Minimum fact variants:

- `codex_availability_observed`
- `codex_thread_observed`
- `codex_turn_observed`
- `codex_item_observed`
- `codex_request_observed`
- `codex_request_resolved`
- `runtime_inventory_observed`
- `runtime_control_observed`
- `runtime_handoff_observed`
- `command_outcome_observed`
- `attachment_state_observed`
- `host_generation_changed`

Every fact has a stable source identity. A repeated identical identity is idempotent; the same identity with different validated content is a consistency error that stops only the affected task.

#### `TaskAggregate`

The aggregate is a strict versioned object containing:

- task identity and frozen launch configuration;
- desired state;
- Codex binding and latest authoritative summary;
- Runtime binding and latest authoritative summary;
- active handoff and continuation state;
- attention map;
- attachment readiness;
- current requested operation;
- processor generation and last accepted source positions.

An incoming component snapshot replaces that component’s previous summary exactly. Empty arrays and `none` are explicit values. There is no truthy, nullish, or length-based fallback merge.

#### `TaskEngine.accept`

One transaction must:

1. validate and deduplicate the event;
2. load the exact aggregate revision;
3. fold the event into the aggregate;
4. derive a complete `NativeLifecycleInput` from the aggregate;
5. invoke the native reducer;
6. create at most one next command;
7. commit the accepted event, aggregate, projection, and outbox row.

The engine must not mark the reducer command as completed before its outcome fact. Local persistence commands may be completed inside the same transaction only if their transition is pure and represented as an explicit internal command class.

#### `TaskCommandAdapter`

The adapter receives one closed command variant and current stable bindings. It may:

- execute the exact external request;
- read authoritative truth for reconciliation;
- return a typed fact.

It may not call the reducer, enqueue another command, mutate renderer state, or run a convergence loop.

All native lifecycle command variants must be exhaustively classified at compile time:

- pure ledger transition;
- repeatable read;
- externally correlated write;
- externally uncertain write requiring truth-based reconciliation.

#### Ordered event ingress

One App Server connection has one ordered asynchronous ingress queue. A later event cannot overtake an earlier event. The UI does not expose a request until its accepted-event transaction commits. Listener failure is surfaced as a recoverable product state and is never an unhandled promise rejection.

Connection replacement fences the old generation. Shutdown waits for accepted ingress work or records that recovery is required. Restart reads App Server and Runtime truth before continuing commands.

#### `ProductTaskPort`

`LocalProductApi` depends on a small interface:

- submit a typed task intent;
- read a versioned product projection;
- subscribe from a cursor;
- perform account and attachment operations that are explicitly outside task lifecycle.

It does not depend on `RoveTaskCoordinator`, `OrderedAttentionQueue`, or `DurableContinuationStore`. It never performs a follow-up lifecycle mutation after an intent returns.

## Retain, replace, and remove from production

| Asset | Decision | Condition |
|---|---|---|
| Native lifecycle reducer/validators | Retain | Input is derived only from `TaskAggregate` |
| `TaskStore` portability goal | Retain | Redefine around typed events and aggregate revisions |
| SQLite/Kysely/driver | Retain | One migrated schema and one production authority |
| Existing SQLite tables | Migrate | Old rows become read-only migration input; production uses the new aggregate/event schema |
| `TaskProcessWorker` idea | Retain | Worker consumes only durable commands and emits typed facts |
| Current `TaskProcessManager` merge implementation | Replace | No full-snapshot input and no fallback merge |
| `compareLifecycleDecision` | Remove | No second merge or comparison callback |
| Current `RoveTaskCoordinator` production role | Replace | Legacy-only importer/test helper may remain temporarily, unreachable from production composition |
| Current command execution logic | Extract selectively | One adapter method per command, no orchestration |
| Memory continuation/attention/context repositories | Remove from production lifecycle | Optional bounded display caches only |
| Conversation projection service | Retain as disposable cache | It cannot select commands or gate lifecycle intents |
| App Server host and validators | Retain | Must satisfy ordered async ingress and generation fencing |
| `LocalProductApi` and renderer | Retain contract/UI | Route lifecycle only through `ProductTaskPort` |
| Legacy JSON importer | Retain once | Transactional conversion, then old files are archival evidence only |

## One implementation task

The replacement is performed in one implementation task with internal checkpoints. The implementer does not ask the Master to accept intermediate checkpoints and does not run the external live campaign.

1. **Contract checkpoint**
   - Add closed `TaskEvent`, `TaskAggregate`, `TaskProjection`, and command-outcome schemas in the platform-neutral protocol package.
   - Replace full-snapshot `TaskProcessInput` and remove fallback merge semantics.
   - Generate compile-time completeness checks for event and command unions.

2. **Ledger checkpoint**
   - Add the new schema in one migration.
   - Implement atomic event/aggregate/projection/outbox commit.
   - Implement optimistic revision and per-task serialization.
   - Convert active legacy state transactionally; ambiguous tasks become `recovery_required` without dispatch.

3. **Engine/worker checkpoint**
   - Implement exact event fold and aggregate-to-native-input derivation.
   - Implement one-command worker and typed outcome re-entry.
   - Exhaustively implement execute/reconcile behavior for every command.

4. **Ingress/adapters checkpoint**
   - Add ordered App Server ingress and old-generation fencing.
   - Feed Runtime and App Server facts directly to the engine.
   - Extract external command methods from the coordinator without retaining its loops.

5. **Product cutover checkpoint**
   - Introduce `ProductTaskPort`.
   - Make production `CodexExecutionCore` compose only the new engine.
   - Make lifecycle renderer intents submit exactly one task intent.
   - Make product projections read from the engine ledger.
   - Remove the old coordinator, compatibility stores, and optional-driver path from production reachability.

6. **Focused proof checkpoint**
   - Run only the finite campaign below, companion typecheck, lint on changed files, formatting, and `git diff --check`.
   - Return for independent Master review. Do not package and do not run external services.

## Finite acceptance campaign

### A. Static source gates

All must be mechanically checked:

1. Production composition has exactly one `TaskEngine` and one task SQLite store.
2. `LocalProductApi` imports only `ProductTaskPort` for lifecycle work.
3. Production does not construct `RoveTaskCoordinator`.
4. No production lifecycle branch checks an optional driver/callback.
5. No production lifecycle read references the four legacy JSON filenames.
6. No task event contains `NativeLifecycleInput` or a caller-supplied aggregate.
7. No fallback merge treats `none`, `null`, or an empty list as “retain prior.”
8. Every native command has exactly one compile-time classification and adapter branch.
9. Every renderer lifecycle action maps to exactly one typed intent.
10. No fire-and-forget call surrounds `TaskEngine.accept`, command-outcome recording, or ordered event delivery.

### B. Aggregate contract tests

1. Duplicate identical event is a no-op.
2. Duplicate identity with changed payload is rejected.
3. Empty attention replaces prior attention with empty.
4. No continuation replaces a prior settled continuation with none.
5. A newer component observation replaces only that component summary.
6. An older source generation cannot overwrite a newer one.
7. Invalid cross-record task/session/thread/handoff identities are rejected.
8. Projection is reproducible byte-for-byte from the aggregate.

### C. Generated command completeness

For every native lifecycle command type:

- a compile-time adapter mapping exists;
- execute behavior is classified;
- reconcile behavior is classified;
- its outcome fact is validated;
- an unsupported or newly added variant fails the manifest check before runtime.

### D. Production-composition lifecycle traces

Use real `TaskEngine`, SQLite, worker, ordered ingress, App Server host over a process-backed stand-in, Runtime adapter over a process-backed stand-in, and `LocalProductApi`. Do not call the manager, coordinator, queue, or SQLite directly in the trace assertions.

Required traces:

1. launch → Runtime bind → Codex bind → initial turn;
2. idle message → one new turn;
3. active message → one steer;
4. Codex approval request → durable UI attention → response → server resolution;
5. request-human item → durable handoff → human takeover → Return Control → fresh inspection → one continuation;
6. finish during active turn → interrupt accepted → terminal notification → Runtime close → attachment cleanup → archive → closed;
7. finish while awaiting human → settle handoff conservatively → close;
8. Runtime process restart with named workspace → recover binding and continue;
9. App Server restart → resume/read exact thread and retain pending attention;
10. Desktop restart with both components alive → rebuild projection and continue;
11. archive and unarchive;
12. capture-mode task → no Codex turn.

### E. Cut-point matrix

Run the same parameterized interruption harness for every externally consequential command used by the traces. The process is stopped at each point:

1. before intent/event commit;
2. after commit, before claim;
3. after claim, before dispatch;
4. after external acceptance, before outcome commit;
5. after authoritative terminal change, before observation commit;
6. after outcome commit, before projection notification;
7. while replacing the App Server or Runtime generation.

On restart, each case must satisfy all of these:

- the task is readable;
- the same intent identity remains correlated;
- no consequential external request is repeated without reconciliation;
- no accepted attention or handoff disappears;
- the worker either converges or produces one explicit `recovery_required` projection;
- a closed task emits no new command.

This cross-product is the finite proof obligation. New lifecycle commands automatically enter it through the command manifest.

### F. Master review gate

The Master independently:

- runs all static source gates;
- inspects the production composition root;
- runs the aggregate, command-completeness, production-trace, and cut-point suites once;
- runs companion typecheck and `git diff --check`;
- confirms the old production shell is unreachable.

Any failure rejects the implementation pass. It does not authorize an incremental correction. The Master records the failed invariant, reassesses the replacement design as a whole, and decides whether to rerun a new bounded implementation.

## Post-acceptance verification campaign

Only after the Master gate passes:

1. run the repository-wide test suite once;
2. run lint, typecheck, and build once;
3. run P5 deterministic fixtures and MCP E2E once;
4. start the source-built Rove product locally;
5. run the live GitHub acceptance journey;
6. run Gmail → Calendar;
7. run Drive upload → organize → download with pre-launch attachment selection;
8. run the visual-heavy Maps journey;
9. run the IRS/PDF multi-tab download journey;
10. include at least one real human handoff/Return Control and one Finish convergence in the live set;
11. package once only if the source-built live set passes;
12. run one packaged startup/login/task smoke.

If an external service is signed out, continue the non-dependent campaign and use a non-mutating substitute for that service’s transport/capability coverage. Do not weaken the lifecycle campaign and do not use direct browser automation outside Rove to make a journey pass.

## Stop conditions

The implementation task stops and returns to the Master if:

- production still constructs the old coordinator;
- a lifecycle intent requires a direct post-return mutation in `LocalProductApi`;
- an event or outcome cannot be represented without passing a full lifecycle snapshot;
- a command lacks deterministic execute/reconcile classification;
- the production-composition harness needs fake direct manager/queue calls;
- migration cannot classify an active task without guessing;
- the finite cut-point campaign exposes any repeat or lost task state.

Passing unit counts alone never override these conditions.

