# Phase 5 P5.6-P5.7 product surface and recovery integration

Date: 2026-09-08 (corrected through Master re-review round 4 and independently
accepted)

Status: **P5.6 and P5.7 are accepted and closed by the Master Engineering
Agent.** P5.8 was subsequently narrowed and closed in
[`2026-09-08-phase5-p58-local-product-seam.md`](./2026-09-08-phase5-p58-local-product-seam.md);
P5.9 is the remaining Phase 5 gate.

## Delivered product behavior

### P5.6 unified native product surface

- The renderer has one root snapshot store, one local-product subscription, and
  one `ProductSurface` component tree for chip, expanded, and full
  presentations. Presentation transitions reveal different amounts of the same
  task/session/conversation/attention truth; they do not reinterpret it.
- The full composer accepts only a desired outcome. Before launch, independent
  visible controls require an execution mode (`Automate`, `Work together`, or
  `Capture`) and a browser identity (a named workspace or explicit
  `Temporary`). The trusted main-process API creates task and intent IDs,
  chooses cwd and policy, validates the dynamic App Server catalog, and freezes
  the resolved task context.
- Capture starts the human-owned Runtime session and deliberately does not
  start a Codex turn.
- Account, plan, model, reasoning effort, rate-limit, token-usage, and
  login-pending state come only from bounded App Server projections. Logged-out
  and unavailable states are explicit, login supports browser and device-code
  contracts plus cancellation, and usage is never synthesized. Login URLs do
  not cross into the renderer: an identity-only intent asks the main process to
  resolve the exact current login and then enforce HTTPS before opening the
  system browser.
- The task view projects bounded conversation messages, structured progress,
  task history, browser/evidence counts, and current control. Codex approvals
  and Rove browser handoff are visually and behaviorally separate authorities.
  The renderer supplies only a request ID, generation, decision, and
  schema-validated answers. The main process binds the exact current
  task/thread/turn/item identity; stale or historical decisions reject before
  a wire response.
- Renderer writes use a dedicated narrow intent IPC. Internal task start,
  resume, thread lifecycle, raw turn, continuation, and arbitrary attention
  response commands are unavailable at preload and reject as untyped runtime
  values before the mutable product API is resolved. Launch identities, cwd,
  selection source, approval policy, and sandbox remain host-created.
- Return Control is one renderer IPC operation. The main process resolves the
  exact active Runtime session/task, validates durable continuation truth,
  returns ownership for that exact session, fresh-inspects, and performs at
  most one task-bound continuation dispatch. Stop and every other live control
  are likewise bound only to the active Runtime task; selecting history is a
  read-only presentation choice.
- A completed, task-bound App Server `mcpToolCall` for the real Rove
  `control.request_human` tool is now the only production registration path for
  a durable continuation. Registration validates the exact task, thread, turn,
  session, continuation policy, Runtime generation, and Runtime-issued handoff
  ID. Duplicate stream events and `thread/read` recovery converge on one
  durable record and one Rove-control attention item.
- Each observed handoff has an immutable fingerprint over its exact task,
  thread, turn, Runtime session, handoff ID, generation, instruction, policy,
  and pre-handoff observation sequence. Exact historical replay is a no-op in
  every lifecycle state; immutable drift is a collision. Already-known history
  is not revalidated against newer mutable Runtime state, while an unknown
  historical handoff that Runtime can no longer corroborate is rejected and
  surfaced as recovery attention instead of becoming actionable.
- Runtime persists ownership generation plus active and most recently returned
  handoff IDs. Restart therefore preserves the exact handoff identity and
  monotonic generation instead of recreating either from process memory.
  Automatic policy durably records the exact Return receipt before checking
  Codex turn eligibility, then resumes once when the thread is idle—even after
  coordinator restart or a competing turn. Explicit-response policy returns
  ownership while showing “Your response is needed” and leaving the response
  composer and durable wait pending until the user's successfully dispatched
  response supersedes it.

### P5.7 recovery, privacy, and distribution

- Cold Desktop startup, App Server reconnect, and Runtime recovery call one
  coalesced truth-based coordinator recovery path. Startup does not complete
  until restored state has been reconciled. The path validates immutable
  Runtime mode and browser identity, resumes and reads the exact App Server
  thread, reconciles conversation and continuation truth, and never blindly
  replays `turn/start`. Identity drift is a visible task failure rather than a
  fallback; all execution-core listeners detach on stop.
