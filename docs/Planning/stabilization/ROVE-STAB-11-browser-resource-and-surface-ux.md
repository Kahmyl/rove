# ROVE-STAB-11 — Browser resource and surface UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready after authority prerequisites  
**Dependencies:** STAB-02 where authority-related; STAB-10 for handoff state  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

Browser resource failures and surface transitions remain task/resource-scoped, guided and recoverable. Raw host/runtime errors and global warning leakage never masquerade as the state of whichever Task is currently selected.

## Owns

MR-017, MR-018, MR-019, MR-021 and presentation portion of MR-023.

## Work

- Replace raw PROFILE_NOT_FOUND with guided profile recovery.
- Decide/document recovery for an existing Task whose frozen launch configuration lacks a later-created profile.
- Scope unmatched-session cleanup to the owning Task/resource, or render it explicitly as global resource recovery without attaching it to selected conversation content.
- Reconcile intended browser-foreground behavior with the full Rove surface.
- Do not render Open Browser when exact live authority is unavailable; render bounded recovery instead.

## Acceptance criteria

No raw IPC/runtime exception text is required for ordinary recovery. New Task and unrelated Tasks never inherit another resource's cleanup warning. Browser foregrounding preserves a coherent Rove/follower experience.

## Verification

Focused profile/unmatched-session/surface tests → multi-Task Electron selection → native browser foreground journey.

Checkpoint before STAB-13.
