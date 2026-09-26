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

ROVE-STAB-01 is complete as a planning/evidence ticket. It establishes the canonical issue map, source-boundary observations, preserved passes/non-issues, reproduction requirements, and ownership of unresolved questions. No production source was changed by STAB-01.

The next production ticket is ROVE-STAB-02 unless new evidence changes the dependency graph. STAB-02 must begin by consuming the STAB-01 handoff in the continuity ledger, running `pnpm codex:context`, and recording its exact current-main start SHA before production edits.
