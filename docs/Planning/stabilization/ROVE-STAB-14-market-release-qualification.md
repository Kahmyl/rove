# ROVE-STAB-14 — Market release qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Final gate  
**Dependencies:** All nonblocked tickets; explicit disposition for STAB-12  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This is the accumulated sprint gate. Consume every completed ticket's exit handoff, every open/new MR finding, every accepted provider limitation, the current packaged/runtime dependency baselines, and MR-029 qualification-CI nondeterminism.

Do not infer release readiness from the original sprint plan. The release matrix must be generated from the continuity ledger as it exists when STAB-14 starts.


## Objective

Qualify the repaired system as a market candidate, not merely a development build with passing unit tests.

## Required evidence

- repository checks, typecheck, lint, build and a repeatable full deterministic suite;
- qualification-CI determinism: process-backed tests used as release gates must stop failing different cases on unchanged/docs-only code; known nondeterminism is either fixed or explicitly removed from the blocking gate with a bounded replacement test;
- TaskEngine process-cut/restart and production traces;
- managed Runtime recovery/chaos matrix;
- real App Server attention family characterization;
- real managed browser Agent/Companion takeover and return;
- persistent SQLite restart/upgrade with representative existing state;
- packaged application critical-path qualification;
- responsive/accessibility Electron journey;
- final human walkthrough;
- release ledger of every remaining provider/platform qualification boundary.

## Release gate

No open P0/P1 correctness or authorization defect may be hidden by copy, retries or disabled controls. Any unresolved external blocker must have an explicit product/architecture disposition and must not be represented to customers as a capability Rove cannot prove.

## Sprint completion

When this ticket passes, update Implementation Status from evidence, mark the stabilization sprint complete, and retire obsolete planning instructions through normal Git history.

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
