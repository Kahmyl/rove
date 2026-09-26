# ROVE-STAB-05 — Startup hydration and degraded-state UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-03/04  
**Dependencies:** STAB-03, STAB-04  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

Startup hides only incoherent pre-snapshot composition. Once coherent local state exists, the conversation is readable while provider reconciliation proceeds independently and boundedly.

## Owns

MR-006 plus customer presentation of the repaired STAB-03/04 states.

## Acceptance criteria

- Neutral centered initial hydration until first coherent local snapshot.
- No indefinite loader waiting for provider reconciliation.
- Persisted conversation appears after local hydration.
- Per-Task recovery is shown on the owning Task.
- Unrelated Tasks remain interactive.
- Degraded Runtime/provider state is bounded and customer-safe.
- No flash of contradictory Worked/Checking/composer states during first hydration.

## Verification

Renderer state tests → Electron cold start → persisted restart with healthy provider → persisted restart with unavailable/invalid Runtime.

Checkpoint before downstream market acceptance.
