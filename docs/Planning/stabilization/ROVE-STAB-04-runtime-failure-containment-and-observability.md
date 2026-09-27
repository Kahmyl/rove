# ROVE-STAB-04 — Runtime failure containment and observability

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready  
**Dependencies:** STAB-01  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume STAB-01's Runtime-failure findings and any STAB-02 observations that change Runtime ownership/addressing. In particular, retain the distinction between the observed `INVALID_CONFIGURATION` responses and later transport failures; do not infer their common cause without Runtime-side evidence.

Also consume STAB-03's distinction between active checking and exhausted bounded uncertainty. Runtime containment must feed that existing customer-safe model rather than creating another recovery state, and must not disturb the STAB-02 monotonic Runtime inventory transport coordinate.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


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
