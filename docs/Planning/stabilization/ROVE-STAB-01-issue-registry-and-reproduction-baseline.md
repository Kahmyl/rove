# ROVE-STAB-01 — Issue registry and reproduction baseline

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete  
**Dependencies:** None  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Objective

Convert the 26 September acceptance report, prior hard-Stop evidence, current repository source, and bounded upstream provider research into one non-duplicated issue map before production remediation begins.

## Completed work

- Established the eight root problem families used by the sprint.
- Created stable finding IDs MR-001 through MR-028.
- Mapped every confirmed defect and live qualification gap to one primary ticket.
- Recorded cross-stage consolidations so the same authority/state problem is not fixed repeatedly.
- Preserved passing behavior and explicit non-issues.
- Performed read-only source inspection of recovery, Runtime polling, customer execution projection, approval configuration/decision projection, attention classification, task-scoped MCP, unmatched Runtime presentation, browser foreground coordination, and Stop provider state.
- Rechecked upstream Codex hard-Stop status on 26 September 2026.
- Recorded reproduction preservation requirements and unresolved questions without modifying product source.

Canonical outputs:

- [issue-registry.md](issue-registry.md)
- [acceptance-baseline-2026-09-26.md](acceptance-baseline-2026-09-26.md)
- [../market-readiness-stabilization-sprint.md](../market-readiness-stabilization-sprint.md)

## Acceptance criteria

- [x] Every acceptance defect/gap has a stable ID.
- [x] Repeated symptoms across stages are consolidated under a root family.
- [x] Confirmed defects are distinguished from qualification gaps and explicit non-issues.
- [x] Each finding has one primary owning ticket.
- [x] Source review identifies concrete boundaries without claiming unproven root causes.
- [x] Persistent restart state is explicitly protected as a reproduction fixture.
- [x] Hard Stop is isolated as a provider/architecture blocker rather than folded into ordinary UI remediation.
- [x] Current upstream hard-Stop evidence is dated and bounded.
- [x] Implementation Status is corrected so source qualification no longer overstates live acceptance.
- [x] No production source changes are included.

## Verification

1. every MR ID appears exactly once as a canonical registry row;
2. every MR ID maps to an existing stabilization ticket;
3. every ticket referenced by the sprint exists in the repository;
4. the Planning index points to the sprint;
5. the Implementation Status correction points to the same sprint/evidence baseline;
6. repository checks/Markdown checks pass on the planning PR.

## Completion note

STAB-01 proves the **planning/evidence baseline**, not product correctness. Its completion authorizes diagnosis of STAB-02; it does not authorize bulk implementation of the remaining tickets.
