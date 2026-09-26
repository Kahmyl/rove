# ROVE-STAB-08 — Approval decision fidelity and UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-07  
**Dependencies:** STAB-07  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

Rove preserves the provider's exact available approval decisions and translates them into truthful customer choices without inventing unsupported scope.

## Owns

MR-007 and the decision/UX portion of MR-008.

## Required correction

The pinned schema can express richer command decisions such as one-time accept, session accept and policy amendments. The Rove projection currently reduces approval decisions to a smaller generic vocabulary and commonly labels acceptance **Approve**.

Model exact supported decisions first; render them second.

## Acceptance criteria

- Explicit refusal exists whenever provider authority supports refusal.
- One-time approval is clearly labeled.
- Session/policy scope is presented only when the exact provider decision exists.
- Persistent policy amendment describes what will persist before acceptance.
- Submitting/checking disables duplicate decisions and settles exactly once.
- Decline/deny cannot execute through another capability.
- No final-looking Task terminal state appears until STAB-06 terminal authority is satisfied.

## Verification

Schema/adapter round-trip → collaboration projection → renderer → live command approval accept/decline/session/policy scenarios as supported.

Checkpoint before STAB-09 completion.
