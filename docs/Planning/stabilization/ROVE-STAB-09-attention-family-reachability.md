# ROVE-STAB-09 — Attention-family reachability and live fixtures

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready for characterization  
**Dependencies:** STAB-01; product-policy fixes may depend on STAB-07/08  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume STAB-07/STAB-08 decisions without reopening them. Permission modes share `on-request` and `rove_task`, with reviewer `user` versus `auto_review`. Once an approval request is emitted, Rove preserves its exact advertised one-time, session, refusal/cancel and policy-amendment decisions; requests without an advertised richer set do not invent broader scope. Provider characterization must prove actual family emission and the emitted decision set, not merely replay the deterministic renderer fixture. Preserve STAB-01's distinction between a product defect and an unqualified request family.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA.


## Invariant

Every supported attention family has a deliberate non-sensitive live trigger at the actual App Server/MCP boundary. Unsupported provider behavior is documented as such instead of being "passed" by deterministic renderer fixtures.

## Owns

MR-010, MR-012, MR-013, MR-014, MR-015 and MR-027.

## Work

Characterize and create safe triggers for conversational user input, command approval, file-change approval, network approval, additional-permission approval, MCP structured form, and MCP trusted URL.

The live MCP fixture must be extended to emit both elicitation variants through the real protocol path.

## Acceptance criteria

For every supported family:

- exact Task/thread/turn/request/generation binding;
- expected product surface appears;
- accept plus refusal/cancel where supported;
- disabled/submitting/checking state is unambiguous;
- exact-once settlement;
- no cross-Task selection theft;
- no secret echo into transcript/history;
- safe keyboard/narrow-layout path exists.

If the pinned provider cannot emit a family, record the exact version/schema/runtime evidence and either qualify a candidate provider or document the compatibility gap.

## Verification

Provider characterization harness → live App Server/MCP fixture → LocalProductApi/attention broker integration → Electron attention journey.

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
