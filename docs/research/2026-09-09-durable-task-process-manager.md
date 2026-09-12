# Phase 5 lifecycle recovery: bounded architecture and tool decision

**Date:** 2026-09-09  
**Status:** Architecture recommendation; no production implementation is authorized by this document  
**Decision owner:** Master Engineering Agent  
**Scope:** The remaining Phase 5 reliability boundary: task launch, Codex and Runtime binding, human handoff/return, finish, cleanup, archive, and restart recovery

## Executive decision

Rove should implement a small, portable **task process manager** whose only responsibility is to drive a product task from launch to a settled terminal state across the Codex App Server, the Rove Runtime, the desktop process, and human handoff.

The process manager must be the single lifecycle decision-maker. It should retain the existing generated lifecycle reducer, persist inputs and planned commands in one transaction, execute those commands through thin adapters, and reconcile every uncertain outcome from the authoritative component before taking another consequential step.

The recommended implementation is a combination of focused tools:

1. **Rove's existing generated lifecycle reducer** for domain decisions.
2. **SQLite** as the local transactional ledger and command outbox.
3. **Kysely** for typed SQL, schema migrations, and a portable `TaskStore` adapter boundary.
4. **`better-sqlite3`**, subject to a packaging and crash experiment, as the Electron-compatible SQLite driver.
5. **Rove's existing generated protocol validators** at every adapter and persistence boundary.

This is not a desktop-only architecture. The reducer, event/command schemas, and ports must live in a platform-neutral package. SQLite is one adapter. A later hosted implementation can use PostgreSQL and a server-side worker without changing the product protocol or lifecycle rules. A browser extension would call the hosted product API; it would not depend on SQLite or Electron.

This is also not a generic workflow framework. Rove should not introduce a workflow language, local broker, cloud synchronization system, device registry, or orchestration of individual browser clicks. The bounded process contains only the cross-component lifecycle that has repeatedly failed to converge.

## Why Phase 5 keeps producing local repairs

The failure pattern is architectural rather than a long list of unrelated defects.

Rove already contains a strong deterministic lifecycle contract in `packages/protocol/src/native-lifecycle-contract.ts`. It describes the important product phases, requested operations, observed truths, and next commands. The production coordinator calls that reducer, but mainly to calculate the state projected into the UI.

The actual work is performed by a second, handwritten control flow in `apps/companion/src/main/codex/task-coordinator.ts`. That file currently contains 3,587 lines, including a staged close loop. Related conversation, continuation, context, and attention state is persisted through separate services and separate JSON files. The five central files for these responsibilities total about 7,894 lines before the generated lifecycle contract is counted.

`apps/companion/src/main/codex/execution-core.ts` currently creates independent file repositories for at least:

- `codex-conversations.v2.json`
- `codex-continuations.v2.json`
- `codex-task-contexts.v2.json`
- `codex-attention.v1.json`

`FileStateRepository` protects each file with its own in-process queue and revision check. It writes a temporary file and renames it. That can protect an individual file from some partial-write cases, but it cannot atomically commit a task-state transition together with its attention state, continuation state, and next external command. There is no durable command outbox spanning these records.

The result is duplicate lifecycle authority:

```text
generated reducer ───────► UI projection
                               ▲
                               │
handwritten coordinator ─► external work ─► several JSON repositories
```

When an external request is accepted but the process is interrupted, or one file is saved and another is not, restart has to infer which part happened. Adding another local retry or special case improves one cut point while leaving the duplicated control structure in place.

The observed GitHub finish failure is a representative example. Codex accepted an interrupt request and later exposed the turn as interrupted, but Rove remained in a waiting-for-human lifecycle and cleanup did not converge. The Codex protocol intentionally separates request acceptance from later terminal truth: `turn/interrupt` returns an empty success response, while final state arrives through `turn/completed`; `thread/read`, `thread/resume`, and `thread/archive` provide recovery and lifecycle facts.[^1] Rove must model that separation explicitly instead of treating a successful RPC response as the terminal result.

