# ROVE-UXR-03 — Task Interaction Dock and composer

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Dock/composer/queue foundation candidate qualified — manager review pending

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Make bottom-of-task interaction one coherent product surface rather than competing cards.

## Context

MR-034 spans composer, queue, decisions, collaboration and execution controls. Existing New/existing Task composer reuse is useful but does not yet establish one mode-responsible dock.

## Owned invariant

One Task Interaction Dock owns ordinary compose, blocking decision, browser collaboration, checking/return and stopping modes, using exact customer capabilities; queue is adjacent material and never a second composer.

## Findings owned

Primary: MR-034. MR-035/036/037 retain their specialist owners; establish their integration seam without implementing those tickets early.

## Dependencies

[ROVE-UXR-02](ROVE-UXR-02-responsive-shell-and-surface-system.md)

## Explicit non-goals

Approval algebra changes, provider reachability work, effect-fence changes, browser-authority redesign, removal of attachments/settings/queue capability, and specialist implementations owned by UXR-04/05/06.

## Continuity entry contract

After manager acceptance and explicit continuation in the same implementation chat, inherit the UXR-02 foundation candidate and source fingerprints in its ledger exit plus UXR-01 contracts. The shell uses compact drawers below 968px, optional 240px inline navigation from 968px, and an optional 280px inspector from 1280px; central gutters are 24px. Reuse the 8/12/16px control/panel/overlay scale and shared nested-overlay focus ownership. Consume the correction exit that supersedes rejected checkpoint `a82a07d`: shared inert leases preserve topmost focus through underlying drawer resize/removal and release all protection on final close. Retain the committed rendered regression when introducing dock overlays. Keep the primary conversation/draft subtree mounted. Inspect current composer gates, typed capability/collaboration projections, queue intent paths and existing stable Send/Stop behavior; preserve exact identities.

## Investigation requirements

Map New Task and existing Task input, draft retention, accepted/queued delivery, attachments, Commands, mode, approval policy, combined model/reasoning, Output/context chips and primary-action geometry. Define mode selection and safe transition behavior from exact facts, including decision plus browser plus Stop; never infer authority from visibility. Compare a bounded presentation resolver/container with ad hoc card stacking.

## Implementation responsibility

This candidate owns the canonical dock container and mode seam, ordinary composer, queue hierarchy, Stop/Stopping/Stopped presentation and stable primary actions. Queue defaults expose primary Steer when relevant; secondary edit/reorder/remove use overflow. Progressive disclosure keeps all implemented settings and attachments reachable at compact widths.

## Acceptance criteria

- New/existing Task composers share intentionally compact structure; the dock is not a giant floating modal-like card.
- One primary surface appears per dock mode. Inactive ordinary drafts are preserved across mode changes and restored safely without dispatch.
- Queue sits immediately above the dock, preserves ordered exact entries/context through edit/reorder/remove/Steer and survives Stop/restart without implicit execution.
- Stop remains available wherever exact execution/capability truth permits it, including decision or collaboration modes; Stopping disables duplicate intent and Stopped permits later conversation.
- Attachments, Commands, mode, approval policy, model/reasoning and Output/context chips retain capability and clear compact disclosure. Send/Stop geometry remains stable without hiding required actions.

## Focused verification expectations

Mode-resolution and renderer interaction tests from production projections; New/existing parity, queue intents, draft preservation, stable action geometry, Stop before turn and through waiting/checking.

## Affected-area verification

TaskEngine/LocalProductApi queue promotion, exact Steer, attachments/context, attention and browser projections; run touched integration and renderer journeys plus repository/typecheck/build checks at implementation time.

## Visual, responsive and accessibility evidence

Normal/820×700, light/dark compose/queue/Stopping/Stopped captures; keyboard/focus, long text/title, attachments, overflow controls and reduced motion. Prove discovery and hierarchy as well as DOM presence.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

UXR-04, UXR-05 and UXR-06 inherit one dock seam, mode responsibilities, exact capability inputs and quiet queue/Stop geometry. The graph permits independent scopes after this checkpoint; shared-file writes still require isolation.

## Candidate exit

See the [continuity ledger](continuity-ledger.md) for exact accepted start, source fingerprints, evidence and causal corrections. The typed presentation resolver prioritizes Stopping, one exact current decision, required/human/return browser collaboration, capability-blocked checking, Capture and compose. Voluntary takeover remains secondary in compose. Queue stays immediately above the mode body, with Steer primary and edit/remove/reorder in overflow. Send and independently available Stop occupy separate stable slots; pending Stop is immediately non-actionable. Shared compact composition preserves attachments/Commands/frozen settings/Output chips; per-Task text drafts and timeline reading intent restore without dispatch. Existing specialist controls are integrated through the seam without redesigning their family behavior or authority.

Stop for independent manager review after normal commit/non-force push. UXR-04 remains unstarted and requires acceptance plus an explicit continuation message; MR-034 integrated/human qualification and specialist/external gates remain open. No host effect fence, provider policy, schema, persistence format or migration changes occurred.
