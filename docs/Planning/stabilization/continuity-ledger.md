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

**Durable handoff checkpoint:** `32da33d65f00d9ddb814efe016570f79f4425345` (`Record STAB-08 approval handoff`), pushed to `origin/codex/stab08-approval-decision-fidelity`.

**PR state:** stacked PR creation against `codex/stab07-approval-policy-contract` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged. This external tooling boundary does not block STAB-09.

**Qualification boundary:** no live model, credentialed provider, external-service mutation, packaged application or human acceptance was run. The Electron journey is a credential-free deterministic rendering qualification, not evidence that a live provider emits each attention family. No preserved acceptance home was mutated.

**Finding disposition:** MR-007 and MR-008 are closed at schema/adapter/collaboration/renderer boundaries. STAB-09 owns deliberate live reachability, emitted-family characterization and actual decision-set evidence; it must preserve exact decisions and must not count the deterministic renderer fixture as live qualification.

**Next handoff:** push this PR-tooling record, then branch STAB-09 from the exact final STAB-08 head. STAB-09's first gate is to distinguish request families the provider can deliberately emit from those that remain unqualified, without reopening the STAB-07 policy mapping or STAB-08 response vocabulary.

**Non-goals:** do not synthesize approval requests, invent session/persistent scope, widen provider amendments, conflate permission review with consequential-action authorization, or claim live reachability from deterministic fixtures.

### ROVE-STAB-09 — COMPLETE

**Exact stacked start SHA:** `f390fae0e4c03ded6510b5749feee12fe740d896` (final pushed `codex/stab08-approval-decision-fidelity` head).

**Branch:** `codex/stab09-attention-family-reachability`; clean at entry. No predecessor PR was merged.

**Implementation checkpoints:** `ef5958a44286c4b36763f42830ac60ab9339af5b` (`Add attention reachability characterization`) and `06fd4e0dce85f91c77a57c3a21fb0c374eb05d24` (`Enable live conversational attention`).

**Root causes and disproved hypotheses:** the pinned provider's structured user-input capability was present but under-development and not enabled by the production launch, so a bounded question could fall back to transcript content. The production host also verified its sibling `codex-code-mode-host` but did not place the verified component directory on child `PATH`, making helper discovery depend on ambient process state. Direct `mcpServer/tool/call` is not a product-attention trigger: App Server connects the fixture but resolves its elicitation internally without forwarding `mcpServer/elicitation/request` to the application client. A prompt asking for network use does not imply a dedicated network request; both qualified providers emitted generic command approval without `networkApprovalContext`. No prompt or advertised tool produced additional-filesystem-permission attention.

**Invariant established:** production App Server launch now prepends the verified component directory and enables `default_mode_request_user_input`. The retained MCP server deliberately emits non-sensitive form and trusted-URL elicitations and has a direct protocol regression. `agent:attention-boundary` provides credential-free raw-protocol characterization. The explicitly guarded `agent:attention-live` harness covers conversational input, command, file, network, additional permission, MCP form and MCP URL with exact method, advertised-decision, context, thread and turn capture. It chooses only an advertised refusal/cancel response, supplies fixed non-sensitive form data, never opens the URL, and forbids alternate-capability retries.

**Live provider matrix:** pinned managed Codex `0.154.0-alpha.6.2` emitted exact thread/turn-bound `item/tool/requestUserInput` with the feature enabled and exact `item/fileChange/requestApproval`. Its attempted network command emitted `item/commandExecution/requestApproval` with `accept`, the exact command policy amendment and `cancel`, but no `networkApprovalContext`; the final run returned the exact advertised `cancel` and did not dispatch the command. Additional permission was unavailable. The pinned model catalog did not expose the connected fixture tools. Candidate application Codex `0.155.0-alpha.9.2` emitted both form and trusted-URL `mcpServer/elicitation/request` variants through live model turns; the form used fixed non-sensitive input and the URL was cancelled unopened. This closes the reachability investigation while preserving pinned MCP catalog support, dedicated network context and additional permission as explicit compatibility limitations rather than fabricated passes.

**Files and compatibility:** production changes are limited to `apps/companion/src/main/codex/app-server-host.ts` and its regression in `task-execution.test.ts`. Characterization lives in `experiments/agent-execution/attention-fixture-mcp-server.mjs`, its test, `live-app-server.mjs`, and package scripts. Product and implementation contracts, the issue registry, this ticket, and STAB-13's inherited qualification boundary were reconciled. No schema, persistence or migration changed. Promoting a provider with model-visible MCP fixture tools remains a separate component-qualification decision.