## Architectural boundary

### What belongs in the process manager

Only operations that cross durable ownership boundaries:

- create a Rove task and freeze its launch configuration;
- start or recover the Codex App Server connection;
- create, find, resume, read, interrupt, and archive a Codex thread;
- create, bind, inspect, release, and recover a Rove Runtime session;
- record a human handoff and accept a correlated return-control event;
- settle outstanding attention and continuation records;
- drive finish and cleanup until every authoritative component agrees;
- rebuild the renderer projection after restart.

### What stays outside

- Browser perception, target resolution, interaction verification, downloads, uploads, and browser ownership remain Runtime responsibilities.
- Conversation text and turn truth remain Codex responsibilities; Rove may cache projections but must not create a second authoritative conversation history.
- The renderer remains a projection and intent source. It never calls Codex or Runtime directly.
- Authentication, future multi-device synchronization, hosted queues, billing, and organization administration are not introduced in this refactor.
- Individual browser actions are not converted into workflow steps. Existing semantic transactions continue to govern them in Runtime.

This is the intended middle line: product-specific enough to stay small, transport- and storage-neutral enough to support a future hosted service.

## Required invariants

The implementation is accepted only if all of these are true:

1. **One lifecycle authority.** Every lifecycle transition and next command comes from the generated reducer. The coordinator may schedule and dispatch; it may not independently choose the next lifecycle step.
2. **Atomic intent.** A state transition and the command it requires are committed in one database transaction.
3. **Stable identity.** Every task, external binding, handoff, event, and command has a stable ID. Every task has a monotonically increasing sequence and an ownership generation.
4. **Serialized task decisions.** Only one reducer transaction may advance a given task at a time, locally or in a future hosted deployment.
5. **At-least-once command delivery.** Workers may retry. Adapters must be idempotent or must reconcile before a retry that could duplicate a consequential effect. The design does not claim cross-system exactly-once execution.
6. **Recorded uncertainty.** Request acceptance, possible start, observed terminal success, observed terminal failure, and unresolved outcome are distinct states.
7. **Truth-based recovery.** On restart or an uncertain response, Rove reads Codex and Runtime truth and feeds those facts back to the reducer before dispatching another consequential command.
8. **Durable human handoff.** A handoff remains visible and resumable across renderer reload and process restart. Return control must match the task, handoff ID, and generation.
9. **Finish is desired state, not a one-shot handler.** Clicking Finish commits `desiredState = closed`. The processor continues until Codex is terminal, pending requests are resolved or conservatively retained, Runtime ownership is released, and archive state is confirmed.
10. **Projection is disposable.** The UI can be rebuilt from the ledger plus fresh Codex/Runtime facts. Losing a renderer snapshot cannot lose work.
11. **Forward-compatible protocol.** Persisted payloads have explicit versions and strict validators. Unknown required variants stop the affected task rather than being guessed.
12. **No background mutation after terminal state.** A closed task cannot emit a new command unless an explicit user operation reopens it.

## Processing model

### Inputs, decisions, and commands

Use three different concepts:

- **Intent:** a user or system request such as launch, return control, finish, or retry cleanup.
- **Fact:** a validated observation from Codex, Runtime, the desktop host, or a command result.
- **Command:** a reducer-selected request to one authoritative component.

For each task input, the processor performs one transaction:

```text
intent or fact
      │
      ▼
validate + deduplicate
      │
      ▼
load task at sequence N
      │
      ▼
pure lifecycle reducer
      │
      ▼
atomically commit:
  task at sequence N+1
  accepted input
  projection
  next command(s) in outbox
      │
      ▼
worker dispatches due command
      │
      ▼
accepted / terminal / unresolved fact
      └──────────────► repeat until stable
```

The transactional outbox pattern exists specifically to avoid a database update succeeding while the corresponding message or command is lost. It also requires consumers to tolerate duplicate delivery.[^2] A process manager is appropriate when a central component must retain the state of a multi-step process and determine the next message; the same pattern is unnecessary overhead when applied indiscriminately.[^3] That is why this design is limited to the task lifecycle rather than every Rove interaction.

