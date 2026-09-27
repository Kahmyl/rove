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
- Resolved by STAB-07: the intended provider mapping is `on-request` plus the writable `rove_task` profile and reviewer `user`; the truthful customer label is **Ask for approval**, not the retired **Always ask** wording.
- Which provider versions can deliberately emit each attention family?
- Will Codex expose exact process cancellation/exit proof, or does Rove need a different execution-ownership architecture?
- What is the correct existing-Task recovery when a browser profile is created after that Task's launch configuration was frozen?

#### Handoff to ROVE-STAB-02

STAB-02 owns MR-001, MR-003, MR-020, MR-022, and the authority portion of MR-023.

Its first gate is read-only: trace at least one affected Task across Task record → bootstrap identity → Codex thread/session → Runtime inventory/session → browser attachment → handoff/control generation, and identify the first point where live/persisted authority diverges.

Do **not** begin with a patch for the unbound callback. Reproduce and trace the entire authority chain first.

### ROVE-STAB-02 — COMPLETE

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

**Implementation checkpoint:** `6758dfb3b47138670e498e6f99c290d1ea919956` (`Converge persisted task runtime authority`).
**Branch:** `codex/stab02-authority-convergence`.
**Handoff commit:** `c7a4230fada5917d1a91710fd332466c637af538` (`Record STAB-02 authority handoff`).
**PR:** not created. `gh pr create --base main --head codex/stab02-authority-convergence` failed with `GraphQL: must be a collaborator (createPullRequest)`. The branch is pushed to `origin`; no PR was merged.

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

#### Final read-only proof — Runtime source-coordinate collision

The row-11 exception is now proven.

For `task_b362...` / `ses_da04...`:

- Runtime session state is `awaiting_human`, controller null, ownership generation 2, handoff generation 2.
- The persisted observation log ends at sequence 2 (`human_requested`).
- The last accepted TaskEngine Runtime event also uses source `inventory:ses_da04...`, generation 1, position 2, but carries the immediately earlier control truth `status: active`, controller `agent`, handoff generation 2.
- The candidate next poll uses the **same source coordinate** generation 1 / position 2 while carrying different Runtime truth: `awaiting_human` / controller null.
- TaskEngine correctly rejects a reused source coordinate whose content digest changed.

Current `pollRuntimeTruth()` derives event source position from `control.observationSeq ?? 1`. Here `getControlStatus()` obtains `observationSeq` from the latest persisted Runtime observation, so the session/control state change to `awaiting_human` did not receive a new observation sequence beyond the already-persisted `human_requested` observation. The poll therefore attempts to publish two different authority states at the same idempotency coordinate. The rejection occurs while processing projection row 11 and aborts the outer poll, starving rows 12–16, including the Companion Task, from Runtime observation and durable binding.

This closes the read-only diagnosis gate. STAB-02 implementation can begin.

Implementation ownership is now:

1. canonical filesystem identity for persisted Task workspace authority (MR-030);
2. bound Runtime control-status callback for completed handoff reconstruction (MR-003 / MR-020);
3. Runtime inventory observation identity that cannot reuse one TaskEngine source coordinate for changed truth, plus STAB-02-local proof that later Tasks are not starved by the row-11 transition (MR-031 / MR-022 authority path).

Generic Runtime transport/backoff/failure-domain hardening beyond the source-coordinate defect remains STAB-04.

#### Implemented invariant and disposition

- Persisted workspace authority now canonicalizes the protected root, exact per-Task directory, and persisted cwd through the filesystem. It accepts an alias only when all resolve to the exact protected child and fails closed for outside paths, symlink escapes, and missing/unresolvable paths. The migration clears only its own exact false-negative blocker after authority is proved.
- Historical request-human reconstruction now passes a Runtime control-status callback bound to the exact Runtime client instance. A regression Runtime whose method calls `this.request()` proves the production failure mode is closed.
- Runtime inventory transport now owns a monotonic position within each durable Runtime host generation rather than borrowing the provider domain's `observationSeq`. An unchanged complete Runtime truth is skipped; changed truth receives a new TaskEngine source coordinate even when `observationSeq` is unchanged. TaskEngine's conflicting-coordinate rejection remains unchanged and strict.
- MR-003, MR-030, and the authority/event-identity portion of MR-031 are closed by executable evidence.
- MR-001 is narrowed: the workspace blocker is removed, while exact Codex recovery blocker clearing and bounded terminal recovery remain STAB-03.
- MR-020 and MR-022 are narrowed at their authority roots. Exact handoff reconstruction and later-task Runtime convergence are repaired; real Agent/Companion browser takeover and return remain STAB-10 qualification.
- The authority portion of MR-023 is repaired. Customer-safe browser recovery/presentation remains STAB-10/STAB-11.

