# ROVE-STAB-14 — Market release qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Final gate  
**Dependencies:** All nonblocked tickets; explicit disposition for STAB-12  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Objective

Qualify the repaired system as a market candidate, not merely a development build with passing unit tests.

## Required evidence

- repository checks, typecheck, lint, build and full deterministic suite;
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
