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

### ROVE-STAB-02 — IN PROGRESS — READ-ONLY DIAGNOSIS

**Inherited checkpoint:** STAB-01 merge `0ed941ce1b2f4fd734d2f56aeb136813cbee41d6` plus continuity-process merge `ed156afd0c2874927900279900165b6cae160650`.  
**Exact ticket start SHA:** `ed156afd0c2874927900279900165b6cae160650`  
**Start worktree state:** local `main`, clean, exactly aligned to `origin/main` after a fast-forward from `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`.  
**Local editor state:** untracked `.vscode/mcp.json` was preserved unchanged and locally excluded through `.git/info/exclude`; it is not tracked by remote main.

**Reproduction availability:** original acceptance home `/private/tmp/rove-stage2.NZ9umP` was confirmed present and inactive, size about 208 MB.  
**Preserved snapshot:** `/private/tmp/rove-stage2-stab02-baseline` created with `cp -a`, about 207 MB and 3,256 files.  
**Authority stores observed in snapshot:** four Runtime bootstrap claims, four Runtime session records, and `codex-product/task-process.v1.sqlite3`.  
**Analysis DB:** `/private/tmp/rove-stage2-stab02-analysis/task-process.v1.sqlite3`, SHA-256 `f0e12e240c0017144165dd9a6b2aa03af0df0a4d692bc56d17a30950cae2b5a0`.  
**Diagnostic command issue:** the first `sqlite3 -readonly` integrity invocation failed with SQLite error 14 (`unable to open database file`). This is a diagnostic-tool/open-mode issue against the analysis copy, not yet a product defect and not evidence that the preserved source fixture is corrupt. No product source was modified.

Required reading:

- `docs/Planning/market-readiness-stabilization-sprint.md`
- this continuity ledger;
- `ROVE-STAB-01-issue-registry-and-reproduction-baseline.md`;
- `ROVE-STAB-02-task-runtime-codex-authority-convergence.md`;
- `issue-registry.md`;
- `acceptance-baseline-2026-09-26.md`;
- corrected `docs/Engineering/implementation-status.md`;
- responsible Product/Engineering authority documents routed by the Rove engineering skill.

The entry gate is satisfied. Continue read-only diagnosis from the preserved snapshot. Do not modify production source until the Task → Codex → Runtime → browser/handoff authority chain has been traced and the first divergence identified.

#### Read-only authority evidence — persisted snapshot

The preserved TaskEngine database opens cleanly from a disposable copy: SQLite integrity check is `ok`, foreign-key check reports no violations, and 16 Task aggregates are present.

A cross-store trace established:

- every one of the 16 persisted Task aggregates currently carries `recoveryRequired = "Persisted task workspace is outside the protected per-task root and requires explicit recovery."`;
- each Task's Codex thread identity remains exact and `threadExists: true` with an exact `threadSource = rove:<taskId>:<bootstrapId>`;
- four persisted Runtime sessions exist and exactly match four Task launch bootstrap IDs:
  - `boot_4740... → ses_60f8... → task_04f5...` (Agent, completed);
  - `boot_79e9... → ses_19f5... → task_52d8...` (Agent, completed);
  - `boot_c351... → ses_da04... → task_b362...` (Agent, `awaiting_human`, controller null, active handoff generation 2);
  - `boot_4216... → ses_fa53... → task_350f...` (Companion, active, controller agent);
- `task_b362...` persists the exact Runtime session ID `ses_da04...` in `record.identity.sessionId`, while `task_350f...` has no persisted Runtime session ID even though its bootstrap ID exactly identifies active Runtime session `ses_fa53...`;
- the Task aggregate Runtime truth for the four browser-associated Tasks is `availability: unavailable`, `bootstrapLookup: unknown`, `status/attachment: unknown` even though Runtime session files are present in the same product home;
- bootstrap-claim JSON files are creation receipts, not current session truth: they still show `status: starting`, controller agent, ownership generation 1 while the corresponding session records have advanced to completed/awaiting_human/active and later generations.

This narrows the investigation but does not yet establish the first causal divergence. In particular, the global persisted-workspace recovery blocker may mask later Runtime/Codex recovery behavior, and the Companion missing-session-ID case must be traced through TaskEngine events before deciding whether session binding failed or was never required/persisted in that path.

#### Source observations added after the persisted trace

Current source explains two important facts:

- `SqliteTaskEngineStore.migratePersistedSchema()` sets the exact global recovery message when a persisted `launch.cwd` is not equal to `<taskWorkspaceRoot>/<taskId>`. The actual persisted `launch.cwd` values still need to be compared with the expected root before classifying this as a compatibility migration defect.
- Runtime `listSessionInventory()` reads current `session.json` records, while bootstrap claims are not the inventory source. Therefore stale bootstrap-claim status is expected creation-receipt behavior and is not itself the authority defect.

Next read-only gate: inspect persisted `launch.cwd`, archive/visibility state, Codex recovery blockers, and the TaskEngine event history for `task_b362...` and `task_350f...` to determine (a) why all Tasks received the workspace blocker, and (b) where Runtime session binding diverged between requested Agent handoff and successful Companion browser use.