#### Changed boundaries and compatibility

- Production: `sqlite-task-engine-store.ts`, `codex-thread-truth-reconciler.ts`, and `execution-core.ts`.
- Regression coverage: the matching persisted-store, reconciler, and Runtime-event tests.
- No schema, wire format, provider version, dependency, or migration identity changed.
- Existing TaskEngine duplicate/source-coordinate integrity was not weakened.
- The original acceptance home and preserved baseline were not opened for mutation. A disposable database copy at `/private/tmp/rove-stab02-verify.G1XB1W/task-process.v1.sqlite3` was migrated for qualification only.

#### Verification

- Focused and affected authority/recovery: 116 tests passed across nine companion files.
- Preserved-fixture copy: 16 Tasks loaded; false workspace blockers fell from 16 to 0; all 16 still projected recovery because the independent Codex blocker lifecycle remains for STAB-03.
- `pnpm test:recovery:contract`: 63,417 assertions passed.
- `pnpm test:recovery:processes`: all source-built local recovery scenarios passed; no external services contacted and terminal cleanup reported no stale process, port, profile lock, browser, Runtime session, or cleanup-required Task.
- `pnpm check:repository`: passed (703 files, 1,293 relative imports, 107 local document links before this handoff edit).
- `pnpm typecheck`: passed.
- `pnpm build`: passed through the process-recovery qualification.
- `pnpm test`: 200 files and 1,708 tests passed after rerunning outside the restricted loopback sandbox. The first sandboxed attempt failed only because local IPC/browser fixture binds were denied.
- `pnpm test:experiments`: 24 tests passed.

#### Residual gaps and handoff

- No live model, credentialed provider, original acceptance-home relaunch, packaged application, or human acceptance was run. Those evidence classes remain explicitly unqualified.
- The preserved acceptance home still contains exact `thread_history_reconstructible` blockers. STAB-03 owns why exact later success does not clear the matching older blocker, bounded retry/terminal recovery, preserved safe controls, and multi-Task isolation.
- STAB-04 still owns generic Runtime permanent/transient failure classification, per-Task failure containment, backoff, observability, and amplification prevention; it must preserve the STAB-02 transport identity.
- Exact next stop point: push this PR-tooling record, then branch STAB-03 from the resulting exact STAB-02 head. PR creation can be retried later by an authenticated collaborator without rewriting the branch.
- STAB-03 first gate: restart a disposable copy of the preserved database with STAB-02 authority fixes, trace each remaining blocker to its creating and clearing authority, and prove the first stale-success shadow before editing recovery behavior.

### ROVE-STAB-03 — COMPLETE

**Dependency state:** STAB-02 implementation checkpoint `6758dfb3b47138670e498e6f99c290d1ea919956`; consume the final pushed handoff/PR head before editing.

**Exact stacked start SHA:** `af5c1a0de9bcd265b163d493364900f7d7822e04` (final pushed `codex/stab02-authority-convergence` head).

**Branch:** `codex/stab03-recovery-lifecycle`, created directly from that exact head. STAB-02 PR creation remains unavailable to the current GitHub identity; no PR was merged.

**Inherited fixture state:** disposable fixture `/private/tmp/rove-stab03-diagnosis.zPVKhI/task-process.v1.sqlite3` was copied from the preserved STAB-02 baseline and migrated independently. The original acceptance home and preserved baseline remain untouched.

**Owned remaining findings:** MR-001 exact Codex blocker lifecycle and MR-002 stale blocker shadowing.

#### Diagnosis

- all 16 Tasks retained one exact `thread_history_reconstructible` blocker. The ledger held 96 startup scheduled attempts and 32 terminal startup unresolved observations, with no successful reconciliation observation;
- three Tasks also retained an earlier event-delivery failure. Later same-thread item/request traffic did not prove the missed exact history and therefore was correctly rejected as clearing authority;
- MR-002 was reproduced before implementation: newer exact success removed the matching blocker, then a delayed older unresolved diagnostic recreated it because success had no durable ordering watermark;
- persisted blocker/reason normalization was inconsistent: after STAB-02 removed the false workspace reason, typed Codex blockers could coexist with `recoveryRequired: null` until another event happened;
- the preserved fixture also has one independent stale Stop presentation: its historical `interrupt_codex_turn` command succeeded while the requested operation remains `interrupt`. That is not a Codex blocker-lifecycle cause and stays with MR-009/MR-024 in STAB-06.

