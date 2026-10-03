# Rove Human-Review Remediation Program

**Status:** UXR-02 foundation candidate qualified; independent manager review pending

**Started:** 3 October 2026

**Program start:** `2ff214b8f8624859c1a55bb50a16997302614560`

**Branch:** `codex/human-review-remediation-planning`

**Canonical remote base:** `main` at `a0a1bfff23628da236e1737f8d396842f69da890`

**Review PR:** [#38 — Human-review remediation program and implementation](https://github.com/Kahmyl/rove/pull/38)

## Origin and evidence boundary

Post-STAB-14 recorded E2E human review found market-significant interaction/presentation defects that the existing machine pass criteria did not classify. The recorded package remains immutable: `artifacts/human-e2e-acceptance/20260927T144500Z/{manifest.json,walkthrough.md,SHA256SUMS}`, committed by `2ff214b`; its run source was `42952a2bce699cee299a2bca6315d95d6181b54f`.

**RECORDED E2E ACCEPTANCE: PARTIAL**

**HUMAN REVIEW: REMEDIATION REQUIRED**

Preserve all 37 PASS, six UNQUALIFIED and one BLOCKED recorded results. They establish bounded state, reachability, functional and authority evidence; they do not establish professional visual composition. The supplied post-recording human review is the new evidence source. This planning task does not repeat or self-certify that review, change the recorded manifest's historical PENDING field, or rerun the Stage 1–4 walkthrough.

The central defects are a heavy fragmented task-bottom area, squeezed compact shell, inconsistent blocking-decision composition and duplicate submitting copy, permanent amber warnings, duplicate browser collaboration controls, weak profile/recovery hierarchy and incoherent surface scale. Reachability alone does not establish discoverability or a release-quality composition. These are architectural presentation responsibilities, not a request for isolated CSS patches.

## Authority and engineering standard

[Product Operating Model](../../Products/product-operating-model.md), [Product Direction](../../Products/product-direction.md), [Application and Capability Contracts](../../Engineering/application-and-capability-contracts.md), [Events and Live State](../../Engineering/events-and-live-state.md), [Browser Control and Recording](../../Engineering/browser-control-and-recording.md) and [Testing and Operations](../../Engineering/testing-and-operations.md) remain canonical. The [conversation experience plan](../conversation-and-task-experience.md) now reflects the dock, notification and responsive targets. None is implemented merely by this planning checkpoint.

Choose the smallest architecture that fully satisfies the product invariant, not the smallest patch that removes the current symptom. Reuse the exact authority and working custom behavior. No new planner, lifecycle engine, task-sync framework, paid dependency or authority bypass is authorized.

A selected Task has one primary Task Interaction Dock. Ordinary compose, exact blocking customer decision, browser collaboration, checking/return and stopping are modes of it. Applicable blocking decisions replace ordinary composition as peer primary surface; background attention never replaces another Task's dock. Queue is immediately above the dock, not a second composer. Stop follows exact capability truth in each mode. The dock owns Take Over/Return/checking; inspector owns resource status. Dismissible notifications are separate from durable unresolved markers and never clear safety state. Compact shells progressively collapse secondary surfaces; elevation communicates hierarchy instead of making normal work look like overlapping modal cards.

## Dependency graph

```text
UXR-01
  -> UXR-02
    -> UXR-03
      -> UXR-04 + UXR-05 + UXR-06
        -> UXR-07 (all three predecessors complete)
          -> UXR-08
            -> FINAL HUMAN-RECORDED STAGE 1–4 ACCEPTANCE
              -> remaining provider/platform/distribution release gates
```

This graph is frozen unless current repository evidence proves it unsound. Record any justified boundary/dependency revision in [continuity-ledger.md](continuity-ledger.md), update affected entries and canonical contracts together, and preserve one primary owner per finding. Independent research can proceed where safe; shared-file parallel writes require separate branches/worktrees and isolated mutable runtime resources.

## Tickets and status

UXR-01 began In Progress / planning-contract setup; this checkpoint completes that setup only. UXR-02 foundation is independently accepted at `b59fe4f`; UXR-03 foundation is independently accepted at `3458fb3`; UXR-04 has a qualified decision candidate awaiting manager review; UXR-05–08 remain Planned.

| Ticket                                                                        | Responsibility                                        | Status                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| [ROVE-UXR-01](ROVE-UXR-01-evidence-and-interaction-contract.md)               | Evidence and interaction-contract freeze              | Complete — planning setup only                 |
| [ROVE-UXR-02](ROVE-UXR-02-responsive-shell-and-surface-system.md)             | Responsive shell and surface-system foundation        | Foundation accepted — integrated/human pending |
| [ROVE-UXR-03](ROVE-UXR-03-task-interaction-dock-and-composer.md)              | Task Interaction Dock and composer                    | Foundation accepted — integrated/human pending |
| [ROVE-UXR-04](ROVE-UXR-04-attention-and-decision-interaction.md)              | Attention and decision interaction                    | Candidate — manager review pending             |
| [ROVE-UXR-05](ROVE-UXR-05-notifications-and-customer-state.md)                | Notifications and customer-state presentation         | Planned                                        |
| [ROVE-UXR-06](ROVE-UXR-06-browser-resource-and-collaboration-presentation.md) | Browser resource and collaboration presentation       | Planned                                        |
| [ROVE-UXR-07](ROVE-UXR-07-cross-surface-visual-and-state-coherence.md)        | Cross-surface visual and state coherence              | Planned                                        |
| [ROVE-UXR-08](ROVE-UXR-08-visual-qualification-and-remediation-gate.md)       | Visual/interaction qualification and remediation gate | Planned                                        |

## Issue mapping

| Finding | Primary owner                                                                 | Supporting responsibilities |
| ------- | ----------------------------------------------------------------------------- | --------------------------- |
| MR-034  | [ROVE-UXR-03](ROVE-UXR-03-task-interaction-dock-and-composer.md)              | UXR-02 / UXR-07             |
| MR-035  | [ROVE-UXR-04](ROVE-UXR-04-attention-and-decision-interaction.md)              | UXR-03 / UXR-07             |
| MR-036  | [ROVE-UXR-05](ROVE-UXR-05-notifications-and-customer-state.md)                | UXR-07                      |
| MR-037  | [ROVE-UXR-06](ROVE-UXR-06-browser-resource-and-collaboration-presentation.md) | UXR-02 / UXR-07             |
| MR-038  | [ROVE-UXR-02](ROVE-UXR-02-responsive-shell-and-surface-system.md)             | UXR-07                      |
| MR-039  | [ROVE-UXR-08](ROVE-UXR-08-visual-qualification-and-remediation-gate.md)       | UXR-07                      |

Final wording and classification live in the [issue registry](../stabilization/issue-registry.md). MR-038 assigns UXR-02 primary ownership of the foundation and UXR-07 integrated coherence responsibility; they are not competing fixes. No existing authority/security finding moves into family I.

## Completion and release boundaries

UXR tickets cannot weaken exact Task/provider decisions, ownership generations, Stop process truth, recovery authority, secret isolation or consequential replay fences. New contradictory evidence is registered and routed to its owning authority rather than masked by copy or layout. Functional coverage remains alongside visual qualification.

UXR-08 completion means only **Remediation machine qualification complete; candidate ready for final human-recorded acceptance.** The final Stage 1–4 human-paced recording is not an implementation ticket and occurs only after UXR-08 passes. It is not run or marked passed here.

The sequence is planning → implementation → ticket verification → cross-surface qualification → UXR-08 machine gate → final Stage 1–4 human-paced recorded acceptance → remaining provider/platform/distribution release gates. [STAB-14](../stabilization/ROVE-STAB-14-market-release-qualification.md) cannot close before remediation and final human acceptance, and remains separately blocked on provider-owned elevated-grant consumption, Windows/Linux packaged process trees, packaged live provider/browser composition, signing/notarization and remaining supported-platform distribution evidence. These stay with STAB-12/STAB-14; UX work does not absorb them.

## Next checkpoint

The manager independently accepted UXR-03 foundation at exact `3458fb36f5f9e0f81f9ef0e7345c5884fea52331` without a remediation round and explicitly continued the same sole worker to bounded UXR-04. Consume the [manager checkpoint and qualified decision exit](continuity-ledger.md). UXR-04 awaits manager review; UXR-05 remains unstarted until independent review and the next explicit continuation message.

The same actual implementation chat continues UXR-02 through UXR-08, one writer and one review stop per item. After accepting each checkpoint, the persistent manager sends the next bounded item explicitly. Focused/directly affected checks apply per item; full integrated system verification follows implementation at UXR-08. Final human-recorded acceptance and provider/platform/distribution gates remain separate. Retire ticket metadata with the active program.