### Command states

Each durable command should have one of these states:

- `pending`
- `leased`
- `accepted`
- `possibly_started`
- `succeeded`
- `failed`
- `cancelled`
- `reconcile_required`

`accepted` means only that the recipient accepted the request. `succeeded` requires an authoritative terminal fact. If the process dies after dispatch but before recording the response, the command becomes `reconcile_required`; it is not blindly reissued.

Examples:

- A Codex interrupt is reconciled with `thread/read` and turn state.
- A Codex archive is reconciled by listing or reading the thread archive state.
- A Runtime release is reconciled through session ownership and generation.
- A continuation is reconciled with the bound thread and its correlated turn/message identity.

### Per-task serialization

Locally, the worker can use the single SQLite writer and a short database transaction to claim a task and due command. A lease includes `owner_id`, `generation`, and `expires_at`. Restart releases only expired leases and increments the processor generation.

In a hosted PostgreSQL adapter, the same port can use row locks or `FOR UPDATE SKIP LOCKED`. That is an adapter detail; the reducer and product protocol do not change.

## Persistence design

### Local schema

Use one SQLite database for lifecycle-critical state:

| Table | Purpose |
|---|---|
| `task_instance` | Identity, frozen launch configuration, desired state, current reducer state, sequence, ownership generation |
| `task_input` | Deduplicated user intents and external facts with source identity and schema version |
| `task_command` | Transactional outbox, command payload, status, lease, attempts, and reconciliation metadata |
| `task_binding` | Codex thread, Runtime session, browser workspace, and authoritative ownership generations |
| `task_handoff` | Current and historical human handoffs and correlated return-control event |
| `task_attention` | Durable attention request, resolution, and external request identity |
| `task_projection` | Disposable UI projection and revision |
| `schema_migration` | Explicit migration history and compatibility metadata |

The normalized columns should cover identifiers, task sequence, statuses, timestamps, and lookup keys. Versioned JSON may hold already-validated protocol payloads. This avoids both extremes: one opaque JSON blob that cannot enforce relationships, and a huge relational schema coupled to every upstream Codex field.

SQLite documents atomic commit behavior across process, operating-system, and power failures, subject to the filesystem and configuration assumptions.[^4] Write-ahead logging allows readers to proceed alongside a writer but still has one writer at a time, which is a good fit for a local task ledger.[^5] Configure and verify:

- WAL mode;
- `synchronous = FULL` for lifecycle commits;
- foreign keys enabled;
- a bounded busy timeout;
- automatic checkpointing plus a controlled checkpoint during clean shutdown;
- integrity check and migration backup before a production schema upgrade.

### Storage port

The platform-neutral package should depend on an interface such as:

```ts
interface TaskStore {
  transact<T>(operation: (tx: TaskTransaction) => Promise<T>): Promise<T>;
  claimDueCommands(worker: WorkerIdentity, limit: number): Promise<Command[]>;
  recordCommandFact(fact: CommandFact): Promise<void>;
  subscribe(cursor?: ProjectionCursor): AsyncIterable<TaskProjectionChange>;
}
```

The exact interface should be generated or contract-tested against both an in-memory adapter and SQLite. A future PostgreSQL adapter implements the same behavior. SQL syntax or Electron types must not appear in the reducer package.

### Product API

Keep `LocalProductApi`, but treat “Local” as the current adapter name rather than the domain boundary. Extract a versioned transport-neutral `ProductApi` contract with:

- commands that return accepted intent identities;
- queries that return versioned snapshots;
- a resumable subscription cursor;
- no renderer-provided task IDs, working directories, component bindings, or execution settings outside the explicit product choices.

The Electron preload calls an in-process adapter today. A future hosted client can call an HTTP/WebSocket adapter with the same request and event schemas.

## Tool selection

### Chosen now

