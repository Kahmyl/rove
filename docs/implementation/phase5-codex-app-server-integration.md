# Phase 5 replan: Rove-native Codex product layer

> **Closeout (2026-09-12):** Phase 5 is accepted and closed for the source
> product. Packaging and bundling were explicitly excluded and remain a future
> release gate. See
> [the Phase 5 source closeout](../experiments/2026-09-12-phase5-source-closeout.md).

## Desktop persistence boundary

The native Desktop does not inherit the generic cwd-relative `ROVE_HOME`
default. Its product home is `Rove/product` below Electron's stable per-user
application-data directory, regardless of source versus packaged launch,
repository cwd, or `--user-data-dir`. `ROVE_DESKTOP_HOME` is the only Desktop
qualification override and must be absolute. Runtime and CLI workflows retain
their existing generic `ROVE_HOME` behavior.

Rove's Codex App Server continues to receive a Rove-owned isolated `CODEX_HOME`
inside that product home. Credentials and browser profiles from historical
cwd-relative homes are deliberately not inspected, copied, or migrated.

Date: 2026-09-07

Historical status at publication: replanned around the native Rove product
boundary; final Phase 1–4 live non-regression entry matrix passed on 2026-09-07;
ready for P5.0 contract lock. Superseded by the 2026-09-12 source closeout above.

## Why the original plan is insufficient

The original Phase 5 scope correctly selected Codex App Server, but it treated
the integration as a list of RPC methods. Phases 1–4 showed that this is the
wrong architectural level. The difficult failures were caused by ambiguous
authority, implicit identity, duplicated product state, incomplete protocol
migrations, and verification modeled against the wrong scope.

Phase 5 must therefore integrate four independent kinds of truth explicitly:

1. Codex owns conversation, turn, item, model, and account truth.
2. Rove owns browser workspace, browser session, target, action, evidence, and
   human-control truth.
3. The desktop host owns process lifetime, protocol compatibility, task
   association, and presentation.
4. The renderer is a projection of those truths; it is not an additional
   authority or persistence layer.

## Product outcome

Phase 5 is not an embedded chat panel and it is not a branded wrapper around
an external Codex client. It is the first complete Rove task experience. A
person signs in to Codex through Rove, chooses from the models and reasoning
efforts actually available to that account, confirms the execution mode and
browser identity, describes the desired outcome in ordinary language, and
follows the task from the same Rove surface.

The user must never have to write "use the Rove MCP connector", "use the Rove
custom plugin", or any other tool-routing incantation. Rove owns the Codex
configuration, the required MCP connection, the task policy, and readiness
checks. The composer accepts the task itself, not product setup instructions.

The same surface must also make these states coherent:

- Codex account, plan, available models, reasoning effort, and usage limits;
- task conversation, streamed work, approvals, errors, and completion;
- the user-owned Agent, Companion, or Capture execution mode;
- Rove browser workspace, session, evidence, and live control state;
- a durable human-attention request with clear instructions;
- automatic continuation after the human returns browser control when the
  request explicitly permits continuation.

Phase 5 establishes the task and event foundation that the later workflow
product will reuse. Workflow definitions, schedules, and run history remain a
later phase; they must not require a second conversation or execution model.

## Researched protocol baseline

The planning baseline is Codex CLI `0.153.4`. Its version-specific TypeScript
and JSON Schema bundles were generated locally with:

```text
codex app-server generate-ts --experimental
codex app-server generate-json-schema --experimental
```

The current official contract establishes:

- App Server is the supported deep-client integration for authentication,
  conversation history, approvals, and streamed agent events.
- The stable local transport is newline-delimited JSON-RPC over stdio.
  WebSocket transport and dynamic tools are experimental.
- Every connection must perform `initialize` followed by `initialized` before
  other requests.
- threads, turns, and items are distinct identities with streamed lifecycle
  notifications.
- stored threads resume by `threadId`; list/read APIs and returned runtime
  status are the recovery baseline.
- server-initiated approval requests are correlated by request, thread, turn,
  and item identifiers and later cleared by `serverRequest/resolved`.
- account state, ChatGPT browser/device-code login, model and effort catalogs,
  rate limits, and token-activity summaries are discoverable rather than
  hard-coded;
