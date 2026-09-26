# Market-Readiness Issue Registry

**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`  
**Status:** Canonical output of ROVE-STAB-01  
**Rule:** every observed defect or qualification gap has one primary owner. Secondary tickets may depend on it, but the same symptom is not duplicated as multiple independent fixes.

## Root families

- **A — Authority convergence:** exact Task, Codex thread, Runtime session, browser attachment, continuation/handoff identity.
- **B — Runtime resilience:** provider failure taxonomy, polling, backoff, error containment and diagnostics.
- **C — Customer execution truth:** active/waiting/checking/human-control/terminal state and duration.
- **D — Approval contract:** customer policy promise, provider settings, decision scope and refusal.
- **E — Attention reachability:** live ability to emit and qualify each request family.
- **F — Browser/surface UX:** profile recovery, orphan presentation, window/foreground coordination.
- **G — Hard Stop:** exact process termination authority.
- **H — Qualification infrastructure:** real fixtures and market-level qualification.

## Canonical findings

| ID | Finding | Kind | Family | Primary ticket |
| --- | --- | --- | --- | --- |
| MR-001 | Persistent Tasks remain indefinitely on Checking State after restart | Confirmed defect | A | STAB-02 / STAB-03 |
| MR-002 | Exact successful later Codex evidence does not clear the matching older thread-history blocker | Confirmed defect | A | STAB-03 |
| MR-003 | Historical handoff reconstruction passes Runtime `getControlStatus` without preserving object binding | Confirmed source defect | A | STAB-02 |
| MR-004 | Runtime startup failure produces repeated INVALID_CONFIGURATION/fetch failures instead of one bounded degraded state | Confirmed defect | B | STAB-04 |
| MR-005 | Runtime polling continues through permanent failure and process-level unhandled rejections accumulate | Confirmed defect | B | STAB-04 |
| MR-006 | Initial hydration exposes partially reconciled Task content and no dedicated bounded loading state | Confirmed presentation defect | B/H | STAB-05 |
| MR-007 | Command approval can expose only Approve, with no refusal | Confirmed defect | D | STAB-08 |
| MR-008 | Command approval does not faithfully present one-time/session/policy scope when provider decisions support richer semantics | Confirmed adapter/product gap | D | STAB-07 / STAB-08 |
| MR-009 | Final-looking command result can appear while the Task remains Working, timer advances and Stop remains | Confirmed defect | C | STAB-06 |
| MR-010 | Structured conversational user-input request was not reached; bounded choice appeared as ordinary assistant transcript content | Confirmed live-path defect/gap | E/C | STAB-09 |
| MR-011 | Under visible Always ask, explicit immediate file mutation completed without Needs Input or approval decision | Confirmed authorization-path defect | D | STAB-07 |
| MR-012 | Manual network approval family did not receive `networkApprovalContext`; generic command approval was reached instead | Live qualification gap | E | STAB-09 |
| MR-013 | Dedicated additional filesystem permission request could not be emitted in the live environment | Live qualification gap | E | STAB-09 |
| MR-014 | MCP structured-form elicitation is not reachable with the bundled live fixture | Qualification-fixture gap | E/H | STAB-09 |
| MR-015 | MCP trusted-URL elicitation is not reachable with the bundled live fixture | Qualification-fixture gap | E/H | STAB-09 |
| MR-016 | Attention families were not qualified keyboard-only at 820×700 | Qualification gap | H | STAB-13 |
| MR-017 | Opening Browser without a configured profile leaks raw PROFILE_NOT_FOUND host/runtime text | Confirmed product defect | F | STAB-11 |
| MR-018 | Creating/selecting a browser profile after Task creation does not give that existing frozen Task a clear recovery path | Confirmed product/lifecycle UX defect | F | STAB-11 |
| MR-019 | Foregrounding the managed browser can blank/close the full Rove surface unexpectedly | Confirmed surface defect | F | STAB-11 |
| MR-020 | Agent requested handoff can leave unmatched `awaiting_human/controller:none` Runtime state rather than one actionable exact handoff | Confirmed blocking defect | A | STAB-10 |
| MR-021 | Browser cleanup for one unmatched Runtime session is presented on unrelated selected Tasks and New Task | Confirmed ownership/presentation defect | F/A | STAB-11 |
| MR-022 | Companion can successfully use a browser while the owning Task later projects No browser attached | Confirmed blocking defect | A | STAB-02 / STAB-10 |
| MR-023 | Open Browser can be offered when exact Task Runtime authority is unavailable, then fail with raw IPC text | Confirmed defect | A/F | STAB-10 / STAB-11 |
| MR-024 | Terminal-looking Worked can coexist with unfinished activity, Checking State and Stop | Confirmed cross-stage state defect | C | STAB-06 |
| MR-025 | Agent Take Over, exact foregrounding, Return to Rove, fresh checking, resume and main/follower parity remain downstream-unqualified | Qualification gap caused by blocker | A/H | STAB-10 / STAB-13 |
| MR-026 | Hard Stop can interrupt the Codex turn while a yielded local process continues running | Confirmed provider blocker | G | STAB-12 |
| MR-027 | Deterministic renderer coverage exists for request families that the real development path cannot deliberately trigger | Qualification architecture gap | H/E | STAB-09 |
| MR-028 | Current implementation-status source claims overstate live recovery/handoff qualification relative to development-app evidence | Documentation/status defect | H | STAB-01 |
| MR-029 | Repository verify is nondeterministic on a docs-only branch: separate runs failed in different process-backed tests while repository checks, typecheck and build passed | Qualification-infrastructure defect | H | STAB-14 |

## Cross-stage consolidations

- **MR-001, MR-002, MR-003, MR-020, MR-022 and part of MR-023** share the Task/Runtime/Codex authority-convergence boundary.
- **MR-009 and MR-024** are one customer execution-state model problem, exposed in different acceptance stages.
- **MR-007, MR-008 and MR-011** are one approval-policy/decision-contract family, not three renderer fixes.
- **MR-012 through MR-015 and MR-027** are primarily live capability/fixture reachability until provider behavior proves a product defect.
- **MR-017 through MR-019 and MR-021** remain browser/surface UX work after exact authority is repaired.
- **MR-026** remains separate from ordinary Task state because provider turn interruption does not prove process death.

## Source-boundary observations from STAB-01

1. `codex-thread-truth-reconciler.ts` passes `this.runtime.getControlStatus` as a callback during historical completed-handoff reconstruction without binding the runtime object. This is a concrete source defect but is not assumed to explain every recovery failure.
2. `main.ts` runs the session surface monitor approximately every 750 ms. A failed inspection clears its signal key but has no backoff/circuit policy.
3. `customer-task-execution.ts` marks a segment terminal whenever it has no open customer-active interval, even when the overall execution projection is waiting/checking/human-controlled rather than authoritatively terminal.
4. Task policy stores `approvalPolicy: "on-request"` for both customer reviewer choices while `approvalsReviewer` varies separately. The current labels **Always ask** and **Approve for me** therefore require explicit contract verification before UI patching.
5. The pinned App Server schema can express command decisions beyond generic accept/decline, including `acceptForSession` and policy amendments. Rove's customer collaboration model reduces approval actions to a smaller decision vocabulary and labels acceptance generically as Approve.
6. `attention.ts` recognizes the intended request families; network approval classification depends on App Server actually supplying `networkApprovalContext`.
7. Task-scoped MCP already has capability scoping that prevents creation/addressing of another session, providing a foundation for STAB-02 rather than requiring a new browser architecture.
8. `main.ts` intentionally closes the full Rove surface when the owned browser is foregrounded. The black/full-surface symptom therefore belongs to surface coordination.
9. `unmatchedRuntimeSession` is computed from the global Companion snapshot versus all projected Tasks. Presentation must not visually transfer one unmatched resource to whichever Task happens to be selected.
10. Upstream Codex issue #42717 remains open as of 26 September 2026, and current upstream `ProcessEntry` still lacks owning-turn identity. No current release is accepted as solving MR-026.
11. STAB-01 PR qualification exposed a separate release-signal problem: the first docs-only verify run failed Runtime integration cleanup with `ENOTEMPTY`, while the rerun failed a TaskEngine process-cut handoff case with `Task is not ready for a handoff`. Repository checks, typecheck and build passed in both attempts. Because the code delta is documentation-only and the failures differ, the suite itself is currently not a deterministic market gate; STAB-14 owns that qualification-infrastructure defect rather than hiding it.

## Preserved passes / explicit non-issues

- background attention remained bound to the owning Task and did not steal selection;
- returning to that Task restored the same request without duplication;
- one accepted command approval produced one visible operation/result;
- direct browser work submitted from unmaterialized New Task can create the Task and automatically launch the configured browser;
- New Task does not need a Browser panel before materialization;
- expected `about:blank` in the constrained Companion test is not a defect;
- auto-reviewed reserved-domain network work settling normally does not qualify or invalidate the manual network approval family;
- the ambiguous initial "propose file change and wait" attempt is not classified as an approval-rendering defect.

## Open questions owned by later tickets

STAB-01 deliberately does not answer these by guess:

- which exact Runtime configuration field produced INVALID_CONFIGURATION;
- whether every persisted recovery failure shares the unbound callback cause;
- what the market meaning of **Always ask** is and which App Server policy/configuration enforces it;
- which current provider version can deliberately emit every attention family;
- whether current/newer Codex provides an exact process-cancel/exit proof suitable for hard Stop;
- whether existing-Task profile recovery should mutate launch configuration or require an explicit fresh Task.
