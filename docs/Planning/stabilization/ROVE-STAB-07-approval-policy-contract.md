# ROVE-STAB-07 — Approval policy contract

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete
**Dependencies:** STAB-01; provider characterization from STAB-09 may inform  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume STAB-01's approval findings and any provider characterization already produced by STAB-09 research without treating later-ticket implementation as complete. Preserve the distinction between provider approval policy and Rove reviewer choice.

At ticket start, reconcile current `main` with the continuity ledger, record the exact start SHA, and verify the effective provider configuration from current source/schema before deciding product mapping.

## Invariant

The customer-facing approval policy name describes the actual authorization behavior enforced by Rove and the provider.

## Owns

The policy-contract portion of MR-008 and MR-011.

## Required decision

Establish an ADR-level mapping for the human-reviewed and automatically reviewed permission modes. The human-reviewed label is **Ask for approval**; the earlier **Always ask** wording is retired because it falsely implied confirmation before operations already allowed by the frozen task permission profile. The automatic label remains **Approve for me**.

The current frozen Task policy uses provider `approvalPolicy: "on-request"` while separately choosing `approvalsReviewer`. That must be proven compatible with the customer promise or changed.

The exact mapping is:

- **Ask for approval** → provider `approvalPolicy: "on-request"`, `approvalsReviewer: "user"`, named `rove_task` permission profile, task workspace writable;
- **Approve for me** → provider `approvalPolicy: "on-request"`, `approvalsReviewer: "auto_review"`, the same named `rove_task` permission profile and workspace boundary.

Both choices permit operations already inside the task profile. The reviewer choice governs permission requests that cross that boundary; it does not grant or replace Rove's separately scoped authorization for consequential external actions.

Do not solve MR-011 by forcing a React card for an operation the frozen provider/security profile already allows. Correct the customer promise and preserve the established sandbox. STAB-08 owns the fidelity and refusal UX for permission requests that are actually emitted.

## Acceptance criteria

- Exact product meaning of both labels is documented.
- Exact provider configuration and reviewer semantics are documented and regression-tested.
- Thread start/resume evidence proves the effective configuration.
- Under **Ask for approval**, a mutation beyond the frozen task permission boundary cannot occur without the required human review; workspace-local mutations already allowed by that boundary are not misrepresented as requiring per-edit confirmation.
- Auto-review remains bounded to the policy explicitly promised to the customer.
- Existing security/sandbox constraints are not weakened.

## Verification

Configuration contract tests → credential-free process-backed thread start/resume characterization → harmless command/file mutation semantics under both policies. Live provider execution is qualification evidence only when separately authorized; it must not be substituted with an unapproved model or external-service run.

Checkpoint before STAB-08.

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