| Responsibility | Choice | Reason |
|---|---|---|
| Lifecycle decisions | Existing generated Rove reducer | Already represents the product semantics and is covered by deterministic fixtures; replacing it adds risk without fixing durability. |
| Local transactional storage | SQLite | Embedded, one-file deployment, atomic transactions, strong crash behavior with correct settings, and a natural fit for a single-user desktop writer. |
| Typed database boundary and migrations | Kysely | Small TypeScript SQL layer supporting both SQLite and PostgreSQL; keeps SQL explicit and allows two adapters without imposing an application framework.[^6] |
| Electron SQLite driver | `better-sqlite3`, conditional on Gate 0 | Mature synchronous transaction API, WAL support, MIT license, and prebuilt binaries for common platforms.[^7] The native binary must pass Electron rebuild, signing, packaging, and crash tests before adoption. |
| Boundary validation | Existing generated validators | Retains exact Codex and Rove protocol validation rather than adding a second schema system. |

Pin exact versions. Kysely had a prior advisory involving certain dynamic JSON-path helpers; use a patched version and do not build query paths from external input.[^8]

`node:sqlite` is not the default recommendation for this Electron 37 line. The API was added in Node 22.5, was still experimental in Node 22.13, and only became release-candidate stability in Node 25.7.[^9] It remains an attractive later simplification after the Electron runtime moves to a Node version where the module and required options are mature.

### Evaluated but not adopted for this refactor

| Tool | Strength | Why not now |
|---|---|---|
| XState | Mature statecharts, visual reasoning, model-based testing | Persisted snapshots do not by themselves provide durable external-command delivery. Actions are not replayed and invoked actors restart after restoration.[^10] Rove already has a reducer, so XState would add a second model. It remains useful as an optional test generator later. |
| Restate | Durable workflows, per-key serialization, human wait/resume, embedded state in a single server binary | Strong conceptual fit, especially for a later hosted runner, but the desktop would have to ship and manage another server process, data directory, upgrades, backup/restore, networking, and a source-available license review.[^11] That is too much operational surface for the bounded local fix. Keep it as a future hosted-runner candidate behind the same ports. |
| Temporal | Proven durable execution and recovery | A production self-hosted Temporal Service is an operational system with security, visibility, scaling, and upgrade responsibilities.[^12] It is disproportionate for an embedded desktop process. |
| DBOS | Durable TypeScript workflows with recovery | Requires PostgreSQL for its system database.[^13] It is a credible future service candidate, not a local Electron dependency. |
| Inngest | Event-driven functions and a self-hosted server | The self-hosted stack combines several server subsystems and persistence dependencies.[^14] It is broader than Rove's local lifecycle need. |
| Reflow | Embedded TypeScript workflows on SQLite and event waiting | Its design is close to the local need, but the project is young and has a small adoption footprint.[^15] It may be used as an experiment comparator, not the Phase 5 production foundation. |
| PGlite | PostgreSQL semantics in-process | Its WebAssembly/runtime weight and single-user operating assumptions do not buy enough over SQLite locally. PostgreSQL compatibility belongs at the `TaskStore` contract, not inside the desktop database engine. |
| Drizzle | TypeScript SQL tooling | Kysely is the thinner fit for explicit repository adapters; adopting both is unnecessary. |

The tool decision is intentionally plural. Libraries provide the database, transactions, typed SQL, and migrations. Rove implements only its domain reducer, ports, and recipient-specific reconciliation—the product-specific code that a general tool cannot know.

## Local and future hosted topology

### Local product now

```text
Renderer
   │ versioned ProductApi intents + projection subscription
   ▼
Electron main process
   ├── Task processor ──► SQLite TaskStore
   ├── Codex adapter ───► Codex App Server
   └── Runtime adapter ─► Rove Runtime ─► managed browser workspace
```

### Hosted product later

```text
Desktop client or browser extension
   │ same versioned ProductApi over network transport
   ▼
Rove service
   ├── Same task processor and reducer
   ├── PostgreSQL TaskStore adapter
   ├── Codex execution adapter
   └── Browser/Runtime adapter appropriate to the deployment
```