#### Root causes established before implementation

The next read-only trace established three concrete authority defects:

1. **Workspace identity false negative (MR-030).** Every persisted Task stores `launch.cwd` under `/tmp/rove-stage2.NZ9umP/task-workspaces/<taskId>`, while the current Desktop home resolves from the qualification override as `/private/tmp/rove-stage2.NZ9umP`. The persisted-schema migration compares `path.resolve(launch.cwd)` with `path.resolve(taskWorkspaceRoot/taskId)`, which is lexical and does not resolve filesystem aliases/symlinks. On this macOS fixture, this marks all 16 Tasks as outside the protected root even though `/tmp` and `/private/tmp` refer to the same underlying temporary hierarchy. All 16 customer projections therefore enter `recovering`; most lose all allowed actions. This is the first deterministic startup divergence in the preserved fixture and masks the separate Codex blocker string.

2. **Requested Agent handoff history reconstruction loses Runtime method binding (MR-003 / MR-020).** For `task_b362...`, Runtime was durably bound to `ses_da04...`, progressed to active Agent control, and then exposed handoff `handoff_2de8...` generation 2. Eight milliseconds later, the live `item/completed` path recorded a `TypeError` and scheduled thread-history reconciliation. All three reconciliation attempts then remained unresolved. Source passes `this.runtime.getControlStatus` as an unbound callback; `CompanionRuntimeClient.getControlStatus()` dereferences `this.request`. This directly explains the TypeError on completed handoff material and prevents reconstruction/acknowledgement of the exact requested handoff.

3. **Lazy Companion browser attachment failed to converge through the existing Runtime-observation bind path (MR-022 / authority part of MR-023).** `task_350f...` launched as Companion without Runtime and therefore correctly has no `bind_runtime_identity` command in its initial bootstrap history. A later Runtime session `ses_fa53...` exists with the Task's exact bootstrap ID and active Agent controller, proving browser work occurred, but the Task has no `runtime_inventory_observed` event at all and `record.identity.sessionId` remains absent. Source review shows the lifecycle reducer already emits `bind_runtime_identity` when an open Task observes one Runtime session while `record.identity.sessionId` is absent. Therefore the missing durable bind is downstream of a missing Runtime observation, not an absent lifecycle transition. `resolveTaskRuntimeControlAuthority()` then correctly refuses control because the durable bind never occurred. The next diagnosis must determine why Runtime polling never published the exact bootstrap-correlated session for this Task; do not add a second ad-hoc binding path.

The startup Codex side remains independently unhealthy: every persisted Task has one `thread_history_reconstructible` blocker and repeated startup retries. The workspace blocker hides that string in the customer projection. STAB-02 will correct the authority defects above; STAB-03 remains responsible for bounded blocker lifecycle/clearing semantics after exact authority can be reconstructed.

Filesystem identity verification is complete: `/tmp` is a symlink to `private/tmp`; Python `samefile()` confirms the acceptance homes are the same inode/device; Node `path.resolve()` incorrectly treats them as different while `realpathSync.native()` resolves both to `/private/tmp/rove-stage2.NZ9umP`. All 16/16 persisted Task workspaces are the same filesystem objects as their expected `/private/tmp/.../task-workspaces/<taskId>` paths. Therefore MR-030 is confirmed as a lexical-path authority false negative rather than a genuine workspace escape.

Workspace and requested-handoff implementation may begin after their focused test design is fixed. The Companion Runtime-binding symptom still requires one more read-only trace because the canonical lifecycle already contains the durable bind transition; adding another bind path would duplicate authority. Preserve the security invariant that canonicalized Task workspaces must still resolve inside the canonicalized protected task-workspace root.

#### Runtime-poll starvation evidence

A full projection-order trace shows the production store iterates Tasks in projection row order. Runtime inventory observations exist for rows 1–11 only; `task_b362...` is row 11 and is the last Task ever to receive a Runtime inventory observation. Rows 12–16, including `task_350f...`, have none. The Companion Runtime session `ses_fa53...` was durably created at 10:18:22.628Z and updated at 10:18:22.823Z, while its Task continued to receive Codex events through 10:18:32.361Z, yet no Runtime inventory event was accepted for that Task.

Current `pollRuntimeTruth()` reads one Runtime inventory and then processes every Task inside one outer `try`; any per-Task `getControlStatus` or ingress failure aborts the remainder of that poll. This makes one earlier Task capable of starving all later Task authority convergence. The preserved ordering strongly localizes the starvation boundary to `task_b362...`, the first nonterminal Runtime-bound Task before rows 12–16.

This establishes the starvation mechanism but not yet the exact exception at row 11. Before changing code, inspect `ses_da04...` Runtime observation sequence and the last accepted TaskEngine Runtime source coordinate. A repeated source coordinate with changed Runtime truth would prove the likely event-identity collision; otherwise route generic per-Task Runtime read containment to STAB-04 rather than duplicating it in STAB-02.

## Future ticket rows

ROVE-STAB-03 through ROVE-STAB-14 receive concrete entry state when their direct dependencies complete. Their existing ticket text is provisional sequencing, not frozen implementation truth.
