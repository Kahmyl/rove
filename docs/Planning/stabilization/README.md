# Market-Readiness Stabilization Tickets

This directory contains the tickets and evidence ledger for the single [Rove Market-Readiness Stabilization Sprint](../market-readiness-stabilization-sprint.md).

The canonical ticket-to-ticket handoff state is [continuity-ledger.md](continuity-ledger.md). A new Codex execution must consume that ledger and the current ticket's continuity entry contract before implementation.

## Working rules

- Ticket IDs are stable.
- Ticket boundaries are continuity checkpoints, not fresh investigations. Previous exit state must be reconciled with live repository/runtime truth before the next ticket edits code.
- A ticket cannot be marked complete until its exit/handoff state is durable in the continuity ledger and affected downstream entry contracts.
- The issue registry owns symptom deduplication and cross-stage classification.
- A ticket owns an invariant, not merely one screenshot or acceptance step.
- Product source changes begin only after the ticket's read-only diagnosis is current.
- Each implementation ticket receives its own focused and affected-subsystem verification before the next dependent ticket.
- The final market qualification is sprint-wide and does not replace ticket-level verification.
- Generated screenshots/traces may remain ignored artifacts; durable findings, hashes, commands, contract decisions, and qualification results belong in the ticket or evidence ledger.
- Hard provider blockers are never marked complete from synthetic presentation evidence.

## Current status

ROVE-STAB-01 is complete as a planning/evidence ticket. ROVE-STAB-02 established exact Task/Runtime/Codex authority convergence. ROVE-STAB-03 has verified the exact recovery-blocker lifecycle, durable stale-observation ordering, persisted compatibility, and bounded unresolved customer state; its final checkpoint is recorded in the continuity ledger.

The next production ticket is ROVE-STAB-04 unless new evidence changes the dependency graph. It must consume the STAB-02 Runtime transport-identity handoff and STAB-03 bounded recovery/presentation handoff, run `pnpm codex:context`, and record its exact stacked start SHA before production edits.