The portable assets are the protocol schemas, reducer, reducer fixtures, port contracts, and acceptance traces. The replaceable assets are storage, transport, process supervision, and component adapters.

This does not promise that local tasks can automatically move to the cloud. Device registration, synchronization, conflict resolution, and credential transfer are separate product decisions. It ensures only that the core does not have to be rewritten when those decisions are made.

## Bounded implementation plan

One implementation task should execute these gates consecutively. It must return to an independent Master review and must not self-accept Phase 5.

### Gate 0 — driver and packaging experiment

Before changing production flow:

- build a minimal Kysely + `better-sqlite3` database in the Companion main process;
- prove transactions, foreign keys, WAL, full synchronous mode, busy timeout, migrations, and reopen recovery;
- interrupt the process at controlled points before commit, after commit, after command claim, and after simulated dispatch;
- build and launch the Electron source app;
- package a disposable app once solely to prove native-module rebuild, architecture, signing/staging, and runtime loading;
- compare the in-memory adapter and SQLite adapter against the same contract fixtures.

If native packaging or crash behavior fails, stop this technology choice before changing product state. The fallback is the mature SQLite driver already available in the Electron runtime or a different maintained Node-API driver, assessed against the same experiment. Do not weaken durability settings to make the experiment pass.

### Gate 1 — introduce the ledger without changing user behavior

- add the platform-neutral task-process package and `TaskStore` contract;
- add SQLite migrations and repository adapter;
- import validated lifecycle-critical JSON state on first launch, keeping a timestamped read-only backup;
- record reducer inputs, state, projection, and commands transactionally;
- run the new reducer path in comparison mode against existing projections without dispatching commands;
- fail startup safely on disagreement and emit a compact diagnostic trace.

Do not indefinitely dual-write two authoritative systems. Comparison mode is a migration gate with an explicit removal condition.

### Gate 2 — make the reducer authoritative for the smallest complete lifecycle

Move these operations together, because separating them recreates the gap:

- launch and component binding;
- human handoff and return control;
- finish, interrupt settlement, Runtime release, and archive;
- restart recovery for all the above.

The old coordinator may translate API calls into intents and dispatch reducer commands through adapters. It must no longer select close stages, handoff advancement, or retry behavior independently.

### Gate 3 — remove duplicate lifecycle paths

- delete or reduce the manual close loop and in-memory lifecycle locks;
- remove lifecycle reads from the independent JSON repositories;
- keep non-authoritative conversation caching only if the UI still needs it;
- make attention and continuation state part of the same task transaction;
- add a static or test-enforced rule that external lifecycle mutations originate only from the process worker adapters.

The refactor is not complete while both lifecycle authorities can issue work.

### Gate 4 — source-built acceptance campaign

Run locally from source; do not produce a release package yet.

For every journey, verify normal completion plus controlled process interruption at each lifecycle boundary:

1. GitHub repository and issue journey.
2. Gmail-to-Calendar journey.
3. Drive upload, organize, and download journey using pre-launch attachments.
4. Google Maps visual journey and human handoff/return.
5. Multi-tab PDF/download journey.

At minimum, cut the process:

- after launch intent commit and before dispatch;
- after Codex accepts a request and before Rove records the response;
- after Runtime accepts a request and before Rove records the response;
- while waiting for the human;
- immediately after return control;
- during an active Codex turn when Finish is requested;
- after Codex settles but before Runtime release;
- after Runtime release but before archive confirmation;
- after terminal state commit but before the UI receives it.

After every cut, restart and assert:

- no duplicate external mutation;
- no lost handoff or attention request;
- correct user-visible phase and available action;
- eventual convergence to the same terminal state as the uninterrupted run;
- no owned Codex or Runtime process/session remains after a successful finish;
- a non-convergent task remains explicitly recoverable rather than appearing complete.

### Gate 5 — package once, then repeat a narrow smoke

Only after every source-built journey and interruption matrix passes:

