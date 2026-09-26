# ROVE-STAB-03 — Recovery lifecycle and bounded reconciliation

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-02  
**Dependencies:** STAB-01, STAB-02  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Do not start from the original recovery hypothesis. Consume the completed STAB-02 handoff first: its proven Task/Runtime/Codex identity invariant, root cause(s), disproved hypotheses, persistence implications, exact verification evidence, and any new MR findings.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA. Recovery logic must be evaluated against the authority model actually established by STAB-02, not the model assumed when this ticket was first written.


## Invariant

A recovery blocker is created and cleared by exact matching authority. Recovery attempts are bounded. Exhausted recovery becomes a truthful bounded customer state; it does not remain Checking forever and does not freeze unrelated Tasks.

## Owns

MR-001 and MR-002 after authority convergence is correct.

## Acceptance criteria

- Successful exact history/runtime evidence clears only its matching blocker.
- Newer exact success cannot remain shadowed by stale historical failure.
- Retry budget and terminal unresolved state are explicit.
- Safe local conversation remains readable.
- Safe controls remain available when product authority permits them.
- One unresolved Task does not disable unrelated Task interaction.
- Retain actionable diagnostic category/detail without exposing mechanism text to customers.

The preserved persistent acceptance home must restart into either resolved Tasks or bounded inability-to-confirm states.

## Verification

Reconciler/TaskEngine focused tests → process-cut/restart tests → preserved SQLite home → multi-Task recovery Electron run.

Checkpoint before STAB-05.

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