- MCP startup state is observable, including reauthentication-required
  failures;
- an enabled MCP server can be marked required, causing thread start/resume to
  fail instead of silently continuing without it.

Primary reference:

- <https://developers.openai.com/codex/app-server>

## Product and deployment boundary

```text
Rove Desktop (device execution plane; authoritative in Phase 5)
  |
  +-- Native Rove task surface
  |     `-- account | composer | conversation | progress | attention | browser
  |
  +-- RoveTaskCoordinator
  |     `-- task lifecycle, policy bootstrap, continuation, recovery
  |
  +-- CodexAppServerHost
  |     `-- pinned compatible `codex app-server --stdio`
  |
  +-- CodexRpcClient
  |     `-- initialize, requests, responses, notifications, server requests
  |
  +-- CodexConversationStore
  |     `-- bounded idempotent thread/turn/item projection
  |
  +-- RoveTaskContextAuthority
  |     `-- codexThreadId <-> roveTaskId <-> roveSessionId(s)
  |
  +-- existing Runtime / Control Plane / Rove MCP
  |
  +-- LocalProductApi
  |     `-- typed commands + ordered event subscription
  |
  `-- UnifiedProductProjection
        `-- compact | expanded | full renderer state

Optional future Rove Cloud Hub (control plane; never browser authority)
  |
  +-- Rove account, device registration, encrypted product metadata
  +-- workflow definitions, scheduling, notification routing, remote intent
  `-- versioned command/event transport to an online trusted device
```

Codex App Server is not a new Rove control plane. Rove does not copy Codex
conversation history into its own database, reinterpret Codex turn status, or
proxy browser mutations around MCP.

For the initial local product, no cloud execution API is required. The
renderer communicates with the trusted Desktop main process through typed IPC;
the main process communicates with the existing Runtime through authenticated
loopback interfaces and with App Server through stdio. `LocalProductApi` is a
logical application boundary, not a requirement to expose another localhost
HTTP server.

A future web Hub may use Vercel for the web application, authentication
callbacks, and stateless metadata APIs. Vercel is not the execution host for
App Server process supervision, durable browser workspaces, long-lived browser
sessions, or device secrets. If the cloud control plane later needs durable
coordination, streaming connections, queues, or scheduled workers, those run
on an appropriate stateful service with durable storage. The provider remains
replaceable behind the command/event contract. Phase 5 does not select a cloud
provider or build this optional Hub: the local Desktop product remains complete
without it.

## Decisions

### 1. Use a supervised stdio child, not the experimental WebSocket transport

`CodexAppServerHost` owns one local child process and a strict JSONL boundary.
Protocol messages come only from stdout; diagnostics come from stderr. Request
IDs are host-generated, unique for the connection, and correlated with bounded
timeouts. Malformed stdout, duplicate responses, unknown IDs, premature exit,
and writes after exit are protocol failures.

The host performs bounded restart with backoff. It never assumes an RPC was
accepted merely because bytes were written. Requests outstanding at process
loss fail as transport-uncertain; state is reconciled through App Server read
or resume operations after restart.

### 2. Pin protocol compatibility and regenerate deliberately

Generated bindings are versioned build inputs, not regenerated from whatever
`codex` happens to be on a user's PATH at application startup. Rove records:

- resolved Codex executable identity;
- CLI/App Server version;
- checked-in schema baseline;
- supported version range;
- initialize response and negotiated capabilities.

An unsupported version fails before thread mutation. A Codex upgrade is an
explicit dependency update that regenerates schemas, reviews diffs, and runs
contract fixtures. Development may use an explicitly configured compatible
system binary; packaged production must resolve a pinned Rove-approved binary
or a deliberately supported installation, never silently select an arbitrary
PATH entry.

### 3. Bootstrap Rove capability without user prompting

Rove's existing MCP server remains the single Codex-to-Rove tool surface.
Phase 5 does not duplicate the tool catalog as App Server `dynamicTools`, which
is experimental and would create a second schema/dispatch path. Rove-owned
threads configure the Rove MCP server as required. If it is unavailable,
thread start or resume fails visibly rather than allowing Codex to continue
without browser authority.

