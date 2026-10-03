# ROVE-UXR-06 — Browser resource and collaboration presentation

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Machine-qualified candidate — independent manager review pending

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Present browser resources and human collaboration once, with clear surface responsibilities.

## Context

MR-037 reflects duplicated central/inspector Take Over/Return controls and crowded recovery/profile content. STAB-10/11 repaired ownership and profile recovery; presentation must reuse it.

## Owned invariant

The dock owns current Take Over, human control/Return and checking-after-return. Browser inspector owns resource status/recovery/Open/View/recording, never a second primary collaboration decision.

## Findings owned

Primary: MR-037. UXR-02 owns compact shell foundation; this ticket applies it to browser resource/profile and recording presentation.

## Dependencies

[ROVE-UXR-03](ROVE-UXR-03-task-interaction-dock-and-composer.md)

## Explicit non-goals

Browser ownership or follower-authority redesign, silently rebinding deleted frozen profile identities, new capture scopes, hidden recording, and reopening qualified takeover/return without contradictory evidence.

## Continuity entry contract

Consume UXR-02 drawer rules and UXR-03 dock seam; inherit exact STAB-10 Task/session/page/handoff/ownership generations and STAB-11 profile recovery/native foreground constraints. Read Browser Control and Recording before edits.

The accepted UXR-03 foundation at `3458fb3` establishes `task-interaction-dock.tsx` as presentation resolver/container ownership. Consume its accepted ledger exit before edits: exact request coordinates select one primary surface, Stopping takes precedence, Stop is independent of input and browser controls, queue stays above every mode, and drafts/read intent remain Task-owned. Reuse the existing response/control paths and retained renderer/queue/negative regressions. Specialist family contents and durable authority remain with this ticket; do not infer acceptance from the seam alone.

Accepted UXR-02 shell at `b59fe4f`, UXR-04 decision at `eef0f8b` and UXR-05 notifications at `bad71035b7e1443941fbb031f3527c0de90bce18` are upstream foundations. Consume their manager ledger checkpoints, preserving nested-modal focus, drawer semantics, exact decision/Stop/secret/numeric/contrast controls and presentation-only dismissal/durable markers. This ticket starts from exact clean `bad7103` on the same PR #38 branch. Existing snapshot lacks authoritative current-page URL; do not turn historical activity or a recording URL into live page authority.

## Investigation requirements

Trace attached identity/owner/state/profile/site/page, Open/View Browser and bounded recovery. Compare dock, inspector and compact follower so full-surface versus follower presentation preserves one authority. Review Browser Profiles management create/select/rename/delete, selected/default state, missing/deleted profile recovery, narrow typography/copy density and Recording panel density.

## Implementation responsibility

This implementation owns browser collaboration dock modes and resource-only inspector, compact drawer application, profile management modal and recovery/recording hierarchy. Preserve exact command paths, Agent requested versus Companion voluntary takeover, failed-return human ownership, fresh Checking and requested recording lifecycle/scope.

## Acceptance criteria

- No two equally prominent Take Over/Return actions for the same authority exist in dock and inspector; follower presentation shares exact semantics without becoming another authority.
- Inspector clearly shows attachment, owner/state, profile, safe site/page, Open/View, bounded recovery and recording where relevant. Compact layout uses the established drawer/overlay.
- Create/select/rename/delete and selected/default profile state are readable in the management modal; missing/deleted frozen identity recovery remains explicit and retains conversation.
- Take Over presents/transfers the exact task-owned resource; Return requires fresh checking, failure remains human-owned, and Stop never steals ownership.
- Recording requested/active/finalizing/available/failed and scope remain clear; inspector/profile/recording content has intentional hierarchy at both widths/themes.

## Focused verification expectations

Dock/inspector control presence and exact intent tests; profile modal CRUD/default/recovery renderer tests; return/checking and recording density/lifecycle presentations.

## Affected-area verification

Retain existing browser authority, foreground/follower revocation, profile catalog and attachment negative tests. Cross-process/native claims need their actual boundary; packaged live composition remains external STAB-14 qualification.

## Visual, responsive and accessibility evidence

Normal/820×700 light/dark inspector open/closed, no attachment, profile recovery, takeover/human/return/checking and all profile modal operations. Pointer/keyboard focus, reduced motion, long profile/site copy and Recording panel evidence.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

UXR-07 consumes one browser collaboration surface, resource drawer/modal hierarchy and preserved native/provider limitations. MR-037 closure requires composition proof, not another ownership claim.


## Candidate handoff — 3 October 2026

Dock-only collaboration and resource inspector/profile/recording hierarchy are implemented with unchanged host authority. Focused suites pass 167 + 47 tests; production renderer passes 160 captures / two groups. The [ledger exit](continuity-ledger.md) owns exact source/report identity, commands, corrected candidates and limitations. The authoritative current-page URL gap remains explicit: existing View Browser is retained, recording hostname provenance is historical, and no read-model field is fabricated. MR-037 awaits independent manager review plus integrated/human qualification. Stop after normal commit/non-force push on PR #38; UXR-07 remains unstarted until acceptance and explicit continuation.
