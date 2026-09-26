# ROVE-STAB-07 — Approval policy contract

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready  
**Dependencies:** STAB-01; provider characterization from STAB-09 may inform  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

The customer-facing approval policy name describes the actual authorization behavior enforced by Rove and the provider.

## Owns

The policy-contract portion of MR-008 and MR-011.

## Required decision

Establish an ADR-level mapping for **Always ask** and **Approve for me**.

The current frozen Task policy uses provider `approvalPolicy: "on-request"` while separately choosing `approvalsReviewer`. That must be proven compatible with the customer promise or changed.

Do not solve MR-011 by forcing a React card when the provider/security policy still allows the mutation.

## Acceptance criteria

- Exact product meaning of both labels is documented.
- Exact provider configuration and reviewer semantics are documented and regression-tested.
- Thread start/resume evidence proves the effective configuration.
- Under the chosen Always ask meaning, an in-scope mutation cannot occur without the required human boundary.
- Auto-review remains bounded to the policy explicitly promised to the customer.
- Existing security/sandbox constraints are not weakened.

## Verification

Configuration contract tests → live thread start/resume characterization → harmless command/file mutation scenarios under both policies.

Checkpoint before STAB-08.