The Desktop host generates the Rove-owned Codex configuration and task policy.
It uses a stable product-owned MCP server identity, verifies the expected Rove
catalog and task binding through App Server startup status, and only then
accepts the first turn. The model is told that Rove is the browser authority by
host-owned instructions, never by text the user must remember to type. This
prevents natural-language tool discovery from confusing this product with an
unrelated service or marketplace entry that happens to share the word "Rove".

Readiness is fail-closed and visible. The task surface distinguishes Codex not
ready, Rove MCP not ready, Rove MCP authentication required, and browser
workspace attention required before sending the task. It does not silently
fall back to another MCP server or browser tool.

Built-in browser and computer-use capability must be unavailable to
Rove-owned browser tasks by configuration, not only by prompt. External MCP
clients remain supported and exercise the same Rove contracts.

### 4. Introduce an explicit task-scoped capability

The host creates a durable opaque `roveTaskId` before starting a Codex thread.
The App Server MCP connection receives a task-scoped capability that binds its
Rove calls to that task. Session start returns and records the resulting
`roveSessionId`; later calls must match the bound task.

The association is never inferred from visible text, the latest active
session, renderer state, or parsed assistant output. Required persisted
identity is:

```text
roveTaskId
codexThreadId
codexSessionId (read from App Server, never derived)
zero or more sequential roveSessionIds
selected browserWorkspaceId
executionMode
browserIdentityMode
taskLaunchSelectionSource
```

At most one Rove browser session may be active for a task. A browser workspace
still retains its existing global single-writer lease. The native task
coordinator resolves and freezes execution mode and browser identity before the
first browser session starts; a Codex tool call cannot silently select or
change them. The cross-phase product contract is defined in
[`ADR-task-execution-mode-browser-identity-selection.md`](../adr/ADR-task-execution-mode-browser-identity-selection.md).

### 5. Keep the two approval systems distinct

Codex approvals and Rove browser handoff may appear in one product surface,
but they are different state machines:

- Codex approval: JSON-RPC request ID plus thread, turn, and item identity;
- Rove handoff: Rove session ID plus ownership generation and controller.

The renderer may present both in one ordered attention queue. It cannot answer
either from stale UI state, and it never translates a Rove takeover into a
Codex command/file approval or vice versa. Phase 5 does not auto-approve shell,
file, network, permission, MCP elicitation, or destructive tool requests.

Renderer writes use a separate narrow intent IPC, not the trusted internal
product-command union. The renderer cannot address a task for live mutation,
choose cwd or task/intent identity, select policy, issue raw turn/continuation
operations, or supply an arbitrary attention response. The main process binds
follow-up, stop, Return, and attention decisions to the active task and expands
the exact pending attention identity before any mutation. Historical tasks are
read-only projections.

### 6. Build one event-sourced conversation projection

`CodexConversationStore` reduces responses and notifications by their exact
identities. It tolerates response/notification ordering differences and
duplicate terminal events, while rejecting identity conflicts. Item-completed
state is authoritative over deltas; `turn/completed` is authoritative for turn
terminal status. Reasoning shown to the user is limited to the protocol's
explicit summaries, never hidden chain of thought.

The reducer exposes a bounded desktop snapshot containing:

- account readiness and redacted identity;
- current thread and turn status;
- user and assistant messages;
- bounded plan/tool/file/command progress;
- pending approvals or user input;
- model and rate-limit summaries;
- recoverable warnings and terminal errors.

Codex retains durable transcript authority. Rove persists only task
associations and small product metadata.

### 7. Preserve the one-surface product model

The full presentation gains the conversation surface. Chip and expanded
presentations show bounded task progress, attention state, and existing browser
control actions. They are projections of the same combined product store and
do not run separate polling loops or maintain separate thread state.

Opening or closing the full presentation changes only presentation. It does
not resume, interrupt, create, or switch a Codex thread. Browser Take Over,
Return, Pause, and Stop retain their existing Rove semantics.

The full surface contains six product areas backed by the same store:

1. account onboarding and connection health;
2. outcome composer and task history;
3. conversation and structured progress timeline;
4. browser workspace/session state and evidence;
5. approvals and human-attention instructions;
6. model, reasoning-effort, and usage controls.

