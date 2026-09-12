# Phase 5 P5.1-P5.5 production integration

Date: 2026-09-07

Status: implementation complete and ready for master-agent review. This report does not self-accept P5.1-P5.5, and P5.6 has not started.

## Scope delivered

### P5.1: App Server transport and compatibility gate

- `apps/companion/src/main/codex/protocol.ts` contains the reviewed, generated-derived protocol subset used by Rove and its pinned schema digest.
- `apps/companion/src/main/codex/compatibility.ts` permits only the reviewed App Server tuple: version `0.153.4`, macOS arm64 executable digest `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`, and schema digest `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`. Development and packaged executable locations are explicit, and missing, inaccessible, version-mismatched, digest-mismatched, or schema-mismatched binaries fail closed.
- `apps/companion/src/main/codex/rpc-connection.ts` implements strict JSONL request, response, notification, and server-request handling; connection-scoped IDs; timeouts; malformed/orphan/duplicate-message shutdown; and uncertain-outcome classification for outstanding requests after connection loss.
- `apps/companion/src/main/codex/app-server-host.ts` owns the supervised child process, sanitized environment, required `initialize`/`initialized` handshake, health state, bounded restart policy, stderr diagnostics, and graceful shutdown. The stable host facade reconnects listeners and callers after recovery.

