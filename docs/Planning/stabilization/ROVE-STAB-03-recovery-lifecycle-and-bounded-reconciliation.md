# ROVE-STAB-03 — Recovery lifecycle and bounded reconciliation

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Complete

**Dependencies:** STAB-01, STAB-02  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

Do not start from the original recovery hypothesis. Consume the completed STAB-02 handoff first: its proven Task/Runtime/Codex identity invariant, root cause(s), disproved hypotheses, persistence implications, exact verification evidence, and any new MR findings.

At ticket start, reconcile current `main` with the continuity ledger and record the exact start SHA. Recovery logic must be evaluated against the authority model actually established by STAB-02, not the model assumed when this ticket was first written.

### Concrete STAB-02 handoff

- consume implementation checkpoint `6758dfb3b47138670e498e6f99c290d1ea919956` plus the final STAB-02 handoff/PR head;
- filesystem aliases that prove the same exact protected per-Task workspace are authoritative, while outside, escaped, or unresolved paths remain blocked;
- historical request-human reconstruction now preserves exact Runtime client authority;
- Runtime inventory has its own monotonic transport coordinate and unchanged polls do not append events; do not rebuild recovery around provider `observationSeq`;
- the preserved 16-Task fixture copy clears all workspace blockers but every Task remains in recovery because of independent `thread_history_reconstructible` blockers;
- MR-001 now belongs here only for exact Codex blocker creation/clearing, bounded retry/terminal state, safe controls, and unrelated-Task isolation. Do not reopen the three STAB-02 authority roots without contradictory evidence.

First gate: on a fresh disposable copy of the preserved database, map every remaining blocker to the exact diagnostic/event that created it and the exact later evidence that should or should not clear it. Establish a failing case for MR-002 before changing reducer or reconciliation behavior.

### Actual entry state

- exact stacked start SHA: `af5c1a0de9bcd265b163d493364900f7d7822e04`;
- branch: `codex/stab03-recovery-lifecycle`;
- worktree clean at entry and based directly on the final pushed STAB-02 head;
- STAB-02 PR creation was attempted but unavailable because the authenticated GitHub account is not a collaborator; no PR was created or merged;
- read-only diagnosis will use a fresh disposable copy of the preserved fixture, never the original acceptance home or preserved baseline.
- implementation checkpoint: `75b028e5f4d9336d342396472177cf1f2321fc47` (`Bound recovery lifecycle and stale evidence`).
- durable handoff checkpoint: `9480dd48a97d42d76b4586c526c8505780746021` (`Record STAB-03 recovery handoff`), pushed to `origin/codex/stab03-recovery-lifecycle`;
- the stacked PR creation attempt against `codex/stab02-authority-convergence` failed because the authenticated GitHub account is not a collaborator. No PR was created or merged.

### Diagnosis and implementation evidence

- disposable fixture: `/private/tmp/rove-stab03-diagnosis.zPVKhI/task-process.v1.sqlite3`, copied from the preserved STAB-02 baseline and migrated independently;
- all 16 Tasks had one `thread_history_reconstructible` blocker; the ledger contained 96 startup `scheduled` observations and 32 terminal startup `unresolved` observations, with no successful reconciliation observation;
- three Tasks additionally retained an earlier event-delivery failure. The requested-handoff Task recorded the live `item/completed` failure, three failed repair attempts, and later unrelated item/request traffic. Nearby later traffic is not authority to clear missing exact history;
- MR-002 was reproduced before production edits: an exact successful reconciliation deleted its blocker, but a delayed older `unresolved` observation with the same blocker ID recreated it because the aggregate retained no success watermark;
- persisted compatibility normalization exposed a second MR-001 cause: clearing the false workspace reason left typed Codex blockers present while `recoveryRequired` remained null, so the blocker and customer state could disagree;
- recovery observations now carry an explicit attempt limit. `scheduled` means active checking, the final `unresolved` means exhausted recovery, and exact success records a bounded durable per-blocker watermark. Older failures cannot recreate newer resolved uncertainty, and older success cannot erase a newer failure;
- aggregate/projection normalization reconstructs blocker lifecycle and re-synchronizes the owned recovery reason without overwriting an unrelated recovery authority;
- exhausted Codex recovery projects customer-safe `Task state unclear` / `Couldn't continue` rather than indefinite Checking. Conversation remains readable and safe per-Task controls remain governed by the existing product authority;
- the disposable preserved fixture now normalizes 15 Tasks to bounded `unresolved` and one Task to its independent persisted `stopping` intent, while all 16 retain the exact terminal `unresolved:3/3` blocker. The Stop intent's command had already succeeded in the historical ledger; that separate customer execution-state defect remains with MR-009/MR-024 in STAB-06 rather than broadening this ticket.

## Invariant

A recovery blocker is created and cleared by exact matching authority. Recovery attempts are bounded. Exhausted recovery becomes a truthful bounded customer state; it does not remain Checking forever and does not freeze unrelated Tasks.

## Owns

MR-001 and MR-002 after authority convergence is correct.

## Acceptance criteria

- Successful exact history/runtime evidence clears only its matching blocker.
- Newer exact success cannot remain shadowed by stale historical failure.
- Retry budget and terminal unresolved state are explicit.
- Safe local conversation remains readable.
- Safe controls remain available when product authority permits them.
- One unresolved Task does not disable unrelated Task interaction.
- Retain actionable diagnostic category/detail without exposing mechanism text to customers.

The preserved persistent acceptance home must restart into either resolved Tasks or bounded inability-to-confirm states.

## Verification

Reconciler/TaskEngine focused tests → process-cut/restart tests → preserved SQLite home → multi-Task recovery Electron run.

Completed evidence:

- required failing MR-002 test failed before implementation, recreating the older blocker after newer exact success;
- focused affected subsystem: 10 files, 171 tests passed;
- `pnpm test:recovery:contract`: 63,417 assertions passed;
- `pnpm test:recovery:processes`: passed every local process/restart scenario after the expected restricted-sandbox loopback denial; no external services were contacted and terminal cleanup reported no stale processes, ports, profile locks, browsers, or Runtime sessions;
- disposable preserved SQLite read: 16 Tasks, all recovery markers synchronized, blocker shape `unresolved:3/3`, customer execution `unresolved` for 15 Tasks and the independent historical Stop intent for one;
- `pnpm check:repository`, `pnpm typecheck`, and `pnpm build`: passed;
- `pnpm test`: passed outside the restricted local-bind sandbox;
- `pnpm test:experiments`: 24 tests passed.

Not qualified here: original acceptance-home mutation/relaunch, credentialed or live model/provider work, packaged application, or human acceptance. The original acceptance home and preserved STAB-02 baseline remain untouched.

Checkpoint before STAB-05.

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