These are regions of one product, not independent applications. The current
micro and main companion implementations converge into presentation states of
one native Rove surface. A pending human instruction, approval, or error
survives compact/expanded/full transitions and app restart.

### 8. Keep account identity separate from browser identity

Codex/ChatGPT authentication is owned by App Server and stored in a dedicated
Rove-managed Codex data root. BrowserWorkspace cookies remain owned by the Rove
browser workspace. Neither identity is copied into the other store.

The renderer receives only redacted account state. Login uses App Server's
official ChatGPT browser or device-code flow. Rove never scrapes credentials,
stores access tokens in renderer state, or automates the ChatGPT login through
the Rove task browser.

Rove reads account and plan state from `account/read` and account update
notifications, reads rate-limit and token-activity state from App Server, and
populates the model picker from `model/list`. The UI does not hard-code model
names or infer entitlement from the plan name. Models such as Sol, Terra, or
Luna appear only when the connected App Server reports them, together with
their supported reasoning efforts and default.

### 9. Recover from truth, not from replay

After renderer failure, the host republishes its current projection. After App
Server failure, Rove restarts the child, reinitializes, reads account/model
state, and reads or resumes the recorded thread. It does not replay a turn or
answer an approval whose resolution is unknown.

Cold Desktop startup performs the same coalesced truth recovery after durable
stores and lifecycle listeners are restored and before the execution core is
reported ready. A simultaneous Runtime or App Server recovery shares that
operation. Health, account, conversation, attention, and continuation
listeners are detached when the core stops.

If failure occurs during a consequential Rove tool call, the existing Rove
receipt, consequence key, and replay fence remain authoritative. App Server
restart cannot turn transport uncertainty into permission to dispatch the
browser action again.

### 10. Make human return a durable continuation trigger

`control.wait` is a bounded transport operation, not the owner of product
continuation. A Codex turn may finish after asking the user to take control, a
wait may time out, and the Desktop or renderer may restart while the human is
working. The task must still resume correctly.

When Codex requests human control, `RoveTaskCoordinator` persists a pending
attention record containing:

```text
roveTaskId
codexThreadId
originatingCodexTurnId
roveSessionId
handoffGeneration
handoffId
observationFingerprint
preHandoffObservationSeq
requestedInstruction
continuationPolicy
status
returnEventId
returnObservationSeq
```

The fingerprint covers only immutable observation identity. Exact
`mcpToolCall` replay is therefore a no-op even after the continuation becomes
dispatch-recorded, consumed, cancelled, or superseded; changed immutable input
is a collision. A previously registered historical observation is never
revalidated against a newer active Runtime handoff. Conversely, an unknown
historical observation that the current or most-recently-returned Runtime
handoff cannot corroborate must fail visibly and must not become actionable.

`continuationPolicy` is explicit. `resume_after_control_return` applies only
when completion of the browser handoff is itself the required signal. Requests
that require an answer, choice, uploaded input, or revised task remain
`explicit_user_response` and never auto-continue merely because control moved.

The authoritative Rove Return Control transition creates one durable
`human_control_returned` event for the matching session, ownership generation,
and handoff ID. The coordinator commits that Return receipt before checking
Codex turn eligibility and consumes it exactly once:

1. reject a canceled task, stale generation, mismatched session, or already
   consumed continuation;
2. invalidate pre-handoff browser targets and require a fresh inspection;
3. reconcile the Codex thread and active-turn state;
4. if the originating turn is still active, steer it with the correlated
   completion signal; if a different turn is active, remain pending until a
   serialized terminal event makes the thread idle; otherwise start one
   continuation turn;
5. project "Continuing automatically" and then ordinary streamed progress.

The continuation is a host-originated structured product event. Rove must not
forge a visible user message saying "done", depend on an indefinitely open MCP
call, parse an assistant sentence to discover whether continuation is allowed,
or generate multiple turns when a Return event is replayed.

### 11. Keep privileged execution on the trusted device

The device execution plane owns Codex process supervision, Codex credentials,
browser cookies, browser processes, local files, Rove capabilities, approvals,
and consequential-action receipts. Secrets remain in the App Server data root
or operating-system protected storage and are never exposed to the renderer or
future cloud Hub by default.

