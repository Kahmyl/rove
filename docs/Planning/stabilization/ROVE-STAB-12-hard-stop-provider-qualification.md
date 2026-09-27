# ROVE-STAB-12 — Hard Stop provider qualification / execution ownership decision

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** In progress; Rove-owned exact execution boundary authorized 27 September 2026
**Dependencies:** STAB-01  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Carry forward the exact Stop blocker evidence from STAB-01 and the separately preserved Stop investigation branch/evidence. Do not interpret unrelated TaskEngine progress as resolution of process termination authority.

At every provider requalification, record provider version/hash, exact process-backed reproduction, termination receipt/evidence, and whether the result changes the architectural decision. Reconcile current `main` with the continuity ledger before integrating any Stop work.

## Invariant

Rove may say local work is Stopped only when it has evidence that the exact owned local operation can no longer continue normal execution.

## Owns

MR-026.

## Current provider evidence — 27 September 2026

- Selected Rove component is now exact Codex App Server `0.155.0-alpha.9.2` (SHA-256 `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`); exact `0.154.0-alpha.6.2` remains a qualified rollback component.
- Prior Rove live probe: `turn/interrupt` succeeded and the turn became interrupted, but the long local command still reached natural completion.
- openai/codex issue #42717 remains open.
- Current upstream `ProcessEntry` still has no owning-turn identity.
- Exact `0.155.0-alpha.9.2` was live-qualified in default and supported `--disable unified_exec` modes. Both runs accepted `turn/interrupt`, reported the exact turn `interrupted`, retained exact command-process metadata, and still wrote the delayed completion sentinel. This disproves turn interruption as process authority.
- The separate credential-free `command/exec` qualification passes on macOS arm64 for both selected and rollback components under the named `rove_task` profile: exact termination observes exit 137, kills the delayed child tree, preserves an unrelated execution, and owner crash also prevents the child sentinel.
- Production registers the exact thread/turn/call-bound `rove_exec` dynamic tool, disables provider local-execution features, persists the immutable authority tuple and final receipt in SQLite migration `0007_add_local_execution_supervision`, and settles Stop only after exact command exit plus provider terminal truth.
- Upstream issue #42717 remains open. Current upstream protocol explicitly separates ordinary turn interruption from thread-wide background-terminal cleanup; neither supplies exact Task/turn/process termination authority to Rove.
- The unresolved product/architecture alternatives are recorded in [hard-stop-execution-decision.md](../../Engineering/hard-stop-execution-decision.md).
- Rove does not use `pkill`, process-name killing, guessed OS PIDs, or UI-only settlement.

## Work

For each promising provider candidate, run the exact process-backed Stop characterization before adopting it. Preserve selected and rollback qualification receipts, and reject component manifests whose exact execution evidence is missing or stale.

If upstream intentionally retains background processes and exposes no suitable exact cancellation proof, stop implementation and produce an architecture/product ADR for either Rove-owned exact execution cancellation or explicitly weaker customer semantics.

The required architecture decision has now authorized Rove-owned exact local execution supervision. Implement the bounded subsystem in [hard-stop-execution-decision.md](../../Engineering/hard-stop-execution-decision.md). Provider turn interruption remains one input to Stop settlement; it is not execution termination evidence.

The base-profile supervision path is implemented. The remaining architecture/security gate is not process identity: standalone `command/exec` accepts the frozen named permission profile but cannot consume the existing turn-scoped human/automatic approval decision or its exact permission amendment. Commands outside the base profile fail closed. Human authority selected a provider-owned grant boundary: Rove will not build a separate per-grant App Server delegate or derive grants heuristically. STAB-12 cannot complete until a supported provider extension satisfies the exact binding/replay/expiry contract, followed by packaged Windows/Linux process-tree qualification.

`pnpm agent:provider-grant-boundary` is the retained credential-free candidate probe. While the seam is unsupported it must prove that synthetic grant-binding fields cannot produce an elevated effect. Current providers permissively accept the unknown fields but still enforce `rove_task`; that is blocked evidence, not grant consumption. A candidate cannot close this ticket from schema shape or permissive parsing alone: update the harness for the supported provider protocol and prove human plus automatic review, exact consumption, refusal, changed-material and stale-authority rejection, replay, expiry, restart, and Stop behavior through real process-backed execution.

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
