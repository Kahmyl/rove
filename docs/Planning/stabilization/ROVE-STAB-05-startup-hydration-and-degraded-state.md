# ROVE-STAB-05 — Startup hydration and degraded-state UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-03/04  
**Dependencies:** STAB-03, STAB-04  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This ticket may begin only after the STAB-03 recovery state machine and STAB-04 Runtime degraded-state contract are durable and merged. Consume both exit handoffs, including their exact customer-safe states, retry/terminal semantics, diagnostic boundaries, and verification fixtures.

The startup UI must render those proven states. It must not invent a third recovery model or conceal an unresolved provider state behind a loader.

STAB-03 specifically establishes `checking` only while a bounded attempt is active and `Task state unclear` after the attempt limit is exhausted. Persisted blocker authority is reconstructed independently of obsolete reason strings. Hydration must preserve that distinction and keep conversation history readable.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


## Invariant

Startup hides only incoherent pre-snapshot composition. Once coherent local state exists, the conversation is readable while provider reconciliation proceeds independently and boundedly.

## Owns

MR-006 plus customer presentation of the repaired STAB-03/04 states.

## Acceptance criteria

- Neutral centered initial hydration until first coherent local snapshot.
- No indefinite loader waiting for provider reconciliation.
- Persisted conversation appears after local hydration.
- Per-Task recovery is shown on the owning Task.
- Unrelated Tasks remain interactive.
- Degraded Runtime/provider state is bounded and customer-safe.
- No flash of contradictory Worked/Checking/composer states during first hydration.

## Verification

Renderer state tests → Electron cold start → persisted restart with healthy provider → persisted restart with unavailable/invalid Runtime.

Checkpoint before downstream market acceptance.

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