#### Implemented invariant

- recovery diagnostics expose the attempt and attempt limit; scheduled attempts are active checking and exhausted attempts are terminal unresolved;
- a bounded durable per-blocker success watermark orders delayed diagnostics across restart. Older failure cannot shadow newer exact success, and older success cannot clear newer failure;
- compatibility normalization reconstructs legacy blocker lifecycle and synchronizes the owned recovery reason without overwriting another authority;
- exhausted recovery projects bounded customer-safe inability to confirm, while exact conversation history remains readable and per-Task safe controls remain available;
- blocker identity remains exact. No nearby thread traffic, unrelated Task fact, or customer copy clears it.

#### Files and compatibility

- protocol/reducer: `packages/protocol/src/task-engine.ts`;
- persistence compatibility: `apps/companion/src/main/codex/sqlite-task-engine-store.ts`;
- producers: `codex-thread-truth-reconciler.ts`, `execution-core.ts`;
- customer execution/presentation: `customer-task-execution.ts`, `customer-task-presentation.ts`, `product-task-port.ts`;
- tests cover stale failure after success, stale success after newer failure, active versus exhausted attempts, durable restart watermark, legacy normalization, safe Stop, presentation, exact clearing and unrelated-Task isolation;
- persisted schema version remains 3. All new fields are additive and legacy payloads normalize on read/migration.

#### Verification

- required MR-002 regression was first observed failing;
- affected focused suite: 10 files / 171 tests passed;
- `pnpm test:recovery:contract`: 63,417 assertions passed;
- `pnpm test:recovery:processes`: passed all process/restart scenarios outside the restricted loopback sandbox, contacted no external services, and left no stale local resources;
- disposable preserved SQLite read: 16 synchronized recovery markers; all blockers terminal `unresolved:3/3`; 15 customer states bounded unresolved plus one independent historical Stop state assigned to STAB-06;
- `pnpm check:repository`, `pnpm typecheck`, `pnpm build`, full `pnpm test`, and `pnpm test:experiments` passed;
- no live model, credentialed provider, packaged application, original acceptance-home relaunch, or human acceptance was run.

**Implementation checkpoint:** `75b028e5f4d9336d342396472177cf1f2321fc47` (`Bound recovery lifecycle and stale evidence`).

**Durable handoff checkpoint:** `9480dd48a97d42d76b4586c526c8505780746021` (`Record STAB-03 recovery handoff`), pushed to `origin/codex/stab03-recovery-lifecycle`.

**PR state:** stacked PR creation against `codex/stab02-authority-convergence` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block the next independent ticket.

**MR disposition:** MR-001 is closed for exact Codex blocker lifecycle and bounded terminal recovery; MR-002 is closed. MR-009/MR-024 retain the independent persisted Stop/customer execution-state discrepancy for STAB-06.

**Next handoff:** checkpoint this durable completion record, push `codex/stab03-recovery-lifecycle`, attempt the stacked PR without merging, then branch STAB-04 from the exact final STAB-03 head. STAB-04 must preserve the Runtime inventory transport identity from STAB-02 and the bounded recovery/presentation distinction from STAB-03.

**Non-goals:** do not reopen canonical workspace identity, Runtime callback binding, or Runtime inventory transport identity without contradictory evidence; do not absorb STAB-04 failure taxonomy/backoff.

### ROVE-STAB-04 — COMPLETE

**Exact stacked start SHA:** `a76cce8c9b7d703a62d43dc938193b74f6ff02b4` (final pushed `codex/stab03-recovery-lifecycle` head).

**Branch:** `codex/stab04-runtime-failure-containment`; clean at entry. No predecessor PR was merged.

**Inherited invariants:** Runtime inventory owns a monotonic Rove transport coordinate independent of provider observation sequence (STAB-02). Customer recovery distinguishes active bounded checking from exhausted inability to confirm and exact success/failure ordering is durable (STAB-03).

**Owned findings:** MR-004 permanent Runtime configuration failure amplification and MR-005 unbounded polling/unhandled rejection containment.