- The Desktop IPC session is an explicit allowlist of only ID, mode, status,
  controller, and bounded handoff display fields. Workspace/profile objects and
  the complete browser-runtime diagnostic tree remain main-process-only. The
  product snapshot uses an explicit conversation projection and omits cwd, App
  Server session IDs,
  task-capability fingerprints, raw attention payloads, host stderr, cookies,
  tokens, device secrets, login URLs, and full transcript state. Raw Runtime
  sessions remain main-process-only. Renderer-facing display prose and
  collections have executable finite bounds. Opaque request, task, thread,
  turn, item, session, login, rate-limit, and model identifiers, plus accepted
  HTTPS URLs, are either rejected at their explicit ingress limit or preserved
  byte-for-byte; they are never prefix-truncated or normalized into a different
  identity.
- MCP form projection is all-or-nothing. `form`, `openai/form`, and legacy
  `openaiForm` all validate an explicit supported top-level, field, option, and
  array-item key set. Supported field types retain exact
  defaults, options, required state, numeric/string/item constraints, and
  supported formats. Invalid or unsupported schemas remain visible with an
  explicit reason and cannot be partially submitted; decline and cancel remain
  available.
- Production startup uses the packaged App Server by default. The macOS arm64
  distribution contains the reviewed Codex `0.153.4` executable and
  compatibility manifest. Packaging verifies the source digest before clearing
  or mutating staging, retains the verified bytes in memory, and packages those
  exact bytes. Unsupported platform or digest drift fails closed.
- The real packaged Desktop smoke starts the packaged Runtime, creates and ends
  an explicit Temporary session, starts authenticated HTTP MCP, verifies the
  bundled Codex version, launches the native Desktop with managed services, and
  requires it to remain alive through the startup window.

## Compatibility evidence

| Property                           | Verified value                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| Codex App Server                   | `0.153.4`                                                          |
| Platform tuple                     | macOS arm64                                                        |
| Executable SHA-256                 | `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629` |
| Generated schema aggregate SHA-256 | `50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5` |
| Runtime validator catalog SHA-256  | `625e426cc3fcd6e11b3f2e0aaa95ae03682738daba86e5e634ad59a2e0ea27d0` |
| Required Rove MCP catalog          | exact canonical 29 tools                                           |
| Rove tool-definition SHA-256       | `7ea9e288845f04024c696011ccae7eafa54a5ee443a44629e03965d379856340` |
| Packaged manifest                  | `release/staging/services/codex/compatibility.json`                |

