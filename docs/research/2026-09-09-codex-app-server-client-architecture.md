# Codex App Server client architecture: exact lifecycle research and Rove correction boundary

**Date:** 2026-09-09  
**Status:** Research complete; implementation and external live journeys remain paused  
**Decision owner:** Master Engineering Agent  
**Pinned runtime:** Codex CLI / App Server `0.153.4`  
**Scope:** Connection initialization, thread creation and materialization, live attachment, history, turn dispatch, restart, reconciliation, and the Rove integration boundary

## Executive conclusion

Rove's repeated Phase 5 failures are not primarily failures of browser perception, browser interaction, the task ledger, or the renderer. The central defect is that Rove does not yet model the Codex App Server as a **stateful, connection-scoped conversation service**.

The protocol has three different operations that Rove has partially treated as interchangeable:

1. `thread/read` inspects stored state. It does **not** attach the calling connection to the thread's live event stream.
2. `thread/start` creates a live thread and subscribes the calling connection.
3. `thread/resume` loads or rejoins a thread and subscribes the calling connection.

A healthy App Server process therefore does not imply that a Rove task is ready. After every new connection generation, each open task must be classified and, when it is to remain interactive, attached with `thread/resume` before the task worker can dispatch or rely on live events.

Rove also has a second, independent contradiction in its history handling:

- production requests `historyMode: "paginated"` at `thread/start`;
- later identity validation requires `thread.historyMode === "legacy"`;
- ordinary observation and uncertain-message reconciliation call `thread/read(includeTurns: true)`, which is not the history contract for paginated threads;
- runtime status is derived from the contents of `thread.turns`, even though metadata-only paginated reads intentionally return an empty array.

The current exact-error fallback for `list_turns is not supported yet` can suppress one symptom, but it cannot make those mutually inconsistent assumptions correct.

The bounded production correction is one **Codex Thread Session Supervisor** inside the existing Companion execution core. It owns the connection generation, negotiated history strategy, per-thread attachment state, first-turn bootstrap, metadata reads, history paging, event correlation, and uncertain dispatch reconciliation. The existing Task Engine remains the durable product process manager; the supervisor becomes its single App Server adapter. No cloud service, new workflow product, or broad Runtime rewrite is required.

This is the smallest boundary that removes the underlying mismatch instead of adding another case-specific patch.

## What “exactly how Codex uses it” can and cannot mean

There are four evidence levels in this report.

| Evidence level                                       | What it establishes                                                             | Confidence                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| Pinned official protocol and server source           | Normative 0.153.4 wire and lifecycle behavior                                   | Highest                                       |
| Pinned public Codex client source                    | How OpenAI's public TUI/exec clients structure the client boundary              | High                                          |
| Isolated probes against the installed 0.153.4 binary | The behavior of the exact local executable Rove currently embeds                | High for exercised cases                      |
| Installed ChatGPT desktop process observation        | That ChatGPT launches its bundled App Server and supplies product configuration | High for invocation, not for private UI logic |

The complete ChatGPT desktop client implementation is proprietary. It is not possible to truthfully claim 100% knowledge of its internal renderer, state store, or every recovery branch. This report does not infer those internals.

What can be known exactly is sufficient for Rove:

- the pinned App Server's protocol and server implementation;
- the public Codex reference client's lifecycle behavior;
- the exact local binary's observable behavior;
- Rove's complete current production call path.

The public TUI is especially valuable because OpenAI uses a shared `codex-app-server-client` facade for conversational CLI surfaces. That facade centralizes bootstrap, initialization, transport/event routing, lifecycle identity, and shutdown while preserving App Server response semantics. See the pinned [client README](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-client/README.md) and [TUI AppServerSession](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app_server_session.rs).

## Normative 0.153.4 protocol model

### Connection lifecycle

The default stdio transport is newline-delimited JSON-RPC messages. Each transport connection has its own initialization and subscription state.

The required ordering is:

```text
open transport
  -> initialize(clientInfo, capabilities)
  <- initialize response
  -> initialized notification
  -> all other requests
```

Initialization is exactly once per connection. Requests before the handshake are rejected, and a repeated initialize is rejected. The server uses bounded queues and documents `-32001` overload as retryable with exponential backoff and jitter. These are connection behaviors, not task completion facts. See the pinned [App Server protocol and lifecycle overview](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/README.md).

