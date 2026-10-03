# ROVE-UXR-08 — Visual/interaction qualification and remediation gate

**Program:** [Rove Human-Review Remediation Program](README.md)

**Status:** Planned — implementation not started

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

## Purpose

Add a retained composition-quality gate so functionally reachable screens cannot pass while visibly unacceptable.

## Context

MR-039 is a qualification gap, not invalidation of the earlier 37 bounded functional passes. This ticket establishes remediation machine qualification; final human-paced Stage 1–4 recording is a later gate.

## Owned invariant

Functional authority and visual composition are separately evidenced. A release candidate requires readable, discoverable, intentionally designed composition, not merely reachable controls/no overflow.

## Findings owned

Primary: MR-039. Qualifies closure evidence for MR-034–MR-038 without taking ownership of their implementations.

## Dependencies

[ROVE-UXR-07](ROVE-UXR-07-cross-surface-visual-and-state-coherence.md)

## Explicit non-goals

Silent remediation in a qualification ticket, weakening existing functional assertions, live-family claims from fixtures, closing external provider/platform/distribution gates or performing the final Stage 1–4 recording.

## Continuity entry contract

Consume integrated UXR-07 candidate and specialist exits; require all remediation finding dispositions and no hidden predecessor blocker. Build qualification from current truth, not stale fixture assumptions.

## Investigation requirements

Audit existing DOM/reachability PASS semantics and identify explicit composition judgments and retained review evidence for hierarchy, density, discoverability, responsive allocation and state coherence. Select believable timestamps/durations for ordinary fixtures; retain dedicated long-duration behavioral tests separately. Define a subtle pointer/click indicator that does not obscure controls.

## Implementation responsibility

Later implementation owns retained machine-readable visual/composition matrix, deterministic captures, assertions and explicit reviewer rubric alongside unchanged functional coverage. Retain exact SHA/component versions, dimensions/theme/input/motion, state provenance, expected/observed results, hashes and failure references. Generated media stays ignored under artifacts.

## Acceptance criteria

- Matrix covers normal (1180×780) and 820×700; light/dark; pointer/keyboard; normal/reduced motion. Dock modes include compose, queue, decision, browser collaboration, human control, checking and stopping/stopped.
- States include warning notification, durable unresolved marker, failure and recovery. Include all seven attention families, Browser Profiles modal, compact inspector/drawer, queue, long text/title, attachments, many activities and Latest/read-position behavior.
- Pass requires intentional readable hierarchy, discoverable refusal/scope and primary actions, coherent surface scale, stable controls/focus and truthful state. No-overflow/DOM presence is necessary but insufficient.
- Fixtures use believable time/duration except dedicated long-duration cases; evidence has a subtle pointer/click indicator and does not lengthen execution for video.
- All retained composition judgments and functional assertions pass. New failures are registered/routed before qualification resumes. Unavailable live families retain STAB-09 limits.
- Completion wording is exactly “Remediation machine qualification complete; candidate ready for final human-recorded acceptance.” It never claims human Stage 1–4 acceptance passed.

## Focused verification expectations

Execute retained composition matrix with DOM/state plus capture/rubric outcomes; verify matrix completeness, provenance and checksum linkage. Run repository checks and touched harness tests.

## Affected-area verification

At the integrated candidate run typecheck, build, affected/full deterministic qualification as required by release policy and current ledger. Keep real provider/process/native/package evidence distinct, and do not infer external gates from this machine matrix.

## Visual, responsive and accessibility evidence

All mandatory axes and scenarios above need explicit coverage records, screenshots/contact sheets and review outcomes. Every combination judged mandatory by the rubric gets a retained cell; any reduced pairwise coverage requires recorded rationale and cannot omit blocking-decision/refusal or narrow/theme states.

## Continuity exit contract

Before completion, update [continuity-ledger.md](continuity-ledger.md) with exact start/end commit and branch, evidence-backed MR dispositions, root cause and disproved hypotheses, contract/source boundaries changed, compatibility/migration/fixture consequences, exact commands/results, evidence modes/paths/hashes, failures and unqualified boundaries, preserved reproductions, residual blockers and the next gate. Record no schema or persistence change when none occurred. Update every directly downstream entry contract if evidence changes its assumptions; new evidence can revise scope only through the ledger and responsible canonical authority.

Keep product/runtime/test names descriptive; ticket IDs remain bounded planning metadata. Existing authority/security invariants and negative regression assertions cannot be weakened for layout. Live model/external-service checks require explicit authorization and temporary test homes.

## Downstream handoff

Stop at the machine checkpoint. Schedule/perform final Stage 1–4 human-paced recording only in separately authorized follow-up after UXR-08 passes; then STAB-14 still owns remaining provider/platform/distribution release gates.
