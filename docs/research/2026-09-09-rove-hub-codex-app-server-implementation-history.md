# Rove Hub and Codex App Server: implementation, failure history, and recommended completion

**Date:** 2026-09-09  
**Audience:** Product, engineering, and future implementation reviewers  
**Pinned Codex baseline:** `0.153.4`  
**Current Phase 5 status:** Closed for source-product scope on 2026-09-12. Packaging and bundling are deferred to a separate release gate. See [the Phase 5 source closeout](../experiments/2026-09-12-phase5-source-closeout.md).  
**Purpose:** Explain in mostly plain English how Rove Hub uses Codex App Server, what failed during Phase 5, how each failure was handled, which corrections should remain, and what one bounded implementation should complete the phase.

## Executive summary

Rove Hub uses Codex App Server as the conversational agent inside the Rove Desktop product. App Server supplies ChatGPT account sign-in, account and usage information, model selection, conversation threads, turns, streamed progress, approvals, and agent messages. Rove supplies the parts that are unique to the product: durable browser workspaces, safe browser actions, evidence, downloads, human takeover, file authority, and the customer-facing task experience.

The high-level choice was correct. OpenAI describes App Server as the interface for embedding Codex into a rich client when the product needs authentication, conversation history, approvals, and streamed agent events. Rove is exactly that kind of client. The mistake was not choosing App Server. The mistake was initially treating it too much like a collection of independent remote calls and not enough like a stateful, connection-scoped conversation service.

Phase 5 consequently developed two substantial systems:

1. a strong Rove product and task foundation, including a unified UI, account projection, browser-task binding, durable lifecycle records, an outbox worker, human-return continuation, file attachments, and recovery; and
2. an App Server client whose individual transport and validation pieces are strong, but whose thread-session behavior still contains contradictory assumptions about history, live attachment, and first-message durability.

That explains the frustrating pattern we experienced. Many corrections were real and necessary, and the complete repository was green at the last accepted compatibility checkpoint. But live runs kept reaching a different boundary because broad tests used locally constructed thread responses that did not fully reproduce the exact App Server session behavior. We repeatedly fixed the symptom that was visible at that boundary while one deeper client-session mismatch remained.

The latest visible error—`Requested message is invalid`, accompanied by repeated recovery notices and no browser opening—is not evidence that the browser engine is failing. The task never reached a valid first Codex turn. The active Rove adapter creates a paginated thread, later expects a legacy thread, tries to obtain paginated history through a legacy full-history read, and treats an empty history array as evidence that the thread is idle. Those assumptions cannot all be correct at the same time.

The recommendation is therefore one bounded correction, not another product reset:

- add a single `CodexThreadSessionSupervisor` inside the existing execution core;
- make it the only place that performs task-related thread and turn operations;
- record the history mode actually returned by App Server;
- keep metadata reads, history retrieval, and live attachment as separate concepts;
- require every open task to reattach after a new App Server connection;
- combine new-thread creation and acceptance of the first user message into one recoverable task command; and
- reconcile uncertain messages by the durable `clientUserMessageId`, using bounded history pages.

The Task Engine, SQLite ledger, Runtime, browser authority, Rove MCP catalog, attachments, unified product surface, and local product API should remain. No cloud backend, new workflow engine, broad browser rewrite, or renderer redesign is required to fix the current problem.

## 1. The product model in plain English

Rove Hub is not intended to be a chat box placed next to a browser. It is intended to be one customer product in which a person can:

- sign in to a ChatGPT account from Rove;
- see the models, reasoning levels, usage, and limits available to that account;
- choose how the task should run;
- choose whether the browser should use a durable named workspace or a temporary identity;
- describe the desired outcome without having to mention MCP or internal tooling;
- follow the agent's conversation and progress;
- take control when a human action is required;
- return control and allow the correct task to continue once;
- stop, recover, finish, archive, and revisit a task; and
- retain reliable evidence of consequential browser actions.

Three separate owners of truth make that possible:

| Area                    | Owner                     | What that means                                                                                                                                       |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation            | Codex App Server          | Threads, turns, messages, streamed items, account state, models, usage, and Codex approval requests come from App Server.                             |
| Browser execution       | Rove Runtime and Rove MCP | Browser workspaces, sessions, targets, actions, downloads, evidence, and control ownership come from Rove.                                            |
| Customer task lifecycle | Rove Desktop Task Engine  | The link between the desired outcome, Codex thread, Runtime session, continuation, attachment, and final product state is durable Rove product state. |

The renderer is deliberately not a fourth source of truth. It displays a projection and sends narrow user intents. It does not invent IDs, select hidden policies, claim an operation succeeded, or directly drive App Server or the managed browser.

## 2. How Codex App Server is implemented in Rove Hub

### 2.1 Rove starts and verifies a local App Server

The Desktop main process owns a supervised Codex child process. The production transport is App Server's stable local `stdio` mode: one newline-delimited JSON message per line. Diagnostics are kept separate from protocol output.

Before Rove uses the process, it verifies the expected Codex version and packaged executable identity. The protocol types and runtime validators are generated from the pinned `0.153.4` App Server schemas. An unsupported or changed component is supposed to fail before Rove starts a customer thread.