**Confirmed root cause:** the acceptance catalog stored the managed Chrome directory through `/tmp`, while restarted Runtime derivation used `/private/tmp`. They were the same existing filesystem object, but lexical validation rejected them. Three-mode session fan-out, coupled snapshot reads, 750 ms monitors and incomplete fire-and-forget rejection boundaries amplified the permanent response into fetch failures and process-level unhandled rejections.

**Implemented invariant:** existing managed and legacy directories are authorized by canonical filesystem identity without admitting missing paths or escapes. Runtime dependency health is a single classified circuit: permanent configuration failure probes every 30 seconds, transient failure backs off exponentially from 750 ms to 30 seconds, and one probe is admitted at a time. Local Product history remains publishable with one customer-safe warning; closed-circuit ticks and failed background publication cannot escape as unhandled rejections; a successful probe clears the state and resumes reads.

**Files and compatibility:** `packages/browser/src/profiles/browser-workspace-registry.ts`; `apps/companion/src/main/runtime-client.ts`; `runtime-failure-containment.ts`; `main.ts`; `codex/execution-core.ts`; and the structural Runtime port in `task-coordinator.ts`, plus focused tests. No persistence schema, migration, provider contract, credential, task identity or Runtime inventory coordinate changed.

**Verification:** required regressions failed first. The affected suite passed 9 files / 49 tests including real browser restart and Runtime HTTP integration. Disposable managed-process fixture `/private/tmp/rove-stab04-process.9fBJvP`, invalid-catalog copy SHA-256 `97f063da8cabce602f3115c4e1ee16f3eb5c0f532f37d4b07997c71485f0741d`, proved one request across a 240-call permanent burst, one transport probe across a 120-call outage burst, healthy restart recovery, and zero process-level unhandled rejections. The first full run passed 1,718/1,719 tests and exposed one inherited pre-STAB-03 assertion that expected active Checking after bounded legacy-attention recovery had exhausted; the test was reconciled to the already-established unresolved / `Task state unclear` contract, with no production change. `pnpm check:repository`, `pnpm typecheck`, `pnpm build`, full `pnpm test` (201 files / 1,719 tests), and `pnpm test:experiments` (24 tests) passed.

**Implementation checkpoint:** `078a674cc1d51b479f21e00ba3655b83107abdbd` (`Contain Runtime dependency failures`).

**Durable handoff checkpoint:** `3f96b094354344e9e4c4bf1b2c1dc5c145677b94` (`Record STAB-04 Runtime containment handoff`), pushed to `origin/codex/stab04-runtime-failure-containment`.

**PR state:** stacked PR creation against `codex/stab03-recovery-lifecycle` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-05.

**Finding disposition:** MR-004 and MR-005 are closed. The preserved original acceptance home remains valid and untouched; the disposable fixture is the STAB-05 unavailable/invalid Runtime input.

**Residual boundary:** packaged application relaunch and human-visible startup qualification remain unrun. STAB-05 owns coherent first hydration and presentation of this established degraded state; it must not add a new Runtime retry taxonomy or hide local conversation history behind Runtime recovery.

**Next handoff:** push this PR-tooling record, then branch STAB-05 from the resulting exact final STAB-04 head. STAB-05 must preserve the bounded recovery and Runtime degraded-state contracts while making first local hydration coherent.

**Non-goals:** do not change Task/Runtime identity, invent another recovery model, or reinterpret all transport errors as the retained configuration failure.

### ROVE-STAB-05 — COMPLETE

**Exact stacked start SHA:** `d642822d0a00516ff32fec86d2fdfd35e5cbf6b9` (final pushed `codex/stab04-runtime-failure-containment` head).

**Branch:** `codex/stab05-startup-hydration`; clean at entry. No predecessor PR was merged.

**Inherited invariants:** STAB-03 distinguishes active bounded checking from exhausted `Task state unclear`; STAB-04 preserves local Product truth behind one classified Runtime degraded state and customer-safe warning.

**Owned finding:** MR-006 initial hydration coherence and presentation of the established STAB-03/04 states. MR-006 is closed.

**Confirmed root cause:** `startDesktop()` awaited the complete Codex execution-core startup path before IPC registration and native surface presentation. Independently, `desktop === null` rendered the full empty shell and a coherent product-null/error-null envelope was misclassified as startup failure. Existing non-null Product snapshots already carried the correct STAB-03 per-Task and STAB-04 Runtime states; no new recovery state was needed.

