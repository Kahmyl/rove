# ROVE-STAB-04 — Runtime failure containment and observability

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete
**Dependencies:** STAB-01  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume STAB-01's Runtime-failure findings and any STAB-02 observations that change Runtime ownership/addressing. In particular, retain the distinction between the observed `INVALID_CONFIGURATION` responses and later transport failures; do not infer their common cause without Runtime-side evidence.

Also consume STAB-03's distinction between active checking and exhausted bounded uncertainty. Runtime containment must feed that existing customer-safe model rather than creating another recovery state, and must not disturb the STAB-02 monotonic Runtime inventory transport coordinate.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.

### Actual entry state

- exact stacked start SHA: `a76cce8c9b7d703a62d43dc938193b74f6ff02b4`, the final pushed STAB-03 head;
- branch: `codex/stab04-runtime-failure-containment`;
- worktree clean at entry;
- STAB-03 implementation/handoff is pushed, while PR creation remains unavailable to the authenticated non-collaborator identity; no PR was created or merged;
- diagnosis begins from retained Runtime-side evidence and current call sites. No live model, credentialed service, or original acceptance home will be used.

### Diagnosis and implementation

- The retained `INVALID_CONFIGURATION` was exact: `browser-workspaces.json` stored a managed workspace through macOS `/tmp`, while the restarted Runtime derived the same directory through `/private/tmp`. Lexical equality failed although `realpath` and device/inode identity matched. The registry now compares existing canonical paths, still rejects missing paths and symlink escapes, and returns the Runtime-owned lexical managed path.
- Unconfigured session discovery issued three concurrent mode-filtered reads. Snapshot refresh then coupled Runtime snapshot, workspace and local Product reads in one rejecting `Promise.all`; 750 ms surface and Runtime-inventory monitors continued through permanent failure. The execution-core failure callback could itself reject from inside a background interval, and three fire-and-forget Workflow refresh chains lacked terminal rejection handling.
- `CompanionRuntimeClient` now exposes structured dependency health, uses one session-list read, classifies stable GET configuration/authentication failure separately from transient transport/server failure, admits only one probe after a 30-second permanent delay, and exponentially backs transient probes from 750 ms to a 30-second cap. The first diagnostic is retained within each same-class failure episode.
- Desktop refresh preserves the last Runtime-owned snapshot portions while independently publishing local Product truth. One customer-safe warning is projected without low-level mechanism text and disappears after a healthy probe. Runtime inventory and surface monitors skip closed-circuit ticks; monitor, callback and Workflow publication failures are contained.

No task, artifact, credential, provider wire format, database schema or migration changed.

**Implementation checkpoint:** `078a674cc1d51b479f21e00ba3655b83107abdbd` (`Contain Runtime dependency failures`).

### Verification evidence

- Required regressions failed first for canonical alias acceptance, single session discovery, permanent configuration containment and transient backoff.
- Focused fault-injection and affected subsystem suite: 9 files / 49 tests passed, including real browser restart and Runtime HTTP integration.
- Full-suite review found one inherited pre-STAB-03 assertion that still expected active Checking after its bounded legacy-attention recovery had exhausted. The regression now asserts the established unresolved / `Task state unclear` contract without changing production behavior.
- Repository exit gate passed: `pnpm check:repository`; `pnpm typecheck`; `pnpm build`; full `pnpm test` (201 files / 1,719 tests); and `pnpm test:experiments` (24 tests).
- `pnpm typecheck` and `pnpm build` passed.
- Disposable managed-process fixture `/private/tmp/rove-stab04-process.9fBJvP` used a real Runtime with invalid catalog copy SHA-256 `97f063da8cabce602f3115c4e1ee16f3eb5c0f532f37d4b07997c71485f0741d`: 240 calls after permanent failure produced one HTTP request; 120 calls after process loss produced one transport probe; restart reopened the same client to `ready`; process-level unhandled rejection count was zero.
- The original acceptance home `/private/tmp/rove-stage2.NZ9umP` and preserved baseline were not mutated. No live model, credentialed provider, packaged app or human acceptance was run.

## Invariant

Runtime dependency failure is classified, bounded and contained. Permanent configuration failures are not polled as transient outages; transient failures use bounded retry/backoff; no Runtime polling path can create an unhandled-rejection storm.

## Owns

MR-004 and MR-005.

## Diagnosis requirements

Identify the exact field/condition that produced `INVALID_CONFIGURATION` from retained Runtime-side evidence. Do not infer it from the client status code.

Audit all `CompanionRuntimeClient` call sites, including snapshot refresh, workspace refresh, surface monitoring, workflow-triggered refresh, IPC handlers and startup sequencing.

## Acceptance criteria

- Permanent 4xx/configuration error enters a stable degraded state and stops aggressive polling.
- Retryable transport failure uses bounded backoff and recovery.
- First actionable diagnostic is retained safely.
- Repeated failures do not produce process-level unhandled rejections.
- A healthy Runtime transition reopens polling/refresh cleanly.
- Customer UI receives one bounded state rather than a stream of low-level errors.

## Verification

Runtime-client fault injection → desktop snapshot/surface monitor tests → process-backed managed Runtime invalid-config/unavailable runs → rejection-count assertion.

Checkpoint independently of STAB-03.

## Continuity exit / handoff contract

This ticket is **not complete** merely because its implementation and tests pass. Before changing its status to Complete, make the resulting engineering state durable for the next ticket.

Update [continuity-ledger.md](continuity-ledger.md) with:

- exact ticket start SHA and final ticket commit/PR/merge SHA;
- MR findings closed, narrowed, superseded, or newly discovered;
- confirmed root cause(s) and important hypotheses disproved;
- invariant actually established by the implementation;
- exact production/schema/persistence/contract files changed;
- migration, compatibility, provider-version, or fixture consequences;
- focused verification and affected-subsystem verification with exact commands/results;
- real-boundary/E2E evidence, including paths/hashes where material;
- failures, flakiness, and anything not qualified;
- preserved reproduction state and whether it remains valid;
- residual blockers/open questions;
- direct downstream tickets whose assumptions or entry contracts changed;
- the exact next stop point and next verification gate.

Then update every directly dependent ticket's **Continuity entry contract** when the new evidence changes what that ticket must inherit. The next ticket must be able to continue from repository-owned state without reconstructing this investigation from chat history.
