# ROVE-STAB-08 — Approval decision fidelity and UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-07  
**Dependencies:** STAB-07  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Do not design approval buttons independently. Consume the completed STAB-07 approval-policy contract and the customer execution-state semantics from STAB-06. The exact provider decisions that STAB-07 establishes are the only decisions this ticket may render.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


## Invariant

Rove preserves the provider's exact available approval decisions and translates them into truthful customer choices without inventing unsupported scope.

## Owns

MR-007 and the decision/UX portion of MR-008.

## Required correction

The pinned schema can express richer command decisions such as one-time accept, session accept and policy amendments. The Rove projection currently reduces approval decisions to a smaller generic vocabulary and commonly labels acceptance **Approve**.

Model exact supported decisions first; render them second.

## Acceptance criteria

- Explicit refusal exists whenever provider authority supports refusal.
- One-time approval is clearly labeled.
- Session/policy scope is presented only when the exact provider decision exists.
- Persistent policy amendment describes what will persist before acceptance.
- Submitting/checking disables duplicate decisions and settles exactly once.
- Decline/deny cannot execute through another capability.
- No final-looking Task terminal state appears until STAB-06 terminal authority is satisfied.

## Verification

Schema/adapter round-trip → collaboration projection → renderer → live command approval accept/decline/session/policy scenarios as supported.

Checkpoint before STAB-09 completion.

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