**Implemented invariant:** Desktop IPC and the native surface are presented before awaited provider startup. Null and coherent product-null/error-null snapshots render only centered neutral hydration; initial IPC failure becomes one bounded retry surface. Once coherent local Product truth exists, persisted conversation and Task-owned recovery render immediately, unrelated Tasks remain interactive, and exactly the established customer-safe Runtime warning may appear without leaking internal diagnostics or changing Task state.

**Files and compatibility:** startup ordering in `apps/companion/src/main/main.ts`; hydration classification and rendering in `product-surface-state.ts`, `product-surface.tsx`, and `styles.css`; focused renderer/architecture tests; credential-free Electron qualification entry and experiment. No schema, migration, provider-version contract, Runtime retry taxonomy, Task identity, or recovery authority changed. Qualification sources remain excluded from packaged application files by the existing package rule.

**Verification:** required renderer regressions failed first, then 3 files / 67 focused tests passed. `node experiments/agent-execution/startup-hydration-qualification.mjs` passed healthy and permanently degraded real built Electron launches over one disposable persisted snapshot; both proved neutral hydration, readable persisted conversation, exact Task-owned `Task state unclear`, and an unrelated interactive Task, while only the degraded launch rendered the safe browser-service warning. The fixture self-deleted and used no credential, model, installed Codex component, external provider, or preserved acceptance state. `pnpm check:repository` passed (708 files, 1,303 relative imports, 107 local document links); `pnpm lint`, `pnpm typecheck`, `pnpm build`, full `pnpm test` (202 files / 1,723 tests), and `pnpm test:experiments` (24 tests) passed.

**Implementation checkpoint:** `a98882d69af44d4b30dbaedc9254d2cc9e7a146e` (`Hydrate local tasks before provider startup`).

**Durable handoff checkpoint:** `35fb6d33ed5312a4ce60ac9dd9dc9da295b31737` (`Record STAB-05 startup hydration handoff`), pushed to `origin/codex/stab05-startup-hydration`.

**PR state:** stacked PR creation against `codex/stab04-runtime-failure-containment` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-06.

**Residual boundary:** packaged-application and human acceptance remain unrun. The preserved original acceptance home and `/private/tmp/rove-stab04-process.9fBJvP` remain untouched and valid. Managed Runtime process health is still an earlier local-service prerequisite; STAB-05 decouples the local Product surface from provider reconciliation and renders already-classified Runtime degradation, rather than inventing a second host-start recovery path.

**Downstream handoff:** STAB-06 must preserve neutral hydration as pre-snapshot-only. Once Product truth exists, its authoritative execution-state changes must remain Task-owned, keep unrelated Tasks interactive, and remain independent of the Runtime warning. Its first gate is the persisted successful-interrupt / still-requested-Stop case already isolated by STAB-03.

**Non-goals:** do not add another recovery state, make provider reconciliation a prerequisite for local conversation readability, or reopen Runtime retry taxonomy.

### ROVE-STAB-06 — COMPLETE

**Exact stacked start SHA:** `e8de4068b23d2c7e5c6feb7b815efb9296e46a93` (final pushed `codex/stab05-startup-hydration` head).

**Branch:** `codex/stab06-authoritative-execution-state`; clean at entry. No predecessor PR was merged.

**Inherited invariants:** STAB-02 exact Task/Runtime/Codex authority, STAB-03 bounded recovery and the isolated stale Stop, and STAB-05's separation between pre-snapshot hydration, Task-owned Product truth and the independent Runtime warning.

**Owned findings:** MR-009 and MR-024, plus the execution-state portion of MR-010. These findings are closed at the local projection, persistence compatibility and rendered customer-journey boundaries.

**Confirmed root causes:** customer work-segment status had only `active` and `terminal`, with terminality inferred from the absence of an open duration interval. That compacted approval waiting, checking, human control and stopping even though their owning work was nonterminal. The working state independently required the same interval, so an authoritative active Codex turn could render as idle/terminal when timing evidence was stale. The preserved STAB-03 Task exposed a separate settlement defect: its succeeded legacy `interrupt_codex_turn` command carried no operation ID, while requested-operation settlement requires the exact operation ID.

