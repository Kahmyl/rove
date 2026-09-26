# ROVE-STAB-10 — Browser task ownership and handoff lifecycle

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on STAB-02/03/06  
**Dependencies:** STAB-02, STAB-03, STAB-06  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

One browser collaboration journey preserves one exact Task, Runtime session, page/browser attachment, handoff identity/generation and owner through session start, requested/voluntary takeover, return, fresh inspection and continuation.

## Owns

MR-020, MR-022, authority portion of MR-023 and MR-025.

## Acceptance criteria

### Agent requested handoff

`session.start → control.request_human → durable acknowledgement → control.wait` converges to one **Waiting for you** state with one Take Over action. No unmatched awaiting-human session is created.

### Companion voluntary takeover

A successfully running task-owned browser remains projected as attached with Agent ownership and exposes voluntary Take Over without synthetic handoff identity.

### Return

Human control → Return to Rove → checking → fresh exact-page inspection → resumed work/ready. No mutation admission reopens before fresh grounding.

### Shared

- main Task and follower agree;
- exact page is foregrounded;
- background Task selection cannot redirect control;
- restart/recovery preserves or truthfully invalidates the same authority.

## Verification

Runtime/control unit tests → task capability/session integration → process-backed browser E2E for Agent → Companion → return/checking → restart.

Checkpoint before STAB-11/13.