For every new transport connection, Rove performs the required sequence:

```text
start process
  -> send initialize with Rove client identity and supported capabilities
  <- validate initialize response
  -> send initialized notification
  -> permit later requests
```

The host correlates each request and response by a unique request ID, validates the response shape, applies timeouts, rejects unknown or duplicate responses, and marks outstanding writes uncertain if the process disappears before their outcome is known.

This transport foundation is sound and should remain.

### 2.2 Rove gets account, model, and usage truth from App Server

Rove does not hard-code the user's plan or available models. It asks App Server for account state, model and reasoning-effort catalogs, rate limits, and token activity. It listens for updates and publishes a redacted product projection.

Browser sign-in and device-code sign-in are initiated through App Server's account operations. Credentials remain in a Rove-owned Codex data directory on the trusted device. They do not enter renderer state and they are separate from the cookies in a Rove browser workspace.

This separation matters: signing in to Rove's Codex account does not sign the managed browser into GitHub or Google, and a persistent browser workspace does not authenticate Codex.

### 2.3 The composer freezes the task's customer choices

Before launch, the full Rove surface asks for the desired outcome and makes two independent choices explicit:

- execution mode: Agent, Companion, or Capture; and
- browser identity: a named persistent workspace or a temporary browser.

It also exposes model, reasoning effort, and the permission-review option. The useful middle option discussed during live testing—“Approve for me”—maps to Rove's reviewed automatic approval setting for eligible local operations. It remains distinct from “always ask” and unrestricted execution.

When the user starts a task, the trusted main process creates the task and operation IDs, chooses the working directory and product policy, and freezes the launch selection. The renderer cannot change those details later by sending a larger internal command.

Capture mode creates the Rove capture/session context but deliberately does not start a Codex turn. Agent and Companion modes proceed into Codex execution with their different control semantics.

### 2.4 Rove binds the task to its Runtime and MCP capability

Rove starts or restores the Runtime session before browser work. The resulting task, Runtime session, browser identity, and selected mode are bound together.

For a Rove-owned task, App Server receives a product-owned configuration containing the required Rove MCP server. That MCP connection is task-scoped. Rove verifies:

- the MCP server is ready and authenticated;
- its name and version match;
- it is bound to the expected Runtime session; and
- the exact production catalog contains the expected 29 tool definitions.

The purpose is to let the customer state only the outcome. The agent does not need to discover a service named “Rove,” and it must not silently fall back to another browser controller.

### 2.5 Rove creates a Codex conversation and submits work

Conceptually, a new task requires two App Server operations:

1. `thread/start`, which creates a new Codex conversation and attaches the current App Server connection to its live events; and
2. `turn/start`, which sends the user's first request and begins the agent's work.

For a continuing task, `thread/resume` rejoins the stored thread and attaches the current connection. If an exact regular turn is already active, a follow-up may use `turn/steer`; otherwise a new turn is started.

Rove supplies a durable operation ID as `clientUserMessageId`. App Server echoes it on the stored user-message item. That is the key that lets Rove determine whether a message was accepted when a response is lost.

The present implementation performs these operations through `CodexRuntimeTaskAdapter`. This is the part that now needs the bounded session-supervisor correction described later.

### 2.6 Events become durable product progress

App Server streams events for turn start and completion, messages, tool work, files, commands, plans, approvals, and other items. Rove validates those events and delivers them in connection order.

The Task Engine stores customer intent, planned commands, command outcomes, task bindings, attention, continuation, and product projection in SQLite. Its worker claims durable commands, calls the Codex/Runtime adapter, and feeds typed results back into the reducer. The reducer then decides the next state and next command.

This is the result of the later “proper reset.” Earlier Phase 5 code allowed JSON stores and coordinator branches to make lifecycle decisions independently. The accepted reset replaced that split decision model with a durable ledger, typed facts, an outbox worker, ordered ingress, and recovery after process interruption.

Some older JSON files and coordinator code remain for compatibility and tests, but they are not supposed to decide new production lifecycle transitions.

### 2.7 The unified product surface displays the same state at three sizes

The compact chip, expanded companion, and full Rove Hub surface are different presentations of the same store and subscription. Expanding or collapsing the product should not create a new thread, reset attention, or change browser control.

The full view contains account onboarding, the outcome composer, task history, conversation, progress, browser state, evidence, approvals, handoff instructions, model/effort selection, and usage. The chat region was made independently scrollable after live use showed that long conversations extended beyond the viewport.

### 2.8 Human takeover and return are durable product events

Codex approval and Rove browser takeover are intentionally different processes, even when they appear in one attention list.

When the browser requires a person, Rove stores the exact task, Codex thread and turn, Runtime session, handoff identity, ownership generation, instruction, and continuation policy. The user can take control without keeping a single MCP wait call open forever.

When control is returned, Rove verifies the exact handoff, invalidates pre-handoff browser targets, requires a fresh browser inspection, and continues at most once. If the originating Codex turn is still active, Rove steers that turn. If the thread is idle, it starts one continuation turn. If a different turn is active or the outcome is uncertain, it waits or stops instead of inventing a user message such as “done.”