The public remote client performs this same ordered handshake, buffers events that arrive while initialize is in flight, and emits a disconnected event when the transport closes or becomes invalid. Outstanding requests fail on disconnect. The remote client does not contain an automatic reconnect loop; a higher layer must establish a new connection and restore its application session. See the pinned [remote client implementation](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-client/src/remote.rs).

### Thread lifecycle and connection subscription

`thread/start` is both creation and attachment:

- it creates a fresh thread;
- returns its immediate thread representation;
- emits `thread/started`;
- subscribes the calling connection to the thread's turn and item events.

`thread/resume` is both loading/rejoining and attachment:

- if the thread is already running, it rejoins the live thread;
- otherwise it reconstructs the stored thread;
- it adds the calling connection to the thread's subscriber set;
- subsequent live events are sent to subscribed connection IDs.

The server source makes this explicit. Its resume path calls `try_add_connection_to_thread`, and the listener routes events through `subscribed_connection_ids`. See pinned [thread lifecycle source](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/src/request_processors/thread_lifecycle.rs) and [thread protocol types](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs).

`thread/read` is inspection only:

- it can return metadata and optionally stored history;
- it reports `notLoaded` when a stored thread is not currently loaded;
- it does not resume the thread;
- it does not subscribe the calling connection.

The public Codex TUI documents this distinction directly in code: a thread-read fallback can seed replay state, but it does not attach the listener established by resume, so the channel is marked replay-only. See pinned [TUI session lifecycle](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app/session_lifecycle.rs).

`thread/loaded/list` reports which thread IDs are in memory. It does not say that the current connection is subscribed to any of them.

`thread/unsubscribe` removes only the current connection's subscription. When the last subscriber is gone, the server retains an inactive thread for a bounded idle period before unloading it and emitting `thread/closed` plus a status transition to `notLoaded`.

### Turn lifecycle

`turn/start` adds a user input and immediately returns an initial turn object. The authoritative running and terminal transitions still arrive as events:

```text
turn/start response accepted
  -> turn/started
  -> item/started, deltas, item/completed, requests...
  -> turn/completed(completed | failed | interrupted)
```

`turn/steer` is a distinct operation for an already active regular turn. It requires the exact active turn identity and does not create a second turn. Rove should only steer when it has an authoritative active status and matching turn ID.

`turn/interrupt` acknowledges the cancellation request but does not itself prove terminal state. Terminal state is established by `turn/completed` or later authoritative inspection.

`clientUserMessageId` is the protocol's durable correlation hook. When supplied to `turn/start` or `turn/steer`, it is echoed as `clientId` on the corresponding user-message item. This is the correct key for reconciling a dispatch whose response was lost.

### History modes are negotiated behavior, not a fixed assumption

Version 0.153.4 supports two history contracts:

| Mode        | Metadata inspection                | History retrieval                           | Resume recommendation           |
| ----------- | ---------------------------------- | ------------------------------------------- | ------------------------------- |
| `paginated` | `thread/read(includeTurns: false)` | `thread/turns/list` and `thread/items/list` | `excludeTurns: true`, then page |
| `legacy`    | `thread/read`                      | `thread/read(includeTurns: true)`           | full history may be returned    |

The App Server documentation states that full-history hydration is deprecated for paginated threads. Its public TUI first performs the typed read, recognizes the known paginated-history incompatibility, retries metadata-only, and hydrates through the paginated APIs. The TUI also negotiates a legacy fallback when the connected App Server/store does not support the paginated feature.

This is important: the client records the server's returned mode and uses a mode-specific history reader. It does not request one mode and later assert another.

### Fresh threads are not necessarily durable before the first message

The isolated 0.153.4 experiment produced this exact result:

| Experiment                                                    | Result                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Start with history mode omitted                               | Returned `paginated`, `idle`, zero turns                                              |
| Start explicitly as `legacy` with experimental API enabled    | Returned `legacy`, `idle`, zero turns                                                 |
| Full-history read of fresh legacy thread                      | `-32600`: history unavailable before first user message                               |
| Stop the process after legacy `thread/start`, before any turn | A new process could not list, read, resume, or archive the thread; no rollout existed |

The experiment used a new temporary `CODEX_HOME`, no real browser, no external service, and no model turn. All temporary threads and files were isolated.

