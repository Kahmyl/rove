# ROVE-STAB-10 — Browser task ownership and handoff lifecycle

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete

**Dependencies:** STAB-02, STAB-03, STAB-06  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This ticket consumes the exact Task/Runtime/Codex authority model from STAB-02, bounded recovery semantics from STAB-03, and nonterminal/terminal customer execution semantics from STAB-06. Those are dependencies, not background reading.

STAB-06 establishes that approval waiting, checking and human control remain nonterminal expanded work with frozen duration, while historical segments alone compact after authoritative terminality. Its process-backed approval and handoff traces are the minimum entry baseline. Preserve the exact operation-bound Stop settlement and do not reinterpret the independently unresolved preserved Task as active or stopping.

Do not add browser-specific compensating state that bypasses those established contracts. At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.

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