Live use exposed that takeover was visible but return control was not. The Return Control action and continuity path were then wired through the product surface and verified through a source-built lifecycle.

### 2.9 Files use explicit customer authority

Rove intentionally does not allow task text containing a local path to grant the browser access to that file. Browser upload accepts only an opaque, task-scoped file-evidence identity.

The Drive live journey revealed that the product needed a real pre-launch attachment control. The resulting attachment boundary lets the user choose a file in the operating-system picker before launch or respond to a mid-task file request. Rove snapshots the selected bytes privately, binds the attachment to the exact task and Runtime session, exposes only safe metadata, materializes it as Runtime evidence, and cleans it up at terminal completion.

This is a product consent boundary, not an App Server feature, and it should remain.

### 2.10 Finish, archive, and restart are task-engine workflows

Finish is not supposed to be a button that merely interrupts the current turn. It is a durable workflow that converges Codex status, Runtime status, attention, continuation, attachment cleanup, profile ownership, and product history. Archive is a separate final action on a terminal conversation.

On restart, the Desktop rebuilds product state from the SQLite ledger and fresh Codex/Runtime facts. Commands accepted before a process cut are reclaimed or reconciled. Consequential browser actions keep their separate Rove receipts and cannot be repeated just because App Server restarted.

This durable task foundation passed the accepted interruption and repository campaigns. The remaining gap is that the App Server adapter still needs a correct per-connection thread-session model before those lifecycle guarantees can be trusted in every live run.

## 3. Phase 5 implementation timeline

| Slice                       | What was delivered                                                                                                                                                         | Final disposition                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P5.0                        | Version-specific App Server experiment and contract lock: transport, MCP, attention, crash cases, surface continuity, continuation, account/catalog, and launch selection. | Accepted after bounded corrections.                                                                     |
| P5.1–P5.5                   | App Server host, protocol validation, account/catalog projection, conversation storage, task-scoped Rove MCP, attention, and continuation.                                 | Accepted after five independent review rounds.                                                          |
| P5.6–P5.7                   | Unified chip/expanded/full product, explicit mode and browser identity, recovery, privacy, and packaged component checks.                                                  | Accepted.                                                                                               |
| P5.8                        | Local product seam. Desktop remains the complete local execution plane; `LocalProductApi` stays versioned and JSON-safe for a future transport.                            | Accepted. No cloud backend built.                                                                       |
| P5.9                        | Real customer acceptance across account, GitHub, Gmail/Calendar, Drive, Maps, research/PDF/download, takeover, restart, finish, and archive.                               | Open. It exposed the issues described below.                                                            |
| Proper reset during P5.9    | Durable Task Engine, SQLite ledger, outbox worker, typed external results, ordered ingress, and process-cut recovery replaced split lifecycle decision paths.              | Architecture gate accepted; compatibility closeout and the last full repository/build campaigns passed. |
| Current App Server research | Exact review of 0.153.4 protocol/server/client source, installed binary, Rove production calls, and isolated history/materialization behavior.                             | Research complete. Session-supervisor implementation not yet accepted.                                  |

## 4. Problems encountered and how each was handled

The following history distinguishes three categories:

- **Direct App Server boundary:** transport, schemas, account, threads, turns, history, events, and restart attachment.
- **Rove integration boundary:** how product tasks, Runtime sessions, MCP, persistence, and App Server are joined.
- **Customer-journey boundary:** browser perception, file selection, downloads, and UI behavior encountered only after a task was running.

### 4.1 The initial contract model was too permissive in several places

**Category:** Rove integration and protocol modeling.

P5.0 initially allowed noncanonical workspace IDs, could start a continuation while an unrelated turn was active, lacked some restored-state and duplicate-task conflict checks, did not always reject identity collisions, accepted a narrower-than-needed schema subset, and had incomplete crash/launch matrices. Some “local product API” tests used weak memory or JSON stand-ins instead of exercising a real serialization boundary.

**Resolution:** The contract models were tightened. Rove-owned IDs were made canonical; continuations became idle-only or exact-turn steering; duplicate and collision checks became fail-closed; RFC 3339 timestamps and the supported schema keywords were validated; restart, crash, transport, and launch matrices were expanded; and the local API was exercised directly and through JSON round trips.

**Retained lesson:** Define identity, state transition, and serialization contracts before product implementation. This correction remains valid.

### 4.2 The first production integration trusted too many partial shapes

**Category:** Direct App Server boundary.

Early P5.1–P5.5 code did not validate every product-used status, item, turn, preview, restored record, and relation as strictly as the pinned protocol required. The tool-catalog integrity check did not initially cover the full definitions. Startup and restore could expose partial state. Attention recovery and the production lifecycle probe were not strong enough.

**Resolution:** Runtime validators were mechanically generated from `0.153.4` TypeScript for 76 product-used schemas. Restore validation was made as strict as write-time validation, including real calendar dates, relationship checks, exact booleans, request method/kind consistency, and bounded collections. The exact 29-tool definitions were pinned. Runtime and Codex bootstrap were reconciled atomically. Durable attention restore was added. A real lifecycle probe exercised start, turn, read, resume, archive, and unarchive through the production host.

