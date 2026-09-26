# ROVE-STAB-03 — Recovery lifecycle and bounded reconciliation

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-02  
**Dependencies:** STAB-01, STAB-02  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

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