**Disproved hypotheses:** the generated lifecycle reducer is not the correct place to add command correlation; it must remain byte-for-byte aligned with its locked oracle. The exact operation ID is therefore bound when TaskEngine assembles the command. The preserved Stop is not evidence that the STAB-03 Codex blocker should be cleared: after Stop compatibility repair, the Task correctly remains `unresolved` from its independent exhausted recovery authority.

**Implemented invariant:** current work derives semantic segment state from authoritative Task/Codex/Runtime/recovery state, not duration bookkeeping. Active, waiting-for-customer, checking, human-control and stopping segments remain expanded; only active work advances duration, while all other nonterminal states freeze it. Prior segments remain terminal and new work does not rewrite their history. Active Codex/bootstrap/message authority projects working even when no interval is open. New interrupt commands carry their exact operation ID. Persisted compatibility clears only an exact legacy requested Stop with a same-Task request event and a succeeded interrupt command recorded at or after that request.

**Files and compatibility:** production changes are in `packages/protocol/src/task-engine.ts`, `apps/companion/src/main/codex/customer-task-execution.ts`, `sqlite-task-engine-store.ts`, and `apps/companion/src/renderer/product-surface.tsx`; focused, renderer and process-backed tests changed beside those boundaries. `experiments/agent-execution/authoritative-execution-state-qualification.mjs` provides the disposable-copy legacy probe. No schema version, migration identity, wire format, provider version, dependency, recovery blocker or Runtime warning contract changed. Existing legacy databases normalize on open; current commands settle through the existing exact operation contract.

**Real-boundary evidence:** both affected process-backed production-composition traces passed, proving approval waiting and browser human control publish nonterminal semantic segments with no active timer. The complete six-trace suite also passed in the full run. A disposable copy of `/private/tmp/rove-stab03-diagnosis.zPVKhI/task-process.v1.sqlite3` repaired Task `task_d7fe2288-bb43-453d-8527-8ac9a60af753` from requested `interrupt` to `observe`, then projected its independent exhausted-recovery state as `unresolved`. The preserved source stayed byte-identical at SHA-256 `a6e215e557d4ae30d07b38e188652eed39ee8f4538bf3937cb04d6498f2badf6` and remains valid.

