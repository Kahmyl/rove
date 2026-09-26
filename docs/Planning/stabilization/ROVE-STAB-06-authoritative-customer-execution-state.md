# ROVE-STAB-06 — Authoritative customer execution-state model

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready after authority/recovery facts  
**Dependencies:** STAB-02/03 facts established  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume the authority/recovery conclusions already established by STAB-02 and STAB-03 before changing customer execution projection. In particular, terminality must be derived from the authoritative turn/recovery model that exists after those tickets, not from the original pre-stabilization projection.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


## Invariant

A work segment is terminal only when its owning work is authoritatively terminal. Waiting for customer, approval submission, checking, human browser ownership and return-checking are nonterminal states even though active execution duration is frozen.

## Owns

MR-009 and MR-024 and the execution-state portion of MR-010.

## Source diagnosis already established

The current projection makes segment status `terminal` whenever no open customer-active interval exists. That conflates "not currently accruing active work time" with "terminal".

## Required model

Represent at least the semantic distinction among active, waiting_for_customer, checking, human_control and terminal. Names may differ, but terminality cannot be inferred from a closed duration interval.

## Acceptance criteria

- A visible command/tool result cannot make work look completed while the owning turn is still active/waiting/checking.
- Waiting/checking/human control freeze duration without terminal compaction.
- Authoritative terminal transition compacts work once.
- Subsequent new work creates/resumes the correct segment without rewriting prior terminal history.

## Verification

Pure projection transition table → command-approval live E2E → browser handoff/checking fixture → rendered duration/compaction journey.

Checkpoint before STAB-10.

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