**Retained lesson:** Generated validation and symmetric write/restore invariants should remain. However, schema correctness alone did not prove that Rove chose the correct sequence of valid operations.

### 4.3 Account sign-in looked inert or required a second click

**Category:** Direct App Server account flow plus product UI.

The first click could successfully start an App Server login operation while the UI failed to preserve and automatically open the returned trusted URL. A second click appeared to be necessary. Late completion from an older login could also clear a newer attempt, and cancellation could race with a replacement login.

**Resolution:** Rove preserved the current login projection, opened the validated system-browser URL exactly once, exposed a manual retry if opening failed, matched completion and cancellation to the exact login ID, split refresh and account-mutation generations, and prevented an older completion or cancellation from replacing a newer login.

**Status:** Accepted. A live current-ID run completed and the account remained signed in.

### 4.4 Browser login ended on an unreachable localhost success page

**Category:** Direct App Server account configuration.

Authentication itself succeeded, but Chrome was redirected to `localhost:1455/success?...` after the local callback listener had gone away. The browser displayed `ERR_CONNECTION_REFUSED`, creating the impression that sign-in failed even though App Server reported the account signed in.

**Resolution:** The browser-login request selected App Server's hosted success page and ChatGPT branding. The device-code path remained unchanged.

**Status:** The request-construction fix was independently accepted; the authenticated account persisted.

### 4.5 Rove MCP readiness failed even though the server and 29 tools were present

**Category:** Rove integration boundary.

The readiness check compared a digest calculated from an in-memory JavaScript object with a digest of the actual JSON payload. Optional properties whose value was `undefined` existed in memory but were omitted by JSON transport. The pinned digest therefore described a payload the MCP server could never send.

**Resolution:** The shared canonicalization rule now first performs a JSON serialize/parse round trip, then sorts tool definitions and object keys, and finally hashes the actual wire representation. The server name, version, authentication, session binding, exact names, and full definitions remain checked.

**Status:** Accepted and proven through real MCP process tests.

### 4.6 App Server rejected the computer-use configuration

**Category:** Direct App Server configuration.

Rove supplied optional platform fields as null. Across the configuration boundary, the macOS value was interpreted as an invalid empty scalar where App Server expected a structured table.

**Resolution:** When no platform-specific rules exist, Rove omits `macos` and `windows` entirely and sends only the default application-access setting. Start and resume use the same construction.

**Status:** Accepted. A harmless production-equivalent Codex lifecycle passed afterward.

### 4.7 The packaged Codex component set was incomplete as one atomic unit

**Category:** Packaging and App Server integration.

Codex browser work required not just the CLI executable but the compatible code-mode host/helper and their coordinated configuration. Treating one executable digest as the whole component identity left room for mismatched packaged pieces.

**Resolution:** Packaging now stages and verifies the Codex executable and code-mode host as one reviewed component set, including filenames, digests, sizes, platform, architecture, executable mode, and behavior checks before mutation of staging output.

**Status:** Retained. Packaging remains deliberately last after source-live acceptance.

### 4.8 Completed-turn events conflicted after restart

**Category:** Rove conversation persistence.

Older persisted event fingerprints hashed the full mutable transport payload. Newer code hashed only normalized, reducer-relevant content. The same semantic event therefore appeared to have a conflicting identity after restart.

**Resolution:** Event fingerprints became versioned. During authoritative thread reconciliation only, exact legacy start, completed-item, and terminal events can be migrated to the semantic form when their stored content and status match exactly. Ordinary reducer input still rejects a changed event.

**Status:** Migration passed and remains useful for historical records.

### 4.9 A completed historical task remained active and blocked every new task

**Category:** Rove lifecycle integration.

The product could render a conversation as historical and read-only while its task context and Runtime session were still active. Finish interrupted Codex but did not always converge Runtime completion, continuation, attention, attachment cleanup, context removal, profile ownership, and archive eligibility. There was also no normal path back from archived history to the composer.

**Resolution, first stage:** Codex-owned IDs were correctly treated as bounded opaque strings instead of assuming only older UUID variants. Duplicate cleanup controls were removed. Terminal history no longer became the active task. A normal “Back to new task” path was added.

**Resolution, foundational stage:** Research concluded that lifecycle truth was split across the coordinator, several JSON stores, Runtime, Codex, and UI state. Rove introduced a Task Engine with a SQLite ledger, typed facts, durable commands, guarded claims, an outbox worker, ordered ingress, and restart reconciliation. JSON compatibility stores became projections rather than decision owners. Finish, return, attention, attachment cleanup, and archive were routed through the same durable process.

**Status:** The proper-reset architecture was accepted after 36 focused checks, five real production traces, and 21 process-interruption cases. Compatibility closeout then reached 1,149/1,149 repository tests, a successful build, P5.0 75/75, and the full P5.9 deterministic lifecycle campaign.

### 4.10 The first durable-process implementation was a parallel journal, not the owner

**Category:** Rove lifecycle architecture.

