# ROVE-STAB-09 — Attention-family reachability and live fixtures

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready for characterization  
**Dependencies:** STAB-01; product-policy fixes may depend on STAB-07/08  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

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