The architecture continues to use App Server as the rich-client integration
surface for authentication, conversation history, approvals, and streamed
agent events, consistent with the
[official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Verification results

| Check                                | Result                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.0 schema comparison               | Pass; all recorded version, executable, schema, and validator digests matched                                                                                        |
| P5.0 deterministic oracle            | 75/75 passed, including the production continuation lifecycle matrix and explicit legacy compatibility                                                               |
| P5.6/P5.7 focused production tests   | 93/93 passed across 14 account, IPC intent, product API, cold-start/handoff recovery, Runtime client, renderer, preload, bounded-state, and generated-boundary files |
| Renderer visual and keyboard harness | Pass; five production-renderer artifacts, keyboard order, interactive assertions, and no renderer-emitted host-owned addressing                                      |
| Live App Server read-only probe      | Pass; signed-in account, 9 models, rate limits, usage, and Rove MCP projection                                                                                       |
| Live required-MCP boundary           | Pass; exact server/catalog, bound call, mismatch rejection, text/image content, visible unavailable-server failure                                                   |
| Live signed-in lifecycle             | Pass; streaming, steer, bounded interrupt, list/read/resume, restart recovery without blind replay, archive cleanup                                                  |
| Full repository suite                | 139 files, 864/864 passed on the final single-worker, no-file-parallelism run                                                                                        |
| External MCP E2E                     | 2/2 passed through real stdio and authenticated Streamable HTTP                                                                                                      |
| Static gates                         | `pnpm typecheck`, `pnpm lint`, `pnpm build`, targeted `prettier --check`, and `git diff --check` passed                                                              |
| Desktop packaging                    | Unpacked darwin/arm64 application built successfully                                                                                                                 |
| Packaged native smoke                | Passed for Runtime, MCP, pinned Codex executable, and Desktop process                                                                                                |
| Digest-drift probe                   | Expected nonzero rejection before staging mutation                                                                                                                   |

The first packaged smoke exposed an obsolete implicit browser selection in the
smoke request (`{ mode: "agent" }`) and correctly received HTTP 400. The smoke
was corrected to provide `{ browser: { mode: "temporary" } }`, directly matching
the accepted explicit-identity contract, and then passed. No production
fallback was introduced.

An earlier concurrent gate run hit existing 5-second and 20-second timing
ceilings in one Runtime lifecycle case and one Playwright primitive case. Both
passed in isolation, and the final non-concurrent repository run passed
862/862. During round 4, the ordinary file-parallel run similarly exhausted
shared browser capacity and reported 13 unrelated timeouts/assertions; the
authoritative single-worker, no-file-parallelism rerun passed 864/864.

## Independent-review finding disposition

| Review finding                                 | Corrected disposition                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversation and existing-profile path leakage | Replaced the copied association with an explicit bounded conversation DTO; removed both existing-profile paths; adversarial serialization covers a real conversation and all profile variants.                                             |
| Split, history-addressable Return Control      | Removed `continuation.return` from the renderer command union; one main-process IPC binds the exact active Runtime session to the exact current task.                                                                                      |
| Post-return crash gap and overlapping recovery | Persisted pending continuation plus a newer Runtime generation triggers fresh inspection and one dispatch; App Server and task recovery calls coalesce while in flight; crash and no-op matrices are executable tests.                     |
| Incomplete attention rendering                 | Projects all bounded request-user-input questions/options/Other/secret state, typed MCP form schemas, identity-only URL elicitation, and type-specific approval context; decline and cancel remain distinct.                               |
| Arbitrary external navigation                  | Removed arbitrary renderer URL opening and all renderer login URLs; trusted identity resolution rejects wrong, stale, cancelled/superseded, malformed, and non-HTTPS cases.                                                                |
| Viewed history could retarget live actions     | Introduced separate viewed and active task variables; history is read-only while attention, status, Return, pause, takeover, and stop remain active-task scoped.                                                                           |
| Static-only renderer evidence                  | The Playwright harness now performs DOM interactions and records exact commands for a two-task state, multi-question secret/Other input, typed MCP form, Return Control, and URL elicitation.                                              |
| No real `request_human` continuation bridge    | A completed, bound App Server MCP item is validated against authoritative Runtime handoff truth and registered durably; replay and `thread/read` recovery are idempotent. The production composition test uses no direct insertion helper. |
| Restart reset handoff identity/generation      | Runtime persists the ownership generation and exact active/returned handoff IDs; restart-cut tests prove request, takeover, Return, and post-Return initialization remain monotonic and exact.                                             |
| Return policy mismatch                         | Automatic policy fresh-inspects and dispatches once; explicit-response policy returns control without dispatch and keeps its visible durable wait until a successfully dispatched user response supersedes it.                             |
| Opaque identity truncation                     | Accepted identifiers, model IDs, login IDs, and HTTPS URLs now preserve exact values; adversarial same-prefix IDs prove routing remains distinct. Oversized input fails at explicit ingress limits.                                        |
| Partial or lossy MCP forms                     | Exact supported constraints/defaults/options are projected and validated; unsupported or invalid schemas are visible, non-submittable, and never partially projected.                                                                      |

## Master re-review round 2 disposition

| Review finding                                                                         | Corrected disposition                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay depended on mutable continuation state and current Runtime state                | Registration now compares an immutable observation fingerprint, so exact replay is a no-op while changed immutable input rejects. The matrix covers pending, dispatch-recorded, consumed, cancelled, and superseded records. Known historical observations bypass current Runtime revalidation; unknown uncorroborated history is rejected and made visibly non-actionable.                                                             |
| Delayed automatic continuation could remain pending after a competing turn became idle | Return receipt identity and observation sequence are committed before eligibility is checked. Serialized `turn/completed` reconciliation re-evaluates the persisted receipt, including after coordinator restart, and concurrent/duplicate terminal events produce exactly one `turn/start`.                                                                                                                                            |
| Crash-cut and actual MCP-boundary evidence was incomplete                              | Fresh repositories and restarted stores/coordinators cover first observation while awaiting, after takeover, after Return, App reconnect, Runtime restart, and post-dispatch replay. The task-scoped real `control.request_human` handler and real stdio/HTTP transports prove authoritative session/generation/handoff identity and mismatch rejection. Bridge failures emit a bounded visible alert and refresh the product snapshot. |
| The P5.0 continuation schema was weaker than production                                | The schema and model now include the exact handoff ID, immutable observation fingerprint, pre-handoff observation sequence, and durable Return receipt fields. The 75/75 oracle includes production lifecycle shapes, replay/collision semantics, and explicit generation-only legacy handling.                                                                                                                                         |
| Explicit-response copy and supported form fidelity were incorrect                      | Returned explicit-response attention now consistently says “Your response is needed” across chip, expanded, and full presentations. Empty-string options/defaults are preserved, invalid defaults and calendar values reject, and RFC3339 date-time values retain their timezone-bearing representation.                                                                                                                                |

## Master re-review round 3 disposition

| Review finding                                                    | Corrected disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer-facing command union exposed trusted internal operations | Preload now exposes only `executeProductIntent(RendererProductIntent)`. A main-process IPC adapter rejects unknown/internal command objects before resolving the mutable API. Follow-up, stop, approval/input/form decisions, and MCP URL intents contain no task/thread/turn/item addressing and are rebound to the active task and exact pending attention in main. Launch creates task/intent IDs and selects cwd, selection source, approval, and sandbox policy on the host. Runtime tests feed untyped internal commands and injected allowed intents and prove no mutation occurs. |
| Desktop session projection copied browser-runtime diagnostics     | `DesktopSession` is an explicit semantic projection of session ID, mode, status, controller, and bounded handoff display data. Browser runtime, sandbox diagnostics, diagnostic messages/codes, profiles, workspaces, timestamps, page and handoff internals are omitted. Adversarial serialization covers path-like and credential-like strings in every excluded nested browser/profile/workspace diagnostic location.                                                                                                                                                                  |
| `openai/form` silently discarded arbitrary JSON Schema meaning    | All accepted form modes now use strict supported-key checks at object, field, one-of option, and array-item levels plus type-applicability checks. `pattern`, composition, `multipleOf`, `uniqueItems`, constrained items, non-object roots, conflicting options, and unsupported additional-properties semantics remain visible with a bounded reason but cannot submit. Supported enums/defaults/numeric/string/array/date/date-time behavior remains exact.                                                                                                                            |
| Cold Desktop startup did not reconcile restored truth             | `CodexExecutionCore.start()` attaches conversation, continuation, attention, and health listeners, constructs the product API, then awaits the existing coalesced recovery fence before returning ready. A file-backed production-composition test restores task and post-Return continuation state, overlaps startup and event recovery, proves one inspection and one `turn/start`, proves historical replay inert, and verifies RPC/health listeners detach on stop.                                                                                                                   |

## Master re-review round 4 form compatibility

The executable compatibility table in `local-product-api.test.ts` is derived
from the checked-in Codex App Server 0.153.4 `v2_McpElicitation*` definitions.
It projects the valid cases and submits their exact defaults (with one explicit
Unicode input override), then verifies the exact broker response.

| Generated variant      | Executable coverage                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Boolean                | Boolean default and exact accepted content                                                                                   |
| Number                 | Fractional minimum, maximum, default, and accepted content                                                                   |
| Integer                | Integer minimum, maximum, default, and accepted content                                                                      |
| String formats         | `email`, `uri`, `date`, and timezone-bearing RFC 3339 `date-time`                                                            |
| String length          | One-code-point astral Unicode default and submission satisfy `minLength: 1` / `maxLength: 1`; a two-code-point value rejects |
| Legacy titled enum     | Exact `enum` values and whitespace-bearing `enumNames` labels                                                                |
| Untitled single-select | Exact enum values including the empty string                                                                                 |
| Titled single-select   | Exact `oneOf` `{ const, title }` values and labels                                                                           |
| Untitled multi-select  | Exact `items: { type: "string", enum }`, default, and min/max item bounds                                                    |
| Titled multi-select    | Exact `items: { anyOf: [{ const, title }] }`, default, labels, and min/max item bounds                                       |
| Object metadata        | Bounded `$schema`, a unique known-name `required` list, and exact required/default projection                                |

Malformed and lossy cases are visible but non-submittable and never call the
broker. The table covers non-array/null/mixed/unknown/duplicate `required`,
non-string or oversized `$schema`, unknown top-level keys, hybrid string
variants, missing titled-option titles, duplicate option values, duplicate
multi-select defaults and submissions, defaults below `minItems`, and Unicode
values above `maxLength`.

### Reproduction commands

```sh
pnpm phase5:p50:schema
pnpm phase5:p50:fixtures
pnpm phase5:p50:live
node experiments/phase5-app-server/live-app-server.mjs --mcp-boundary
node experiments/phase5-app-server/live-app-server.mjs --lifecycle
pnpm vitest run apps/companion/src/main/codex apps/companion/src/main/runtime-client.test.ts apps/companion/src/preload/api.test.ts apps/companion/src/renderer/product-surface-state.test.ts apps/companion/src/renderer/product-surface.test.tsx
pnpm --filter @rove/companion typecheck
pnpm typecheck
pnpm lint
pnpm vitest run --maxWorkers=1 --no-file-parallelism
pnpm build
pnpm test:e2e
pnpm package:desktop:dir
pnpm test:desktop:package
node experiments/phase5-app-server/product-surface-visual.mjs
env ROVE_CODEX_EXECUTABLE=/bin/echo node scripts/package-desktop.mjs --verify-codex-only
pnpm exec prettier --check apps/companion/src/main/codex/local-product-api.ts apps/companion/src/main/codex/local-product-api.test.ts docs/experiments/2026-09-07-phase5-p56-p57-product-surface-recovery.md
git diff --check
```

The expected-drift command exits nonzero. Live, browser, loopback, lifecycle,
and native Desktop commands require host permission on macOS.

## Visual evidence

- `docs/experiments/artifacts/p5.6-p5.7-product-surface/full-onboarding.png`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/full-active-handoff.png`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/full-explicit-response-returned.png`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/compact-active.png`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/expanded-attention.png`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/manifest.json`

The onboarding keyboard path is recorded as Desired outcome, Execution mode,
Browser identity, Model, Reasoning effort, then Refresh. Because the fixture is
logged out, launch is honestly disabled and therefore omitted from the tab
order. SSR accessibility tests independently prove labeled composer controls,
distinct attention authorities, and controls in all three presentations. The
full-surface manifest also records successful DOM assertions for historical
read-only isolation, preserved active attention, exactly one Return Control
IPC, exact per-question answers, typed MCP form content, and an external intent
containing identity but no URL or host-owned task/thread/turn/item addressing.

## Implementation inventory

Principal new P5.6/P5.7 files:

- `apps/companion/src/renderer/product-surface.tsx`
- `apps/companion/src/renderer/product-surface-state.ts`
- `apps/companion/src/renderer/product-surface.test.tsx`
- `apps/companion/src/renderer/product-surface-state.test.ts`
- `apps/companion/src/main/codex/local-product-api.test.ts`
- `apps/companion/src/main/codex/account-catalog-bounds.test.ts`
- `apps/companion/src/main/codex/product-recovery.test.ts`
- `apps/companion/src/main/codex/request-human-composition.test.ts`
- `apps/companion/src/main/codex/continuation-observation-replay.test.ts`
- `apps/companion/src/main/codex/product-intent-ipc.ts`
- `apps/companion/src/main/codex/product-intent-ipc.test.ts`
- `apps/companion/src/main/codex/execution-core-startup-recovery.test.ts`
- `experiments/phase5-app-server/product-surface-visual.mjs`
- `docs/experiments/artifacts/p5.6-p5.7-product-surface/*`
- this report

Principal production integrations updated:

- `apps/companion/src/main/codex/account-catalog.ts`
- `apps/companion/src/main/codex/task-coordinator.ts`
- `apps/companion/src/main/codex/local-product-api.ts`
- `apps/companion/src/main/codex/execution-core.ts`
- `apps/companion/src/main/main.ts`
- `apps/companion/src/main/runtime-client.ts`
- `apps/companion/src/shared/desktop-api.ts`
- `apps/companion/src/preload/api.ts`
- `apps/companion/src/preload/preload.cts`
- `apps/companion/src/renderer/main.tsx`
- `apps/companion/src/renderer/styles.css`
- `scripts/package-desktop.mjs`
- `scripts/verify-desktop-package.mjs`
- `vitest.config.ts`

The shared worktree also contains accepted P5.1-P5.5 and unrelated user/Master
changes. They were preserved; there was no commit, reset, clean, checkout,
merge, rebase, push, or pull request.

## Review risks and boundaries

- The supported packaged binary tuple is intentionally macOS arm64 only. Other
  platforms fail closed until their exact executable and schema tuple is
  reviewed.
- Live interactive browser-login completion, device-code completion, token
  refresh, logout, and real consequential approval variants still require a
  disposable acceptance account. Their exact contracts and deterministic
  state transitions are implemented and tested; this report does not represent
  them as live account-mutation passes.
- The visual harness substitutes only the versioned logical product API fixture
  to create deterministic screenshots and execute real DOM interactions.
  Production renderer code is built and served unchanged; the actual host seam
  is covered independently by focused, live, E2E, and packaged tests.
- P5.8 and P5.9 remain outside this assignment and have not started.

## Final Master acceptance

Date: 2026-09-08

Decision: **P5.6 and P5.7 are accepted and closed. P5.8 may begin.** This is
not overall Phase 5 acceptance: P5.8 and P5.9 remain required and were not
started by this review.

### Independent acceptance findings

1. Renderer writes enter through the narrow product-intent IPC. Internal task,
   thread, turn, continuation, and arbitrary response commands reject before
   the mutable product API is resolved. Main binds follow-up, stop, attention,
   URL, and Return Control operations to the active task and exact pending
   state; history selection remains read-only.
2. Renderer snapshots are explicit projections. Browser-runtime diagnostics,
   profile/workspace paths, task policy, App Server session IDs, device
   secrets, login URLs, and unprojected attention payloads do not cross the
   preload boundary.
3. Cold Desktop startup restores listeners and durable state, then shares one
   truth-recovery operation with overlapping Runtime/App Server recovery. The
   file-backed startup test proves one fresh inspection, one continuation
   dispatch, inert historical replay, and listener cleanup.
4. The form compatibility table now covers every representable generated
   Codex 0.153.4 elicitation variant. Required-field shape, `$schema`, titled
   multi-select, exact option values/labels, defaults, bounds, formats, and
   Unicode code-point length are preserved. Malformed or unsupported schemas
   remain visible but cannot submit or call the response port.
5. The five product artifacts visibly confirm one coherent chip, expanded,
   and full surface; explicit-response copy is consistent, active attention
   survives historical viewing, and browser controls remain attached to the
   live task.
6. The current macOS arm64 package was rebuilt from the accepted source and
   passed the native Runtime/MCP/Codex/Desktop smoke. A mismatched executable
   was rejected before staging mutation, and the retained staged executable
   still matched the reviewed digest.

### Independent Master evidence

| Check                                          | Result                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer/form/privacy probes                   | Passed; renderer boundary and host binding, session projection, continuation replay, complete valid-form matrix, and malformed-required rejection |
| Pinned App Server schema comparison            | Passed for Codex `0.153.4`; executable, generated-schema, and runtime-validator digests matched                                                   |
| P5.0 deterministic oracle                      | 75/75 passed                                                                                                                                      |
| Focused P5.6/P5.7 production set               | 14 files, 93/93 passed                                                                                                                            |
| Full repository suite                          | 139 files, 864/864 passed with one worker and no file parallelism                                                                                 |
| External MCP process E2E within the full suite | 2/2 passed through real stdio and authenticated Streamable HTTP                                                                                   |
| Typecheck, lint, and production build          | Passed                                                                                                                                            |
| Targeted Prettier and `git diff --check`       | Passed                                                                                                                                            |
| Current Desktop package rebuild                | Passed for darwin/arm64                                                                                                                           |
| Current packaged native smoke                  | Passed for Runtime, MCP, pinned Codex, and Desktop startup                                                                                        |
| Wrong-executable negative check                | Rejected as expected; staged Codex digest remained `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`                             |

Interactive browser-login completion, device-code completion, token refresh,
logout, and real consequential approval exercises remain intentionally deferred
to the disposable-account live-acceptance gate in P5.9. They do not reopen the
accepted deterministic P5.6/P5.7 implementation, but they remain mandatory
before overall Phase 5 release acceptance.