The initial Task Process Manager implementation created SQLite tables and an outbox, but production still dispatched operations immediately through coordinator code, still required continuation/attention/task-context JSON files, and did not feed external results back through the reducer. Some indexed columns could disagree with the stored aggregate, and the first interruption tests did not terminate a real child process at the important boundaries.

**Resolution:** A production worker became the only command claimer and dispatcher. External outcomes became typed reducer facts. Task binding, handoff, continuation, attention, and projection became readable from the ledger. Guarded command transitions and two-connection claims were added. Real process-cut tests used the production composition. Legacy active work was quarantined rather than silently replayed.

**Retained lesson:** A persistence layer is not authoritative merely because it records data. All decisions and external outcomes must cross it.

### 4.11 Launch selection could differ from the session that actually started

**Category:** Rove integration boundary.

The product displayed one mode/browser choice while a session-start request could be assembled from a mutable or independently restored context. This risked a mismatch between visible customer intent and the Runtime session.

**Resolution:** Launch configuration is frozen at task acceptance and checked again when the Runtime session starts. Mode, browser identity, workspace, permission reviewer, task ID, and session association must match.

**Status:** Accepted and retained in the Task Engine launch record.

### 4.12 “Approve for me” was not represented as a first-class product choice

**Category:** Product/App Server permission integration.

Live use showed that always asking for every eligible operation made unattended work impractical, while unrestricted execution was not the intended default. The existing product did not clearly carry the middle permission level from UI through frozen launch and resume.

**Resolution:** Rove added an explicit permission-review selection, serialized it in the frozen task configuration, applied the same choice on start and resume, and rejected a resumed thread whose effective setting changed.

**Status:** Accepted in focused and live qualification.

### 4.13 Rejected read-only browser operations stopped the entire customer journey

**Category:** Customer-journey policy, not App Server.

Drive and Maps reached healthy pages, but a retryable stale screenshot/observation response was treated as terminal. A completed Codex turn was also initially accepted as journey success even when the final answer admitted that required steps were not done.

**Resolution:** The route policy now permits one bounded fresh inspect/re-ground/retry only when Rove explicitly marks the operation retryable, the operation is read-only or conclusively pre-dispatch, no consequential effect may have occurred, and there is no human or terminal boundary. Schema mistakes that provably never reached the handler may be mechanically corrected once as a new request. Live harnesses verify journey-specific durable evidence rather than equating “turn completed” with “outcome completed.”

**Status:** Deterministic coverage passed. This policy remains separate from the current App Server session failure.

### 4.14 Download completion was not a first-class expected effect

**Category:** Customer-journey evidence.

The research/PDF journey could click Download, but Rove did not have a canonical way to wait for and correlate the resulting managed file. Exact filename assumptions also failed when Chrome safely added a collision suffix such as `(1)`.

**Resolution:** Rove added `download_completed` as an expected effect, recorded a pre-dispatch action boundary, waited for persisted managed-file evidence, and returned the durable observation and evidence IDs in the receipt. A filename is exact only when the task genuinely requires that saved name; otherwise the actual saved name comes from evidence. Failure, mismatch, timeout, persistence uncertainty, or ownership change remain unresolved or not applied and do not permit a second download.

**Status:** Accepted foundation; the IRS/PDF journey later completed successfully with correlated evidence.

### 4.15 Target names and failure reports were interpreted too literally

**Category:** Customer-journey grounding and acceptance.

One PDF step used a visible target name that was not unique enough. Later, a run that had actually completed the required browser work was reported as failed because the acceptance harness interpreted a non-terminal diagnostic as the task result.

**Resolution:** Bounded target-text grounding was added. The acceptance rule now stops only for a rejected or failed required Rove operation or an unmet final postcondition, not for every diagnostic sentence.

**Status:** The independent research/PDF journey ultimately passed.

### 4.16 Dynamic Google pages made valid targets and screenshots look stale

**Category:** Browser perception/interaction, not App Server.

Calendar continuously changed unrelated page content. Rove's earlier global mutation counter invalidated an otherwise stable target or viewport screenshot even when the document, frame, viewport, and exact target were unchanged.

**Resolution:** For non-coordinate target actions and observation-bound screenshots, Rove may tolerate unrelated page-global churn only after revalidating the exact frame, document/root, target identity, state, geometry, viewport, clipping, and occlusion immediately before dispatch. Navigation, target replacement, movement, ambiguity, ownership change, and consequential uncertainty remain hard stops.

**Status:** The native product Calendar evidence journey passed and produced a real viewport screenshot.

### 4.17 Drive upload reached a deliberate file-authority stop

**Category:** Customer consent and file authority.

The task reached Drive but could not upload `/tmp/rove-live-acceptance.txt`. The agent could not operate the operating-system file picker, and task text alone could not authorize access to that path.

**Resolution:** Pre-launch and mid-task attachment authority was implemented. A person explicitly chooses the file; Rove turns it into opaque task-scoped evidence. Raw paths remain data, not authority.

**Status:** Automated boundary checks passed. The manual native-picker release gate and complete Drive customer journey still need final live qualification after the App Server session correction.

### 4.18 Takeover existed, but returning control was unclear or impossible