- package the desktop app;
- verify fresh install and upgrade from the last Phase 5 build;
- verify sign-in callback, persistent browser workspace, one normal journey, one human handoff, one finish during an active turn, and one restart recovery;
- verify the database file, WAL/checkpoint behavior, migrations, and native driver on each supported platform/architecture.

## Acceptance rules

The implementation task is complete only when it supplies:

- a finding-by-finding code inventory;
- the reducer/port contract and adapter tests;
- deterministic database and interruption fixtures;
- the JSON import and rollback evidence;
- source-built live evidence for every journey;
- one final packaged smoke after source acceptance;
- proof that the legacy lifecycle executor no longer issues commands;
- compact reproducible traces that link each intent, reducer decision, command, external fact, and final projection by stable IDs;
- all repository lint, typecheck, build, formatting, and test gates.

If the new architecture cannot pass the interruption campaign, the task must stop mutating the implementation, preserve the evidence, and return to a new research/review cycle. It must not continue accumulating case-specific retries.

## Rollback and migration safety

- Before first migration, copy the old validated JSON files into a timestamped backup directory.
- Record the import digest and source revisions in the database.
- Make import idempotent.
- During comparison mode, the old path remains operational and the new store does not dispatch.
- Once Gate 2 starts dispatching from the ledger, rollback means reverting the application version and restoring the pre-migration backup; do not attempt bidirectional synchronization.
- Never delete the backup during Phase 5 acceptance.
- A migration error must leave the old files unchanged and prevent task execution until the user receives a clear recovery message.

## Final recommendation

Proceed with one cohesive implementation task and one independent Master review.

The task should **not** install a general workflow server first. It should begin with the bounded Gate 0 experiment for SQLite, Kysely, and the Electron driver, then promote the existing lifecycle reducer from projection helper to the only command authority. This is the shortest path that addresses the repeated failure class rather than another individual symptom.

The design preserves the future: the same reducer and product API can run behind PostgreSQL and a hosted worker for a browser extension or another client. It also preserves present simplicity: one embedded database and one in-process worker, with no local broker, cloud control plane, synchronization subsystem, or second service.

## Sources

[^1]: OpenAI, [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server). The lifecycle-relevant methods include turn interruption/completion, thread read/resume/archive, and server-request resolution.
[^2]: AWS Prescriptive Guidance, [Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).
[^3]: Enterprise Integration Patterns, [Process Manager](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html).
[^4]: SQLite, [Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html).
[^5]: SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html).
[^6]: Kysely project, [type-safe TypeScript SQL query builder](https://github.com/kysely-org/kysely).
[^7]: `better-sqlite3` project, [SQLite library for Node.js](https://github.com/WiseLibs/better-sqlite3).
[^8]: Kysely project, [JSON path SQL injection advisory for affected historical versions](https://github.com/kysely-org/kysely/security/advisories/GHSA-wmrf-hv6w-mr66).
[^9]: Node.js, [`node:sqlite` documentation and stability history](https://nodejs.org/api/sqlite.html); Electron, [37.2.6 release runtime versions](https://releases.electronjs.org/release/v37.2.6).
[^10]: Stately, [XState persistence](https://stately.ai/docs/persistence) and [model-based testing](https://stately.ai/docs/testing).
[^11]: Restate, [service semantics](https://docs.restate.dev/foundations/services), [self-hosted server](https://docs.restate.dev/server/overview), [human wait/resume](https://docs.restate.dev/ai/patterns/human-in-the-loop), [upgrades](https://docs.restate.dev/server/upgrading), and [license](https://github.com/restatedev/restate/blob/main/LICENSE).
[^12]: Temporal, [self-hosted Temporal Service guide](https://docs.temporal.io/self-hosted-guide).
[^13]: DBOS, [TypeScript workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) and [workflow recovery](https://docs.dbos.dev/production/workflow-recovery).
[^14]: Inngest, [self-hosting architecture and configuration](https://www.inngest.com/docs/self-hosting).
[^15]: Reflow, [embedded TypeScript durable workflow project](https://github.com/danfry1/reflow-ts).
