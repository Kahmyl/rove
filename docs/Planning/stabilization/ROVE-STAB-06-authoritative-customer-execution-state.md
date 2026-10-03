# ROVE-STAB-06 — Authoritative customer execution-state model

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete

**Dependencies:** STAB-02/03 facts established  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume the authority/recovery conclusions already established by STAB-02 and STAB-03 before changing customer execution projection. In particular, terminality must be derived from the authoritative turn/recovery model that exists after those tickets, not from the original pre-stabilization projection.

The STAB-03 disposable preserved fixture adds one exact entry case: a Task has a durably succeeded `interrupt_codex_turn` outbox command but still persists `requestedOperation.type === "interrupt"`, so it projects Stopping independently of its exhausted Codex blocker. Diagnose that persisted Stop settlement under MR-009/MR-024; do not weaken or clear the exact recovery blocker to hide it.

STAB-05 establishes that pre-snapshot startup alone owns the neutral hydration surface. Once local Product truth exists, the owning Task's execution presentation must render immediately, unrelated Tasks must remain interactive, and an independent Runtime warning must not alter Task terminality. Preserve that separation while changing the execution-state projection.

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

## Completion evidence

Implementation checkpoint: `fac74fb1facd1e5f29ae20afdea03c48fc570dfa` (`Project authoritative customer execution state`).

The customer projection now carries explicit active, waiting-for-customer, checking, human-control, stopping and terminal segment states. Only active work accrues duration; every nonterminal state remains expanded with exact customer copy while its duration is frozen. Authoritative Codex turn state no longer depends on a timing interval being open.

New Stop commands carry the exact requested operation ID so normal command settlement can clear the matching intent. Persisted compatibility also repairs the bounded legacy case where the same Task has an exact interrupt request followed by a succeeded interrupt command. It does not clear the independent recovery blocker or infer Codex truth from the command.

The pure projection and rendered transition tables pass. Credential-free process-backed production-composition traces prove approval waiting and human browser control remain nonterminal, and the complete six-trace suite passes. A disposable copy of the preserved STAB-03 database proves the stale Stop changes from `interrupt` to `observe`, leaving its independently authoritative exhausted-recovery state as `unresolved`; the preserved source database remains byte-identical with SHA-256 `a6e215e557d4ae30d07b38e188652eed39ee8f4538bf3937cb04d6498f2badf6`.

Repository checks, lint, typecheck, build, experiment tests and the complete 202-file / 1,724-test suite pass. One process cut-point case transiently reached terminal state before requesting handoff on the first full run; the exact case passed on rerun and all 22 cut-point cases passed in the clean full-suite rerun. No live model, credentialed provider, packaged application or human acceptance was run.

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