The future cloud Hub may know that a device and task exist and may relay a
signed, user-authorized intent to that device. It is not allowed to impersonate
the device's Rove capability, receive browser cookies, or declare a local
browser action successful. Device events and receipts remain authoritative for
execution outcome.

## Isolated experiments before production code

### E1 — protocol lifecycle and drift

Prove initialize, account read, model discovery, thread start/list/read/resume,
turn streaming, steer, interrupt, archive/unarchive, malformed messages,
process exit, and reconnect using the pinned CLI. Record actual event ordering
without freezing one incidental ordering into the reducer.

### E2 — Rove MCP integration boundary

Compare the standard required MCP configuration with experimental dynamic
tools. The expected decision is standard MCP. Prove catalog availability,
task-scoped association, Rove-only browser capability, normal image/evidence
content, and visible failure when MCP is unavailable.

### E3 — approval and handoff concurrency

Drive command, file, network, permission, MCP elicitation, and user-input
requests while independently exercising Rove Take Over/Pause/Return. Prove
identity-scoped decisions, stale-decision rejection, cancellation cleanup, and
one coherent attention queue without merging authorities.

### E4 — crash and outcome reconciliation

Kill App Server before a response, mid-stream, during approval, during an
ordinary Rove action, and after a consequential Rove dispatch. Prove bounded
restart, thread recovery, idempotent projection, no phantom active turn, and no
duplicate external mutation.

### E5 — unified-surface continuity

Exercise chip, expanded, full, close/reopen, renderer crash, desktop restart,
browser fullscreen, and foreground suppression while a turn streams and while
attention is pending. Exactly one native Rove host is visible and conversation
or browser-control state never resets because presentation changed.

### E6 — durable human-return continuation

Exercise return before and after `control.wait` timeout, after the originating
Codex turn completes, during an active turn, after renderer restart, after App
Server restart, and after Desktop restart. Replay and reorder Return events.
Prove exactly one continuation, mandatory fresh browser inspection, no forged
user message, no continuation after cancel, and explicit-user-response
handoffs remaining paused.

### E7 — account, catalog, and local/cloud seam

Exercise logged-out, browser login, device-code login, token refresh, logout,
rate-limit updates, unavailable usage fields, model catalog changes, hidden
models, and unsupported reasoning efforts. Run the product with a fully local
transport, then substitute a fixture transport at the `LocalProductApi`
boundary. Prove that no Codex token, browser cookie, raw MCP capability, or
consequential-outcome authority crosses the future cloud seam.

### E8 — task launch mode and browser identity

Exercise all Agent/Companion/Capture and named-workspace/Temporary
combinations, remembered defaults, one-time overrides, no-workspace startup,
workspace lease contention, mismatched agent requests, presentation changes,
and restart. Prove visible user-owned selection, immutable session launch,
correct initial controller behavior, persistent authentication continuity,
temporary-profile cleanup, and no silent identity fallback.

## Production slices

1. **P5.0 — gate, experiments, and contract lock:** preserve the green Phase
   1–4 matrix; run E1–E8; check in protocol fixtures, a supported-version
   manifest, task/continuation contracts, and the local/cloud trust boundary.
2. **P5.1 — App Server host:** executable resolution, stdio supervision,
   initialize, RPC correlation, diagnostics, shutdown, and restart.
3. **P5.2 — native account and catalog:** ChatGPT login/logout, redacted
   account and plan projection, dynamic model/effort discovery, rate limits,
   usage summaries, and connection health.
4. **P5.3 — conversation core:** thread lifecycle, turns, event reducer,
   interruption, steering, history, and read/resume reconciliation.
5. **P5.4 — zero-instruction Rove task bootstrap:** required MCP
   configuration, verified catalog readiness, host-owned task policy, opaque
   task binding, association persistence, and competing-browser exclusion.
6. **P5.5 — approvals and durable attention:** typed server requests, exact
   response routing, cancellation, human-return continuation, deduplication,
   and unified-but-distinct attention projection.
7. **P5.6 — unified product surface:** onboarding, composer, conversation,
   visible mode/browser-identity selectors, structured progress,
   browser/evidence, model/usage, and compact/expanded/full presentation using
   one combined product store.
