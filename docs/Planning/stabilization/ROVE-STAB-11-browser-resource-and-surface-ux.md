# ROVE-STAB-11 — Browser resource and surface UX

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready after authority prerequisites  
**Dependencies:** STAB-02 where authority-related; STAB-10 for handoff state  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume the browser authority/handoff result from STAB-10 and the exact authority foundations from STAB-02. Resource/profile/surface UX may only present states those tickets can prove; it must not manufacture attachment or control authority.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


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
