# ROVE-STAB-02 — Task / Runtime / Codex authority convergence

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready  
**Dependencies:** STAB-01  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

For every open Task, Rove can prove the exact Codex thread and Runtime session/browser authority it owns, or prove that no such resource exists. Live work, restart, history reconstruction, browser launch and handoff cannot silently change that binding.

## Owns

MR-001, MR-003, MR-020, MR-022 and the authority portion of MR-023.

## Read-only diagnosis first

- Reproduce persisted Checking State from the preserved home.
- Trace Task record identity, bootstrap ID, Codex thread/session, Runtime inventory receipt, task capability scope, browser attachment and handoff generation.
- Verify the concrete unbound `getControlStatus` callback failure and audit similar method-reference boundaries.
- Explain why a successful task-scoped MCP browser run can cease to be resolvable through the Task projection before changing code.

## Acceptance criteria

- Exact Task ↔ Runtime session ↔ Codex thread binding survives browser use and restart.
- Historical reconstruction cannot call Runtime with lost object binding.
- One Runtime session cannot be adopted by the wrong Task from UI selection/current-session heuristics.
- A Companion browser that successfully ran cannot project **No browser attached** unless authoritative detach/termination evidence exists.
- Requested Agent handoff material binds to the same Task/session/generation later used for takeover.
- Stale/cross-Task authority fails closed without corrupting another Task.

## Verification

Focused identity/reconciler tests → task-runtime control-authority tests → SQLite restart → real Runtime browser session in Agent and Companion → original authority-loss E2E.

Checkpoint before STAB-03.
