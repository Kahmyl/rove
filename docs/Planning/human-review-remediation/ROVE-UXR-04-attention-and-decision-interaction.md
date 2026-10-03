# ROVE-UXR-04 — Attention and decision interaction

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Planned — implementation not started

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Compose every applicable selected-task blocking decision as the current interaction surface.

## Context

MR-035 includes approvals stacked over the composer, weak action hierarchy/discoverability and duplicated “Submitting your response…”. STAB-07/08/09 established authority and provider compatibility that this work must retain.

## Owned invariant

An exact selected-task blocking request occupies the dock until it settles; ordinary composition is not a peer primary surface underneath it. Background attention stays on its owning Task/sidebar.

## Findings owned

Primary: MR-035. Uses UXR-03 docking and UXR-02 primitives; does not reopen exact provider decisions unless contradictory authority evidence is recorded.

## Dependencies

[ROVE-UXR-03](ROVE-UXR-03-task-interaction-dock-and-composer.md)

## Explicit non-goals

Permission-policy redesign, manufacturing provider families, altering exact decision values/order/amendments, granting elevated execution, secret retention, or global blocking of unrelated Tasks.

## Continuity entry contract

Consume UXR-03 dock/Stop seam and STAB-07/08 exact emitted-decision contracts plus STAB-09 provider-family matrix. Characterize current request rendering and response state without treating deterministic fixtures as live reachability.

The UXR-03 foundation candidate establishes `task-interaction-dock.tsx` as presentation resolver/container ownership. Consume its accepted ledger exit before edits: exact request coordinates select one primary surface, Stopping takes precedence, Stop is independent of input and browser controls, queue stays above every mode, and drafts/read intent remain Task-owned. Reuse the existing response/control paths and retained renderer/queue/negative regressions. Specialist family contents and durable authority remain with this ticket; do not infer acceptance from the seam alone.

## Investigation requirements

Map conversational structured input, command approval, file-change approval, network approval, additional permission, MCP structured form and trusted URL. Inspect duplicate request.description render sites and submitting projection; trace exactly-once response. Examine refusal/decline visibility, one-time/session/policy-amendment explanation, focus restoration, form validation and secure/external intent handling.

## Implementation responsibility

Later implementation owns family-specific dock response surfaces, primary/secondary decision hierarchy, stable disabled/submitting state and coherent form/URL presentation. Keep exact request/generation binding, all offered material and decisions, safe Stop and ephemeral secret boundaries; provide one submitting message.

## Acceptance criteria

- All seven applicable families use the selected-task blocking-decision dock; composer draft survives but ordinary composer is not stacked underneath. Background requests do not replace another Task’s dock.
- Every materially distinct offered action is visibly discoverable. Refusal/decline is not hidden merely because scrolling or tabbing can eventually reach it.
- One-time, session and policy-amendment consequences are readable before acceptance; provider values and amendment objects round-trip unchanged.
- Controls settle once; disabled/submitting state stays spatially coherent and contains no duplicated “Submitting your response…”. Stale/cross-Task decisions fail closed.
- MCP form hierarchy, validation, trusted-URL actions and keyboard/focus are understandable at normal and 820×700 in both themes. Stop remains available from exact capability truth.

## Focused verification expectations

Seven-family production projection renderer matrix; exact decision round-trip, duplicate/stale response rejection, one submitting presentation, form validation and trusted-URL intent assertions.

## Affected-area verification

Attention host/adapter/TaskEngine contracts, ephemeral secret isolation, Task switching, dock mode restoration, Stop and browser collaboration coexistence. Keep unavailable live provider families explicitly unqualified.

## Visual, responsive and accessibility evidence

Normal/820×700 light/dark pointer/keyboard captures for every family, pending/submitting/resolved and long material; show refusal and scope discoverability, focus, reduced motion and no clipping. Evidence mode must identify deterministic versus live.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

UXR-07 consumes qualified request-family composition and provider limitations. MR-035 closes only after these interaction assertions and visual review pass; no authority closure is inferred.