**Category:** Rove product continuity.

The user saw a soft takeover indication and could take control, but could not find a button that returned control to the agent. A wait call could also end before the human finished, risking a lost continuation.

**Resolution:** One durable handoff record now survives turn completion and restart. Return Control is routed through an exact task/session/handoff intent and starts or steers at most one continuation after fresh inspection. The action was wired into the source-built surface. Visual refinement remains a later UI-cleanup item.

**Status:** Functional correction accepted; polish deferred.

### 4.19 Long conversations were not scrollable

**Category:** Product UI.

Once the conversation extended below the viewport, the user could not reach later messages.

**Resolution:** The conversation region received its own bounded scrolling behavior while the surrounding product controls remain available.

**Status:** Retained UI correction.

### 4.20 Compatibility closeout initially exposed 24 failures

**Category:** Migration integration.

After the Task Engine reset was accepted, the first full suite passed 1,125 of 1,149 tests. The 24 failures represented grouped compatibility gaps: renderer fixtures still used the old product port, attachment reselection bypassed the new authority, human-return responses used the old continuation path, task-engine decisions could be reported as success, semantic transfer tests compared the wrong state, legacy active work expected replay, and close/bootstrap assertions used the old sequence.

**Resolution:** These were handled as seven migration groups, not 24 unrelated patches. Focused checks passed, then the one full repository run passed 1,149/1,149. The build and frozen Phase 5 campaigns also passed.

**Retained lesson:** This closeout validated the new task architecture, but it still did not reproduce every App Server history and connection mode used in the later live run.

### 4.21 Current failure: the task never reaches a valid Codex turn

**Category:** Direct App Server client-session design.

The current product can display:

```text
Error invoking remote method 'rove:product-intent': Error: Requested message is invalid.
Codex event recovery: Requested message is invalid.
```

The product may also retain a task that blocks a replacement task, while no managed browser is open. That is expected at this failure point: browser work begins only after App Server accepts the initial turn and the agent calls Rove MCP. Here the task fails before that point.

The underlying contradictions are now established:

1. production asks `thread/start` for `historyMode: "paginated"`;
2. later identity validation requires the returned thread to be `legacy`;
3. normal observation and uncertain-message recovery call `thread/read(includeTurns: true)`, which is the legacy full-history pattern;
4. paginated threads require metadata reads plus the paginated turn/item APIs;
5. Rove infers idle/active state by scanning `thread.turns`, even though a valid metadata-only paginated read contains no hydrated turns;
6. a healthy new App Server process is treated too much like a ready task, although every live task must attach on that new connection; and
7. new thread creation and the first user message are recorded as separate durable commands, leaving a process-cut window in which a zero-turn thread may never have been materialized to storage.

An exact handler for the text `list_turns is not supported yet` was added during diagnosis. It may avoid one immediate exception, but it does not resolve any of the contradictions above and is not an acceptable final architecture.

## 5. What the latest research established

### 5.1 What is official and knowable

