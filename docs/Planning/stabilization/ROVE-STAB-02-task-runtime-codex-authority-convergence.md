# ROVE-STAB-02 — Task / Runtime / Codex authority convergence

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete

**Dependencies:** STAB-01  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Consume STAB-01 before any new investigation:

- STAB-01 merge checkpoint: `0ed941ce1b2f4fd734d2f56aeb136813cbee41d6`;
- [issue-registry.md](issue-registry.md), especially MR-001, MR-003, MR-020, MR-022, and the authority portion of MR-023;
- [acceptance-baseline-2026-09-26.md](acceptance-baseline-2026-09-26.md);
- the STAB-01 source-boundary observations and preserved passes/non-issues;
- the corrected live qualification status in Implementation Status;
- the persistent acceptance reproduction state, if still available, without mutating it before a safe copy/reproduction is established.

STAB-01 established one concrete source defect—historical handoff reconstruction passes `getControlStatus` without preserving object binding—but explicitly did **not** establish that this explains every recovery/authority failure. Do not collapse the investigation to that one fix.

The exact implementation baseline is **not** the original planning baseline. At ticket start, run `pnpm codex:context`, reconcile current `main`/worktree against the continuity ledger, and record the exact start SHA before editing.

### Established ticket start state

- exact start SHA: `ed156afd0c2874927900279900165b6cae160650`;
- local main aligned and clean at ticket start;
- original acceptance home confirmed present/inactive and copied to `/private/tmp/rove-stage2-stab02-baseline`;
- analysis SQLite backup created at `/private/tmp/rove-stage2-stab02-analysis/task-process.v1.sqlite3`, SHA-256 `f0e12e240c0017144165dd9a6b2aa03af0df0a4d692bc56d17a30950cae2b5a0`;
- four persisted Runtime session records and four bootstrap claims are available for the authority trace;
- initial SQLite read-only CLI open failed with error 14 against the analysis copy; this is being diagnosed without touching product source or the preserved fixture.

### First gate

Before production edits, produce a read-only authority trace for at least one affected Task covering Task record → bootstrap identity → Codex thread/session → Runtime inventory/session → browser attachment → handoff/control generation, and identify where the live/persisted chain diverges.

## Invariant

For every open Task, Rove can prove the exact Codex thread and Runtime session/browser authority it owns, or prove that no such resource exists. Live work, restart, history reconstruction, browser launch and handoff cannot silently change that binding.

## Owns

MR-001, MR-003, MR-020, MR-022, MR-030 and the authority portion of MR-023.

## Read-only diagnosis first

- Reproduce persisted Checking State from the preserved home.
- Trace Task record identity, bootstrap ID, Codex thread/session, Runtime inventory receipt, task capability scope, browser attachment and handoff generation.
- Verify the concrete unbound `getControlStatus` callback failure and audit similar method-reference boundaries.
- Explain why a successful task-scoped MCP browser run can cease to be resolvable through the Task projection before changing code.

## Diagnosis conclusions before implementation

The preserved fixture has established three implementation roots within this ticket:

- persisted workspace authority uses lexical path equality and falsely rejects the macOS `/tmp` ↔ `/private/tmp` alias;
- completed requested-handoff reconstruction passes Runtime `getControlStatus` without its owning object binding, producing the observed TypeError and unresolved thread-history repair;
- the Companion Task never received a `runtime_inventory_observed` event after its exact bootstrap-correlated Runtime session appeared; the existing lifecycle already knows how to emit `bind_runtime_identity` from such an observation, so the remaining defect is observation/convergence delivery rather than absence of a bind transition.

These conclusions are evidence-backed. Filesystem proof additionally confirmed `/tmp` → `/private/tmp`, identical device/inode for the acceptance home, Node lexical inequality but canonical realpath equality, and 16/16 persisted workspaces resolving to the same filesystem objects as their expected per-Task paths. A projection-order trace also established a Runtime-poll starvation boundary: runtime observations stop at projection row 11 (`task_b362...`), while rows 12–16 receive none even after the Companion Runtime session is created. The poll currently aborts the entire Task loop on one per-Task failure. One final trace must identify the exact row-11 exception before assigning the fix between STAB-02 event identity and STAB-04 generic failure containment. Implementation must still preserve the original security intent: path equivalence must not authorize a workspace that resolves outside the canonical protected per-Task root.

## Implementation gate — open

Read-only diagnosis is complete. The preserved fixture proves:

- MR-030 is a canonical-filesystem identity false negative;
- the requested Agent handoff reconstruction TypeError is caused by an unbound Runtime client method;
- the Companion authority loss is caused by a Runtime inventory event source-coordinate collision at the preceding Agent Task, which aborts the poll before later Tasks can observe and durably bind their exact bootstrap-correlated Runtime sessions.

Implementation may now proceed. Do not broaden STAB-02 into STAB-04's general Runtime failure taxonomy/backoff work.

## Acceptance criteria

- Exact Task ↔ Runtime session ↔ Codex thread binding survives browser use and restart.
- Historical reconstruction cannot call Runtime with lost object binding.
- One Runtime session cannot be adopted by the wrong Task from UI selection/current-session heuristics.
- A Companion browser that successfully ran cannot project **No browser attached** unless authoritative detach/termination evidence exists.
- Requested Agent handoff material binds to the same Task/session/generation later used for takeover.
- Stale/cross-Task authority fails closed without corrupting another Task.

## Verification

Focused identity/reconciler tests → task-runtime control-authority tests → SQLite restart → real Runtime browser session in Agent and Companion → original authority-loss E2E.

Checkpoint before STAB-03.

## Implementation checkpoint

Production implementation is checkpointed at `6758dfb3b47138670e498e6f99c290d1ea919956` on `codex/stab02-authority-convergence`.

The durable handoff is `c7a4230fada5917d1a91710fd332466c637af538`. The branch is pushed against `main`; GitHub PR creation was attempted and refused because the authenticated account is not a collaborator. No PR was created or merged, and downstream work continues as an explicit stacked branch from the final STAB-02 head.

- persisted Task workspace migration proves canonical filesystem identity for the exact protected per-Task directory and remains fail-closed for outside, escaped, and unresolved paths;
- historical completed-handoff reconstruction preserves Runtime client method binding;
- Runtime inventory events use a Rove-owned monotonic transport position per Runtime host generation, skip unchanged complete truth, and no longer reuse a TaskEngine source coordinate when provider `observationSeq` is unchanged;
- exact bootstrap-correlated later Tasks can therefore reach the existing `bind_runtime_identity` lifecycle path without adding a Companion-specific authority mechanism.

Focused/affected companion tests, the recovery contract, process-backed recovery, repository checks, typecheck, build, the complete 1,708-test suite, and experiment tests passed. A disposable copy of the preserved 16-Task database cleared all 16 false workspace blockers; its remaining Codex blockers correctly carry into STAB-03. No live provider, credentialed service, packaged app, or human acceptance was claimed.

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