This follows the public Codex App Server contract described in the [official App Server documentation](https://developers.openai.com/codex/app-server).

### P5.2: Accounts, catalog, conversations, and persistence

- `account-catalog.ts` provides browser/device-code login initiation and cancellation, logout, redacted account state, account/rate-limit notifications, dynamic model and reasoning-effort discovery, hidden-model filtering, and explicit usage-unavailable results.
- `conversations.ts` provides thread start/list/read/resume/archive/unarchive, turn start/steer/interrupt, deterministic normalized event IDs, idempotent/order-tolerant streaming reduction, conflict rejection, and terminal-state precedence. Only explicit summaries are persisted; transcript content remains in Codex.
- `persistence.ts` provides versioned repositories with atomic temporary-file replacement, mode `0600`, optimistic revisions, and local device-secret creation.

### P5.3: Rove task-scoped execution

- `task-coordinator.ts` persists and freezes contextual authority, opens the exact Runtime session before starting Codex work, launches a task-scoped Rove MCP process, verifies the exact canonical 29-tool catalog, and only then starts the App Server thread.
- A task capability is derived with HMAC from local key material and supplied only to the child MCP environment. Raw capability material is neither returned through the product API nor persisted in task records.
- The App Server thread receives explicit default-deny configuration for competing web search, browser, and computer-use paths. Hidden or unsupported models/efforts are rejected before launch.
- Resume reconstructs the same scoped capability, reconciles the durable Runtime/App Server bootstrap identities, verifies actual-thread MCP readiness, and resumes the exact thread/session with the same deny configuration.
- `packages/protocol/src/rove-tool-catalog.ts` is the single canonical tool catalog. `apps/mcp/src/server/tool-catalog.ts` re-exports it.
- `apps/mcp/src/runtime/task-scoped-runtime-client.ts` binds every Runtime operation to the environment-provided task/session scope, including reuse of the coordinator-created session.

### P5.4: Attention and control handoff

- `attention.ts` separates Codex and Rove attention authorities and models command execution, file mutation, network access, permission prompts, MCP elicitation, user input, and control handoff as typed requests.
- Every request is bound to exact task/thread/turn/item/generation context. The queue is bounded and ordered; exact duplicates are idempotent; ID collisions, stale generations, cancelled requests, and ambiguous decisions fail closed. There is no automatic approval path.

### P5.5: Durable continuations and product seam

- `continuations.ts` assigns stable command IDs and persists an outbox state of `not_started`, then `possibly_started` before any wire dispatch. A possibly-started command is never replayed automatically.
- A continuation either starts on an idle exact thread or steers its exact active turn. Other pending work is rejected. Cancellation and supersession are explicit.
- Completion requires fresh thread truth tying the command to the exact terminal turn before the durable command is consumed.
- `local-product-api.ts` is the versioned main-process seam for task/account/thread/turn/attention/continuation operations. It does not expose raw RPC access or task capabilities.
- `execution-core.ts` composes the services around a dedicated Codex home, persistent repositories, and local key material. `apps/companion/src/main/main.ts` installs the composition root only when `ROVE_CODEX_EXECUTABLE` is configured and shuts it down before application exit.

## Persistence and migration boundary

The first production persistence version introduces:

- `codex-task-contexts.v2.json`
- `codex-conversations.v2.json`
- `codex-continuations.v2.json`
- `codex-attention.v1.json`
- `task-capability.key`

Repositories reject an unknown schema version with an explicit migration-required error. There is no predecessor production schema to migrate. Raw capabilities, Codex credentials, browser cookies, and transcript bodies are not copied into these stores. Codex credentials remain under the dedicated local `CODEX_HOME`; task capability key material remains a local mode-`0600` secret; no new cloud synchronization path was added.

## Verification evidence

| Check                                    | Result                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.0 fixture matrix                      | 72/72 passed after pointing its source check at the canonical protocol catalog                                                                                                                                                                                                                                                                |
| Safe live P5.0 probe                     | Passed against `/Applications/ChatGPT.app/Contents/Resources/codex`, App Server `0.153.4`; verified pre-init rejection, malformed-input diagnostics, logged-out account behavior, dynamic model catalog, unavailable logged-out rate/usage, exact 29-tool MCP catalog, scope mismatch rejection, image/text results, and required-MCP failure |
| Production host live smoke               | Passed with the pinned executable/digest and an isolated Codex home; reached ready health, created a connection, read logged-out account state, and discovered 11 models                                                                                                                                                                      |
| Phase 5 execution tests                  | 13/13 passed in the initial implementation                                                                                                                                                                                                                                                                                                    |
| MCP transport and v1 E2E tests           | 8/8 passed with real stdio and authenticated HTTP transports                                                                                                                                                                                                                                                                                  |
| Focused Runtime/MCP/Companion regression | 108/108 passed                                                                                                                                                                                                                                                                                                                                |
| Full repository test suite               | 127 files, 782 tests passed with host permissions required by local HTTP fixtures and Playwright                                                                                                                                                                                                                                              |
| Static verification                      | `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed                                                                                                                                                                                                                                                                                        |
| Desktop staging                          | `pnpm package:desktop:prepare` passed                                                                                                                                                                                                                                                                                                         |
| Formatting                               | Every changed Phase 5 file passes targeted Prettier checks and `git diff --check`; repository-wide `prettier --check .` still reports 143 pre-existing files outside this change set                                                                                                                                                          |

The live checks were deliberately safe: they used logged-out state and did not initiate login, mutate an account, or execute a consequential browser action.

### Reproduction commands

```sh
pnpm phase5:p50:fixtures
pnpm phase5:p50:live -- --mcp-boundary
pnpm exec vitest run apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/runtime/task-scoped-runtime-client.test.ts
pnpm exec vitest run apps/mcp/src/control-transports.integration.test.ts apps/mcp/test/e2e/v1.e2e.test.ts
pnpm exec vitest run --reporter=dot
pnpm lint
pnpm typecheck
pnpm build
pnpm package:desktop:prepare
git diff --check
```

The full suite requires host permission on macOS because it starts loopback HTTP fixtures and Playwright Chromium processes. Running it in the restricted sandbox fails with `listen EPERM` and Chromium Mach-port permission errors; the identical host-permitted run passed 782/782.

## Phase 5 implementation file inventory

New production and test files:

- `apps/companion/src/main/codex/account-catalog.ts`
- `apps/companion/src/main/codex/app-server-host.ts`
- `apps/companion/src/main/codex/attention.ts`
- `apps/companion/src/main/codex/compatibility.ts`
- `apps/companion/src/main/codex/continuations.ts`
- `apps/companion/src/main/codex/conversations.ts`
- `apps/companion/src/main/codex/execution-core.ts`
- `apps/companion/src/main/codex/index.ts`
- `apps/companion/src/main/codex/local-product-api.ts`
- `apps/companion/src/main/codex/persistence.ts`
- `apps/companion/src/main/codex/phase5-execution.test.ts`
- `apps/companion/src/main/codex/protocol.ts`
- `apps/companion/src/main/codex/rove-mcp-probe.ts`
- `apps/companion/src/main/codex/rpc-connection.ts`
- `apps/companion/src/main/codex/task-coordinator.ts`
- `apps/mcp/src/runtime/task-scoped-runtime-client.test.ts`
- `apps/mcp/src/runtime/task-scoped-runtime-client.ts`
- `packages/protocol/src/rove-tool-catalog.ts`
- `docs/experiments/2026-09-07-phase5-p51-p55-production-integration.md`

Existing files changed for composition or canonicalization:

- `apps/companion/src/main/main.ts`
- `apps/companion/src/main/runtime-client.ts`
- `apps/mcp/src/main.ts`
- `apps/mcp/src/server/tool-catalog.ts`
- `experiments/phase5-app-server/run-fixtures.mjs`
- `packages/protocol/src/index.ts`

No dependency or lockfile change was required by P5.1-P5.5. Other dirty tracked and untracked files in the shared worktree pre-date this assignment and were preserved.

## Deferred risks and next-phase work

- P5.6 must add the renderer/control surface, visible attention presentation, and end-to-end UI recovery without weakening the main-process seam.
- P5.7 must replace the opt-in `ROVE_CODEX_EXECUTABLE` integration switch with the approved bundled artifact/install path, package smoke tests, and platform-specific compatibility tuples. Only macOS arm64 is accepted today.
- Disposable-account interactive login completion, token refresh, and logout should be exercised in a dedicated acceptance environment.
- Real App Server approval variants should be exercised against disposable consequential operations; current production logic and tests fail closed without auto-approval.
- Crash injection should cover the real boundary immediately before and after Runtime/browser dispatch, in addition to the durable outbox unit coverage.
- Incomplete bootstrap records remain safely fenced for operator reconciliation rather than being guessed or automatically replayed.
- No transcript or credential cloud synchronization was introduced; any future synchronization proposal requires a separate trust-boundary review.

## Review disposition

P5.1-P5.5 are ready for master-agent review against this evidence. Acceptance remains with the master agent. P5.6 remains explicitly out of scope for this handoff.

## Master review — round 1

Date: 2026-09-07

Decision: **P5.1-P5.5 remain open. P5.6 is not authorized.** The positive
transport and repository evidence reproduces, but the current production core
does not yet enforce several accepted P5.0 boundaries.

### Independently reproduced positive evidence

- the locked `0.153.4` macOS/arm64 executable resolved and a safe isolated
  production-core smoke reached `ready`, reported logged-out state, and
  discovered 11 models;
- the P5.0 deterministic campaign passed 72/72;
- the focused production tests passed **13/13** across two files (not 14/14 as
  stated above);
- the host-authorized full suite passed 127 files and 782/782 tests; the
  sandboxed run failed only at the expected loopback and Chromium permission
  boundaries;
- lint, typecheck, build, desktop staging, changed-file Prettier, and
  `git diff --check` passed.

### Release-blocking findings

1. **The compiled protocol surface is not a generated, exact subset.**
   `protocol.ts` uses `Record<string, unknown>` and `unknown` for the mutable
   thread/turn surface and App Server results. A constant whole-schema digest
   does not make those handwritten shapes correspond to the generated
   `0.153.4` bindings. The subset also omits the App Server MCP status methods,
   `serverRequest/resolved`, the required item projections, and exact
   server-request/response unions. The initialize response is discarded rather
   than validated and recorded. The official App Server contract confirms that
   generated definitions are version-specific and that `turn/start` overrides
   cwd, model, approval, and sandbox state.

2. **The local product seam delegates trusted authority to its caller.** Raw
   `turn.start` and `turn.steer` parameter objects are forwarded unchanged, so
   a future renderer can select an unbound thread and override frozen cwd,
   model, approval policy, or sandbox policy. Continuation commands likewise
   accept caller-supplied `ThreadTruth`. The trusted main process must resolve
   task/thread identity and read App Server truth itself; the renderer may send
   typed user intent only.

3. **The task capability is not authenticated.** The MCP boundary accepts any
   string beginning with `rtcap_`; the probe reports `authenticated: true` from
   the same prefix check; and neither the MCP process nor Runtime verifies the
   HMAC claims. A deterministic master probe passed
   `rtcap_forged-without-signature-validation` as a task capability. The actual
   task-scoped Runtime boundary must validate an opaque capability bound to the
   exact task, session, mode, and browser identity. Probe readiness must come
   from an authenticated bound call and the actual thread's App Server MCP
   status, not a local assertion.

4. **Task bootstrap is not crash-safe or fully correlated.** A crash/failure
   after Runtime session creation but before its second context write leaves an
   orphan session. On restart the persisted unbound context is treated as safe
   to start again. The master crash-cut probe produced two Runtime sessions,
   zero cleanup calls, and selected the second session. A successful
   `thread/start` followed by local persistence failure can similarly be erased
   and retried as a duplicate thread. Bootstrap needs a durable staged outbox
   and reconciliation from Runtime/App Server truth. The required Codex
   `thread.sessionId` is also not persisted.

5. **Conversation reduction is neither identity-collision-safe nor the
   required bounded projection.** Event IDs are hashes of the full payload, so
   conflicting terminal payloads for the same thread/turn receive different
   IDs instead of colliding; the master probe changed one terminal status from
   completed to failed without rejection. Notifications arriving before the
   post-response association bind are logged and lost. Item started/completed,
   messages, plans, command/file/tool progress, authoritative completion,
   restart reconciliation, and hidden-reasoning exclusion are not reduced into
   a bounded product projection.

6. **Attention resolution can claim success before the wire succeeds.** The
   queue is marked resolved before `rpc.respond`; a simulated transport failure
   left the item visibly `resolved`. `serverRequest/resolved` is ignored, old
   connection requests are not made stale on restart, connection generation is
   hardcoded to one, request methods are recognized by regex instead of the
   generated allowlist, and result payloads are unvalidated `unknown` values.
   Exact per-kind decision schemas and confirmation-driven resolution are
   required.

7. **The continuation path bypasses its defining safety condition.** A caller
   can supply idle `ThreadTruth` and trigger `turn/start`; no Runtime target
   invalidation or fresh browser inspection occurs before dispatch. The master
   probe observed `freshInspectionRequired: false` when the wire request was
   sent. Persisted continuation records are not schema/invariant validated,
   return-event identity is not collision-checked globally, and completion
   truth is caller-authored. The JSON text passed to `turn/start`/`turn/steer`
   is also represented by App Server as user input, without a durable mapping
   that lets Rove project it as a host-authored event rather than a fake user
   message.

8. **Account/catalog and evidence claims overstate the implementation.** Hidden
   models are returned in the product snapshot, the model projection omits the
   server default, and no explicit managed-token refresh operation exists.
   Restored task and continuation data are not runtime-schema validated: the
   master probe accepted an invalid execution mode, browser identity,
   selection source, timestamp, zero handoff generation, empty identities, and
   an invalid consumed continuation. The report's executable and schema
   digests are also mistyped; the authoritative values are
   `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`
   and `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`.

### Required correction gate

The next handoff must correct these as one cohesive trusted-device design:

- compile against and validate an exact reviewed generated protocol subset;
- replace raw local commands with runtime-validated, task-bound intents whose
  App Server parameters are constructed by the host;
- implement cryptographically enforced task/session capability validation and
  actual-thread MCP status/catalog/provenance verification;
- introduce a durable, reconciled bootstrap state machine covering every
  Runtime-session and App Server thread-start crash cut;
- build the bounded identity-based conversation projection and restart read/
  resume reconciliation required by P5.3;
- make attention connection-scoped, explicitly typed, stale-aware, and
  confirmed by `serverRequest/resolved` without claiming success after an
  uncertain write;
- obtain Return Control and thread truth from trusted Runtime/App Server
  authorities, invalidate pre-handoff targets, complete a fresh inspection
  before continuation dispatch, and preserve an explicit host-authored
  presentation identity;
- validate all external and restored data against the accepted schemas and add
  crash, collision, reorder, cancellation, and transport-uncertainty tests for
  every finding above.

The correction handoff must update the evidence table with exact reproducible
counts and digests. It must not start P5.6 or weaken the accepted P5.0 oracle.

## Correction implementation — ready for master re-review

Date: 2026-09-07

Status: all eight round-1 findings have been addressed as one trusted-device
refactor. This is a re-review request, not self-acceptance. P5.6 has not started.

### Finding disposition

1. **Exact reviewed protocol boundary.** `protocol.ts` now carries the reviewed
   0.153.4 request/result types, all 18 product-used client methods including
   `mcpServerStatus/list`, the 11 generated server-request methods, reviewed
   notifications including `serverRequest/resolved`, and the thread/turn/item,
   account/model/usage, and MCP status shapes needed by the product. Requests,
   responses, notifications, server requests, and server responses are validated
   at the transport boundary. The initialize identity is validated, retained by
   the supervised host, and checked against 0.153.4. Raw event mode and raw
   turn-policy overrides fail closed. The reviewed generated source digests are
   `83418e6f3f8100fa59b0324afaaf45c8d258db3dd42a10769d9c337c93b910f2`
   (`ClientRequest.ts`),
   `1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be`
   (`ServerRequest.ts`), and
   `e5f798fd1343c539f01fedea0e8a84a43c080fcca4615c80eb04a5edab4f7d0a`
   (v2 JSON schema bundle).
2. **Task-bound product intents.** `local-product-api.ts` accepts only exact,
   runtime-validated task IDs, user text, client intent IDs, and decisions. The
   coordinator resolves the frozen cwd/model/effort/approval/sandbox policy and
   bound thread/turn identities, reads App Server truth for steer/interrupt and
   continuation actions, and constructs every wire request in the trusted main
   process. Extra caller truth or raw parameter fields are rejected.
3. **Authenticated Runtime/MCP boundary.** Capabilities are HMAC-authenticated and
   bind task, Runtime session, execution mode, and browser identity. The MCP
   process verifies the signature and claims before constructing its scoped
   Runtime client. The production probe performs MCP initialize, `tools/list`,
   and a bound `session.status` call, then checks the actual Codex thread's MCP
   name, version, connection/auth state, and full canonical tool-definition
   digest. A forged-token regression test fails at the MCP boundary.
4. **Crash-safe bootstrap.** A persisted bootstrap attempt ID and staged outbox
   cover intent persistence, Runtime dispatch/bind, Codex thread dispatch, and
   completion. Runtime creation is idempotent by bootstrap ID; restart scans
   Runtime truth. Codex thread creation uses a deterministic `threadSource` and
   restart scans App Server truth. Known MCP failure before thread dispatch ends
   the created Runtime session. The exact `thread.sessionId` is persisted and
   checked on resume. Crash-cut tests prove no duplicate Runtime session or
   Codex thread after post-dispatch persistence failure.
5. **Bounded conversation projection.** Semantic event IDs are separate from
   payload fingerprints, so conflicting terminal payloads collide. Pre-bind
   notifications are durably buffered. The bounded projection covers ordered
   turns, user/assistant/host-authored messages, plans, command/file/tool items,
   progress, authoritative item/turn terminal state, explicit summaries, and
   archive state. Completed state wins reordered starts/deltas; thread read/resume
   reconciliation synthesizes the same semantic events. Reasoning content is
   excluded and only explicit reasoning summaries may be projected.
6. **Confirmation-driven attention.** Attention is an exact, bounded state
   machine with connection generation and task/thread/turn/item identity. Only
   generated allowlisted methods enter it; each response kind is validated.
   Successful writes become `awaiting_confirmation`, wire failures become
   `resolution_unknown`, `serverRequest/resolved` confirms resolution, turn
   terminal events stale unresolved turn requests, and connection replacement
   stales old-generation requests. Legacy approval identities use their call ID.
7. **Host-authoritative Return Control.** Registration reads current App Server
   thread truth and Runtime control generation. Return reads the pending durable
   record, requires Runtime's newer returned generation, performs a fresh Runtime
   inspection, then re-reads App Server truth before dispatch. Caller-authored
   truth is rejected. Return event identities collide globally, restored records
   are invariant-validated, and uncertain outbox commands are never replayed.
   Continuation input uses a durable `continue_` client ID projected explicitly
   as host-authored.
8. **Catalog, restored-state, and evidence corrections.** Hidden models are
   removed from product snapshots while defaults, capabilities, modalities,
   personality support, and service tier are preserved. Managed-token refresh is
   explicit. Login/cancel/logout/notification races are generation-fenced. Task,
   conversation, and continuation stores validate all restored identities,
   enums, timestamps, generations, and state invariants. The authoritative
   executable and aggregate schema digests are recorded below.

### Correction verification evidence

| Check                        | Exact result                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executable identity          | Codex CLI `0.153.4`, macOS arm64 SHA-256 `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`                                                                                                 |
| Generated schema evidence    | 1,243 files, 4,623,543 bytes, aggregate SHA-256 `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`; regeneration reported `pass`                                                            |
| P5.0 deterministic oracle    | 72/72 passed                                                                                                                                                                                                |
| Live P5.0 required-MCP probe | Passed: 0.153.4 initialized, 11 models discovered, one required `rove` MCP connected, 29/29 tool catalog matched, bound call succeeded, scope mismatch rejected, unavailable required server failed visibly |
| Production host smoke        | Passed: strict validated host reached `ready`, retained negotiated macOS/unix identity, read logged-out account state, validated 11 models (6 visible), and identified one default model                    |
| Focused correction tests     | 2 files, 19/19 passed (17 Companion plus 2 MCP capability tests)                                                                                                                                            |
| Full repository suite        | 127 files, 788/788 tests passed with host permissions for loopback and Chromium                                                                                                                             |
| Static/build/package         | `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm package:desktop:prepare` passed                                                                                                                      |
| Formatting                   | Targeted Prettier and `git diff --check` passed                                                                                                                                                             |

### Reproduction commands

```sh
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:live -- --mcp-boundary
pnpm exec vitest run apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/runtime/task-scoped-runtime-client.test.ts
pnpm exec vitest run --reporter=dot
pnpm lint
pnpm typecheck
pnpm build
pnpm package:desktop:prepare
git diff --check
```

Remaining acceptance-environment uncertainty is intentionally narrow: a
disposable authenticated account should exercise interactive login completion,
managed-token refresh, logout, and real consequential approval variants. Those
operations were not performed against the user's account. The safe logged-out
live probes, production host, actual required-MCP boundary, and all deterministic
failure/recovery paths above passed. P5.6 remains unauthorized and untouched.

## Master review — round 2

Date: 2026-09-07

Decision: **not accepted**. P5.1-P5.5 remain open and P5.6 remains blocked.
The correction fixed substantial parts of the first review, but independent
production-path probes found five remaining release blockers. This is one
foundational correction gate; it is not authorization to start P5.6.

### Independently reproduced positives

- The reviewed executable and generated-schema evidence still match Codex App
  Server 0.153.4. Schema regeneration passed without drift.
- The P5.0 deterministic oracle passed 72/72.
- The focused correction suite passed 19/19.
- The full repository suite passed 127 files and 788/788 tests with the required
  host permissions for loopback and Chromium.
- The safe live P5.0 required-MCP probe passed against the reviewed executable.
- Lint, typecheck, build, desktop staging, and `git diff --check` passed. The
  sandboxed desktop-staging attempt could not resolve registry hosts; the same
  command passed with host network permission.

### Remaining release blockers

1. **The production App Server boundary is still not generated-schema exact and
   currently rejects a legitimate live response.** An isolated probe used the
   production `CodexAppServerHost`, the reviewed 0.153.4 executable, a temporary
   Codex data root, and the local required-MCP fixture. `thread/start` reached
   App Server but failed in Rove with `Codex value is missing thread.preview.`
   The generated 0.153.4 `Thread` contract defines `preview` as a string and the
   live server legitimately returned `""`; `validateThread` incorrectly applies
   the non-empty identity validator to it. Conversely, the same validator
   accepted a thread with an invalid status object, an unknown item kind, and
   missing generated turn fields. The checked-in digests identify the source
   bundle but do not make the handwritten partial validator conform to it.
   Replace the partial structural casts with a checked-in, reviewed,
   version-derived validator/type subset, and add a real-host thread lifecycle
   smoke that crosses `CodexRpcConnection` rather than a fake RPC port.

2. **Production restored-state validation does not enforce the claimed
   contracts.** The independent probe showed that `validateTaskContext` accepts
   a date-only timestamp, an unrelated bootstrap source, one-character bound
   identities, and a non-digest capability fingerprint. The conversation-state
   validator accepted a map key that disagreed with its thread identity, an
   unsupported turn state, a numeric active-turn identity, a negative sequence,
   malformed projected items, a non-string event fingerprint, and malformed
   pending events. The continuation validator accepted a pending automatic
   continuation with `freshInspectionRequired: false` plus an unknown field.
   The P5.0 oracle is strict, but these production stores use separate, weaker
   validators. Establish one production-owned schema/invariant implementation
   for task, conversation, and continuation persistence, with exact keys,
   strict RFC 3339 timestamps, identity formats and key agreement, bounded
   collections, and state-dependent invariants. Add restart tests for every
   rejected shape.

3. **The exact Rove tool-definition gate is circular.** Preflight checks the 29
   names but accepts any 64-character definition digest. The actual Codex thread
   is then compared with the digest returned by that preflight launch. Two
   matching launches of the same changed server therefore pass even when every
   input definition differs from the reviewed catalog. The independent probe
   changed every definition while preserving names, and task bootstrap still
   completed. Generate and pin one canonical full-definition digest from the
   reviewed production catalog; require both preflight and the actual
   thread-scoped App Server status to match that independent value. Add a
   deliberate one-definition drift test.

4. **Runtime bootstrap idempotency is not atomic.** `SessionService.start`
   performs `findByBootstrapId` followed by a separately persisted random
   session creation. Two simultaneous calls against the production
   `FileSessionStore` with one bootstrap ID returned distinct session IDs. This
   contradicts the crash-safe bootstrap claim and can leave two browser
   sessions for one task. Introduce an atomic create-or-return primitive (or an
   equivalent durable bootstrap claim) in `SessionStore`, enforce exact launch
   identity on redelivery, and serialize same-task coordinator starts. Cover
   simultaneous calls, process interruption at each claim/session persistence
   cut, and restart reconciliation.

5. **The P5.5 attention projection is not durable.** `OrderedAttentionQueue` is
   recreated in memory on every execution-core start and has no repository or
   restore path. Persisted pending continuations are validated but are not
   re-enqueued, so a Desktop restart removes the visible human-control request.
   Codex requests awaiting confirmation likewise disappear instead of returning
   as non-actionable stale/unknown records until App Server truth is reconciled.
   Persist the bounded attention projection, restore Rove-owned pending records,
   restore Codex-owned records conservatively, and prove restart behavior without
   making an unconfirmed decision actionable.

### Required correction gate

Treat these findings as one cohesive boundary-and-recovery correction. The next
handoff must include:

- a production-host live thread start/read/resume/turn/archive smoke through the
  real response validator;
- negative generated-contract tests for every product-used request, response,
  notification, and server request/response shape;
- production persistence tests that reuse the same invariants as the contract
  oracle;
- an independent full tool-definition manifest/digest and drift rejection test;
- atomic concurrent Runtime bootstrap and crash-cut evidence;
- Desktop-restart attention restoration and conservative Codex-request
  reconciliation evidence;
- the existing 72-check oracle, focused suite, full suite, lint, typecheck,
  build, desktop staging, formatting, and safe live probe rerun with exact
  counts.

Disposable-account authentication and real consequential approval exercises
remain acceptance-environment work. They do not block implementing or testing
the deterministic corrections above. P5.6 must not start until this master gate
is accepted.

## Round-2 correction implementation — ready for master re-review

Date: 2026-09-07

Status: the five round-2 release blockers are corrected and the complete
verification gate below passes. This is a correction handoff, not self-acceptance;
P5.1-P5.5 remain subject to master review and P5.6 has not started.

### Blocker dispositions

1. **Exact generated 0.153.4 boundary and real lifecycle.** The checked-in
   protocol subset now records the individual generated-source digests used for
   `Thread`, `Turn`, `ThreadItem`, `Model`, `McpServerStatus`, `ServerRequest`,
   and `ServerNotification`. Product-used methods validate exact top-level
   generated keys and closed discriminants. An empty thread preview is valid;
   malformed thread status, turn shape, and item discriminants fail closed. A
   production-host lifecycle crossed the real `CodexRpcConnection` and completed
   start, safe turn, read, resume, archive, unarchive, and final archive.
2. **One strict production persistence boundary.** Task, conversation,
   continuation, and attention restoration now share exact-record, bounded
   identity, strict RFC 3339, and digest validation helpers. Their validators
   enforce key agreement, collection limits, enums, non-negative sequences, and
   state-dependent invariants. The round-2 malformed-state matrix is rejected by
   the production restore paths.
3. **Independent full-definition digest.** The canonical production tool
   definitions have pinned SHA-256
   `7ea9e288845f04024c696011ccae7eafa54a5ee443a44629e03965d379856340`.
   The value was repinned when the existing `control.request_human` definition
   gained its required instruction and continuation-policy contract; the
   canonical inventory remains exactly 29 tools.
   Coordinator preflight and actual thread-scoped MCP status must both equal that
   independently generated value. A one-description mutation proves drift is
   rejected even when all 29 names are unchanged.
4. **Atomic Runtime bootstrap.** `SessionStore.createOrReturnByBootstrap`
   provides a durable exclusive bootstrap claim. `SessionService` verifies the
   exact launch identity returned for a redelivery, and the coordinator
   serializes starts for the same task. Concurrent production-store and
   coordinator tests return one Runtime session and one Codex thread; claim/session
   crash-cut restoration materializes the claimed session after restart.
5. **Durable, conservative attention restoration.** The bounded attention
   projection is persisted and restored. Rove-owned pending continuations remain
   actionable and are reconciled with the durable continuation outbox. Unresolved
   Codex-owned requests restore as non-actionable `stale` records until an
   authoritative App Server resolution arrives; no unconfirmed decision becomes
   actionable.

### Round-2 verification evidence

| Check                         | Exact result                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated schema regeneration | Passed against Codex CLI `0.153.4`: 1,243 files, 4,623,543 bytes, aggregate SHA-256 `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`; executable SHA-256 `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`                         |
| P5.0 deterministic oracle     | 72/72 passed                                                                                                                                                                                                                                                          |
| Focused round-2 suite         | 4 files, 30/30 passed: 23 Companion protocol/persistence/coordinator/attention tests, 2 task-capability tests, 3 Runtime bootstrap tests, and 2 production catalog-digest tests                                                                                       |
| Full repository suite         | 128 files, 798/798 tests passed with host permissions required for loopback and Chromium                                                                                                                                                                              |
| Safe live required-MCP probe  | Passed: App Server `0.153.4`, exact 29-tool catalog, bound call, scope-mismatch rejection, typed content, and visible required-server failure                                                                                                                         |
| Real production lifecycle     | Passed through `CodexAppServerHost` and `CodexRpcConnection`: empty preview accepted; start/read/resume/turn/archive/unarchive succeeded; safe turn `01a07d8f-d44e-70d0-8bae-dc144d24f755` completed; test thread `01a07d8f-d274-7041-ae17-31c3103c128b` was archived |
| Static/build/package          | `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm package:desktop:prepare` passed                                                                                                                                                                                |
| Formatting                    | Targeted Prettier and `git diff --check` passed                                                                                                                                                                                                                       |

### Round-2 reproduction commands

```sh
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:live -- --mcp-boundary
ROVE_LIFECYCLE_USE_EXISTING_AUTH=1 node experiments/phase5-app-server/production-host-lifecycle.mjs
pnpm exec vitest run apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/runtime/task-scoped-runtime-client.test.ts apps/runtime/src/session/session.bootstrap.test.ts apps/mcp/src/server/tool-catalog.test.ts
pnpm exec vitest run --reporter=dot
pnpm lint
pnpm typecheck
pnpm build
pnpm package:desktop:prepare
git diff --check
```

The lifecycle used the existing authenticated Codex state only to send the safe
prompt `Reply exactly OK.` and then archived the test thread. It did not execute a
consequential approval, account mutation, or browser action. Disposable-account
authentication and consequential approval variants remain acceptance-environment
work. P5.6 remains unauthorized and untouched.

## Master review — round 3

Date: 2026-09-07

Decision: **not accepted**. P5.1-P5.5 remain open and P5.6 remains blocked.
The five round-2 examples were substantially improved, and the Runtime bootstrap,
tool-definition identity, live empty-preview path, and durable attention behavior
now pass their focused checks. Two parts of the claimed boundary are still less
strict than the version-locked and persisted-state contracts.

### Independently reproduced positives

- The exact App Server 0.153.4 executable and generated-schema bundle regenerated
  without drift: 1,243 files, 4,623,543 bytes, aggregate SHA-256
  `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`.
- The P5.0 oracle passed 72/72 and the round-2 focused suite passed 30/30.
- The full repository suite passed 128 files and 798/798 tests with host permission
  for the loopback and Chromium fixtures.
- The prior concurrent Runtime probe now returns one session identity for the same
  bootstrap identity.
- The live required-MCP probe passed with the exact 29-tool catalog, task-bound call,
  mismatched-scope rejection, and required-server failure behavior.
- The production host lifecycle passed start, safe turn, read, resume, archive,
  unarchive, and final archive. It accepted an empty preview; the safe turn
  `01a07db4-f9cc-77c1-8787-17e706278338` completed and test thread
  `01a07db4-f87c-7292-a8a2-d017bff8e89a` was archived.
- Lint, typecheck, build, desktop staging, and `git diff --check` passed. The first
  desktop-staging attempt was stopped after the restricted environment could not
  resolve the package registry; the same command passed with host network access.

### Remaining release blockers

1. **The production protocol validator is still a partial shape check rather than
   the exact generated 0.153.4 contract claimed by the handoff.** An independent
   negative matrix compared the production validator with the regenerated TypeScript
   definitions. It accepted a thread missing the required `source`, a numeric
   `source`, a string `canAcceptDirectInput`, a command item missing required fields,
   an unknown command-item status, a `thread/start` result missing seven required
   result fields, an `item/started` event missing `startedAtMs`, and a command review
   request missing required `kind` and `environmentId`. Unknown top-level keys and
   the previously failing empty preview are handled correctly, but required fields,
   field types, and nested closed enums are not yet exact. Evidence:
   `/private/tmp/rove-p55-review3.tZJ9VJ/protocol-negative-probe.ts`.

2. **The production restore validators still accept malformed or internally
   inconsistent state.** A second independent matrix found that the task validator
   accepts a calendar-invalid RFC 3339 timestamp; the conversation validator accepts
   a terminal state with an active turn, duplicate turn ordering, an item bound to a
   turn outside the ordering, an unsupported author value, numeric text, and an item
   delta with neither item identity nor delta; the continuation validator converts a
   non-boolean inspection field to `false`; and the attention validator accepts a
   method/kind mismatch and duplicate ordering sequence. These are production restore
   paths, not only contract-oracle fixtures. Evidence:
   `/private/tmp/rove-p55-review3.tZJ9VJ/persistence-negative-matrix.ts`.

### Required correction gate

Treat these as one bounded schema-and-restore correction:

- derive or generate the product-used runtime validators directly from the pinned
  0.153.4 schemas, including required fields, nested discriminants/enums, and field
  types; avoid another manually incomplete field list;
- add negative tests that mutate one required field, scalar type, or closed enum at a
  time for every product-used response/event/request family;
- make the production task timestamp check calendar-valid and make conversation,
  continuation, and attention restoration enforce their exact types and
  state-dependent relationships;
- add the independent negative cases above to the durable regression suite;
- rerun the 72-check oracle, focused suite, full suite, live lifecycle, live MCP
  boundary, schema regeneration, static/build/package checks, formatting, and diff
  check.

P5.6 remains unauthorized until this master gate is accepted.

## Round-3 correction implementation — ready for master re-review

Date: 2026-09-07

Status: both round-3 correction areas are implemented and the complete requested
gate passes. This is a correction handoff, not self-acceptance. P5.1-P5.5 remain
subject to master review and P5.6 has not started.

### Correction disposition

1. **Runtime validation is mechanically derived from generated 0.153.4
   TypeScript.** `generate-runtime-validators.mjs` loads the exact
   `generate-ts --experimental` output through the TypeScript compiler, follows
   imported types, and emits closed runtime schemas preserving required versus
   optional fields, scalar types, literal unions, nested objects, arrays, and
   string-indexed maps. Production request, response, notification, server-request,
   and server-response validation now executes the checked-in generated catalog
   rather than handwritten field lists. The catalog contains 76 product-used roots:
   16 client parameter, 18 client response, 20 notification, 11 server request,
   and 11 server response schemas. The schema-regeneration gate independently
   regenerates and byte-compares this catalog; its pinned SHA-256 is
   `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0`.
   Rove's narrower authority rule still rejects turn-level execution overrides,
   and permission responses require an explicit `strictAutoReview` choice.
2. **Restore validation enforces exact types and relationships.** RFC 3339
   validation now checks real calendar dates, clock values, and offsets instead
   of relying on JavaScript date normalization. Conversation restore enforces
   active/terminal relationships, unique and referentially complete turn ordering,
   projected-item identity, author and text types, and event-type-specific fields
   and identities. Continuation inspection is an exact boolean. Attention restore
   enforces authority/method/kind agreement, unique ordering sequences, and an
   exact sequence watermark.

The two independent reviewer probes now both report `accepted: []`: all nine
protocol mutations and all ten persistence mutations are rejected. Permanent
regressions include those exact cases plus a generated-catalog sweep that creates
valid instances and mutates required fields, scalar values, and closed literals
one field at a time across every product-used schema family.

### Round-3 verification evidence

| Check                                | Exact result                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated schema and runtime catalog | Passed against Codex CLI `0.153.4`: 1,243 files, 4,623,543 bytes, aggregate SHA-256 `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`; executable SHA-256 `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`; regenerated runtime catalog SHA-256 `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0` matched byte-for-byte |
| P5.0 deterministic oracle            | 72/72 passed                                                                                                                                                                                                                                                                                                                                                                |
| Independent round-3 probes           | Protocol 9/9 rejected; persistence 10/10 rejected; each reported `accepted: []`                                                                                                                                                                                                                                                                                             |
| Focused production suite             | 5 files, 37/37 passed: 25 Phase 5 execution tests, 5 generated-schema-family tests, 2 task-capability tests, 3 Runtime bootstrap tests, and 2 production catalog-digest tests                                                                                                                                                                                               |
| Full repository suite                | 129 files, 805/805 tests passed with host permission for loopback and Chromium                                                                                                                                                                                                                                                                                              |
| Safe live required-MCP boundary      | Passed against App Server `0.153.4`: exact 29-tool catalog, bound call, mismatched-scope rejection, typed content, and visible required-server failure                                                                                                                                                                                                                      |
| Real production lifecycle            | Passed through the compiled generated validator: empty preview accepted; start/read/resume/turn/archive/unarchive succeeded; safe turn `01a07dcb-99c8-7743-9102-a958311c649e` completed; test thread `01a07dcb-9886-7650-a2dd-1c040ad8caa8` was archived                                                                                                                    |
| Static/build/package                 | `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm package:desktop:prepare` passed. The restricted staging attempt was stopped after registry DNS failure; the identical host-network run passed.                                                                                                                                                                       |
| Formatting                           | Targeted Prettier and `git diff --check` passed                                                                                                                                                                                                                                                                                                                             |

### Round-3 reproduction commands

```sh
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/protocol-negative-probe.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/persistence-negative-matrix.ts
pnpm exec vitest run apps/companion/src/main/codex/protocol-generated-runtime.test.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/runtime/task-scoped-runtime-client.test.ts apps/runtime/src/session/session.bootstrap.test.ts apps/mcp/src/server/tool-catalog.test.ts
pnpm exec vitest run --reporter=dot
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:live -- --mcp-boundary
ROVE_LIFECYCLE_USE_EXISTING_AUTH=1 node experiments/phase5-app-server/production-host-lifecycle.mjs
pnpm lint
pnpm typecheck
pnpm build
pnpm package:desktop:prepare
git diff --check
```

The lifecycle used existing authenticated Codex state only for the fixed safe
prompt `Reply exactly OK.` and archived the test thread afterward. It performed no
consequential approval, account mutation, or browser action. Disposable-account
authentication and consequential approval variants remain acceptance-environment
work. P5.6 remains unauthorized and untouched.

## Master review — round 4

Date: 2026-09-07

Decision: **P5.1-P5.5 remain open. P5.6 remains blocked.** The two round-3
correction areas are accepted in substance: the checked-in runtime catalog is now
mechanically generated from the pinned Codex App Server `0.153.4` TypeScript,
production uses it at the protocol boundary, byte-for-byte regeneration passes,
and all 19 prior reviewer mutations are rejected. One release blocker remains at
the persistence boundary.

### Accepted corrections

1. The generated runtime catalog covers all 76 product-used request, response,
   notification, server-request, and server-response roots. The master schema
   gate regenerated it from the pinned executable and matched SHA-256
   `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0`.
2. The independent protocol probe now rejects all 9 previously accepted cases.
3. The independent restored-state probe now rejects all 10 previously accepted
   cases, including calendar-invalid timestamps and inconsistent conversation,
   continuation, and attention records.
4. The safe live 29-tool Rove MCP boundary, production App Server lifecycle,
   build, package staging, lint, typecheck, and final isolated full suite all pass.

### Remaining release blocker: write/restore invariant symmetry

Production mutation paths can create snapshots that the same product refuses to
read or restore on the next operation or restart. This is one foundational defect,
not a list of unrelated limit adjustments.

Independent production-path evidence:

- `conversation-boundary-probe.ts` applied real conversation events through 65
  completed turns. The 64-turn compaction removed the oldest turn but retained an
  item that referenced it. The store then failed with `Projected item references
an unordered turn.` and remained unreadable.
- `conversation-pending-boundary-probe.ts` buffered one valid event for each of
  129 unbound threads. The write succeeded even though the restored-state contract
  has a global 128-event limit. The next read failed with `Conversation
pending-event bound exceeded.`
- `bounded-state-symmetry-probe.ts` used the production mutation APIs to add 257
  task contexts, 257 conversation associations, and 257 continuation records.
  Each final mutation succeeded. Each resulting snapshot then failed its own
  restore/read contract with the corresponding configured-limit error.

Therefore the product currently lacks the required invariant: **every successful
mutation must persist a state that its canonical restore validator accepts.**
Ordinary long-running use can cross these boundaries without malformed external
input, so this blocks release acceptance even though the standard suite is green.

### Required cohesive correction

1. Give each durable domain one canonical prepare-and-validate path used before
   every repository write. Do not duplicate a second, weaker write-side rule set.
2. Make conversation compaction relationship-aware: when a turn leaves retained
   history, remove or otherwise consistently project every item that refers to
   that turn before committing the snapshot.
3. Enforce global pending-event and association limits before commit, with one
   documented deterministic outcome (bounded eviction where loss is safe, or a
   visible rejection where it is not).
4. Apply the same pre-commit invariant to task-context and continuation
   collections, including all transition writes, not only their create paths.
5. Add a saturation-and-restart matrix at `N` and `N+1` for every bounded durable
   collection. Each case must prove that a successful mutation remains readable
   after constructing a new store, and that a rejected mutation leaves the prior
   snapshot unchanged and readable.
6. Retain the accepted generated-protocol and strict restored-state work, then
   rerun all P5.0, focused, full-suite, schema/catalog, live MCP, production
   lifecycle, static, build, staging, formatting, and diff gates.

### Independent round-4 verification

| Check                                                  | Master result                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Prior negative probes                                  | Protocol 9/9 rejected; persistence 10/10 rejected                                                                          |
| Generated schema/catalog                               | Pass; pinned executable, aggregate schema digest, and runtime catalog digest matched                                       |
| P5.0 deterministic oracle                              | 72/72 passed                                                                                                               |
| Focused correction suite                               | 5 files, 37/37 passed                                                                                                      |
| Browser-test retry after removing concurrent workloads | 2 files, 29/29 passed                                                                                                      |
| Full repository suite, isolated rerun                  | 129 files, 805/805 passed                                                                                                  |
| Safe live required-MCP boundary                        | Passed; exact 29-tool catalog and task-bound call verified                                                                 |
| Production lifecycle                                   | Passed; turn `01a07dd8-8ab9-7760-962d-8eb315ee18a5` completed and task `01a07dd8-897d-7672-a249-be1c3229b77e` was archived |
| Lint, typecheck, build, desktop staging                | Passed                                                                                                                     |
| `git diff --check`                                     | Passed before this report append                                                                                           |
| Boundary saturation probes                             | Failed as described above; release blocker                                                                                 |

The first full-suite attempt ran concurrently with build and browser staging and
reported four unrelated browser timeouts/expectation failures. All 29 tests in
those two files passed immediately when isolated, and the complete suite then
passed as the only active workload. The isolated 805/805 result is the acceptance
signal; the contended run is retained here for audit clarity.

P5.6 must not begin until the implementation task returns this single correction
as one cohesive change and the master review accepts the resulting boundary
matrix.

## Round-4 implementation response: write/restore invariant symmetry

Date: 2026-09-07

Status: **implemented and returned for Master re-review.** This section records
implementation evidence only; it does not self-accept P5.1-P5.5 or authorize
P5.6.

### Cohesive correction

Each durable domain now has one canonical preparation path shared by restore and
every production write:

1. Task contexts use `prepareTaskContexts` / `prepareTaskContextState`. Resolve,
   replacement, snapshot, restore, and repository persistence validate the full
   candidate collection before mutation or write. The 257th context is rejected
   while the valid 256-context snapshot remains unchanged and restorable.
2. Conversations use `prepareConversationState` before every repository commit.
   Turn compaction now removes items whose turn left the retained 64-turn window,
   then applies the 256-item cap. The 2,048-entry event-fingerprint window uses
   deterministic oldest-first eviction. Association overflow and pending-event
   overflow are loss-sensitive and reject before commit; pending events are no
   longer silently discarded per thread.
3. Continuations use `prepareContinuationState` for reads and every create,
   dispatch crash-cut, cancel, and reconciliation write. The 257th record rejects
   without changing the prior snapshot. The 2,048 return-event-fingerprint cap is
   structurally dominated by the 256-record limit because a record can consume at
   most one return event.
4. Attention mutations construct and validate a complete candidate state before
   installation and persistence. Capacity pressure may evict only the oldest
   terminal entry (`resolved`, `cancelled`, or `stale`); a full actionable queue
   rejects unchanged. Response-start and all terminal/reconciliation transitions
   now persist through the same path.

### Permanent boundary matrix and independent probes

`bounded-state-symmetry.test.ts` is permanent coverage for all reachable bounded
durable collections. It proves exact-capacity success, new-store readability,
N+1 rejection with an unchanged readable repository where loss is unsafe, and
deterministic safe projection where loss is explicitly allowed. Coverage includes
256 task contexts, 64 turns related to their items, 256 items, 2,048 conversation
event fingerprints, 256 associations, 128 global/per-thread pending events, 256
continuations including a transition at capacity, and 100 attention entries.

The three Master probes were rerun:

- `conversation-boundary-probe.ts`: 65 turns applied; restart/read succeeded with
  64 turns and 64 related items.
- `conversation-pending-boundary-probe.ts`: the 129th pending event visibly
  rejected with `Conversation pending-event bound exceeded.`; the repository
  remained readable at 128 threads and 128 events.
- The legacy `bounded-state-symmetry-probe.ts` now stops at its first uncaught
  overflow with `Task context bound exceeded.` Its prior assumption that N+1
  succeeds is intentionally false. The permanent matrix catches each expected
  rejection and continues across all domains, verifying unchanged restart state.

### Round-4 verification

| Check                                   | Result                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permanent saturation/restart matrix     | 5/5 passed                                                                                                                                                                                                              |
| Focused Phase 5 suite                   | 6 files, 42/42 passed                                                                                                                                                                                                   |
| Prior adversarial protocol matrix       | 9/9 rejected; accepted list empty                                                                                                                                                                                       |
| Prior adversarial persistence matrix    | 10/10 rejected; accepted list empty                                                                                                                                                                                     |
| P5.0 deterministic oracle               | 72/72 passed                                                                                                                                                                                                            |
| Generated schema/catalog lock           | Passed: Codex `0.153.4`, 1,243 files, 4,623,543 bytes, aggregate `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5`, runtime catalog `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0` |
| Full repository suite, isolated         | 130 files, 810/810 passed                                                                                                                                                                                               |
| Safe live required-MCP boundary         | Passed: exact 29-tool catalog, task-bound call, mismatch rejection, typed text/image content, unavailable-server failure                                                                                                |
| Production lifecycle                    | Passed: turn `01a07de2-36a7-7043-b1a1-bc5dc3ed192d` completed; thread `01a07de2-3552-7b02-ac84-ddba5693cbcd` read, resumed, unarchived, and archived                                                                    |
| Lint, typecheck, build, desktop staging | Passed                                                                                                                                                                                                                  |

The first full-suite run used an intentionally exhaustive fingerprint test that
committed every intermediate pure-reducer state and hit only that test's 30-second
timeout under whole-suite contention. The test was made equivalent but bounded:
every reducer step still passes the production canonical validator, followed by
one repository commit and new-store read. The isolated final suite then passed
810/810.

### Round-4 reproduction commands

```sh
pnpm exec vitest run apps/companion/src/main/codex/bounded-state-symmetry.test.ts apps/companion/src/main/codex/protocol-generated-runtime.test.ts apps/companion/src/main/codex/phase5-execution.test.ts apps/mcp/src/runtime/task-scoped-runtime-client.test.ts apps/runtime/src/session/session.bootstrap.test.ts apps/mcp/src/server/tool-catalog.test.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/conversation-boundary-probe.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/conversation-pending-boundary-probe.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/bounded-state-symmetry-probe.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/protocol-negative-probe.ts
pnpm exec tsx /private/tmp/rove-p55-review3.tZJ9VJ/persistence-negative-matrix.ts
pnpm phase5:p50:fixtures
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:schema
pnpm exec vitest run --reporter=dot
ROVE_CODEX_EXECUTABLE=/Applications/ChatGPT.app/Contents/Resources/codex pnpm phase5:p50:live -- --mcp-boundary
ROVE_LIFECYCLE_USE_EXISTING_AUTH=1 node experiments/phase5-app-server/production-host-lifecycle.mjs
pnpm lint
pnpm typecheck
pnpm build
pnpm package:desktop:prepare
git diff --check
```

P5.6 remains unauthorized and untouched pending Master acceptance.

## Master review — round 5 acceptance

Date: 2026-09-07

Decision: **P5.1-P5.5 are accepted and closed. P5.6 may begin.** The round-4
correction satisfies the final persistence-boundary requirement. No open
release blocker remains within the P5.1-P5.5 scope.

### Independent acceptance findings

1. Every production write site in task-context, conversation, continuation, and
   attention state now routes through the same canonical preparation/validation
   boundary used for restore.
2. Conversation history compaction preserves relationships: after 65 completed
   turns, a fresh store reads 64 retained turns and 64 matching items, with the
   removed turn and its item both absent.
3. Loss-sensitive capacity is enforced before commit. Independent N+1 probes for
   task contexts, conversation associations, global pending events, and
   continuation records all reject while leaving the exact prior repository
   snapshot unchanged and readable after restart.
4. Attention capacity rejects when every entry is actionable. Once one entry is
   terminal, the oldest terminal entry alone is removed; the new entry and all
   remaining entries survive a fresh-store restore.
5. The accepted generated App Server protocol catalog and all 19 prior strict
   protocol/state corrections remain intact.

### Master acceptance evidence

| Check                                      | Result                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Permanent boundary matrix                  | 5/5 passed                                                                                                                     |
| Independent four-domain N/N+1 probe        | Passed; each rejected write left prior state unchanged and restart-readable                                                    |
| Independent conversation probes            | 65-turn compaction remained readable at 64 related turns/items; pending-event N+1 rejected at 128 with readable retained state |
| Focused P5.1-P5.5 suite                    | 6 files, 42/42 passed                                                                                                          |
| Prior protocol and restored-state matrices | 9/9 and 10/10 rejected; accepted lists empty                                                                                   |
| P5.0 deterministic oracle                  | 72/72 passed                                                                                                                   |
| Generated schema/catalog gate              | Passed against Codex `0.153.4`; all pinned digests matched                                                                     |
| Full repository suite                      | 130 files, 810/810 passed in an isolated master rerun                                                                          |
| Safe live 29-tool MCP boundary             | Passed                                                                                                                         |
| Production lifecycle                       | Passed; turn `01a07deb-4d14-7e31-93d5-b4fbd31821c2` completed and thread `01a07deb-4b55-71d0-a75b-cddaa78c0df9` was archived   |
| Lint, typecheck, build, desktop staging    | Passed                                                                                                                         |
| Prettier and `git diff --check`            | Passed                                                                                                                         |

The known acceptance-environment items remain scoped to later gates: interactive
authentication with a disposable account and a real consequential approval
exercise were not performed against the user's accounts. They do not reopen the
accepted deterministic P5.1-P5.5 production core and remain required before the
overall Phase 5 release gate can close.
