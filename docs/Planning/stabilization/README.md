# Market-Readiness Stabilization Tickets

This directory contains the tickets and evidence ledger for the single [Rove Market-Readiness Stabilization Sprint](../market-readiness-stabilization-sprint.md).

## Working rules

- Ticket IDs are stable.
- The issue registry owns symptom deduplication and cross-stage classification.
- A ticket owns an invariant, not merely one screenshot or acceptance step.
- Product source changes begin only after the ticket's read-only diagnosis is current.
- Each implementation ticket receives its own focused and affected-subsystem verification before the next dependent ticket.
- The final market qualification is sprint-wide and does not replace ticket-level verification.
- Generated screenshots/traces may remain ignored artifacts; durable findings, hashes, commands, contract decisions, and qualification results belong in the ticket or evidence ledger.
- Hard provider blockers are never marked complete from synthetic presentation evidence.

## Current status

ROVE-STAB-01 is complete as a planning/evidence ticket. It establishes the canonical issue map, source-boundary observations, preserved passes/non-issues, reproduction requirements, and ownership of unresolved questions. No production source was changed by STAB-01.

The next production ticket is ROVE-STAB-02 unless new evidence changes the dependency graph.