**Verification:** focused Companion/API/renderer/production-trace tests passed 4 files / 205 tests. `pnpm test:experiments` passed 25 tests. `pnpm check:repository` passed 711 files, 1,303 relative imports and 107 local document links; `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. Full `pnpm test` passed 202 files / 1,726 tests in 143.48 seconds; the prior MR-029 runner-exit symptom did not reproduce. Live qualification used only isolated temporary homes and the explicitly authorized account boundary. No requested file was added, no elicitation URL was opened, no additional permission was granted, and no command/network effect succeeded; the only executed command was harmless `true` after the provider determined it needed no approval.

**Finding disposition:** MR-010 and MR-027 are closed. MR-012 and MR-013 are closed as characterized pinned-provider compatibility limitations. MR-014 and MR-015 are closed as fixture defects and characterized provider-version gaps: candidate live support exists, pinned model-catalog exposure does not. MR-016's keyboard-only 820×700 presentation qualification remains owned by STAB-13.

**Durable handoff:** `84920cb343c52d9c4a843224037a8ea43c0fc2f4` (`Record STAB-09 attention handoff`) was pushed after the complete verification result. Stacked PR creation against `codex/stab08-approval-decision-fidelity` was attempted and failed because the authenticated GitHub account is not a collaborator. No PR was created or merged.

**Next handoff:** push the final PR-tooling boundary, then branch STAB-10 only from that exact final STAB-09 head. STAB-13 must consume the recorded provider matrix without requiring unavailable families to masquerade as live passes.

### ROVE-STAB-10 — COMPLETE

**Exact stacked start SHA:** `56ac23d3426a2c8ee3ccbf32ff3aa5848966253d` (final pushed `codex/stab09-attention-family-reachability` head).

**Branch:** `codex/stab10-handoff-browser-attachment-authority`; clean at entry. No predecessor PR was merged.

**Implementation checkpoints:** `c1b7fab52e1914db46994a90f59daf53613196b4` (`Qualify browser control handoffs`) and `324591793a26de400619851da82e6a337276cf7a` (`Verify exact handoff page focus`).

**First gate:** the existing `control:demo` qualification was not runnable: its root script overrode any caller-supplied temporary `ROVE_HOME` with a repository-local demo home, and the demo started a browser Task without creating/selecting the now-required browser workspace. The failed pre-fix run created only two generated files under `.rove-control-demo`; that untracked directory was removed after inspection.

**Root cause and invariant:** the underlying Task/Runtime authority defects had already been repaired by STAB-02/03/06, but the retained real-browser qualification was itself invalid: it overrode temporary-home authority, omitted required browser-workspace setup, skipped durable handoff acknowledgement, and asserted the wrong two-stage return freshness errors. No second product authority was required. The corrected boundary proves one Task/session/page/handoff identity through requested or voluntary takeover, exact-page focus, return and fresh grounding without deriving authority from selection, newest session or ambient browser focus.

**Invariant established:** `control:demo` now creates a self-cleaning temporary Rove home and selected non-sensitive browser workspace, then exercises real Runtime HTTP and Chromium. The live fixture qualifies requested handoff → exact durable acknowledgement → wait → takeover; Agent mutation fencing; document focus on the exact task-owned page; exact return; pre-inspection `INSPECTION_REQUIRED`; post-inspection `TARGET_STALE`; same-page identity; voluntary Companion takeover without a synthetic handoff; mutation fencing during human ownership; and return to Agent control. Structured output reported `requestedHandoff`, `voluntaryTakeover`, and `returnFreshness` as qualified on `page_01`.

**Composed evidence:** Task command/continuation recovery, exact Task Runtime authority, projection, main/follower parity and browser-window routing passed 11 files / 95 tests. That suite includes first-observation recovery after awaiting-human persistence, human takeover and Agent return across Desktop/App Server/Runtime restarts; older Task A routing despite newer Task B; exact-generation rejection; and main/follower takeover/return/checking agreement. Runtime/control/task projection coverage separately passed 8 files / 176 tests. `pnpm control:demo` passed repeatedly and includes the full repository build. The first sandboxed focused attempt produced only expected `listen EPERM` and Chromium sandbox launch failures; its permission-correct rerun passed. No external site, real account, preserved home, credential or consequential action was used.

**Verification:** `pnpm check:repository` passed 712 files, 1,303 relative imports and 107 local document links. `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test:experiments` (25 tests) passed. Full `pnpm test` passed 202 files / 1,726 tests in 135.63 seconds, including all 22 real process cut-point cases and all 117 Runtime integration cases. No assertion or timeout was weakened.

**Files and compatibility:** qualification changes are limited to `apps/runtime/src/demo/control-demo.ts`, the self-cleaning `experiments/agent-execution/browser-control-live.mjs` launcher, and the root `control:demo` script. No schema, persistence, wire format, provider version or production authority changed. MR-020 and MR-022 are closed. STAB-10's authority portion of MR-023 is closed; STAB-11 retains customer-safe browser recovery/presentation. STAB-10's authority/browser portion of MR-025 is closed; STAB-13 retains combined development-app, accessibility and packaged/native-surface qualification.

**Durable handoff:** `f652a58` (`Record STAB-10 browser handoff`) is pushed on `codex/stab10-handoff-browser-attachment-authority`.

**PR boundary:** the authorized stacked PR attempt against `codex/stab09-attention-family-reachability` failed with GitHub GraphQL `must be a collaborator`. No PR was created and nothing was merged.

**Next handoff:** commit and push this PR-tooling boundary, then branch STAB-11 only from that exact final STAB-10 head. STAB-11 must consume the established control authority without reopening it.

### ROVE-STAB-11 — COMPLETE

**Exact stacked start SHA:** `7d951d099ad770f547fd3df3c8db7360145ebc06` (final pushed `codex/stab10-handoff-browser-attachment-authority` head).

**Branch:** `codex/stab11-browser-resource-surface-ux`; clean at entry. No predecessor PR was merged.

**Implementation checkpoint:** `d24a3c6` (`Guide browser resource recovery`).

**Root causes:** the inspector rendered **Open Browser** unconditionally and sent all failures through the generic operation-error channel, so missing selected profiles, deleted frozen profiles and unconfirmed bound Runtime authority were neither distinguished nor customer-safe. The single unmatched Runtime session projection was injected into full selected-task content and also replaced chip/follower task status, making a device resource appear owned by whichever conversation was visible. Native browser following closed the full surface immediately from `showBrowser` and again as soon as the owned browser PID was observed, before a viable follower placement was known; a missing session observation, invalid geometry or failed reconciliation could therefore leave both hosts hidden.

**Invariant established:** browser presentation distinguishes exact attached authority, attachable ready Tasks, profile selection required, deleted frozen profile, bound Runtime recovery and unavailable lifecycle. Only exact attached/attachable states offer View/Open Browser; raw show failures collapse to guided recovery copy. Identity-less existing Tasks can use a later selected profile without replacing their conversation, while deleted frozen identities remain immutable and lead to a new-Task recovery. Unmatched cleanup is a device-global resource strip outside task content and no longer replaces chip/follower task state. The full surface yields only after the exact browser is native foreground and follower geometry resolves to a visible decision; true follower-disable states remain closed.

**Product and real-boundary evidence:** required renderer and controller regressions failed first. The focused surface/profile/authority suite passed 8 files / 92 tests. The built Electron walkthrough passed 44 screenshots and nine findings at `artifacts/customer-journeys/private-beta-walkthrough`, including multi-Task selection, profile-required recovery, deleted frozen-profile recovery, global unmatched cleanup outside `.product-layout`, exact cleanup and the inherited takeover/return journey. `pnpm surface:native-foreground` passed twice with separate real macOS foreground PIDs for the launched Playwright Chromium, exact CDP window geometry/page identity and viable transfer. Initial attempts to force an unrelated application foreground could not reliably displace Chromium in this automation session, so unrelated-foreground revocation remains honestly deterministic-only rather than a claimed live pass.

**Verification:** `pnpm lint`, `pnpm typecheck`, the Companion build, and `pnpm test:experiments` (25 tests) passed. `pnpm check:repository` passed 713 files, 1,306 relative imports and 107 local document links. The first default `pnpm test` run passed 201 files / 1,728 tests and failed one process-cut case; that exact case then passed alone and its complete file passed 22 / 22. A second default run passed the process-cut file but timed out in a different unchanged Runtime integration case; that exact case also passed alone. This is the existing MR-029 suite-load nondeterminism pattern, not a stable STAB-11 regression. The complete bounded-pressure matrix `pnpm vitest run --maxWorkers=4` passed 202 files / 1,729 tests in 176.51 seconds without weakening an assertion or timeout.

**Files and compatibility:** production changes are limited to Companion renderer browser presentation/styles and main-process surface-follow coordination. Tests, the Electron walkthrough fixture, a native foreground qualification harness, root script and the owning application/browser contracts changed with them. No schema, migration, persistence format, wire format, provider version, installed dependency or credential behavior changed. Fixture publication revisions were made monotonic and the browser-absent case no longer invents a Runtime session identity. MR-017, MR-018, MR-019, MR-021 and the remaining presentation portion of MR-023 are closed.

**Residual boundary and downstream handoff:** the real native harness proved exact browser foreground and viable follower transfer but not live unrelated-foreground revocation. STAB-13 inherits the repaired profile/resource/surface behavior and retains the combined development-app, narrow-layout, accessibility, packaged/native-surface matrix plus that live revocation check. STAB-12 remains independent and externally blocked on exact provider process-termination authority.

**Durable handoff:** `2f4c199` (`Record STAB-11 browser surface handoff`) is pushed on `codex/stab11-browser-resource-surface-ux`.

**PR boundary:** the authorized stacked PR attempt against `codex/stab10-handoff-browser-attachment-authority` failed with GitHub GraphQL `must be a collaborator`. No PR was created and nothing was merged.

**Next handoff:** commit and push this PR-tooling boundary, then continue to the independent STAB-12 provider-authority gate without reopening browser authority.

### ROVE-STAB-12 — IN PROGRESS; EXACT EXECUTION OWNERSHIP AUTHORIZED

**Exact stacked start SHA:** `448923348145966879a7ccb3155a71320b82b851` (final pushed `codex/stab11-browser-resource-surface-ux` head).

**Branch:** `codex/stab12-hard-stop-provider-qualification`; clean at entry. No predecessor PR was merged.

**Inherited authority boundary:** pinned Codex App Server `0.154.0-alpha.6.2` accepted exact `turn/interrupt` and reported the turn interrupted while a yielded local command still reached its completion sentinel. The preserved investigation remains local branch `codex/stop-process-cancellation-blocker`, commit `2723642`; it was inspected without merging or publishing it. Current upstream issue #42717 remains open, and upstream protocol still defines ordinary turn interrupt without background-terminal termination while exposing only thread-wide terminal cleanup. Neither an opaque provider process ID nor broad process killing is exact Rove authority.

**Current gate:** qualify the only locally available newer candidate, exact `0.155.0-alpha.9.2` executable SHA-256 `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`, through one opt-in live model turn in both default and supported `--disable unified_exec` modes. Record exact thread/turn/process metadata, interrupt acknowledgement, terminal status and delayed filesystem-sentinel evidence before any architecture decision.

**Candidate result:** both opt-in live runs used temporary workspaces and ephemeral threads, requested one harmless exact command, archived the thread best-effort and removed the workspace. Default mode acknowledged the interrupt and reported the exact turn `interrupted` in 13 ms, but the command wrote its sentinel after eight seconds. Supported `--disable unified_exec` mode reported `interrupted` in 8 ms and also wrote the sentinel. Both runs exposed a string `commandExecution.processId` bound to the exact turn and emitted no unexpected server request. Neither process ID was treated as OS authority; no external account, consequential service or broad kill was used.

**Disproved hypothesis:** the locally available newer provider or its non-unified execution mode does not convert turn interruption into exact local-process termination. MR-026 remains open and is no longer merely waiting for this candidate characterization.

**Decision boundary:** `docs/Engineering/hard-stop-execution-decision.md` records the three truthful options without selecting one: authorize a narrow Rove-owned exact execution/cancellation boundary, explicitly weaken and rename the customer promise, or retain Hard Stop as a release blocker pending provider support. Thread-wide terminal cleanup, PID guessing, process-name killing and UI-only settlement are rejected as non-authoritative.

**Files and compatibility:** STAB-12 adds only the opt-in `experiments/agent-execution/hard-stop-provider-qualification.mjs` harness, its root command and repository-owned decision/evidence documentation. No production source, schema, migration, persistence, wire contract, generated provider binding, approved-component selection, installed component or credential store changed. Candidate `0.155.0-alpha.9.2` was characterized in place; it was not qualified, installed or promoted as Rove's selected component.

**Verification:** both exact live commands (`pnpm agent:stop-live` and `pnpm agent:stop-live -- --disable-unified-exec` with the explicit opt-in and candidate executable) completed and returned structured `blocked` evidence. `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:experiments` (25 tests), and `pnpm check:repository` (715 files, 1,306 relative imports, 111 local document links) passed. The complete bounded-pressure matrix `pnpm vitest run --maxWorkers=4` passed 202 files / 1,729 tests in 122.00 seconds.

**Preserved reproduction:** the harness is self-cleaning, uses a fresh temporary workspace and delayed local sentinel on every run, requires `ROVE_ALLOW_LIVE_STOP=1`, accepts an explicit executable, records its digest and does not persist account data or command output. The prior local investigation branch/commit remains untouched.

**Durable blocked handoff:** `1b4bf15` (`Record hard stop authority blocker`) is pushed on `codex/stab12-hard-stop-provider-qualification`.

**PR boundary:** the authorized stacked PR attempt against `codex/stab11-browser-resource-surface-ux` failed with GitHub GraphQL `must be a collaborator`. No PR was created and nothing was merged.

**Next gate:** commit and push this PR-tooling record, then stop for explicit product/architecture authority. Do not implement an executor, weaken the customer contract, or advance STAB-13 as though the market-readiness blocker were resolved without that decision.

**Authority resumed — 27 September 2026:** explicit human product/architecture authority selected the Rove-owned exact execution/cancellation option. The existing **Stop** meaning is unchanged. Scope includes exact execution identity, launch/process-tree ownership, termination, observed exit, durable receipts, race handling, restart recovery, wrong-authority rejection, observability and production qualification while preserving approval, sandbox, credential, environment and Task isolation.

**Reconciled implementation direction:** provider-owned shell execution cannot remain the production launch path because neither selected nor candidate turn interruption terminates it. Candidate schemas expose exact thread/turn/call dynamic-tool callbacks plus sandboxed `command/exec` with a Rove-supplied connection-scoped process identity, exact terminate RPC and final response after exit/output drain. Those are the current integration candidates; terminate acknowledgement alone remains insufficient. The available candidate's standalone `exec-server` was also process-probed before any model turn and rejected as the local ownership boundary because it requires a remote registration URL and environment identity. Rove will not add that unrelated remote dependency for local Stop.

**Current implementation gate:** establish the durable execution ledger/supervisor and exact Stop settlement, then qualify candidate component cutover, sandbox/approval parity, connection-close containment and packaged cross-platform process trees. STAB-12 remains open and Hard Stop remains a release blocker until those gates pass.

**Delegate primitive qualification:** `experiments/agent-execution/command-exec-termination-qualification.mjs` now provides a credential-free, self-cleaning exact-process test for candidate `command/exec`. On macOS arm64, exact candidate `0.155.0-alpha.9.2` / SHA-256 `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9` ran two independently identified workspace-sandboxed commands. `command/exec/terminate` for only the first identity was followed by its final response (exit 137), its delayed child sentinel remained absent, and the unrelated command exited 0 and wrote its sentinel. The first run inside an already restricted outer sandbox caused both nested sandbox commands to exit 71; the permission-correct OS-boundary rerun passed and no assertion was weakened. This proves the candidate delegate's macOS exact-target/observed-exit behavior, not the still-unimplemented Task ledger, approval bridge, restart recovery, selected-component cutover or other platforms.

**Implemented exact boundary:** production now selects exact App Server `0.155.0-alpha.9.2`, registers the exact thread/turn/call-bound `rove_exec` dynamic tool and disables provider-owned local execution routes. The local execution supervisor assigns the immutable Rove execution and delegate identities before dispatch, binds Task operation/thread/turn/call/owner generation/command digest/permission profile, persists lifecycle and digest-protected final receipts through SQLite migration `0007_add_local_execution_supervision`, bounds output, rejects stale/cross-Task/wrong-generation authority, durably fences late calls, and waits for the original final `command/exec` response before Stop may settle. Codex turn interruption remains a later, separate Stop step.

**Restart and process-tree evidence:** the strengthened credential-free macOS arm64 harness qualifies selected `0.155.0-alpha.9.2` and retained rollback `0.154.0-alpha.6.2` under the named `rove_task` profile, with the App Server owner cwd deliberately separate from the Task workspace. Each exact termination returned final exit 137, suppressed the target child-tree sentinel and preserved an unrelated execution through exit 0. A separate owner-crash process proved the managed App Server owner death suppresses its command tree's delayed sentinel. Startup and generation replacement therefore settle prior-generation nonterminal records only as `owner_shutdown`; Rove never signals a persisted PID or guesses a process.

**Component and compatibility consequences:** selected generated schemas, compiled binding manifest, approved-component registry, experiment schema manifest and recovery stand-in now bind `0.155.0-alpha.9.2`; both selected and rollback component receipts carry the strengthened exact-execution evidence. Component install/verify refuses missing, mismatched or stale evidence. Protocol bindings now include dynamic-tool callbacks, exact command execution/termination/output, and selected-schema additions discovered by the full production process fixture. No credential material, inherited environment or unbounded command transcript enters the execution ledger.

**Verification checkpoint:** the real selected-component `pnpm agent:command-exec-stop` qualification passed, and selected plus rollback `pnpm codex:component:qualify ... --verify-registered-schema` runs passed. `pnpm test:desktop:codex-components`, Companion typecheck, the final focused 157-test component/protocol/adapter/workflow/supervisor/Task-execution set, `pnpm build`, `pnpm lint`, and `pnpm check:repository` passed. The production process trace passed 7/7. The complete 22-case real-process cut matrix was covered by an earlier 13-pass subset and repaired 9-pass subset, including component-generation replacement and acceptance/terminal/notification crash windows. A later single-run matrix passed 21/22; `repeatable_read: after_claim_before_dispatch` failed before execution dispatch because the Task was not yet handoff-ready, then passed in an immediate isolated rerun. The first full Codex subsystem run exposed selected-schema fixture drift rather than product failures; the missing account/model/start/MCP/resume fields were added and the affected process-backed suites passed after repair. Supervisor self-review added exact duplicate-callback reattachment without redispatch and its regression passed.

**Residual release blocker:** standalone `command/exec` can enforce the frozen named base profile but exposes neither the turn's existing approval reviewer nor an exact approved additional-permission amendment. Provider shell routes cannot remain enabled as an alternate opaque launcher, so the new boundary fails closed for work beyond `rove_task`. That preserves security but does not preserve the documented on-request human/automatic approval capability. STAB-12 and MR-026 remain open until a supported provider extension enforces exact Task/turn/call/generation-scoped amendments, including decline and stale-grant rejection. Packaged application and representative Windows/Linux process-tree qualification also remain open. This is the next genuine security/architecture gate; do not describe Stop as market-ready yet; only the independent STAB-13 matrix described below may advance.

**Provider grant authority selected — 27 September 2026:** explicit human architecture/security authority retained Codex as the sole authority for permission profiles, approval review and approval amendments. Rove owns exact execution supervision and cancellation but will not create a per-grant App Server delegate, synthesize a local grant from approval material, or infer authority from active profile, UI state, command failure or paths. Elevated `rove_exec` remains fail-closed until a supported provider seam can consume the exact human/automatic grant on the authoritative connection. The canonical hard-stop contract now specifies provider-issued grant identity, exact connection/thread/turn/request/profile/reviewer/grant/tool-call/execution binding, atomic pre-spawn validation, idempotent replay, provider-validated scoped reuse, expiry/revocation and typed stale/cross-authority rejection.

**Retained provider probe:** `pnpm agent:provider-grant-boundary` aliases the strengthened credential-free exact-execution harness and sends synthetic thread/turn/tool-call/grant fields with an attempted out-of-profile write to `command/exec`. Current selected-provider evidence shows permissive unknown-field acceptance, but `rove_task` still denies the elevated effect; neither parsing nor a generic exit is treated as approved-grant evidence. The normal base-profile control, process-tree termination and owner-crash checks remain separate positive evidence. Qualification receipts record `elevatedPermissionGrantConsumption: false`, so component verification cannot accidentally turn base-profile qualification into an elevated-execution claim. A future promising provider requires an intentional harness adapter and real human/automatic grant-consumption matrix before that value may change.

**Final base-profile verification — 27 September 2026:** the retained provider-grant probe passed for selected `0.155.0-alpha.9.2` and rollback `0.154.0-alpha.6.2`: both providers accepted the synthetic unknown binding fields, completed the request with exit 1 under `rove_task`, and produced no out-of-profile effect. Both component qualification receipts were regenerated and verified with `elevatedPermissionGrantConsumption: false`. `pnpm test:desktop:codex-components`, Companion typecheck, `pnpm lint`, `pnpm build`, `pnpm test:experiments` (25 tests), and `pnpm check:repository` (720 files, 1,316 relative imports, 113 local document links) passed. Full `pnpm test` passed 203 files / 1,737 tests in 143.45 seconds, including all 22 real process cut-point cases and all 117 Runtime integration cases. No assertion or timeout was weakened.

**Durable base-profile checkpoint:** commit `a1e7155` (`Supervise exact local command execution`) contains the coherent exact-execution implementation, provider-owned grant boundary, retained qualification harness, refreshed component receipts and final verification record. This checkpoint does not close STAB-12, claim elevated execution, qualify packaged Windows/Linux process trees, or authorize a merge.

**Downstream disposition:** STAB-12 remains open, but independent STAB-13 accessibility, responsive, multi-Task, main/follower and supported base-profile composition qualification may proceed. Those matrices must exclude elevated local execution from pass claims and route any dependent journey back to this blocker. STAB-14 may inventory and exercise the blocker but cannot declare market readiness when the final release contract requires elevated execution. No PR has been merged.

**STAB-13 independent qualification started — 27 September 2026:** local branch `codex/stab13-cross-cutting-qualification` starts at STAB-12 continuation checkpoint `1bc980e`. The retained production-projection Electron journey passed 28 screenshots across 1180×780 and 820×700. Its assertions cover Working/Queue/Steer/Stop presentation, all seven attention families, requested and voluntary browser control, Return/checking, recovery, failure versus uncertainty, long content, reduced motion, Latest/reading-position preservation, main/follower parity and multi-Task selection stability. The contact sheet and narrow attention screenshots were visually inspected. The fixture still records `stopProcessTerminationQualified: false` because process termination is deliberately proven only by the separate exact-execution harness; elevated execution remains excluded.

**STAB-13 findings and correction:** MR-032 recorded stale qualification provenance and pre-STAB-12 manual wording before correction; the generated manifest now derives the actual Git branch and the manual boundary points to separate base-profile process evidence while retaining the elevated blocker. Extending the matrix to combine every attention family with keyboard-only navigation and visible focus at 820×700 exposed MR-033: scoped command approval labels and consequences visually ran together. MR-033 was routed to the existing approval UX family, corrected with an explicit stacked layout/gap, and retained through a computed-style assertion plus refreshed screenshot. The final matrix passed with every family keyboard-reachable, no document overflow and no out-of-viewport dialog. The focused projection/surface suite passed 12 files / 201 tests.

**STAB-13 real/package evidence and residuals:** `pnpm surface:native-foreground` qualified an exact native Chromium PID, exact CDP page/window identity and viable full-surface-to-follower transfer on macOS; unrelated-foreground revocation remains deterministic-only. `pnpm package:desktop:dir` produced an unsigned darwin/arm64 directory package and `pnpm test:desktop:package` passed. The first sandboxed package attempt was interrupted during expected registry retries, and the first smoke attempt was denied loopback bind permission; both permission-correct reruns passed. After the final scoped style/harness change, the focused projection/surface suite passed 12 files / 201 tests, `pnpm check:repository` passed 720 files / 1,316 relative imports / 113 links, and `pnpm lint`, `pnpm typecheck` and `pnpm test:experiments` (25 tests) passed. Development-app human acceptance, the broader packaged interaction matrix and unrelated-foreground revocation remain open. No elevated-execution or market-readiness claim is made.

**Durable STAB-13 partial checkpoint:** commit `f8e51cf` (`Qualify cross-cutting task interactions`) contains the MR-016 combined accessibility matrix, MR-032/MR-033 corrections, exact provenance, native foreground evidence and package qualification record. STAB-13 remains in progress at the residual gates above. STAB-12 through `1bc980e` is published at `origin/codex/stab12-hard-stop-provider-qualification`; STAB-13 through continuation commit `0e63728` is published at `origin/codex/stab13-cross-cutting-qualification`. Neither branch is merged.

## Future ticket rows

ROVE-STAB-07 through ROVE-STAB-14 receive concrete entry state when their direct dependencies complete. Their existing ticket text is provisional sequencing, not frozen implementation truth.
