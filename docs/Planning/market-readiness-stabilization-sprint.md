# Rove Market-Readiness Stabilization Sprint

**Status:** Active  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`  
**Started:** 26 September 2026  
**Authority:** Product and Engineering contracts remain authoritative. This sprint sequences diagnosis, correction, and qualification; it does not silently change product policy.

## 1. Objective

Prepare the current Rove implementation as though it is being taken to market rather than optimized for a short internal deadline.

Development-app human acceptance exposed defects that cross the original acceptance stages. Several symptoms share one deeper authority, recovery, state-model, approval, or browser-ownership cause. The implementation must therefore be repaired at the owning boundary rather than patched at whichever screen exposed the symptom.

There is **one sprint**. The work is decomposed into ordered tickets so each problem family can be diagnosed, implemented, verified, and checkpointed independently.

## 2. Current acceptance baseline

The 26 September 2026 development-app walkthrough against `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d` established:

- Stage 1 conversation interaction/presentation walkthrough completed; already-recorded findings remain remediation inputs rather than reopening the walkthrough.
- Stage 2 attention/approvals closed with three confirmed defects, four live qualification gaps, and an unqualified 820×700 keyboard-only check.
- Stage 3 browser collaboration closed with blocking authority/handoff defects. Automatic browser launch passed, but requested Agent handoff and Companion voluntary takeover did not reach stable human control.
- Stage 4 startup/recovery closed with blocking persisted-task recovery and Runtime rejection-storm defects.
- Hard Stop remains a separate release-level provider blocker: Codex turn interruption does not prove termination of a yielded local process.

The detailed evidence baseline and issue registry are under [stabilization/](stabilization/README.md).

## 3. Root problem families

The acceptance stages are discovery organization, not engineering ownership.

| Family | Engineering ownership |
| --- | --- |
| A. Task ↔ Runtime ↔ Codex authority convergence | Exact Task/thread/session/browser/handoff identity and restart convergence |
| B. Runtime dependency resilience | Failure taxonomy, bounded polling, backoff, recovery containment, diagnostic retention |
| C. Customer execution-state truth | Working/waiting/checking/human-control/terminal semantics and duration |
| D. Approval policy and decision fidelity | Customer policy promise, provider configuration, exact approval decision algebra |
| E. Attention capability reachability | Live request-family characterization and safe fixtures |
| F. Browser resource/surface UX | Profile recovery, orphan presentation, foreground/window coordination |
| G. Hard Stop execution ownership | Exact process termination or explicit provider/architecture blocker |
| H. Qualification infrastructure | Real-boundary E2E, restart/process fixtures, packaged and human qualification |

The canonical issue mapping is [stabilization/issue-registry.md](stabilization/issue-registry.md).

## 4. Ticket sequence

| Ticket | Title | Current status |
| --- | --- | --- |
| [ROVE-STAB-01](stabilization/ROVE-STAB-01-issue-registry-and-reproduction-baseline.md) | Issue registry and reproduction baseline | Complete |
| [ROVE-STAB-02](stabilization/ROVE-STAB-02-task-runtime-codex-authority-convergence.md) | Task / Runtime / Codex authority convergence | Ready |
| [ROVE-STAB-03](stabilization/ROVE-STAB-03-recovery-lifecycle-and-bounded-reconciliation.md) | Recovery lifecycle and bounded reconciliation | Depends on STAB-02 |
| [ROVE-STAB-04](stabilization/ROVE-STAB-04-runtime-failure-containment-and-observability.md) | Runtime failure containment and observability | Ready after baseline |
| [ROVE-STAB-05](stabilization/ROVE-STAB-05-startup-hydration-and-degraded-state.md) | Startup hydration and degraded-state UX | Depends on STAB-03/04 |
| [ROVE-STAB-06](stabilization/ROVE-STAB-06-authoritative-customer-execution-state.md) | Authoritative customer execution-state model | Depends on authority/recovery facts |
| [ROVE-STAB-07](stabilization/ROVE-STAB-07-approval-policy-contract.md) | Approval policy contract | Ready after characterization |
| [ROVE-STAB-08](stabilization/ROVE-STAB-08-approval-decision-fidelity-and-ux.md) | Approval decision fidelity and UX | Depends on STAB-07 |
| [ROVE-STAB-09](stabilization/ROVE-STAB-09-attention-family-reachability.md) | Attention-family reachability and live fixtures | Can characterize early; product fixes depend on STAB-07/08 |
| [ROVE-STAB-10](stabilization/ROVE-STAB-10-browser-ownership-and-handoff-lifecycle.md) | Browser task ownership and handoff lifecycle | Depends on STAB-02/03/06 |
| [ROVE-STAB-11](stabilization/ROVE-STAB-11-browser-resource-and-surface-ux.md) | Browser resource and surface UX | Depends on authority truth where applicable |
| [ROVE-STAB-12](stabilization/ROVE-STAB-12-hard-stop-provider-qualification.md) | Hard Stop provider qualification / execution ownership decision | External provider blocker |
| [ROVE-STAB-13](stabilization/ROVE-STAB-13-cross-cutting-interaction-qualification.md) | Cross-cutting interaction and accessibility qualification | Depends on repaired product tickets |
| [ROVE-STAB-14](stabilization/ROVE-STAB-14-market-release-qualification.md) | Market release qualification | Final sprint gate |

Dependency order is intentional. It is not permission to combine unrelated tickets into one implementation change.

## 5. Ticket execution protocol

Every implementation ticket follows the same sequence:

1. **Read-only diagnosis.** Reproduce the exact issue against the current branch and inspect the owning authority before editing.
2. **Invariant.** State the invariant that would prevent the entire defect family, not only the visible symptom.
3. **Failing evidence.** Add or retain the smallest test/reproduction at the boundary where the defect actually exists.
4. **Implementation.** Change only what is needed to satisfy that invariant. Do not opportunistically repair another ticket.
5. **Focused verification.** Run the direct unit/contract tests for touched code.
6. **Affected-subsystem verification.** Run the relevant lifecycle, recovery, Runtime, App Server, browser, renderer, or process-backed suite.
7. **Real-boundary qualification.** If the defect only manifests across processes, restart, App Server requests, Runtime/browser ownership, or Electron layout, exercise that boundary. A deterministic renderer fixture does not substitute for a live provider path.
8. **Checkpoint.** Create one coherent ticket commit containing implementation plus its verification evidence/documentation.
9. **Proceed.** Only after the ticket is green should work move to the next dependent ticket.

Do **not** run the full repository suite after every narrow ticket unless the change crosses repository-wide boundaries. The final ticket runs the complete suite and market qualification. Each ticket still runs every verification materially affected by that ticket.

## 6. Change discipline

- One ticket may contain several symptoms when diagnosis proves they share the same authority/invariant.
- Do not merge tickets merely because the same file is touched.
- If diagnosis proves a ticket contains two independent authorities, split the ticket before implementation and update this plan.
- New defects receive an issue-registry ID before they are fixed.
- Do not weaken an acceptance criterion to match current provider behavior.
- Do not replace an authority defect with a renderer workaround.
- Do not infer success from model prose, UI disappearance, an empty inventory, or a provider response whose semantics do not prove the required fact.
- Preserve persistent reproduction state until the owning ticket has qualified the fix.
- Existing Product and Engineering contracts are not rewritten from a failing implementation. If the approved contract itself is wrong, stop and update the responsible canonical document first.

## 7. Verification classes

Use the narrowest class that can actually prove the ticket:

- **Unit / pure projection:** deterministic data transformation and policy.
- **Contract:** schema, reducer, capability, exact identity, wire shape.
- **Persistent integration:** SQLite restart, outbox, replay, reconciliation.
- **Process-backed integration:** App Server/Runtime process lifetime, crash/restart, transport behavior.
- **Browser integration:** real managed Runtime browser, page ownership, handoff, foregrounding.
- **Electron rendered journey:** real preload/product composition, layout/focus/keyboard/window behavior.
- **Packaged qualification:** built application, native modules, OS integration.
- **Human acceptance:** final usability and product coherence.

A higher-level test does not remove the need for a lower-level invariant test; a lower-level test does not qualify a boundary it never exercises.

## 8. Sprint completion conditions

The sprint is complete only when:

- every issue-registry item is closed by a qualifying ticket, explicitly accepted as a documented provider limitation, or superseded by a later evidenced finding;
- persistent Tasks either reconcile or reach a bounded truthful state without freezing unrelated work;
- Runtime failure cannot produce an unhandled rejection storm;
- customer work never looks terminal while authoritative work is nonterminal;
- approval policy labels match actual enforcement and every supported decision is represented truthfully;
- all supported attention families have a safe live qualification path;
- Agent and Companion browser collaboration preserve exact Task/Runtime authority through takeover and return;
- browser resource failures are customer-bounded rather than raw IPC/runtime errors;
- Hard Stop either proves exact process termination or remains an explicit release blocker with an approved architecture/product disposition;
- normal/narrow, keyboard, reduced-motion, multi-Task, restart and recovery qualification passes;
- the packaged application passes the critical market journeys; and
- final human acceptance is satisfactory.

No clock-based shortcut changes these completion conditions.
