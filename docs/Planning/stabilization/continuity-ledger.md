# Stabilization Continuity Ledger

**Role:** Durable ticket-to-ticket continuation state for the single Rove Market-Readiness Stabilization Sprint.  
**Authority:** Current repository/runtime truth and canonical Product/Engineering contracts remain authoritative.  
**Rule:** This ledger is continuation state, not a substitute for a read-only baseline.

## How to use this ledger

At the start of every stabilization ticket:

1. run `pnpm codex:context`;
2. confirm repository root, intended branch/worktree, exact HEAD, status, and upstream alignment;
3. read this ledger, the current ticket, and every directly upstream completed ticket named by its entry contract;
4. inspect current source, schemas, persisted reproduction state, and provider/runtime facts relevant to the ticket;
5. reconcile any difference between current truth and the prior handoff before editing;
6. record the exact ticket start SHA in this ledger.

At the end of every stabilization ticket:

1. record the exact ticket commit, PR, merge SHA, and ending `main`;
2. record findings closed/narrowed/new, root cause, disproved hypotheses, invariant established, files/contracts changed, migrations/compatibility consequences, and verification;
3. record real-boundary evidence and any flakiness or unqualified path;
4. record preserved reproduction state and residual blockers;
5. update every directly dependent ticket whose entry assumptions changed;
6. record the exact next stop point and next gate.

A ticket is not complete until this handoff exists.

## Current chain

### ROVE-STAB-01 — COMPLETE

**Purpose:** issue registry and reproduction baseline.

**Entry product baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`  
**Planning PR:** #35  
**Merged main checkpoint:** `0ed941ce1b2f4fd734d2f56aeb136813cbee41d6`  
**Production source changed:** no

#### Established state

- One market-readiness stabilization sprint with ROVE-STAB-01 through ROVE-STAB-14.
- Canonical issue registry MR-001 through MR-029.
- Cross-stage symptoms consolidated into authority, Runtime resilience, execution-state, approval, attention reachability, browser/surface, hard-Stop, and qualification families.
- Confirmed defects remain distinct from live qualification gaps and preserved non-issues.
- Implementation Status was narrowed where human development-app evidence contradicted stronger source-level qualification language.
- Hard Stop remains an explicit provider/architecture blocker rather than a UI settlement problem.
- CI nondeterminism observed during the docs-only planning PR is retained as MR-029 even though the final PR head passed.

#### Source facts carried forward

- Historical completed-handoff reconstruction passes Runtime `getControlStatus` as an unbound method reference. This is a concrete defect, **not yet proof** that it explains every affected Task.
- The desktop session-surface monitor polls on an approximately 750 ms cadence and lacks a proper permanent-vs-transient failure/backoff boundary.
- Customer work-segment terminality is currently inferred from absence of an open customer-active interval, which can make waiting/checking work look terminal.
- Frozen Task policy currently fixes provider `approvalPolicy: "on-request"` while the customer chooses `approvalsReviewer`; the visible policy labels therefore require explicit contract verification.
- The pinned App Server schema exposes richer approval decisions than Rove's current customer collaboration decision vocabulary.
- Attention classification already recognizes the intended families; live provider emission is the missing proof for several families.
- Task-scoped MCP capability enforcement already prevents a task-bound MCP process from addressing/creating another Task's Runtime session and should be treated as a foundation, not replaced casually.
- The full Rove surface is intentionally closed when the owned browser is foregrounded; the resulting black/blank experience is therefore a surface-coordination problem, not random CSS.
- Unmatched Runtime-session detection is global; customer presentation must not visually assign that resource to arbitrary current Task selection.
- Upstream Codex issue #42717 remains open as of 26 September 2026; no candidate release is qualified as providing exact hard-Stop process termination.

#### Preserved reproduction/evidence state

- Original persistent acceptance home was identified as `/private/tmp/rove-stage2.NZ9umP`. It is a local temporary path: **do not assume it still exists**. If present, copy/preserve it before mutation. If absent, reconstruct a safe reproduction from the durable acceptance evidence; do not fabricate prior state.
- Acceptance evidence filenames/hashes are recorded in `acceptance-baseline-2026-09-26.md`.
- A separate local Stop investigation was previously preserved as branch `codex/stop-process-cancellation-blocker`, commit `2723642`. It may not exist on the remote. Do not overwrite or publish it accidentally; STAB-12 owns whether any of it becomes relevant.

#### Residual questions

- Which exact Runtime configuration field caused `INVALID_CONFIGURATION`?
- Do all persisted recovery failures share the unbound callback cause?
- What exact provider configuration enforces Rove's intended **Always ask** semantics?
- Which provider versions can deliberately emit each attention family?
- Will Codex expose exact process cancellation/exit proof, or does Rove need a different execution-ownership architecture?
- What is the correct existing-Task recovery when a browser profile is created after that Task's launch configuration was frozen?

#### Handoff to ROVE-STAB-02

STAB-02 owns MR-001, MR-003, MR-020, MR-022, and the authority portion of MR-023.

Its first gate is read-only: trace at least one affected Task across Task record → bootstrap identity → Codex thread/session → Runtime inventory/session → browser attachment → handoff/control generation, and identify the first point where live/persisted authority diverges.

Do **not** begin with a patch for the unbound callback. Reproduce and trace the entire authority chain first.

### ROVE-STAB-02 — READY, NOT STARTED

**Inherited checkpoint:** STAB-01 merge `0ed941ce1b2f4fd734d2f56aeb136813cbee41d6` plus this continuity-process change once merged.  
**Exact implementation start SHA:** to be recorded immediately before STAB-02 production work after `pnpm codex:context`.

Required reading:

- `docs/Planning/market-readiness-stabilization-sprint.md`
- this continuity ledger;
- `ROVE-STAB-01-issue-registry-and-reproduction-baseline.md`;
- `ROVE-STAB-02-task-runtime-codex-authority-convergence.md`;
- `issue-registry.md`;
- `acceptance-baseline-2026-09-26.md`;
- corrected `docs/Engineering/implementation-status.md`;
- responsible Product/Engineering authority documents routed by the Rove engineering skill.

**Do not mark STAB-02 in progress until the exact current-main start SHA and reproduction availability are recorded here.**

## Future ticket rows

ROVE-STAB-03 through ROVE-STAB-14 receive concrete entry state when their direct dependencies complete. Their existing ticket text is provisional sequencing, not frozen implementation truth.