**Verification:** the focused affected suite passed 5 files / 120 tests; the two selected process traces passed; `pnpm check:repository`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test:experiments` (24 tests) passed. The first full run passed 1,723/1,724 tests and transiently failed the pre-existing `repeatable_read: after_terminal_change_before_observation` process cut because the Task became terminal before its handoff request. The exact case passed immediately on rerun; a clean complete rerun then passed 202 files / 1,724 tests, including all 22 cut-point cases. No assertion or timeout was weakened.

**Implementation checkpoint:** `fac74fb1facd1e5f29ae20afdea03c48fc570dfa` (`Project authoritative customer execution state`).

**Durable handoff checkpoint:** `ebe5b17014cf48d0546e68c4df05191d20383d11` (`Record STAB-06 execution-state handoff`), pushed to `origin/codex/stab06-authoritative-execution-state`.

**PR state:** stacked PR creation against `codex/stab05-startup-hydration` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-07.

**Residual boundary:** no live model, credentialed provider, packaged application or human acceptance was run. STAB-10 now owns the complete browser ownership/return/checking journey and must preserve these semantic segment states; it is no longer blocked on STAB-06. STAB-12 still owns hard process Stop authority beyond customer intent settlement.

**Next handoff:** commit and push this durable record, attempt the stacked PR against `codex/stab05-startup-hydration` without merging, then branch STAB-07 from the exact final STAB-06 head. STAB-07's first gate remains a read-only proof of the effective provider approval configuration and its separation from Rove reviewer choice.

**Non-goals:** do not infer terminality from a frozen timer, clear independent recovery authority while settling Stop, modify the locked generated lifecycle reducer, or absorb browser return-control qualification from STAB-10.

### ROVE-STAB-07 — COMPLETE

**Exact stacked start SHA:** `116cc668ffe9a1bfaeff06d5cae6fb4f117694be` (final pushed `codex/stab06-authoritative-execution-state` head).

**Branch:** `codex/stab07-approval-policy-contract`; clean at entry. No predecessor PR was merged.

**Inherited invariants:** Task launch policy is frozen and provider approval policy is distinct from reviewer choice. Rove consequential-action authorization remains bound to the exact operation, target, content, attachments and scope; it cannot be inferred from a provider permission reviewer.

**Owned findings:** the policy-contract portion of MR-008 and MR-011. MR-011 is closed as a customer-label/provider-contract mismatch rather than an authorization-path bypass. MR-008 is narrowed to the emitted decision and UX fidelity retained by STAB-08.

**Confirmed root cause:** both customer reviewer choices already launched and resumed Codex with provider `approvalPolicy: "on-request"` and the named `rove_task` profile, whose task workspace is writable. Only `approvalsReviewer` changed between `user` and `auto_review`. Provider `on-request` review applies when an operation crosses the sandbox/permission boundary; it is not confirmation before every permitted workspace-local edit. The visible **Always ask** label and “every request” copy therefore overstated the actual and intended behavior.

**Disproved hypothesis:** the observed immediate workspace file mutation did not prove that the provider bypassed a required review. It was inside the frozen writable task profile. A stricter read-only profile or a synthetic React approval card would redefine ordinary Task behavior and conflate provider permission escalation with Rove consequential-action authorization.

**Implemented invariant:** the human-reviewed mode is named **Ask for approval** and maps to `on-request` + reviewer `user` + `rove_task`; **Approve for me** maps to `on-request` + reviewer `auto_review` + the same profile. Both labels truthfully permit in-profile workspace operations. Crossing the permission boundary remains reviewed according to the selected reviewer, while Rove's independent exact-action authorization remains mandatory for consequential external effects. Capture starts no Codex turn and uses neither mode.

**Files and compatibility:** customer copy and assertions changed in `apps/companion/src/renderer/product-surface.tsx` and its tests; the visual qualification selector changed with it. The process-backed request projection and lifecycle trace now assert approval policy, reviewer, named/default profile and workspace write access at both `thread/start` and `thread/resume`. The canonical application contract, implementation status, issue registry and STAB-08 entry state record the mapping. No persistence schema, migration, wire value, named permission profile, sandbox access, provider version, credential or action-authorization policy changed.

**Provider evidence:** the pinned generated App Server schema accepts the existing values. OpenAI's official sandbox documentation defines the ask-for-approval configuration as workspace write plus `on-request` plus reviewer `user`, explains that `on-request` asks only beyond the sandbox, and states that automatic review does not change the sandbox. The credential-free process-backed fake App Server proves Rove emits and preserves the exact configuration at start and resume.

**Verification:** the failing-first renderer assertion rejected the old label. The affected suite passed 4 files / 204 tests, including the new process restart/resume trace; `pnpm test:experiments` passed 24 tests; `pnpm check:repository` passed 709 files, 1,303 relative imports and 107 local document links; `pnpm typecheck` and `pnpm build` passed. A full `pnpm test` run reported no visible assertion failure and completed every displayed test file, including all affected tests, but retained idle Vitest workers without emitting a final summary and was interrupted after the hang; this is recorded under existing MR-029 and is not represented as a pass. No live model, credentialed provider, external-service mutation, packaged application or human acceptance was run.

**Implementation checkpoint:** `4d41f60b0a39d79c35ea0465a0483037390c0f14` (`Align approval policy contract`).

**Durable handoff checkpoint:** `6456056505ea98c3c41f3f9cbd13e5804db6511a` (`Record STAB-07 handoff`), pushed to `origin/codex/stab07-approval-policy-contract`.

**PR state:** stacked PR creation against `codex/stab06-authoritative-execution-state` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-08.

**Residual boundary:** live provider attention emission and exact decision families remain unqualified. STAB-08 owns refusal and exact one-time/session/policy-amendment decision fidelity only for requests the provider actually emits; STAB-09 owns deliberate live reachability. Neither ticket may reopen the frozen policy mapping without contradictory provider evidence.

**Next handoff:** checkpoint and push this durable record, attempt the stacked PR against `codex/stab06-authoritative-execution-state` without merging, then branch STAB-08 from the exact final STAB-07 head. STAB-08 must preserve **Ask for approval** versus **Approve for me**, the common writable `rove_task` sandbox, and the separation between permission review and consequential-action authorization.

**Non-goals:** do not introduce a new approval engine, make every workspace edit require confirmation, weaken the sandbox, infer external-action authority from automatic review, or redesign attention-family reachability in this ticket.

### ROVE-STAB-08 — COMPLETE

**Exact stacked start SHA:** `499378a20338b4ff90b5366cf632e0098f5c48e5` (final pushed `codex/stab07-approval-policy-contract` head).

**Branch:** `codex/stab08-approval-decision-fidelity`; clean at entry. No predecessor PR was merged.

**Inherited invariants:** **Ask for approval** and **Approve for me** both retain provider `on-request` and the writable `rove_task` profile; only the human versus automatic reviewer changes. Permission review remains separate from Rove authorization for consequential external actions. STAB-06 remains the authority for nonterminal/terminal Task presentation.

**Owned findings:** MR-007 and the remaining decision/UX boundary of MR-008. Both are closed for requests that the provider actually emits. Live attention-family emission remains deliberately unqualified and belongs to STAB-09.

**Confirmed root cause:** the pinned App Server schema can advertise six exact command-execution decisions: one-time accept, session accept, decline, cancel, command-policy amendment and network-policy amendment. Rove reduced that ordered set to generic accept/decline controls and labeled acceptance **Approve**, losing refusal, scope and amendment semantics before the response crossed the renderer boundary.

**Disproved hypothesis:** a generic approval vocabulary is not sufficient merely because the provider response schema accepts it. Scope is request-specific authority: Rove may expose session or persistent-policy acceptance only when the exact emitted decision exists. File-change requests do not advertise an available-decision set, so Rove does not infer session scope from the broader response schema.

**Implemented invariant:** an emitted `availableDecisions` list is structurally validated, projected in its original order with exact wire values, and submitted only if it is structurally identical to an offered decision. `accept` is **Approve once**; session acceptance is explicit; decline and cancel remain distinct; policy amendments state the exact command rule or network host/action and persistence consequence before acceptance. Requests without an advertised richer set expose only qualified one-time accept/refusal choices. Once response handling begins, the exact task/request/generation cannot dispatch a duplicate provider response.

**Files and compatibility:** Local Product API version advances from 9 to 10 because `ProductAttentionProjection` replaces the reduced `allowedDecisions` vocabulary with typed `approvalDecisions`, and renderer intents accept the provider decision union. Production changes are in `local-product-api.ts`, `customer-task-collaboration.ts`, `product-surface.tsx` and `styles.css`; matching renderer and deterministic Electron fixtures advance to version 10. The generated App Server schema remains pinned and unchanged. No persistence schema, migration, provider version, sandbox profile, credential, Task identity or consequential-action authorization changed.

**Verification:** the required focused regression failed first against the reduced projection and generic controls. The final focused suite passed 4 files / 207 tests. `pnpm customer-journey:conversation-task` passed in built Electron with 28 screenshots at `artifacts/customer-journeys/conversation-task-rendered-qualification`, proving visible one-time, session, persistent command-policy and decline choices before acceptance. `pnpm test:experiments` passed 24 tests; `pnpm check:repository` passed 709 files, 1,303 relative imports and 107 local document links; `pnpm lint`, `pnpm typecheck` and `pnpm build` passed. A full `pnpm test` run displayed all repository test files without a visible assertion failure, including all affected tests, but again retained idle Vitest workers without a final summary and was interrupted; MR-029 remains the owning runner-exit issue and this run is not represented as a pass.

**Implementation checkpoint:** `54d0ef02e5dd6388dcf85431475ef21d44f9b80f` (`Preserve exact approval decisions`).

**Qualification boundary:** no live model, credentialed provider, external-service mutation, packaged application or human acceptance was run. The Electron journey is a credential-free deterministic rendering qualification, not evidence that a live provider emits each attention family. No preserved acceptance home was mutated.

**Finding disposition:** MR-007 and MR-008 are closed at schema/adapter/collaboration/renderer boundaries. STAB-09 owns deliberate live reachability, emitted-family characterization and actual decision-set evidence; it must preserve exact decisions and must not count the deterministic renderer fixture as live qualification.

**Next handoff:** checkpoint and push this durable record, attempt the stacked PR against `codex/stab07-approval-policy-contract` without merging, then branch STAB-09 from the exact final STAB-08 head. STAB-09's first gate is to distinguish request families the provider can deliberately emit from those that remain unqualified, without reopening the STAB-07 policy mapping or STAB-08 response vocabulary.

**Non-goals:** do not synthesize approval requests, invent session/persistent scope, widen provider amendments, conflate permission review with consequential-action authorization, or claim live reachability from deterministic fixtures.

## Future ticket rows

ROVE-STAB-07 through ROVE-STAB-14 receive concrete entry state when their direct dependencies complete. Their existing ticket text is provisional sequencing, not frozen implementation truth.
