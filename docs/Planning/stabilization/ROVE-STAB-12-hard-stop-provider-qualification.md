# ROVE-STAB-12 — Hard Stop provider qualification / execution ownership decision

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Externally blocked; research continues  
**Dependencies:** STAB-01  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

Rove may say local work is Stopped only when it has evidence that the exact owned local operation can no longer continue normal execution.

## Owns

MR-026.

## Current provider evidence — 26 September 2026

- Pinned Rove baseline remains Codex App Server `0.154.0-alpha.6.2`.
- Prior Rove live probe: `turn/interrupt` succeeded and the turn became interrupted, but the long local command still reached natural completion.
- openai/codex issue #42717 remains open.
- Current upstream `ProcessEntry` still has no owning-turn identity.
- Newer prereleases exist, including `0.159.0-alpha.6`, but Rove has not qualified any candidate as proving exact process termination.
- Rove does not use `pkill`, process-name killing, guessed OS PIDs, or UI-only settlement.

## Work

For each promising provider candidate, run the exact process-backed Stop characterization before adopting it. If a supported exact termination/exit proof becomes available, complete the preserved Stop operation identity/restart work and qualify the full Stop journey.

If upstream intentionally retains background processes and exposes no suitable exact cancellation proof, stop implementation and produce an architecture/product ADR for either Rove-owned exact execution cancellation or explicitly weaker customer semantics.

## Acceptance criteria

Hard Stop can pass only when:

1. exact Task/turn/local operation is known;
2. Stop is requested once;
3. exact local operation is proven terminated/quiescent;
4. late output cannot continue normal work;
5. Stop operation settles;
6. customer state becomes Stopped;
7. queue is retained;
8. ordinary follow-up starts new work.

Synthetic renderer Stop cannot satisfy this ticket.
