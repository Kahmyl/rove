# ROVE-UXR-05 — Notifications and customer-state presentation

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Planned — implementation not started

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Separate transient notification presentation from durable customer-state truth.

## Context

MR-036 describes permanent amber Outcome unclear/Task state unclear panels consuming the primary interaction area. Durable replay/recovery authority is correct and must survive presentation dismissal.

## Owned invariant

Dismissal or expiry removes only a notification; the affected Task/work/result/action retains a truthful unresolved marker and all fences until matching authority resolves it.

## Findings owned

Primary: MR-036. Owns cross-state wording for Working, Checking, Stopping, Stopped, confirmed failure and uncertainty; delivery-state investigation itself belongs to UXR-07.

## Dependencies

[ROVE-UXR-03](ROVE-UXR-03-task-interaction-dock-and-composer.md)

## Explicit non-goals

Clearing recovery blockers or effect truth via dismissal, relaxing replay fences, broad notification framework replacement, delaying execution termination for animation, and generic retries of uncertain effects.

## Continuity entry contract

Consume UXR-03 dock modes and canonical notification/marker distinction; inspect conversationStatus, customer presentation, recovery blockers and effect fences. Keep exact state/resource attribution from STAB-03/04/06.

## Investigation requirements

Classify Outcome unclear, Task state unclear, browser/runtime degradation and recoverable service warnings as transient notification plus durable marker where warranted. Determine safe dismissal/expiry, recurrence, Task switching, restart and accessible announcement behavior. Investigate minimum conservative visual dwell for extremely fast Stopping only after actual termination is proven; record whether justified and how newer state wins.

## Implementation responsibility

Later implementation owns bounded notification layer and durable state-marker projection/presentation, attribution, recovery/reconcile links and coherent state language. Use marker placement near affected work/result/action or owning Task; notifications must not occupy the dock indefinitely. Visual timing cannot change execution, duration, ownership or replay authority.

## Acceptance criteria

- Transient warnings can dismiss/expire when safe; durable unresolved state remains visible and discoverable after dismissal, Task switching and restart until exact authority settles it.
- Notification dismissal performs no attention response, effect acknowledgement, recovery settlement, ownership change or dispatch. Unsafe replay remains unavailable through every adapter.
- Confirmed failure, uncertainty, neutral Checking and human attention retain distinct language/tone and resource scope; ordinary completion remains quiet.
- Working/Checking/Stopping/Stopped transitions are coherent. If conservative dwell is justified, it is presentation-only, never delays termination or fabricates active work.
- Long warning/recovery copy is readable at 820×700, both themes, keyboard and screen-reader access without permanently occupying primary compose space.

## Focused verification expectations

Notification dismissal/expiry projection and renderer tests; retained marker after dismissal/restart; unchanged effect/recovery fence assertions; fast transition/newer-state and announcement behavior.

## Affected-area verification

Customer Task presentation, effect reconciliation, recovery/outage, sidebar, dock modes and browser-resource degradation. Run relevant persistence/negative replay tests if presentation preference persistence changes.

## Visual, responsive and accessibility evidence

Normal/820×700 light/dark warning shown/dismissed, durable unresolved, resolved, failure/recovery captures with pointer/keyboard/reduced motion. Retain before/after durable truth evidence beside visual evidence.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

UXR-07 inherits notification semantics, marker placement, safe dismissal/expiry, state language and documented Stopping timing decision. No durable safety issue is closed by presentation alone.