The official OpenAI documentation says App Server is the rich-client integration for authentication, conversation history, approvals, and streamed events. It uses a connection handshake, distinct thread/turn/item primitives, and streamed lifecycle notifications. `thread/start` creates and subscribes; `thread/resume` reopens and reattaches; `thread/read` reads without resuming. See the [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

The pinned open-source `0.153.4` server makes the subscription behavior explicit: start and resume associate a connection with a thread's event subscribers. The public Codex TUI keeps read-only history replay distinct from a live-attached session.

The installed ChatGPT desktop product was inspected only through read-only process and bundle evidence. It contains `codex-cli 0.153.4` and runs App Server as a child with product-owned configuration. The proprietary renderer and all private recovery branches cannot be known exactly, and the recommendation does not pretend otherwise.

### 5.2 Read, start, and resume are not interchangeable

- `thread/read` tells the client what is stored. It does not subscribe the connection to later turn and item events.
- `thread/start` creates a thread and subscribes the current connection.
- `thread/resume` rejoins a stored or running thread and subscribes the current connection.

Therefore App Server can be connected while a particular Rove task is still detached. Rove needs both states: global server health and per-task attachment readiness.

### 5.3 History behavior must be negotiated

Version `0.153.4` supports legacy and paginated history behavior. In legacy mode, full turns can be obtained through `thread/read`. In paginated mode, metadata and history are separate; history comes through turn/item pagination. The client must remember the mode returned for each thread and use the corresponding reader.

The public Codex client prefers a bounded paginated view and has an intentional fallback profile. It does not request paginated mode and later require legacy mode.

### 5.4 A new empty thread is not yet a durable customer task

An isolated `0.153.4` experiment used a temporary Codex home, no external service, and no customer browser. It showed:

- default start returned a paginated idle thread with zero turns;
- explicit legacy start returned a legacy idle thread with zero turns;
- reading full legacy history before the first message returned a history-unavailable error; and
- stopping the process after `thread/start` but before a first turn left no rollout that a new process could list, read, resume, or archive.

The durable unit for Rove is therefore not “thread start succeeded.” It is “the task's first correlated user message was accepted, or its absence was authoritatively reconciled.”

### 5.5 `clientUserMessageId` is the correct recovery key

App Server can store a client-provided ID with the user message. Rove already has durable operation IDs and already sends one. Recovery should search recent stored items for that ID. It should not resend the message merely because the original response was lost, and it should not scan an unbounded full transcript.

### 5.6 The public client uses one session facade

OpenAI's public client code centralizes App Server startup, typed calls, returned history behavior, event routing, live versus replay-only status, and shutdown behind one session boundary. Rove does not need to copy that UI, but it should adopt the same architectural separation: one component owns App Server session semantics; product reducers do not each invent their own read/resume rules.

## 6. Recommendation: one bounded App Server session correction

### 6.1 Add `CodexThreadSessionSupervisor`

Create one component inside `CodexExecutionCore` and make it the only production path for task-related `thread/*` and `turn/*` calls.

It should expose product-level operations such as:

```text
bootstrap task and start its first turn
ensure this task is attached on the current connection
read thread metadata
read recent bounded history
start or steer a message
reconcile whether a message was accepted
interrupt and observe terminal status
archive and observe the result
```

The supervisor owns:

- current App Server connection generation;
- the history profile negotiated for that connection;
- the history mode actually returned for each thread;
- whether each task is attached, detached, replay-only, active, idle, archived, missing, uncertain, or blocked;
- the exact active turn when known; and
- bounded message correlation.

It does not own the browser, Runtime, product lifecycle reducer, attachments, UI, or cloud synchronization.

### 6.2 Treat connection readiness and task readiness separately

When App Server restarts, Rove may show that the service is connected, but every nonterminal task must temporarily become “reattaching.” Before that task's worker can send another message, the supervisor must:

1. identify the stored thread;
2. call `thread/resume` when the task should remain live;
3. validate the returned thread, effective settings, and required Rove MCP binding;
4. record the returned history mode;
5. obtain recent state through the correct history reader; and
6. classify the task as attached idle, attached active, replay-only, missing, or blocked.

A successful metadata read must never be treated as attachment.

### 6.3 Combine thread start and first-message acceptance

Replace two independently completed product commands with one recoverable bootstrap command:

```text
bootstrap_codex_task
  -> find an existing correlated materialized thread, or create one
  -> validate the returned history profile and Rove MCP binding
  -> start the first turn with the launch operation as clientUserMessageId
  -> persist the thread and initial-message result together
```

If the process stops during this sequence, reconciliation decides among three facts:

- the correlated user message exists: accept it and do not resend;
- the same-generation zero-turn thread still exists: send the initial message once; or
- no stored thread and no correlated message exist: create one replacement thread and send once.

An active thread without the correlation remains uncertain. It does not receive a duplicate request.

### 6.4 Use a negotiated history adapter

For paginated threads:

- read metadata without turns;
- obtain recent turns and items through paginated APIs;
- apply explicit page and item bounds; and
- never use an empty history page to infer idle status.

For legacy threads:

- use the legacy full-history read only where necessary;
- keep the behavior behind the same supervisor interface; and
- accept it only when the returned thread and connection profile support it.

The invariant should be “this returned history mode is supported and stable for this thread,” not “every thread must be legacy.”

### 6.5 Derive liveness from status and events

Whether a thread is active should come from:

- the returned thread status;
- the accepted `turn/start` response;
- ordered `turn/started`, `turn/completed`, and status-change events; and
- the exact active turn identity returned during resume or paging when available.

History content is useful for rendering and correlation. Its shape is not the primary liveness signal.

### 6.6 Remove the superseded workarounds after cutover

After all production task calls cross the supervisor:

- remove the legacy-only identity assertion;
- remove direct full-history reads from paginated task paths;
- reduce `history-compatibility.ts` to the negotiated version profile;
- remove the exact single-error fallback as the final behavior;
- change fixtures that return legacy threads while production asks for paginated history, unless the test explicitly covers fallback; and
- update any earlier test assumption that reconnect should never call `thread/resume`.

### 6.7 Keep the implementation and review finite

This should be one implementation task and one independent Master review, not another sequence of live symptom fixes.

During implementation, run only focused checks covering:

- initialization and connection generation;
- paginated and legacy history profiles;
- metadata read versus live attachment;
- start plus first-message normal flow;
- process cuts before and after first-message acceptance;
- restart and mandatory reattachment;
- active status with no hydrated history;
- start versus steer;
- bounded `clientUserMessageId` reconciliation;
- old-generation event rejection;
- lost approval/request classification;
- close/archive while detached; and
- migration of the currently blocked task.

Then run once:

1. Companion typecheck and focused production-composition tests;
2. the P5.0 compatibility oracle;
3. the complete repository suite;
4. lint and build;
5. source-built local recovery qualification;
6. the external-service campaign, starting with GitHub as the common infrastructure gate; and
7. one package and smoke run only after the live journeys pass.

If GitHub fails for a service-specific reason, later independent journeys may continue. If it fails because App Server/session attachment is still broken, the campaign stops because every later journey shares that dependency.

## 7. What should not be rebuilt

The current evidence does not justify replacing the following:

- Rove Runtime or browser perception/interaction;
- the Task Engine, SQLite ledger, outbox worker, or ordered ingress;
- task-scoped Rove MCP and its exact catalog checks;
- the unified compact/expanded/full surface;
- account/catalog projection;
- explicit execution mode, browser identity, and permission-review selection;
- durable handoff and Return Control;
- attachment authority;
- download evidence and expected effects;
- the versioned `LocalProductApi`; or
- the decision to defer cloud coordination.

These areas produced some of the live findings, but they now have bounded contracts and passing evidence. Reopening them would increase risk and repeat work without fixing the present failure.

## 8. Cloud and future-product implications

The recommended supervisor is not over-localized. It belongs behind a product port inside the trusted device execution plane. The Task Engine remains a portable reducer and store boundary, and `LocalProductApi` remains versioned and JSON-serializable.

A future cloud Hub or browser-extension client can submit authenticated user intent, display projections, and coordinate devices without receiving browser cookies, local file authority, Codex credentials, or the power to declare a consequential action successful. The local supervisor can later sit behind a different transport because its responsibilities are defined in product terms rather than Electron UI calls.

No backend is needed merely to complete Phase 5. Device registration, cloud authentication, synchronization queues, remote transport, scheduling, and workflows belong to later explicitly planned phases.

## 9. Honest current status

What is proven:

- the pinned App Server transport and schema-validation foundations;
- account/model/usage projection and persisted sign-in;
- required task-scoped Rove MCP and 29-tool catalog verification;
- the unified product surface and frozen task choices;
- durable task lifecycle architecture and real process-cut recovery;
- human takeover/return mechanics;
- dynamic-page freshness, download evidence, and attachment authority;
- a successful full repository checkpoint of 1,149/1,149 tests;
- a successful post-reset build, P5.0 75/75, and the deterministic P5.9 lifecycle campaign; and
- successful live portions including Calendar evidence and the research/PDF journey.

What is not proven:

- the final App Server session model in the active production adapter;
- successful reattachment and history handling for the current paginated production path;
- a clean new customer task reaching its first live browser turn after the latest reset;
- the complete GitHub, Drive, Maps, restart, and combined final campaign on the corrected client; and
- the final packaged Phase 5 product.

The current working tree also contains an unaccepted diagnostic fallback related to the observed history error. The last broad green checkpoint predates that partial change. It should neither be called a completed fix nor be used as the basis for release. The supervisor cutover should replace it, after which the finite verification sequence above determines acceptance.

## 10. Final engineering decision

Phase 5 does not need another broad foundational research cycle. The most recent research has now identified the missing boundary precisely.

The right next step is one cohesive implementation of `CodexThreadSessionSupervisor`, followed by one independent Master review. That work should preserve the substantial accepted Phase 5 foundation and correct only the App Server client-session responsibilities that are currently distributed or contradictory.

The correction is complete only when:

- a task cannot dispatch unless its thread is attached on the current connection;
- read does not imply attachment;
- paginated and legacy history follow their own supported paths;
- empty history does not imply idle;
- the first user message, not an empty thread receipt, materializes a customer task;
- every uncertain message is reconciled by durable correlation without duplicate input;
- restart classifies and reattaches every open task before releasing work;
- the source-built external journeys run without another App Server compatibility patch; and
- the package is produced once, after live acceptance.

That is the bounded route out of the repair loop. It addresses the remaining common dependency once, while retaining the product, lifecycle, browser, evidence, and future-cloud seams that have already been built and reviewed.

## Primary sources and local records

Official and pinned OpenAI sources:

- [Official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
- [Codex App Server `0.153.4` README](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/README.md)
- [Codex App Server client `0.153.4` README](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-client/README.md)
- [Thread protocol types, `0.153.4`](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
- [Thread lifecycle implementation, `0.153.4`](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [Public Codex TUI App Server session, `0.153.4`](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app_server_session.rs)
- [Public Codex TUI session lifecycle, `0.153.4`](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/tui/src/app/session_lifecycle.rs)

Rove records:

- [Phase 5 implementation plan](../implementation/phase5-codex-app-server-integration.md)
- [P5.0 contract lock](../experiments/2026-09-07-phase5-p50-app-server-contract-lock.md)
- [P5.1–P5.5 production integration](../experiments/2026-09-07-phase5-p51-p55-production-integration.md)
- [P5.6–P5.7 product surface and recovery](../experiments/2026-09-07-phase5-p56-p57-product-surface-recovery.md)
- [P5.8 local product seam](../experiments/2026-09-08-phase5-p58-local-product-seam.md)
- [P5.9 live acceptance](../experiments/2026-09-08-phase5-p59-live-acceptance.md)
- [P5.9 local live acceptance](../experiments/2026-09-08-phase5-p59-local-live-acceptance.md)
- [Durable task-process research](./2026-09-09-durable-task-process-manager.md)
- [Proper-reset architecture](./2026-09-09-phase5-proper-reset.md)
- [Proper-reset Master review and compatibility closeout](./2026-09-09-phase5-proper-reset-master-review-1.md)
- [Exact App Server client-session research](./2026-09-09-codex-app-server-client-architecture.md)
