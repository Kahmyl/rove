# ROVE-STAB-01 — Issue registry and reproduction baseline

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete  
**Dependencies:** None  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Actual entry state

STAB-01 began from product baseline `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d` and the 26 September 2026 development-app acceptance report. It was a planning/evidence ticket: production source was intentionally unchanged.

The durable STAB-01 output was merged through PR #35 at `0ed941ce1b2f4fd734d2f56aeb136813cbee41d6`. That merge, the issue registry, acceptance baseline, and implementation-status correction are the continuation state inherited by STAB-02.


## Objective

Convert the 26 September acceptance report, prior hard-Stop evidence, current repository source, and bounded upstream provider research into one non-duplicated issue map before production remediation begins.

## Completed work

- Established the eight root problem families used by the sprint.
- Created stable finding IDs MR-001 through MR-029.
- Mapped every confirmed defect and live qualification gap to one primary ticket.
- Recorded cross-stage consolidations so the same authority/state problem is not fixed repeatedly.
- Preserved passing behavior and explicit non-issues.
- Performed read-only source inspection of recovery, Runtime polling, customer execution projection, approval configuration/decision projection, attention classification, task-scoped MCP, unmatched Runtime presentation, browser foreground coordination, and Stop provider state.
- Rechecked upstream Codex hard-Stop status on 26 September 2026.
- Ran the remote repository qualification. Repository checks, typecheck and build passed, while two docs-only verify attempts failed in different pre-existing process-backed tests; recorded this as MR-029 instead of treating a flaky signal as product evidence.
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
- [x] Remote verification was actually exercised and its nondeterministic process-backed failures are captured as a stabilization finding rather than ignored.
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