This confirms a critical product rule: `thread/start` receipt alone is not a durable task bootstrap. For a customer task, thread creation and acceptance of its first user message must be one journaled bootstrap workflow. A process cut between those calls must reconcile the two possible realities:

- no first message was accepted, so the unmaterialized thread can be replaced safely;
- the first message was accepted, so the persisted user item with the same `clientUserMessageId` must be found and must not be sent again.

Public issue reports [#42099](https://github.com/openai/codex/issues/42099) and [#31158](https://github.com/openai/codex/issues/31158) corroborate zero-turn materialization behavior. They are supporting observations, not the normative source for this decision.

## How the public Codex client uses the boundary

The public client does not expose transport calls throughout the UI. `AppServerSession` is a facade that owns typed requests and the history strategy. Higher-level session lifecycle code owns whether a thread is live-attached or replay-only.

The significant patterns are:

1. **One session facade.** Startup, resume, read, pagination, model/account bootstrap, and event access pass through one typed boundary.
2. **Returned capability is remembered.** Paginated history is preferred, with a bounded legacy fallback when unsupported.
3. **Read and attach remain different.** A successful read can render history but cannot make the thread interactive.
4. **Resume settings are intentional.** The client distinguishes restoring settings, overriding from current configuration, and rejoining a running thread without changing it.
5. **Immediate response and later events are reconciled.** Richer configuration can arrive after the start/resume response, so bootstrap has a short reconciliation phase.
6. **Live and replay-only channels are explicit states.** The UI does not infer interactivity merely because historical items are visible.
7. **History is bounded.** Paginated APIs hydrate a bounded initial view instead of making every lifecycle operation read the entire transcript.

Rove does not need to copy the TUI. It should copy these boundaries.

## What was confirmed about the installed ChatGPT desktop app

Read-only local inspection established:

- the installed ChatGPT application bundles `codex-cli 0.153.4`;
- ChatGPT runs that bundled executable as an App Server child process;
- the process is launched with product-owned configuration, including its built-in product tools and code-mode host feature.

This confirms the broad integration model: the desktop product owns a long-lived App Server process and supplies product policy/configuration around it. It does not establish the private implementation of ChatGPT's internal state store or every recovery branch, so this report does not use that as evidence for details that are already established in the public protocol and source.

## Rove's current production call path

The active production composition is:

```text
main.ts
  -> CodexExecutionCore
       -> CodexAppServerHost
       -> CodexRpcConnection
       -> TaskEngine + SqliteTaskEngineStore + TaskEngineWorker
       -> CodexRuntimeTaskAdapter
       -> OrderedTaskIngress
       -> LocalProductApi / LedgerProductTaskPort
```

The older `RoveTaskCoordinator` and `TaskProcessWorker` still exist in compatibility and test material, but the active production root constructs `CodexExecutionCore`, `TaskEngineWorker`, and `CodexRuntimeTaskAdapter`. Therefore the present App Server defect should be corrected in the active adapter/session boundary, not by reopening the entire Phase 5 lifecycle replacement.

### What is already sound and should be retained

- The App Server executable is version-pinned and validated.
- The stdio connection validates requests and responses against generated 0.153.4 contracts.
- Event callbacks are delivered in order.
- A connection failure marks outstanding request outcomes uncertain.
- Connection generations fence stale events.
- The Task Engine persists intent, commands, outcomes, and product projections in SQLite.
- `clientUserMessageId` is already populated from a durable operation ID.
- Runtime browser/session authority remains outside the Codex adapter.
- Actual Rove MCP status and tool definitions are checked against the bound thread.

These are useful foundations. The correction should not discard them.

### The exact mismatches

#### 1. Transport readiness is exposed before task-session readiness

`CodexAppServerHost` restarts the process, repeats initialize/initialized, and announces a ready connection. The execution core then emits generation-change facts and starts recovery work.

That ordering is acceptable only if task dispatch is held behind a reattachment barrier. At present, transport readiness and per-task live attachment are represented indirectly through outbox work. The product can therefore observe a healthy server while an open task has not yet rejoined its thread.

#### 2. History mode contradicts itself

The active adapter starts a thread with `historyMode: "paginated"`. Its later identity check rejects any resumed or read thread whose mode is not `legacy`.

Both cannot be the production contract. The local pinned binary returns `paginated` when paginated history is requested or selected by default, so the current identity assertion can reject the product's own successfully created thread.

#### 3. Paginated history is read through the legacy API

`observeCodex` calls `thread/read(includeTurns: true)`. Uncertain message reconciliation does the same and scans the returned turns for `userMessage.clientId`.

For paginated history, metadata and transcript paging are separate. The current call can yield the observed `list_turns is not supported yet`/pagination-related failure family instead of task truth.

#### 4. Thread status is reconstructed from the history array

`codexTruth` searches `thread.turns` for an in-progress turn and otherwise reports the thread idle. A metadata-only read intentionally has no turns. This can turn an authoritative `thread.status.type === "active"` into a false idle result.

Status must come from `thread.status`, the accepted turn response, and ordered status/turn events. History content is for projection and correlation, not the primary liveness signal.

#### 5. Thread creation and first user turn are separate durable commands

Rove currently records a successful thread bootstrap before it dispatches the task's initial user message. If the App Server process stops in that interval, a zero-turn legacy thread may have no rollout and cannot be resumed. Even for paginated storage, the customer task has not yet established the durable message correlation needed for safe continuation.

This is a protocol cut, not an error-message case.

#### 6. Reconciliation requires unbounded/full history semantics

The correct correlation identity already exists, but the reader is wrong. Reconciliation should inspect a bounded page window around the most recent state and follow cursors up to an explicit bound. It should never require a whole-thread `includeTurns: true` read for a paginated thread.

#### 7. Compatibility behavior is distributed

History-related special cases are currently split among the adapter, `history-compatibility.ts`, generated protocol validation, experiments, and reducer assumptions. Each new observed message encourages another narrow condition.

Compatibility should be a single connection-scoped profile selected from the pinned version plus a bounded capability probe. Business commands should call semantic methods such as `readRecentHistory` rather than match transport messages.

## Why the latest user-visible failure occurred

The fresh task was able to create its Runtime session and Codex thread. It failed before a useful browser journey began because the first product message crossed the contradictory history path:

1. the thread was created under the paginated history contract;
2. the message/recovery path attempted inspection using assumptions from the legacy contract;
3. history retrieval reached an unsupported list/history operation;
4. the command remained unresolved;
5. the bounded retry path surfaced repeated recovery warnings;
6. the UI retained the nonterminal task and blocked a new launch.

The browser did not open because the Codex turn that would invoke Rove MCP never began successfully. Authentication was not the cause of this specific failure.

The temporary catch for the exact `list_turns is not supported yet` message may turn an empty history into a metadata-only read, but it leaves all of the following unresolved:

- paginated start versus legacy identity validation;
- active status derived from an empty history array;
- no explicit live-attachment readiness barrier;
- full-history reconciliation for nonempty paginated threads;
- the process-cut window between thread creation and the first message.

It should not be accepted as the Phase 5 correction.

## Required state model

The supervisor should maintain a small durable/derivable state for each task-thread binding. The Task Engine remains the durable owner of task intent and command progress; the supervisor owns only App Server session semantics.

| State                     | Meaning                                                                                       | Allowed next App Server operation              | Dispatch allowed?                |
| ------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| `absent`                  | No correlated thread receipt exists                                                           | `thread/start`                                 | No                               |
| `started_unmaterialized`  | Start accepted on this connection; first message not yet confirmed                            | `turn/start`, metadata read on same connection | Only the initial correlated turn |
| `attached_idle`           | Current connection is subscribed; authoritative status idle                                   | `turn/start`, read/page, archive, unsubscribe  | Yes                              |
| `attached_active(turnId)` | Current connection is subscribed; exact active turn known                                     | `turn/steer`, interrupt, read/page             | Only steer with exact ID         |
| `detached_persisted`      | Stored thread exists but current connection is not confirmed subscribed                       | `thread/resume`                                | No                               |
| `replay_only`             | Stored history is readable, but live resume failed or is intentionally not requested          | read/page                                      | No                               |
| `archived`                | Stored thread is archived                                                                     | unarchive or read                              | No                               |
| `missing_unmaterialized`  | Start receipt existed, but no rollout and no accepted first message exist after a process cut | restart bootstrap with same task operation     | No                               |
| `uncertain`               | A write may have been accepted and correlation has not yet resolved it                        | attach, then bounded correlation read          | No new write                     |
| `blocked`                 | Identity, ownership, version, or history capability conflicts                                 | none until explicit recovery/close             | No                               |

Every state is scoped to a `connectionGeneration`. `attached_*` from generation N automatically becomes `detached_persisted` or `uncertain` when generation N is lost.

### Sources of truth

| Question                                           | Source of truth                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Is transport initialized?                          | App Server host connection generation                                   |
| Is this connection receiving this thread's events? | successful start/resume for this generation, not `thread/read`          |
| Is the thread active?                              | `thread.status`, accepted turn identity, and ordered turn/status events |
| What history API is valid?                         | returned `thread.historyMode` plus negotiated compatibility profile     |
| Was this user input accepted?                      | user-message item whose `clientId` equals durable operation ID          |
| Is an interrupt terminal?                          | `turn/completed` or authoritative later status/read                     |
| Is a thread durable after start?                   | accepted first message/rollout evidence, not start receipt alone        |
| May browser work proceed?                          | Task Engine command plus supervisor attached state plus Runtime binding |

## Bounded production correction

### 1. Add one `CodexThreadSessionSupervisor`

Compose it inside `CodexExecutionCore` with:

- the current `CodexRpcPort`/host;
- connection generation notifications;
- generated protocol validators;
- the durable task/thread/session bindings supplied by the Task Engine;
- one compatibility profile for the exact App Server version.

It exposes semantic operations to `CodexRuntimeTaskAdapter`:

```text
bootstrapTaskAndStartInitialTurn
ensureAttached
readMetadata
readRecentHistory
startOrSteer
reconcileUserMessage
interruptAndObserve
archiveAndObserve
```

It does not own Runtime, browser policy, product projection, close workflow, or renderer state.

### 2. Make initial thread plus first message one task command

Replace the production sequence:

```text
lookup_or_start_codex_thread
...persist outcome...
start_or_steer_codex_turn(initial message)
```

with one externally correlated bootstrap command:

```text
bootstrap_codex_task
  -> find exactly one correlated materialized thread, or thread/start
  -> validate returned history mode and MCP binding
  -> turn/start with the launch operation's clientUserMessageId
  -> persist thread + initial turn receipt together
```

If the process stops after `thread/start` but before message acceptance, reconciliation searches for the correlated source and message:

- a materialized thread containing the message completes the command;
- a live same-generation zero-turn thread receives the initial message;
- no stored thread and no correlated message permits one replacement start;
- an active thread without the correlation remains uncertain rather than receiving another input.

This removes the zero-turn orphan as a product state.

### 3. Use a real negotiated history strategy

For the pinned 0.153.4 baseline:

- prefer `paginated` for durable threads;
- record the returned mode, never a requested assumption;
- for paginated threads, always read metadata without turns and hydrate bounded history through turns/items list APIs;
- for legacy threads, use the legacy full-history read only where needed;
- perform one isolated startup capability probe for pagination support;
- accept only the documented/observed compatibility fallback family;
- store the chosen profile on the connection generation.

The identity invariant becomes “returned mode is supported by the negotiated profile and remains stable for this thread,” not “all threads must be legacy.”

### 4. Add a connection reattachment barrier

When the host creates generation N+1:

1. mark every open task-thread binding detached for N+1;
2. refresh account/catalog independently;
3. classify each task from the ledger and stored thread inventory;
4. call `thread/resume` once for every task that should remain live;
5. validate exact thread identity, returned configuration, MCP binding, and history profile;
6. seed recent projection state through the mode-specific reader;
7. mark that task `attached_idle`, `attached_active`, replay-only, missing, or blocked;
8. release that task's worker commands only after classification.

Global App Server health may show “connected” while tasks show “reattaching.” The two projections must not be collapsed into one boolean.

### 5. Stop deriving status from transcript shape

Map `thread.status` directly. Retain active turn IDs from:

- the immediate `turn/start` response;
- `turn/started`;
- `thread/status/changed` when it includes the active turn identity;
- a resumed thread response/page that identifies the active turn.

An empty `turns` array means “history not hydrated or history is empty,” never “thread is idle.”

### 6. Reconcile writes with bounded correlation reads

For a possibly accepted `turn/start` or steer:

1. ensure the current generation is attached;
2. read authoritative metadata;
3. page recent turns/items up to an explicit item/page bound;
4. search for `userMessage.clientId === operationId`;
5. if found, record success without another write;
6. if absent and authoritative state is idle, dispatch exactly once;
7. if absent and authoritative state is active, wait for events/page advancement or remain uncertain;
8. if the bound is exhausted, expose one bounded recovery state instead of a generic retry loop.

### 7. Keep event handling connection-scoped

The existing ordered event delivery and generation fencing should remain. The supervisor adds only the missing subscription invariant:

- an event from an old generation is ignored;
- an attached state is valid only for the generation that established it;
- server requests pending when a connection is lost become unresolved and are not reconstructed from UI text;
- shutdown drains accepted events before closing, or records recovery required.

### 8. Remove distributed history workarounds

After the supervisor is cut over:

- remove the legacy-only invariant from `assertBoundThreadIdentity`;
- remove direct `thread/read(includeTurns: true)` calls from ordinary adapter logic;
- delete or reduce `history-compatibility.ts` to the negotiated compatibility profile;
- update the earlier acceptance statement that reconnect must never call `thread/resume`;
- prevent tests from returning legacy threads when production requests paginated unless the test is explicitly a legacy-profile case.

## Retain, rework, and retire

| Asset                                                            | Decision             | Reason                                   |
| ---------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| `CodexAppServerHost` executable resolution/version pin           | Retain               | Correct process boundary                 |
| `CodexRpcConnection` validation, ordered events, uncertain close | Retain               | Correct transport primitives             |
| Generated 0.153.4 validators                                     | Retain               | Exact wire validation                    |
| Task Engine, SQLite store, outbox worker                         | Retain               | Correct durable product-process boundary |
| Ordered task ingress and generation fencing                      | Retain               | Correct event ordering primitive         |
| Account/catalog service                                          | Retain               | Independent App Server projection        |
| Rove MCP configuration and post-start validation                 | Retain               | Required task capability binding         |
| `CodexRuntimeTaskAdapter` direct RPC orchestration               | Rework               | Delegate session semantics to supervisor |
| `CodexExecutionCore` connection recovery                         | Rework               | Add per-task reattachment barrier        |
| Separate thread-start and first-message commands                 | Replace              | Creates unrecoverable zero-turn cut      |
| `codexTruth` turn-array liveness inference                       | Replace              | Incorrect for metadata/paginated reads   |
| Always-legacy identity assertion                                 | Remove               | Contradicts production start request     |
| Full-history `thread/read` for paginated threads                 | Remove               | Wrong history contract                   |
| Exact one-message `list_turns` fallback as final fix             | Retire after cutover | Symptom-specific and incomplete          |
| Runtime/browser/session implementation                           | No change            | Not implicated in this failure           |
| Renderer visual cleanup                                          | Defer                | Not the lifecycle blocker                |

## Implementation task boundary

This should be one implementation task followed by one independent Master review. It is not five successive patch tasks.

The implementation task must deliver:

1. a closed supervisor state type and transition tests;
2. one negotiated history adapter with paginated and legacy implementations;
3. combined thread/first-turn bootstrap and truth-based reconciliation;
4. connection-generation reattachment barrier;
5. status mapping from authoritative status/events;
6. bounded client-message correlation paging;
7. production cutover so all task-related App Server RPCs cross the supervisor;
8. deletion of superseded history assumptions/workarounds;
9. a migration/recovery rule for currently open zero-turn or incompatible task records;
10. an evidence report mapping every finding in this document to code and tests.

Explicit exclusions:

- no cloud backend;
- no new workflow engine;
- no browser Runtime refactor;
- no renderer redesign;
- no external-service journey during implementation;
- no package build until local acceptance is complete;
- no attempt to reverse engineer proprietary ChatGPT UI code.

## Verification strategy

The user explicitly requested a finite verification budget. The implementation should use the smallest checks required at each gate and run broad checks once.

### During implementation

Run only focused tests for:

1. initialize ordering and generation replacement;
2. paginated start and metadata/history separation;
3. negotiated legacy fallback;
4. start-to-first-turn normal path;
5. process cut after thread start but before first message;
6. process cut after first message acceptance but before local outcome commit;
7. reconnect and required resume before dispatch;
8. metadata read that does not imply attachment;
9. active status with empty hydrated history;
10. exact start versus steer decision;
11. bounded `clientUserMessageId` reconciliation;
12. old-generation event rejection;
13. lost pending server request classification;
14. close/archive while detached;
15. migration of the current blocked task state.

Use the real installed 0.153.4 binary in an isolated `CODEX_HOME` for a short protocol qualification. The probe must not contact an external service. It should cover start, first-message materialization with a harmless fixed response if authentication is deliberately enabled, restart, resume, metadata read, bounded history page, interrupt if active, and archive.

### After the focused gate passes

Run, once:

- Companion typecheck and focused production composition tests;
- the P5.0 compatibility oracle;
- the complete repository test suite;
- lint/build;
- source-app startup and local recovery qualification.

Only then run the external acceptance campaign in the established order. GitHub remains the shared-infrastructure gate. A service-specific failure may allow later journeys; a common App Server/session failure stops the campaign.

Package once after local and external live acceptance both pass.

## Acceptance criteria

The correction is accepted only if all of the following are true:

- No production task can dispatch unless its thread is attached on the current connection generation.
- A metadata read never changes attachment state.
- Production can run against both supported history profiles, with one profile selected per returned thread.
- Paginated production paths never depend on `thread/read(includeTurns: true)`.
- An empty history array never determines idle/active status.
- A task cannot settle bootstrap before its first correlated user message is accepted.
- A cut at every point between start, turn acceptance, event receipt, and local commit converges without duplicate user input.
- A restarted App Server is not reported task-ready until every open task is classified.
- Reconciliation is bounded and correlation-based, not a generic retry loop.
- The blocked GitHub journey reaches an actual browser turn before the broader campaign resumes.
- One full verification and one live campaign pass without another compatibility patch.

## Stop conditions

Stop the implementation and return to architecture review only if one of these occurs:

- the exact 0.153.4 server violates its generated schema or the isolated probe contradicts the pinned server source;
- the returned history mode changes for the same thread without an explicit migration;
- a first-message outcome cannot be reconciled by `clientUserMessageId` within the documented history APIs;
- more than one production component still issues task-related `thread/*` or `turn/*` calls after cutover;
- the correction requires changing Runtime/browser authority or adding an external service.

An unfamiliar error string by itself is not a reason to patch or redesign. It is evidence to classify through the supervisor's state and compatibility profile.

## Final decision

No additional foundational product research is needed before this correction. The necessary protocol model is now explicit and grounded in the pinned server, the public reference client, the local binary, and Rove's active production path.

The correct next step is **not** another live retry and **not** another narrow error handler. It is one bounded implementation of the Codex Thread Session Supervisor, followed by one independent Master review, one broad repository verification, and one external-service acceptance campaign.

## Primary sources

- OpenAI, [Codex App Server 0.153.4 README](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/README.md)
- OpenAI, [Codex App Server client 0.153.4 README](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-client/README.md)
- OpenAI, [App Server thread protocol types, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
- OpenAI, [App Server thread lifecycle implementation, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- OpenAI, [App Server thread state implementation, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/src/thread_state.rs)
- OpenAI, [Codex TUI AppServerSession, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app_server_session.rs)
- OpenAI, [Codex TUI session lifecycle, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app/session_lifecycle.rs)
- OpenAI, [App Server remote client, 0.153.4](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-client/src/remote.rs)

## Local evidence reviewed

- `apps/companion/src/main/codex/execution-core.ts`
- `apps/companion/src/main/codex/app-server-host.ts`
- `apps/companion/src/main/codex/rpc-connection.ts`
- `apps/companion/src/main/codex/codex-runtime-task-adapter.ts`
- `apps/companion/src/main/codex/history-compatibility.ts`
- `apps/companion/src/main/codex/task-engine-worker.ts`
- `apps/companion/src/main/codex/sqlite-task-engine-store.ts`
- `packages/protocol/src/task-engine.ts`
- `packages/protocol/src/native-lifecycle-contract.generated.ts`
- `experiments/phase5-app-server/thread-start-history-matrix.mjs`
- `docs/experiments/2026-09-08-phase5-p59-l1-production-convergence.md`
- `docs/research/2026-09-09-phase5-proper-reset.md`

No external-service journey, repository mutation, email action, Drive action, Maps action, download, packaging, or production release was performed during this research.
