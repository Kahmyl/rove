# ROVE-STAB-12 — Hard Stop provider qualification / execution ownership decision

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Externally blocked; research continues  
**Dependencies:** STAB-01  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Carry forward the exact Stop blocker evidence from STAB-01 and the separately preserved Stop investigation branch/evidence. Do not interpret unrelated TaskEngine progress as resolution of process termination authority.

At every provider requalification, record provider version/hash, exact process-backed reproduction, termination receipt/evidence, and whether the result changes the architectural decision. Reconcile current `main` with the continuity ledger before integrating any Stop work.


## Invariant

Rove may say local work is Stopped only when it has evidence that the exact owned local operation can no longer continue normal execution.

## Owns

MR-026.

## Current provider evidence — 26 September 2026

- Pinned Rove baseline remains Codex App Server `0.154.0-alpha.6.2`.
- Prior Rove live probe: `turn/interrupt` succeeded and the turn became interrupted, but the long local command still reached natural completion.
- openai/codex issue #42717 remains open.
- Current upstream `ProcessEntry` still has no owning-turn identity.
- Newer prereleases exist, including `0.159.0-alpha.6`, but Rove has not qualified any candidate as proving exact process termination.
- Rove does not use `pkill`, process-name killing, guessed OS PIDs, or UI-only settlement.

## Work

For each promising provider candidate, run the exact process-backed Stop characterization before adopting it. If a supported exact termination/exit proof becomes available, complete the preserved Stop operation identity/restart work and qualify the full Stop journey.

If upstream intentionally retains background processes and exposes no suitable exact cancellation proof, stop implementation and produce an architecture/product ADR for either Rove-owned exact execution cancellation or explicitly weaker customer semantics.

## Acceptance criteria

Hard Stop can pass only when:

1. exact Task/turn/local operation is known;
2. Stop is requested once;
3. exact local operation is proven terminated/quiescent;
4. late output cannot continue normal work;
5. Stop operation settles;
6. customer state becomes Stopped;
7. queue is retained;
8. ordinary follow-up starts new work.

Synthetic renderer Stop cannot satisfy this ticket.

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