8. **P5.7 — recovery, security, and packaging:** renderer/App Server/Desktop
   restart, supported binary packaging, auth continuity, protocol drift,
   secret confinement, and external MCP compatibility.
9. **P5.8 — local application seam lock:** retain the versioned
   `LocalProductApi` command/projection boundary and prove representative
   commands plus a complete projected snapshot survive JSON encode/decode.
   Production continues to use typed Desktop IPC. Device registration, cloud
   authentication, synchronization queues, offline cloud behavior, and remote
   transport are deferred to a separately planned Hub phase.
10. **P5.9 — live acceptance:** an uncoached user enters only a desired
    outcome and completes a fresh real Rove browser journey through the native
    product, including model selection, usage visibility, screenshot,
    execution-mode and browser-identity selection, consequential verification,
    timed-out handoff continuation, restart/resume, and final evidence.

Each slice must pass deterministic tests before the next begins. A failed
experiment can change later slice design; experiment code is not promoted by
copying patches into production.

## Release gates

Entry status: the final Phase 1–4 GitHub, Gmail/Calendar, Drive, Maps, and PDF
journeys are green. The authoritative evidence is recorded in
[`2026-09-07-production-live-acceptance.md`](../experiments/2026-09-07-production-live-acceptance.md).
This opens P5.0; it does not waive any later slice or release gate.

- final Phase 1–4 GitHub, Gmail/Calendar, Drive, Maps, and PDF journeys pass on
  the authoritative pre-Phase 5 stack;
- unsupported App Server versions fail before thread mutation;
- no request is sent before initialize/initialized completes;
- no duplicate or orphaned response can resolve another request;
- thread and turn state recover after App Server and Desktop restart;
- Rove MCP absence fails a Rove-owned thread instead of silently degrading;
- a user can begin a browser task without naming Rove, MCP, a connector, a
  plugin, or a browser tool;
- the exact Rove MCP identity and expected catalog are verified before the
  first task turn;
- Codex cannot use a competing browser/computer-use surface for a Rove task;
- every Rove browser session is bound to an explicit Rove task and Codex
  thread;
- task launch visibly resolves Agent/Companion/Capture and named
  workspace/Temporary as independent choices before the first browser action;
- the model cannot silently select, change, or fall back from the frozen mode
  or browser identity;
- Codex approvals and Rove handoff decisions reject stale identity;
- a consequential browser action is never replayed after uncertain transport;
- one logical Rove surface remains visible through all presentation states;
- ChatGPT auth survives clean restart without exposing tokens to the renderer
  or Rove browser store;
- account, plan, model, reasoning-effort, rate-limit, and usage UI is derived
  from App Server state and handles unavailable fields without invention;
- a Return Control event after a timed-out wait resumes the correct task once,
  while a stale, canceled, replayed, or explicit-response handoff does not;
- automatic continuation requires a fresh post-handoff browser observation and
  does not add a fake user-authored "done" message;
- local task execution remains functional with no deployed cloud service;
- the versioned `LocalProductApi` command/projection seam remains JSON-safe so
  a future transport can be introduced without making one part of Phase 5;
- the existing P5.0 fixture boundary continues to prove that a future Hub
  cannot acquire browser, credential, approval, receipt, or
  consequential-outcome authority;
- external MCP clients continue to pass their existing stdio and HTTP E2E
  journeys;
- full typecheck, lint, build, repository tests, packaged desktop smoke, and
  live acceptance pass.

## Explicit exclusions

- Codex SDK and Responses API reimplementation;
- experimental App Server WebSocket transport;
- experimental dynamic tools as the Rove production tool path;
- App Server `process/*`, realtime voice, plugin marketplace, multi-agent,
  review, and remote-control product surfaces;
- a Vercel-hosted or other cloud-hosted browser/App Server execution runtime in
  Phase 5;
- device registration, cloud authentication, synchronization queues, offline
  cloud coordination, or remote product transport in Phase 5;
- workflow definitions, schedules, triggers, destinations, and run history
  owned by Phase 6;
- a second browser authority, internal vision model, OCR authority, or
  coordinate action fallback;
- duplicating Codex transcript persistence in Rove storage.
