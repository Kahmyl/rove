# ROVE-STAB-06 — Authoritative customer execution-state model

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready after authority/recovery facts  
**Dependencies:** STAB-02/03 facts established  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

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
